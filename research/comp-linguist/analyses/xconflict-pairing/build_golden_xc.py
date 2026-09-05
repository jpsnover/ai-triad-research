#!/usr/bin/env python3
"""t/3339 cross-conflict precision golden (TL-GV'd hard pre-write gate, t/3339#6 D2).
Two modes:
  --make  : join candidates + PS predictions, stratified-sample (predicted-contradict + predicted-other),
            SHUFFLE, strip verdicts → blind worksheet.md. CL blind-labels contradict/entail/neutral without
            seeing the classifier verdict (anchoring guard).
  --score : read the labeled worksheet + PS predictions → precision on the classifier's contradict calls,
            Wilson 95% LB. GATE: LB ≥ 0.85 before any cross-conflict contradict counts toward the union.
Precision is the load-bearing metric here (false-attack asymmetry: a wrong attack edge fabricates opposition).
Usage: python build_golden_xc.py --make --pred <ps_predictions.json>
       python build_golden_xc.py --score --pred <ps_predictions.json> --labeled <worksheet-labeled.md>"""
import argparse, json, os, re, sys, math
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(__file__)
CANDS = os.path.join(HERE, "xconflict-candidates.json")
WS = os.path.join(HERE, "xconflict-golden-worksheet.md")
N_POS, N_OTHER = 40, 20   # predicted-contradict / predicted-other split (before shuffle)


def wilson_lb(k, n, z=1.96):
    if n == 0:
        return 0.0
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (c - m) / d


def load_preds(path):
    d = json.load(open(path, encoding="utf-8"))
    rows = d.get("predictions", d) if isinstance(d, dict) else d
    return {r["pair_id"]: r for r in rows}


def deterministic_shuffle(items):
    # index-based interleave (no Math.random/Date — env forbids); stable, spreads pos/other
    return [x for _, x in sorted(enumerate(items), key=lambda t: (t[0] * 2654435761) % len(items))]


def make(pred_path):
    cands = {c["pair_id"]: c for c in json.load(open(CANDS, encoding="utf-8"))["candidates"]}
    preds = load_preds(pred_path)
    pos = [pid for pid, p in preds.items() if p.get("predicted") == "contradict"]
    other = [pid for pid, p in preds.items() if p.get("predicted") in ("entail", "neutral")]
    print(f"predicted-contradict: {len(pos)} | predicted-other: {len(other)}")
    pos = deterministic_shuffle(pos)[:N_POS]
    other = deterministic_shuffle(other)[:N_OTHER]
    sample = deterministic_shuffle(pos + other)
    out = ["# t/3339 cross-conflict precision golden — BLIND worksheet",
           "# Label each pair contradict|entail|neutral from the TWO texts ONLY. Do not consult the classifier.",
           f"# {len(sample)} pairs ({len(pos)} predicted-contradict + {len(other)} predicted-other, shuffled).\n"]
    for pid in sample:
        c = cands[pid]
        out.append(f"## {pid}")
        out.append(f"**A:** {c['stance_text']}")
        out.append(f"**B:** {c['cand_text']}")
        out.append("**VERDICT:** ")
        out.append("")
    open(WS, "w", encoding="utf-8").write("\n".join(out))
    print(f"wrote blind worksheet: {WS} ({len(sample)} pairs)")


def score(pred_path, labeled):
    preds = load_preds(pred_path)
    labels = {}
    cur = None
    for ln in open(labeled, encoding="utf-8"):
        m = re.match(r"^##\s+(\S+)", ln)
        if m:
            cur = m.group(1)
        elif ln.startswith("**VERDICT:**") and cur:
            v = ln.split("**VERDICT:**")[1].strip().lower()
            if v in ("contradict", "entail", "neutral"):
                labels[cur] = v
            cur = None
    tp = sum(1 for pid, v in labels.items() if preds.get(pid, {}).get("predicted") == "contradict" and v == "contradict")
    fp = sum(1 for pid, v in labels.items() if preds.get(pid, {}).get("predicted") == "contradict" and v != "contradict")
    n = tp + fp
    prec = tp / n if n else 0.0
    lb = wilson_lb(tp, n)
    print(f"labeled: {len(labels)} | classifier-contradict in sample: {n} (TP={tp} FP={fp})")
    print(f"precision on cross-conflict contradict calls: {prec:.3f}  Wilson95 LB={lb:.3f}")
    print(f"GATE (LB ≥ 0.85): {'PASS — cross-conflict contradicts may count toward the union' if lb >= 0.85 else 'FAIL — classifier over-flags cross-conflict; do NOT count (recalibrate/tune, do not merge)'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--make", action="store_true"); ap.add_argument("--score", action="store_true")
    ap.add_argument("--pred", required=True); ap.add_argument("--labeled", default=WS.replace(".md", "-labeled.md"))
    a = ap.parse_args()
    if a.make:
        make(a.pred)
    elif a.score:
        score(a.pred, a.labeled)


if __name__ == "__main__":
    raise SystemExit(main())
