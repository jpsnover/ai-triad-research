#!/usr/bin/env python3
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
"""Surgical demotion of standalone-fact non-conflicts (t/3350, PI-authorized; t/3339#6 classification).

Reclassifies ONLY the frozen conflict_ids in CL's verified list (--list) as non-conflicts — a single-
instance "conflict" that is a neutral standalone fact with no opposition. RECLASSIFY, not remove
(CL t/3339#340): sets status=demoted + claim_type=non_conflict + a demotion provenance block, KEEPING
the instance as a claim/evidence record (fully reversible). Every conflict NOT in the list — including
the 15 fork-B verified edges (#2013) and all real multi-instance conflicts — is left byte-identical.

SAFETY GATE (belt-and-suspenders with CL's precision spot-check): a standalone fact is single-instance
with NO edges. The tool REFUSES to demote any listed id that has >=2 instances OR any qbaf edges, and
reports it — catching a misclassified real conflict (or a fork-B-touched one) before it can be demoted.
Any refusal or missing id => not verified-clean => --write refused.

DEFAULT = DRY-RUN: mutated corpus -> SIDECAR (--out) + change manifest + 0-collateral verifier.
--write mutates conflicts.json in place — the OWNER runs that (PS never writes ../ai-triad-data
directly); routes through the t/2902 dirty-tree guard; refuses unless verified-clean.

Usage:
  python demote_nonconflicts.py --list <verified-432.json>            # dry-run
  python demote_nonconflicts.py --list <verified-432.json> --write    # owner: in-place
"""
import argparse, copy, json, os, sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
from data_tree_guard import assert_clean_data_tree  # t/2902 dirty-tree-sweep guard (funnel for data writes)

DATA = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.join(os.path.dirname(_PROJECT_ROOT), "ai-triad-data")
CONFLICTS = os.path.join(DATA, "conflicts", "conflicts.json")


def load_ids(path):
    """Parse CL's frozen list — tolerant of shape: [ids] | {conflict_ids|standalone_facts|ids|demote: [...]}
    where each element is a str id or an object with a conflict_id/claim_id field."""
    d = json.load(open(path, encoding="utf-8"))
    if isinstance(d, dict):
        for k in ("conflict_ids", "standalone_facts", "ids", "demote"):
            if k in d:
                d = d[k]; break
        else:
            raise SystemExit(f"list file {path}: no recognized key (conflict_ids/standalone_facts/ids/demote)")
    out = []
    for x in d:
        cid = x if isinstance(x, str) else (x.get("conflict_id") or x.get("claim_id"))
        if cid:
            out.append(cid)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True, help="CL's frozen verified 432 standalone_fact list")
    ap.add_argument("--write", action="store_true", help="mutate conflicts.json in place (owner only)")
    ap.add_argument("--out", default=os.path.join(os.path.expanduser("~"), "conflicts.demoted.json"),
                    help="dry-run sidecar output (default: home dir — never the data repo)")
    ap.add_argument("--conflicts", default=CONFLICTS)
    args = ap.parse_args()

    doc = json.load(open(args.conflicts, encoding="utf-8"))
    conflicts = doc["conflicts"]
    orig = copy.deepcopy(conflicts)
    ids = load_ids(args.list)
    id_set = set(ids)
    by_id = {c.get("claim_id") or c.get("claim_label"): i for i, c in enumerate(conflicts)}

    touched, missing, refused = [], [], []
    for cid in ids:
        if cid not in by_id:
            missing.append(cid); continue
        c = conflicts[by_id[cid]]
        insts = c.get("instances") or []
        edges = ((c.get("qbaf") or {}).get("graph") or {}).get("edges") or []
        if len(insts) >= 2 or edges:
            refused.append((cid, f"instances={len(insts)} edges={len(edges)}")); continue  # NOT a standalone fact
        c["status"] = "demoted"
        c["claim_type"] = "non_conflict"
        c["demotion"] = {"reason": "standalone_fact", "source": "CL classification (t/3339#6)",
                         "ticket": "t/3350", "reversible": True}
        touched.append(cid)

    touched_set = set(touched)
    out_by_id = {c.get("claim_id") or c.get("claim_label"): c for c in conflicts}
    collateral = []
    for oc in orig:
        oid = oc.get("claim_id") or oc.get("claim_label")
        if oid in touched_set:
            continue
        nc = out_by_id.get(oid)
        if nc is None:
            collateral.append(("DROPPED", oid))
        elif json.dumps(nc, sort_keys=True, ensure_ascii=False) != json.dumps(oc, sort_keys=True, ensure_ascii=False):
            collateral.append(("MODIFIED", oid))
    clean = (not missing and not refused and not collateral)

    print("=== Non-conflict demotion — change manifest ===")
    print(f"list ids                    : {len(ids)}")
    print(f"demoted (reclassified)      : {len(touched)}")
    print(f"REFUSED (has edges/>=2 inst): {len(refused)}{' -> ' + str(refused[:5]) if refused else ''}")
    print(f"missing (id not in corpus)  : {len(missing)}{' -> ' + str(missing[:5]) if missing else ''}")
    print(f"COLLATERAL (untouched changed): {'ZERO' if not collateral else collateral[:5]}")
    print(f"VERIFIED-CLEAN: {'YES' if clean else 'NO — DO NOT PUSH'}")

    if args.write:
        if not clean:
            print("Refusing --write: not verified-clean (missing/refused/collateral).", file=sys.stderr)
            return 2
        assert_clean_data_tree(args.conflicts)   # t/2902 dirty-tree-sweep guard BEFORE the raw sink
        json.dump(doc, open(args.conflicts, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"WROTE in place: {args.conflicts}")
    else:
        json.dump(doc, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"DRY-RUN sidecar: {args.out}  (review, then owner re-runs with --write)")
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
