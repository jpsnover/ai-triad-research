#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""t/3149 WS-B precision@3 re-labeling via an LLM genuine-support judge.

The WS-B proposal step (propose_links.py, t/3014) is deterministic embedding-cosine
top-N, so the only stochastic stage is the *labeling*. This harness runs an LLM judge
over a cosine-stratified sample of the proposed situation->POV-node links across N
independent passes and reports precision@3 as a distribution (mean +/- SD across passes
= run-instability), separately from within-pass bootstrap CI (= estimation-uncertainty).

t/2990 measured precision@3 = 0.63 as a single draw with CL-*agent* labels and did NOT
persist them. This ticket (t/3149) switches to an automated LLM judge (a DIFFERENT
instrument -- a non-comparability boundary, recorded in the register) and persists all
labels so future bootstraps are possible.

Pure read of the data repo; writes only the labels + summary JSON in this dir.

Usage:
    python judge_links.py --dry-run          # sample + show, no LLM calls
    python judge_links.py                     # full run (default 20/band x 4 bands x 3 passes)
    python judge_links.py --per-band 20 --passes 3 --model gemini-2.5-flash --temperature 0.7
"""

import argparse
import json
import math
import os
import random
import statistics
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
# Cosine bands (align with the register's 4-band precision profile 0.27->0.53->0.60->0.80).
BANDS = [(-1.0, 0.45), (0.45, 0.55), (0.55, 0.65), (0.65, 2.0)]
BAND_LABELS = ["<0.45", "0.45-0.55", "0.55-0.65", ">=0.65"]
CAMPS = {"acc": "accelerationist", "saf": "safetyist", "skp": "skeptic"}
SEED = 3149

JUDGE_PROMPT = """You are labeling whether a real-world SITUATION provides genuine \
evidential support for a POLICY-DEBATE CLAIM held by one camp in an AI-policy debate.

Decision criterion (disclosed, apply it literally):
Label genuine_support = true ONLY IF the situation is a concrete instance, scenario, or \
piece of evidence that a reasonable analyst would cite as bearing on the truth, urgency, \
or applicability of THIS specific claim (it exemplifies, tests, or provides evidence for/against it).
Label genuine_support = false if the situation is merely on the same broad topic, shares \
vocabulary, or is only loosely associated -- topical adjacency is NOT genuine support.

CAMP: {camp}
CLAIM (the {camp} position, from the taxonomy node "{node_id}"):
{node_desc}

SITUATION:
label: {sit_label}
description: {sit_desc}
this camp's reading of the situation:
  belief: {belief}
  desire: {desire}
  intention: {intention}

Return ONLY a JSON object, no prose:
{{"genuine_support": true|false, "reason": "<=20 words"}}"""


def resolve_data_root() -> Path:
    env = os.environ.get("AI_TRIAD_DATA_ROOT")
    if env:
        return Path(env)
    # find repo root (.aitriad.json) upward, then its data_root
    p = HERE
    while p != p.parent:
        cfg = p / ".aitriad.json"
        if cfg.exists():
            dr = json.loads(cfg.read_text(encoding="utf-8")).get("data_root", "../ai-triad-data")
            return (p / dr) if not Path(dr).is_absolute() else Path(dr)
        p = p.parent
    raise SystemExit("cannot resolve data root")


def band_index(score: float) -> int:
    for i, (lo, hi) in enumerate(BANDS):
        if lo <= score < hi:
            return i
    return len(BANDS) - 1


def load_context(tax: Path):
    situations = json.loads((tax / "situations.json").read_text(encoding="utf-8"))["nodes"]
    sit_by_id = {s.get("id"): s for s in situations}
    node_desc = {}
    for fname in ("accelerationist.json", "safetyist.json", "skeptic.json"):
        for n in json.loads((tax / fname).read_text(encoding="utf-8"))["nodes"]:
            node_desc[n.get("id")] = n.get("description", "")
    return sit_by_id, node_desc


def build_prompt(link, sit_by_id, node_desc) -> str:
    sit = sit_by_id[link["situation_id"]]
    camp_full = CAMPS[link["camp"]]
    interp = (sit.get("interpretations") or {}).get(camp_full) or {}
    if not isinstance(interp, dict):
        interp = {}
    return JUDGE_PROMPT.format(
        camp=camp_full,
        node_id=link["node_id"],
        node_desc=node_desc.get(link["node_id"], "")[:1200],
        sit_label=sit.get("label", ""),
        sit_desc=(sit.get("description", "") or "")[:1200],
        belief=interp.get("belief", "") or "",
        desire=interp.get("desire", "") or "",
        intention=interp.get("intention", "") or "",
    )


def parse_verdict(text: str):
    """Extract {genuine_support, reason} from a model response, robust to code fences."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1] if "```" in t[3:] else t
        t = t.lstrip("json").strip("` \n")
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        obj = json.loads(t[start : end + 1])
        gs = obj.get("genuine_support")
        if isinstance(gs, bool):
            return {"genuine_support": gs, "reason": str(obj.get("reason", ""))[:200]}
    except (json.JSONDecodeError, AttributeError):
        return None
    return None


