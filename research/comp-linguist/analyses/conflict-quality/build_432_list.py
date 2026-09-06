#!/usr/bin/env python3
"""t/3339: emit the FROZEN, verified list of 432 standalone_fact conflict_ids for PS's demotion tool.
Shape: {_meta{...}, standalone_facts:[{conflict_id, reason, provenance}]}. Verified by a 40-sample CL blind
precision spot-check: 39 genuine facts / 1 contestable = 0.975 (Wilson LB ~0.87)."""
import json, os, sys, math
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(__file__)
cls = json.load(open(os.path.join(HERE, "singleton-classified.json"), encoding="utf-8"))
sf = sorted([r.get("conflict_id") for r in cls if r.get("cls") == "standalone_fact"])
def wilson_lb(k, n, z=1.96):
    p = k/n; d = 1+z*z/n; c = p+z*z/(2*n); m = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n)); return (c-m)/d
out = {
    "_meta": {
        "ticket": "t/3339",
        "purpose": "standalone_fact singletons to reclassify (demote) out of the conflict corpus",
        "classification": "CL single-annotator heuristic (classify_singletons.py) over the 902 single-instance conflicts",
        "n": len(sf),
        "verified": {
            "method": "CL blind 40-sample precision spot-check (verify432-worksheet)",
            "sample": 40, "genuine_fact": 39, "contestable": 1,
            "precision": 0.975, "wilson95_lb": round(wilson_lb(39, 40), 3),
            "note": ("~2.5% residual are borderline-contestable technical theses (e.g. 'hallucinations "
                     "statistically inevitable'); acceptable because the reclassification is REVERSIBLE "
                     "(status=demoted, instance kept) — a mis-demoted claim is flipped back, not lost."),
        },
        "demotion_semantics": "reclassify: status=demoted, claim_type=non_conflict, demotion.reason=standalone_fact, keep instance record",
    },
    "standalone_facts": [{"conflict_id": cid, "reason": "standalone_fact", "provenance": "CL single-annotator (t/3339)"} for cid in sf],
}
p = os.path.join(HERE, "standalone-facts-432.json")
json.dump(out, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"wrote {p}: {len(sf)} conflict_ids, verified precision 0.975 (LB {wilson_lb(39,40):.3f})")
print("first 3:", sf[:3])
