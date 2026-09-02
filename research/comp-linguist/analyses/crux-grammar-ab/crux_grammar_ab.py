#!/usr/bin/env python3
"""t/3144 step 2 — A/B the neutral-evaluator crux-status grammar (3-option vs +undecidable).

Isolates the GRAMMAR variable by holding the crux SET fixed:
  arm A = the existing 3-option labels already on `neutral_evaluations[-1].cruxes[].status`
          (addressed | partially_addressed | unaddressed), no new call.
  arm B = one new classification pass per debate with the pinned evaluator model, over the
          SAME given cruxes, using a 4-option grammar (+ undecidable). We GIVE the cruxes
          (never re-identify) so the crux set can't drift (t/1670 lesson).
Output: the absorption matrix (armA x armB) — how much `undecidable` drains from
partially_addressed vs unaddressed vs addressed — and crux_addressed_rate under A vs B.

Faithful-port note (reproduce-before-assert / checklist ch.6): arm B reuses the shipped
neutralEvaluator framing + constraints verbatim; the DELIBERATE, documented deviation is
(a) cruxes are given not re-identified and (b) the task is status-classification only with
the 4th option — exactly the grammar change Rec-2 would ship. Evaluator model pinned to
gemini-3.5-flash-lite (t/1835/t/1843: crux metrics are evaluator-model-relative).

Pure read of the data repo; writes only labels + summary JSON in --out-dir. No LLM on --dry-run.
"""
import argparse, json, os, random, statistics, sys, time
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
SEED = 3144
STATES_A = ["addressed", "partially_addressed", "unaddressed"]
STATES_B = STATES_A + ["undecidable"]

def resolve_data_root() -> Path:
    env = os.environ.get("AI_TRIAD_DATA_ROOT")
    if env:
        return Path(env)
    return Path(r"C:\Users\jsnov\repos\ai-triad-data")

# Arm-B prompt: shipped neutralEvaluator framing/constraints, restructured to classify a GIVEN
# fixed crux set with the 4-option grammar. Only `undecidable` carries a disclosed definition
# (the other three are self-descriptive, as in the shipped prompt).
ARM_B_PROMPT = """You are an independent, neutral evaluator of a structured debate. You have NO affiliation with any speaker. You do not know the speakers' backgrounds, affiliations, or commitments. They are anonymous.

TOPIC: {topic}

You are given the CRUXES already identified in this debate (the core disagreements that, if resolved, would change one or more speakers' conclusions). Do NOT add, remove, or merge cruxes. For EACH given crux, classify whether the debate addressed it, using EXACTLY one of these four statuses:
   - addressed: the debate engaged the crux and moved it toward resolution
   - partially_addressed: the debate engaged the crux but left it substantially open
   - unaddressed: the debate did not engage the crux
   - undecidable: the debate did not produce enough evidence or engagement to determine whether the crux was addressed (it was raised or implied but never adjudicated either way)

CONSTRAINTS:
- Never refer to speakers by anything other than their labels (Speaker A, Speaker B, Speaker C, Moderator).
- Base your assessment ONLY on what appears in the transcript. Do not bring outside knowledge about the topic.
- Return ONLY valid JSON matching the schema below. No markdown fences, no preamble.

GIVEN CRUXES:
{cruxes_block}

OUTPUT SCHEMA:
{{"cruxes": [{{"id": "crux-1", "status": "addressed | partially_addressed | unaddressed | undecidable"}}]}}

TRANSCRIPT:
{transcript}"""

# Arm A' — the 3-option CONTROL: byte-identical to ARM_B_PROMPT except it omits `undecidable`
# (bullet + schema). A'↔B isolates the GRAMMAR alone (same prompt structure); shipped-A↔A'
# isolates the prompt-structure/reclassification effect (full-eval vs classification-only).
ARM_A_PROMPT = """You are an independent, neutral evaluator of a structured debate. You have NO affiliation with any speaker. You do not know the speakers' backgrounds, affiliations, or commitments. They are anonymous.

TOPIC: {topic}

You are given the CRUXES already identified in this debate (the core disagreements that, if resolved, would change one or more speakers' conclusions). Do NOT add, remove, or merge cruxes. For EACH given crux, classify whether the debate addressed it, using EXACTLY one of these three statuses:
   - addressed: the debate engaged the crux and moved it toward resolution
   - partially_addressed: the debate engaged the crux but left it substantially open
   - unaddressed: the debate did not engage the crux

CONSTRAINTS:
- Never refer to speakers by anything other than their labels (Speaker A, Speaker B, Speaker C, Moderator).
- Base your assessment ONLY on what appears in the transcript. Do not bring outside knowledge about the topic.
- Return ONLY valid JSON matching the schema below. No markdown fences, no preamble.

GIVEN CRUXES:
{cruxes_block}

OUTPUT SCHEMA:
{{"cruxes": [{{"id": "crux-1", "status": "addressed | partially_addressed | unaddressed"}}]}}

TRANSCRIPT:
{transcript}"""

