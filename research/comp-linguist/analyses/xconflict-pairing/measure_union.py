#!/usr/bin/env python3
"""t/3339 UNION benefit measure (TL t/3339#10 cond-2): measure the ACTUAL dual-verified union — same-doc
contradicts (within-conflict) ∪ cross-conflict pairings (new 2-node conflicts) — vs the ratified bar
(≥2× conflicts-with-attacks AND ≥10% arg nodes adversarial, both-endpoint/symmetric). Observed-only;
reports the observed/synthesized split (all observed here — cluster, no generation).

Topology (empirically confirmed): the verified cross-conflict stance-conflicts are single-instance, NO qbaf
(not in baseline N0). Each merge (≤1 opposing instance/stance, best confidence) creates a NEW 2-instance
qbaf conflict → +1 conflict-with-attack, +2 arg nodes (BOTH new, both adversarial by symmetric contradiction),
+2 to the denominator. Same-doc edges are within EXISTING conflicts → add adversarial endpoints, no new nodes.

Denominator (TL-pinned, stated): baseline qbaf node set N0=1010 across 338 conflicts; the union adds the
cross-conflict new instances (real new arg nodes) to BOTH numerator and denominator. The 432-non-conflict
demotion is a SEPARATE diff and is NOT applied here (can't inflate the ratio).

Usage: python measure_union.py [--verified <comma-list|file-of-pair_ids>] [--tau 0.90]
       default verified set = the 16 CL-verified TPs (collapse to 12 under the ≤1-cap)."""
import argparse, json, os, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding="utf-8")
DATA = os.environ.get("AI_TRIAD_DATA_ROOT") or r"C:\Users\jsnov\repos\ai-triad-data"
CONFLICTS = os.path.join(DATA, "conflicts", "conflicts.json")
HERE = os.path.dirname(__file__)
SAMEDOC = r"C:\Users\jsnov\samedoc-predictions.json"
XC_CANDS = os.path.join(HERE, "xconflict-candidates.json")
XC_PREDS = os.path.join(HERE, "xconflict-predictions.json")
BAR_RATIO, BAR_NODEFRAC = 2.0, 0.10
DEFAULT_VERIFIED = ["xc-0083-0","xc-0397-0","xc-0317-1","xc-0053-1","xc-0060-0","xc-0356-0","xc-0164-1",
                    "xc-0415-1","xc-0064-0","xc-0356-1","xc-0169-0","xc-0415-2","xc-0266-0","xc-0081-2",
                    "xc-0356-2","xc-0169-1"]


def load_conflicts():
    d = json.load(open(CONFLICTS, encoding="utf-8"))
    c = d.get("conflicts", d) if isinstance(d, dict) else d
    return list(c.values()) if isinstance(c, dict) else c


def baseline(conflicts):
    conf_attack, node_either = set(), set()
    total_nodes = 0
    for c in conflicts:
        q = c.get("qbaf")
        if not q:
            continue
        cid = c.get("claim_id") or c.get("claim_label")
        g = q.get("graph", {})
        total_nodes += len(g.get("nodes") or [])
        for e in (g.get("edges") or []):
            if e.get("type") == "attacks":
                conf_attack.add(cid)
                # adversarial = has an INCOMING attack (target). Symmetric baseline edges (both directions
                # present) capture both endpoints automatically; directed stance edges → target only.
                node_either.add((cid, e.get("target")))
    return conf_attack, node_either, total_nodes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verified", default=None)
    ap.add_argument("--tau", type=float, default=0.90)
    args = ap.parse_args()
    if args.verified:
        verified = ([l.strip() for l in open(args.verified) if l.strip()]
                    if os.path.exists(args.verified) else [x.strip() for x in args.verified.split(",") if x.strip()])
    else:
        verified = list(DEFAULT_VERIFIED)

    conflicts = load_conflicts()
    conf_attack, node_either, N0 = baseline(conflicts)
    b_conf, b_nodes = len(conf_attack), len(node_either)
    print(f"BASELINE: qbaf conflicts=338  N0={N0} nodes  conflicts-with-attacks={b_conf}  adversarial nodes={b_nodes} ({b_nodes/N0:.1%})")

    # --- same-doc (within-conflict, existing nodes) ---
    sd = json.load(open(SAMEDOC, encoding="utf-8"))
    sd = sd.get("predictions", sd) if isinstance(sd, dict) else sd
    sd_edges = 0
    for r in sd:
        if r.get("predicted") == "contradict" and float(r.get("confidence", 0)) >= args.tau:
            sd_edges += 1
            cid = r.get("conflict_id")
            conf_attack.add(cid)
            node_either.add((cid, r.get("source")))
            node_either.add((cid, r.get("target")))
    print(f"\nSAME-DOC @τ≥{args.tau}: {sd_edges} contradict edges → conflicts-with-attacks={len(conf_attack)}  "
          f"adversarial nodes={len(node_either)} ({len(node_either)/N0:.1%})  [sanity: should reconcile to the ratified 9.5%]")

    # --- cross-conflict (new 2-node conflicts; ≤1-cap: best confidence per stance-conflict) ---
    cands = {c["pair_id"]: c for c in json.load(open(XC_CANDS, encoding="utf-8"))["candidates"]}
    preds = {r["pair_id"]: r for r in json.load(open(XC_PREDS, encoding="utf-8"))["predictions"]}
    by_stance = defaultdict(list)
    for pid in verified:
        if pid in cands:
            by_stance[cands[pid]["stance_conflict_id"]].append(pid)
    xc_added_nodes = 0
    xc_conflicts = 0
    denom = N0
    for scid, pids in by_stance.items():
        best = max(pids, key=lambda p: float(preds.get(p, {}).get("confidence", 0)))  # ≤1-cap
        xc_conflicts += 1
        # new 2-node conflict: stance node + opposing node, both adversarial (symmetric), both new to denom
        conf_attack.add(("XC", scid))
        node_either.add(("XC", scid, "stance"))
        node_either.add(("XC", scid, "oppose"))
        xc_added_nodes += 2
        denom += 2
    print(f"CROSS-CONFLICT: {len(verified)} verified → {xc_conflicts} merges after ≤1-cap → +{xc_conflicts} conflicts, +{xc_added_nodes} nodes (all adversarial+denominator)")

    u_conf = len(conf_attack)
    u_nodes = len(node_either)
    ratio = u_conf / max(b_conf, 1)
    frac = u_nodes / max(denom, 1)
    print(f"\n=== UNION vs bar (≥{BAR_RATIO:.0f}× AND ≥{BAR_NODEFRAC:.0%}, both-endpoint, observed-only) ===")
    print(f"  conflicts-with-attacks {b_conf} → {u_conf}  (×{ratio:.2f})  {'PASS' if ratio>=BAR_RATIO else 'FAIL'}")
    print(f"  adversarial nodes {b_nodes} → {u_nodes} / denom {denom}  = {frac:.1%}  {'PASS' if frac>=BAR_NODEFRAC else 'FAIL'}")
    print(f"  observed/synthesized split: {u_nodes-b_nodes} added adversarial nodes = 100% OBSERVED / 0% synthesized")
    ok = ratio >= BAR_RATIO and frac >= BAR_NODEFRAC
    print(f"  → {'BOTH CLEAR — union writes (report to TL+PI)' if ok else 'BELOW BAR — HOLD + recalibrate (TL cond-3), do not extrapolate'}")


if __name__ == "__main__":
    raise SystemExit(main())
