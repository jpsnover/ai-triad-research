#!/usr/bin/env python3
"""t/3302 Fork-B — grade a contradiction classifier against the FROZEN blind golden and emit the
scoring-GV report (Wilson 95% CIs; TL p/349#167: precision LOWER bound must clear 0.85).

Independence: grade off the golden. Join predictions to the golden by pair_id and take label/split/pool
from the golden ONLY — ignore any echoed gold fields in the predictions (keeps the grader independent).

Predictions schema (PowerShell): { _meta, predictions:[{pair_id, predicted, confidence, ...}] }
  predicted in {contradict, entail, neutral, unresolved}; `contradict` = the attack class; missing pair
  -> unresolved (recall miss, not a precision FP). `confidence` = certainty in the chosen label [0..1];
  sweep it over predicted=='contradict' rows for the P/R curve.

Metrics (split protocol): precision on REP held_out (true base rate); recall on ALL held_out contradicts.
Usage: python score_llm_arm.py [--pred PATH] [--golden PATH]   (defaults co-located)
"""
import argparse, json, math, os, sys
from collections import Counter
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
Z = 1.96


def wilson(k, n):
    if n == 0:
        return (None, None, None)
    p = k / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = (Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))) / d
    return (p, max(0.0, c - h), min(1.0, c + h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pred", default=os.path.join(HERE, "semantic-golden-predictions.json"))
    ap.add_argument("--golden", default=os.path.join(HERE, "semantic-opposition-golden.json"))
    args = ap.parse_args()
    if not os.path.exists(args.pred):
        print(f"[waiting] predictions not found: {args.pred}")
        return 0

    golden = {p["pair_id"]: p for p in json.load(open(args.golden, encoding="utf-8"))["pairs"]}
    praw = json.load(open(args.pred, encoding="utf-8"))
    preds = {r["pair_id"]: r for r in praw.get("predictions", praw)}
    missing = [pid for pid in golden if pid not in preds]
    print(f"golden pairs: {len(golden)} | predictions: {len(preds)} | missing→unresolved: {len(missing)}")

    rows = []
    for pid, g in golden.items():
        pr = preds.get(pid, {})
        rows.append({"label": g["label"], "pool": g["pool"], "split": g["split"],
                     "predicted": pr.get("predicted", "unresolved"), "confidence": float(pr.get("confidence", 0.0))})
    obs = [r for r in rows if r["pool"] != "CONSTRUCTED"]
    rep_held = [r for r in obs if r["pool"] == "REP" and r["split"] == "held_out"]
    held_contra = [r for r in obs if r["split"] == "held_out" and r["label"] == "contradict"]
    is_opp = lambda r, t: r["predicted"] == "contradict" and r["confidence"] >= t

    print(f"\n=== scoring-GV report (Wilson 95% CIs) ===")
    print(f"precision denom REP held_out n={len(rep_held)}; recall denom all held_out contradicts n={len(held_contra)}\n")
    print(f"{'tau':>4} | {'precision (95% CI)':>26} | {'recall (95% CI)':>26} | n_pred")
    best = None
    for i in range(0, 21):
        t = i * 0.05
        po = [r for r in rep_held if is_opp(r, t)]
        tp = sum(1 for r in po if r["label"] == "contradict")
        pp, plo, phi = wilson(tp, len(po))
        rk = sum(1 for r in held_contra if is_opp(r, t))
        rp, rlo, rhi = wilson(rk, len(held_contra))
        ps = f"{pp:.2f} [{plo:.2f},{phi:.2f}]" if pp is not None else "   (no preds)   "
        rs = f"{rp:.2f} [{rlo:.2f},{rhi:.2f}]" if rp is not None else "  -  "
        print(f"{t:>4.2f} | {ps:>26} | {rs:>26} | {len(po)}")
        if pp is not None and plo >= 0.85 and rp is not None and rp >= 0.50 and (best is None or rp > best[2]):
            best = (t, plo, rp)

    print("\n=== gate (bar: precision LB ≥ 0.85, recall ≥ 0.50) ===")
    print(f"PASS at tau={best[0]:.2f} (precision LB {best[1]:.2f}, recall {best[2]:.2f})" if best
          else "precision LB never reaches 0.85 on REP held_out (n_pred too small — see whole-set precision).")

    # whole-observed precision + recall ceiling + false positives
    pc = [r for r in obs if r["predicted"] == "contradict"]
    tp = sum(1 for r in pc if r["label"] == "contradict")
    print(f"\nwhole-observed precision (predicted contradict): {tp}/{len(pc)} = "
          f"{tp/max(len(pc),1):.3f}  Wilson CI {tuple(round(x,2) for x in wilson(tp,len(pc))[1:])}")
    ca = [r for r in obs if r["label"] == "contradict"]
    ceil = sum(1 for r in ca if r["predicted"] == "contradict")
    print(f"recall ceiling: {ceil}/{len(ca)} = {ceil/len(ca):.2f} {tuple(round(x,2) for x in wilson(ceil,len(ca))[1:])}")
    print("confusion (gold ↓ / predicted →):")
    xt = Counter((r["label"], r["predicted"]) for r in obs)
    for gl in ("contradict", "entail", "neutral"):
        print(f"  {gl:10} -> " + str({p: xt[(gl, p)] for p in ("contradict", "entail", "neutral", "unresolved")}))
    con = [r for r in rows if r["pool"] == "CONSTRUCTED"]
    if con:
        cc = sum(1 for r in con if r["label"] == "contradict" and r["predicted"] == "contradict")
        cn = sum(1 for r in con if r["label"] == "contradict")
        ff = sum(1 for r in con if r["label"] == "neutral" and r["predicted"] == "contradict")
        print(f"constructed numeric/temporal: caught {cc}/{cn} contradicts, {ff} false-fires on neutrals")


if __name__ == "__main__":
    raise SystemExit(main())