def strip_transcript(d) -> str:
    lines = []
    for t in (d.get("transcript") or []):
        if not isinstance(t, dict):
            continue
        sp = t.get("speaker") or t.get("pov") or t.get("role") or t.get("speaker_label") or "?"
        txt = t.get("content") or t.get("text") or t.get("message") or t.get("body") or ""
        if isinstance(txt, dict):
            txt = txt.get("text") or json.dumps(txt)
        if txt:
            lines.append(f"Speaker {sp}: {txt}")
    return "\n\n".join(lines)

def never_resolved_frac(d) -> float:
    ct = d.get("crux_tracker") or []
    if not ct:
        return 0.0
    ident = sum(1 for c in ct if c.get("state") == "identified")
    return ident / len(ct)

def load_debates(data_root):
    out = []
    ddir = data_root / "debates"
    for fn in sorted(ddir.glob("debate-*.json")):
        try:
            d = json.loads(fn.read_text(encoding="utf-8"))
        except Exception:
            continue
        ne = d.get("neutral_evaluations")
        if not (d.get("crux_tracker") and ne):
            continue
        last = ne[-1] if isinstance(ne, list) else ne
        cruxes = [c for c in (last.get("cruxes") or []) if c.get("status") in STATES_A]
        if not cruxes:
            continue
        tp = d.get("topic")
        if isinstance(tp, dict):
            tp = tp.get("final") or tp.get("original") or tp.get("refined") or ""
        topic = tp or d.get("title") or ""
        out.append({"id": d.get("id"), "file": fn.name, "topic": topic,
                    "never_resolved": never_resolved_frac(d), "cruxes": cruxes, "transcript": strip_transcript(d)})
    return out