def sample_links(proposal, per_band):
    rng = random.Random(SEED)
    by_band = {i: [] for i in range(len(BANDS))}
    for r in proposal:
        by_band[band_index(r["score"])].append(r)
    sample = []
    for i in range(len(BANDS)):
        pool = sorted(by_band[i], key=lambda r: (r["situation_id"], r["camp"], r["node_id"]))
        rng.shuffle(pool)
        take = pool[: min(per_band, len(pool))]
        for r in take:
            r = dict(r)
            r["band"] = i
            sample.append(r)
    pop_weights = [len(by_band[i]) / len(proposal) for i in range(len(BANDS))]
    return sample, pop_weights, {i: len(by_band[i]) for i in range(len(BANDS))}


def pop_weighted_precision(labels_by_band, pop_weights):
    """labels_by_band: {band_idx: [0/1,...]}. Returns population-weighted mean, renormalizing
    weights over bands that actually have labels."""
    num, wsum = 0.0, 0.0
    for i, labs in labels_by_band.items():
        if labs:
            w = pop_weights[i]
            num += w * (sum(labs) / len(labs))
            wsum += w
    return num / wsum if wsum else float("nan")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-band", type=int, default=20)
    ap.add_argument("--passes", type=int, default=3)
    ap.add_argument("--model", default="gemini-2.5-flash")
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--labels-out", default=str(HERE / "wsb_precision_labels.json"))
    ap.add_argument("--summary-out", default=str(HERE / "wsb_precision_summary.json"))
    args = ap.parse_args()

    proposal = json.loads((HERE / "proposal.json").read_text(encoding="utf-8"))
    tax = (resolve_data_root() / "taxonomy/Origin").resolve()
    sit_by_id, node_desc = load_context(tax)

    sample, pop_weights, band_pop = sample_links(proposal, args.per_band)
    band_counts = {BAND_LABELS[i]: sum(1 for r in sample if r["band"] == i) for i in range(len(BANDS))}
    print(f"[sample] {len(sample)} links; per-band {band_counts}; "
          f"pop weights {[round(w, 4) for w in pop_weights]}")

    if args.dry_run:
        print("\n[dry-run] first sampled prompt:\n")
        print(build_prompt(sample[0], sit_by_id, node_desc)[:1400])
        return 0

    import google.generativeai as genai
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY", os.environ.get("AI_API_KEY", "")))
    gcfg = {"temperature": args.temperature, "response_mime_type": "application/json"}
    model = genai.GenerativeModel(args.model, generation_config=gcfg)

    # labels[link_key][pass_idx] = {genuine_support, reason}
    records = []
    for r in sample:
        records.append({
            "situation_id": r["situation_id"], "camp": r["camp"], "node_id": r["node_id"],
            "score": r["score"], "rank": r["rank"], "band": BAND_LABELS[r["band"]],
            "labels": [],
        })

    from concurrent.futures import ThreadPoolExecutor

    def judge_one(link):
        prompt = build_prompt(link, sit_by_id, node_desc)
        for attempt in range(4):
            try:
                resp = model.generate_content(prompt)
                v = parse_verdict(resp.text or "")
                if v is not None:
                    return v
            except Exception as e:  # noqa: BLE001 - record + retry transient API errors (429/5xx)
                sys.stderr.write(f"  [warn] {link['situation_id']}/{link['camp']} "
                                 f"a{attempt}: {type(e).__name__}: {e}\n")
            time.sleep(0.8 * (attempt + 1))
        return {"genuine_support": None, "reason": "PARSE/API_ERROR"}

    errors = 0
    for p in range(args.passes):
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            results = list(ex.map(judge_one, sample))
        for rec, v in zip(records, results):
            rec["labels"].append(v)
            if v["genuine_support"] is None:
                errors += 1
        # checkpoint after each pass so a kill never loses completed passes
        Path(args.labels_out).write_text(
            json.dumps({"ticket": "t/3149", "model": args.model, "temperature": args.temperature,
                        "seed": SEED, "passes_done": p + 1, "records": records},
                       indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[pass {p}] done in {time.time() - t0:.0f}s ({errors} errors cumulative)", flush=True)

    # per-pass population-weighted precision@3
    per_pass_prec = []
    per_pass_band_prec = []
    for p in range(args.passes):
        by_band = {i: [] for i in range(len(BANDS))}
        for rec in records:
            lab = rec["labels"][p]["genuine_support"]
            if lab is not None:
                bi = BAND_LABELS.index(rec["band"])
                by_band[bi].append(1 if lab else 0)
        per_pass_prec.append(pop_weighted_precision(by_band, pop_weights))
        per_pass_band_prec.append({
            BAND_LABELS[i]: (sum(by_band[i]) / len(by_band[i]) if by_band[i] else None)
            for i in range(len(BANDS))
        })

    mean_prec = statistics.mean(per_pass_prec)
    sd_prec = statistics.stdev(per_pass_prec) if len(per_pass_prec) > 1 else 0.0

    # per-band mean +/- SD across passes
    band_stats = {}
    for i in range(len(BANDS)):
        vals = [pp[BAND_LABELS[i]] for pp in per_pass_band_prec if pp[BAND_LABELS[i]] is not None]
        band_stats[BAND_LABELS[i]] = {
            "mean": statistics.mean(vals) if vals else None,
            "sd": (statistics.stdev(vals) if len(vals) > 1 else 0.0) if vals else None,
            "n_per_pass": band_pop_sample(records, BAND_LABELS[i]),
        }

    # within-pass bootstrap (estimation-uncertainty) on pass 0 labels, resampling links per band
    boot = bootstrap_ci(records, pop_weights, pass_idx=0, iters=2000)

    summary = {
        "ticket": "t/3149",
        "instrument": "LLM genuine-support judge (disclosed criterion)",
        "model": args.model,
        "temperature": args.temperature,
        "seed": SEED,
        "sample_per_band": args.per_band,
        "sample_total": len(records),
        "passes": args.passes,
        "band_population": band_pop,
        "population_weights": {BAND_LABELS[i]: round(pop_weights[i], 4) for i in range(len(BANDS))},
        "precision_at_3": {
            "per_pass": [round(x, 4) for x in per_pass_prec],
            "mean": round(mean_prec, 4),
            "sd_across_passes_RUN_INSTABILITY": round(sd_prec, 4),
            "bootstrap95_within_pass0_ESTIMATION_UNCERTAINTY": boot,
        },
        "per_band_precision": band_stats,
        "parse_or_api_errors": errors,
        "baseline_t2990": {"precision_at_3": 0.63, "instrument": "CL-agent labels (single draw, not persisted)"},
        "notes": "Instrument change (CL-agent -> LLM judge) is a non-comparability boundary. "
                 "SD across passes = run-instability (arXiv run-drift); bootstrap CI = estimation-uncertainty.",
    }

    Path(args.labels_out).write_text(
        json.dumps({"ticket": "t/3149", "model": args.model, "temperature": args.temperature,
                    "seed": SEED, "records": records}, indent=2, ensure_ascii=False),
        encoding="utf-8")
    Path(args.summary_out).write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\n=== precision@3 ===")
    print(f"per-pass: {[round(x, 4) for x in per_pass_prec]}")
    print(f"mean {mean_prec:.4f} +/- {sd_prec:.4f} (SD across passes = run-instability)")
    print(f"bootstrap95 within pass0 (estimation-uncertainty): {boot}")
    print(f"per-band: {json.dumps(band_stats, indent=2)}")
    print(f"errors: {errors}")
    print(f"\nwrote {args.labels_out}\nwrote {args.summary_out}")
    return 0


def band_pop_sample(records, band_label):
    return sum(1 for r in records if r["band"] == band_label)


def bootstrap_ci(records, pop_weights, pass_idx, iters=2000):
    """Population-weighted precision@3 bootstrap: resample links within band, pass `pass_idx`."""
    rng = random.Random(SEED + 7)
    by_band = {i: [] for i in range(len(BANDS))}
    for rec in records:
        lab = rec["labels"][pass_idx]["genuine_support"]
        if lab is not None:
            by_band[BAND_LABELS.index(rec["band"])].append(1 if lab else 0)
    ests = []
    for _ in range(iters):
        num, wsum = 0.0, 0.0
        for i, labs in by_band.items():
            if labs:
                res = [labs[rng.randrange(len(labs))] for _ in labs]
                w = pop_weights[i]
                num += w * (sum(res) / len(res))
                wsum += w
        if wsum:
            ests.append(num / wsum)
    ests.sort()
    if not ests:
        return None
    lo = ests[int(0.025 * len(ests))]
    hi = ests[int(0.975 * len(ests))]
    return {"lo": round(lo, 4), "hi": round(hi, 4), "iters": iters}


if __name__ == "__main__":
    raise SystemExit(main())
