#!/usr/bin/env python3
"""Score the generator's production about[] against the CL blind reference (t/3381).

Acceptance axis (register § "Pre-committed acceptance rule", SO e/145):
    concept-anchored about[]-component >= 0.80.

Metric keying — REF-LEVEL is authoritative here (divergence from the logical-form
scorer's (ref, match_level) keying is deliberate and recorded):
  * The floor exists to catch concept *selection* failure — "pick the correct
    topical concept, not echo an id" (register). It is a claim about *which refs*.
  * The blind worksheet labels refs only; the labeler never saw match_level.
  * match_level is the exact axis t/3379 flagged as the enum-leak bug, and every
    non-`exact` value in this sample (10/169) is concentrated on the single
    force-included diversity node skp-beliefs-170. Keying the floor on
    (ref, match_level) would penalize a known-buggy, blind-unlabeled attribute.
  => Primary floor = mean per-row about-F1 keyed on ref, over concept-anchored
     rows (concept-only + mixed). Strict (ref, match_level) F1 is reported as a
     diagnostic (reference match_level assumed corpus-default 'exact').

Per-row about-F1 follows the logical-form scorer's _f1 semantics exactly:
  both-empty -> 1.0 ; one-empty -> 0.0 ; else harmonic mean of P and R.
"""
import json, re, sys, os, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "sample-manifest.json")
WORKSHEET = os.path.join(HERE, "about-golden-worksheet.md")
FLOOR = 0.80

def f1(ref, cand):
    if not ref and not cand: return 1.0
    if not ref or not cand: return 0.0
    tp = len(ref & cand)
    p = tp/len(cand); r = tp/len(ref)
    return 0.0 if (p+r)==0 else 2*p*r/(p+r)

def parse_reference(path):
    """node_id -> set(refs). 'none' -> empty set."""
    out = {}
    cur = None
    hdr = re.compile(r"^##\s+\[\d+\]\s+(\S+)")
    for ln in open(path, encoding="utf-8"):
        m = hdr.match(ln)
        if m:
            cur = m.group(1); continue
        if cur and ln.startswith("**REFERENCE_ABOUT:**"):
            body = ln.split("**REFERENCE_ABOUT:**",1)[1].strip()
            if body.lower() in ("", "none"):
                out[cur] = set()
            else:
                out[cur] = {t.strip() for t in body.split(",") if t.strip()}
            cur = None
    return out

def main():
    man = json.load(open(MANIFEST, encoding="utf-8"))
    ref = parse_reference(WORKSHEET)
    rows = []
    for e in man["ids"]:
        nid = e["id"]; prof = e["profile"]
        if nid not in ref:
            raise SystemExit(f"worksheet missing reference for {nid}")
        gold = ref[nid]                                   # set of refs
        pred_pairs = [(a["ref"], a.get("match_level")) for a in (e.get("prod_about") or [])]
        pred = {r for r,_ in pred_pairs}                  # ref-level
        tp = len(gold & pred)
        prec = tp/len(pred) if pred else (1.0 if not gold else 0.0)
        rec  = tp/len(gold) if gold else (1.0 if not pred else 0.0)
        row = {
            "id": nid, "profile": prof,
            "gold": sorted(gold), "pred": sorted(pred),
            "tp": tp, "fp": sorted(pred-gold), "fn": sorted(gold-pred),
            "precision": prec, "recall": rec,
            "f1_ref": f1(gold, pred),
            # strict (ref,match_level): reference assumed corpus-default 'exact'
            "f1_strict": f1({(r,"exact") for r in gold}, set(pred_pairs)),
        }
        rows.append(row)

    def agg(subset, key):
        vals = [r[key] for r in subset]
        return statistics.mean(vals) if vals else float("nan")

    def micro(subset):
        tp = sum(r["tp"] for r in subset)
        fp = sum(len(r["fp"]) for r in subset)
        fn = sum(len(r["fn"]) for r in subset)
        P = tp/(tp+fp) if (tp+fp) else float("nan")
        R = tp/(tp+fn) if (tp+fn) else float("nan")
        F = 2*P*R/(P+R) if (P and R and P+R) else 0.0
        return tp, fp, fn, P, R, F

    concept = [r for r in rows if r["profile"] in ("concept-only","mixed")]
    entity  = [r for r in rows if r["profile"] == "entity-only"]

    print(f"n rows = {len(rows)}  (concept-anchored={len(concept)}, entity-only={len(entity)})\n")
    floor_val = agg(concept, "f1_ref")
    print("=== PRIMARY FLOOR (ref-level, concept-anchored rows) ===")
    print(f"  mean per-row about-F1 = {floor_val:.4f}   floor {FLOOR}  ->  "
          f"{'PASS' if floor_val>=FLOOR else 'FAIL'}")
    tp,fp,fn,P,R,F = micro(concept)
    print(f"  micro P={P:.4f} R={R:.4f} F1={F:.4f}  (TP={tp} FP={fp} FN={fn})")
    print(f"  mean per-row precision={agg(concept,'precision'):.4f}  recall={agg(concept,'recall'):.4f}")
    print(f"  strict (ref,match_level) mean-F1 = {agg(concept,'f1_strict'):.4f}  [diagnostic]\n")

    print("=== entity-only control rows (trivial id-projection axis) ===")
    print(f"  mean per-row about-F1 (ref) = {agg(entity,'f1_ref'):.4f}\n")

    print("=== per-profile mean about-F1 (ref) ===")
    for pf in ("concept-only","mixed","entity-only"):
        sub=[r for r in rows if r["profile"]==pf]
        print(f"  {pf:13} n={len(sub):2}  meanF1={agg(sub,'f1_ref'):.4f}  "
              f"meanP={agg(sub,'precision'):.4f} meanR={agg(sub,'recall'):.4f}")

    print("\n=== rows below F1 0.80 (concept-anchored) ===")
    for r in sorted(concept, key=lambda x:x["f1_ref"]):
        if r["f1_ref"] < FLOOR:
            print(f"  {r['id']:22} {r['profile']:12} F1={r['f1_ref']:.2f} "
                  f"P={r['precision']:.2f} R={r['recall']:.2f} "
                  f"FP={r['fp']} FN={r['fn']}")

    out = {
        "ticket":"t/3381","floor":FLOOR,
        "primary_floor_metric":"mean per-row about-F1, ref-level, concept-anchored rows",
        "concept_anchored_floor": floor_val,
        "verdict":"PASS" if floor_val>=FLOOR else "FAIL",
        "concept_anchored_micro":{"tp":tp,"fp":fp,"fn":fn,"precision":P,"recall":R,"f1":F},
        "concept_anchored_strict_matchlevel_meanF1": agg(concept,"f1_strict"),
        "entity_only_meanF1": agg(entity,"f1_ref"),
        "rows": rows,
    }
    with open(os.path.join(HERE,"about-golden-predictions.json"),"w",encoding="utf-8") as f:
        json.dump(out,f,indent=1)
    print("\nwrote about-golden-predictions.json")

if __name__ == "__main__":
    main()