def parse_arm_b(text):
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1].lstrip("json").strip("` \n") if "```" in t[3:] else t
    s, e = t.find("{"), t.rfind("}")
    if s == -1 or e == -1:
        return None
    try:
        obj = json.loads(t[s:e+1])
        return {c["id"]: c.get("status") for c in obj.get("cruxes", []) if c.get("id")}
    except Exception:
        return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-never-resolved", type=float, default=0.5)
    ap.add_argument("--max-debates", type=int, default=12)
    ap.add_argument("--passes", type=int, default=3)
    ap.add_argument("--model", default="gemini-3.5-flash-lite")
    ap.add_argument("--temperature", type=float, default=0.2)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out-dir", default=str(HERE))
    args = ap.parse_args()

    data_root = resolve_data_root()
    debates = load_debates(data_root)
    hi = [x for x in debates if x["never_resolved"] >= args.min_never_resolved]
    rng = random.Random(SEED)
    rng.shuffle(hi)
    sample = sorted(hi[:args.max_debates], key=lambda x: x["id"])
    n_cruxes = sum(len(x["cruxes"]) for x in sample)
    armA = Counter(c["status"] for x in sample for c in x["cruxes"])
    print(f"[pop] debates with both structures: {len(debates)} | high-never_resolved(>= {args.min_never_resolved}): {len(hi)}")
    print(f"[sample] {len(sample)} debates, {n_cruxes} cruxes | arm-A dist: {dict(armA)}")

    if args.dry_run:
        d0 = sample[0]
        cb = "\n".join(f'- {c["id"]}: {c["description"]}' for c in d0["cruxes"])
        p = ARM_B_PROMPT.format(topic=d0["topic"], cruxes_block=cb, transcript=d0["transcript"][:1500])
        print("\n[dry-run] first arm-B prompt (transcript truncated):\n")
        print(p[:2600])
        return 0

    import google.generativeai as genai
    genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
    model = genai.GenerativeModel(args.model, generation_config={"temperature": args.temperature, "response_mime_type": "application/json"})
    from concurrent.futures import ThreadPoolExecutor

    def classify(deb, tmpl):
        cb = "\n".join(f'- {c["id"]}: {c["description"]}' for c in deb["cruxes"])
        prompt = tmpl.format(topic=deb["topic"], cruxes_block=cb, transcript=deb["transcript"][:24000])
        for attempt in range(4):
            try:
                r = model.generate_content(prompt)
                v = parse_arm_b(r.text or "")
                if v:
                    return v
            except Exception as ex:
                sys.stderr.write(f"  [warn] {deb['id']} a{attempt}: {type(ex).__name__}\n")
            time.sleep(0.8 * (attempt + 1))
        return {}

    def run_arm(tmpl, name):
        ps = []
        for p in range(args.passes):
            t0 = time.time()
            with ThreadPoolExecutor(max_workers=args.workers) as ex:
                res = list(ex.map(lambda deb: classify(deb, tmpl), sample))
            ps.append({deb["id"]: labels for deb, labels in zip(sample, res)})
            print(f"[{name} pass {p}] {time.time()-t0:.0f}s", flush=True)
        return ps

    passes_A = run_arm(ARM_A_PROMPT, "A'(3opt)")   # control: same prompt, 3 options
    passes_B = run_arm(ARM_B_PROMPT, "B(4opt)")    # treatment: +undecidable

    def addr_rate(ps):  # per-pass fraction 'addressed' over all classified cruxes
        out = []
        for pp in ps:
            allx = [pp.get(deb["id"], {}).get(c["id"]) for deb in sample for c in deb["cruxes"]]
            allx = [x for x in allx if x in STATES_B]
            out.append(sum(1 for x in allx if x == "addressed") / len(allx) if allx else float("nan"))
        return out
    rate_Ap, rate_B = addr_rate(passes_A), addr_rate(passes_B)
    rate_A_shipped = armA["addressed"] / n_cruxes

    # undecidable usage in B across ALL passes (the decisive number)
    undec_by_pass = [sum(1 for deb in sample for c in deb["cruxes"] if pp.get(deb["id"], {}).get(c["id"]) == "undecidable") for pp in passes_B]

    # clean grammar absorption: A'(pass0) -> B(pass0), same prompt structure
    absorption = defaultdict(Counter)
    for deb in sample:
        for c in deb["cruxes"]:
            a0 = passes_A[0].get(deb["id"], {}).get(c["id"])
            b0 = passes_B[0].get(deb["id"], {}).get(c["id"])
            if a0 in STATES_B and b0 in STATES_B:
                absorption[a0][b0] += 1

    mean = lambda xs: statistics.mean([x for x in xs if x == x]) if any(x == x for x in xs) else float("nan")
    sd = lambda xs: statistics.stdev([x for x in xs if x == x]) if len([x for x in xs if x == x]) > 1 else 0.0
    summary = {
        "ticket": "t/3144", "step": 2, "model": args.model, "temperature": args.temperature,
        "seed": SEED, "passes": args.passes, "min_never_resolved": args.min_never_resolved,
        "n_debates": len(sample), "n_cruxes": n_cruxes, "arm_A_shipped_distribution": dict(armA),
        "DECISIVE_undecidable_usage_in_B_per_pass": undec_by_pass,
        "grammar_absorption_Aprime_to_B_pass0": {a: dict(absorption[a]) for a in STATES_B},
        "crux_addressed_rate": {
            "A_shipped_labels": round(rate_A_shipped, 4),
            "Aprime_3opt_mean": round(mean(rate_Ap), 4), "Aprime_per_pass": [round(x, 4) for x in rate_Ap],
            "B_4opt_mean": round(mean(rate_B), 4), "B_per_pass": [round(x, 4) for x in rate_B],
            "GRAMMAR_effect_Aprime_minus_B": round(mean(rate_Ap) - mean(rate_B), 4),
            "reclassification_effect_shipped_minus_Aprime": round(rate_A_shipped - mean(rate_Ap), 4),
            "reclass_run_instability_sd": {"Aprime": round(sd(rate_Ap), 4), "B": round(sd(rate_B), 4)},
        },
        "interpretation": "GRAMMAR_effect isolates the +undecidable option (A' vs B, identical prompt); "
                          "reclassification_effect is the confound (shipped full-eval vs classification-only "
                          "re-run). If undecidable usage ~0 and GRAMMAR_effect ~0, the missing option does NOT "
                          "distort crux_addressed_rate — the t/3097 artifact hypothesis is not supported for "
                          "this model, and any shipped-vs-reclassified gap is re-run noise, not grammar.",
    }
    outp = Path(args.out_dir)
    (outp / "crux_grammar_ab_labels.json").write_text(json.dumps({"passes_A": passes_A, "passes_B": passes_B, "sample_ids": [x["id"] for x in sample]}, indent=2, ensure_ascii=False), encoding="utf-8")
    (outp / "crux_grammar_ab_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\n=== DECISIVE: undecidable usage in B per pass ===", undec_by_pass)
    print("=== grammar absorption A'(3opt) -> B(4opt), pass0 ===")
    for a in STATES_B:
        if absorption[a]: print(f"  {a:22s} -> {dict(absorption[a])}")
    print(f"\ncrux_addressed_rate: shipped-A={rate_A_shipped:.3f}  A'(3opt)={mean(rate_Ap):.3f}  B(4opt)={mean(rate_B):.3f}")
    print(f"  GRAMMAR effect (A'-B) = {mean(rate_Ap)-mean(rate_B):+.3f}   reclassification (shipped-A') = {rate_A_shipped-mean(rate_Ap):+.3f}")
    print("wrote crux_grammar_ab_summary.json")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
