#!/usr/bin/env python3
# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.
"""Fork-B census-merge applier (t/3339, TL-approved split t/3339#14/#329).

Applies ONLY the frozen verified merge set (scripts/fork-b-verified-merges.json) to conflicts.json:
  - same-doc: symmetric attack edges added within EXISTING conflicts (both endpoints tested);
  - cross-conflict: each verified stance→opposer becomes a NEW 2-instance conflict with symmetric edges.
Edges/conflicts are tagged provenance: claim_origin=observed, edge_origin=semantic, symmetric=true,
classifier + tau + confidence, register=t/3342. NO re-classification and NO auto-merge — it merges
exactly the committed manifest IDs (TL cond-1/2). QBAF strengths are recomputed via qbaf-bridge.mjs
(DF-QuAD; symmetric 2-cycles verified convergent, t/3339#12).

DEFAULT = DRY-RUN: writes the mutated corpus to a SIDECAR (--out), prints a change manifest, and runs
the 0-collateral verifier (every untouched conflict byte-identical). --write mutates conflicts.json in
place — the OWNER runs that after reviewing the dry-run (PS never writes ../ai-triad-data directly).

Usage:
  python apply_semantic_merge.py                 # dry-run -> conflicts.merged.json + manifest + verifier
  python apply_semantic_merge.py --write         # owner: in-place mutation of conflicts.json
"""
import argparse, copy, json, os, subprocess, sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_HERE)
DATA = os.environ.get("AI_TRIAD_DATA_ROOT") or os.path.join(os.path.dirname(_PROJECT_ROOT), "ai-triad-data")
CONFLICTS = os.path.join(DATA, "conflicts", "conflicts.json")
MANIFEST = os.path.join(_HERE, "fork-b-verified-merges.json")
BRIDGE = os.path.join(_HERE, "qbaf-bridge.mjs")
STAMP = "fork-b-census-merge-t3339"   # fixed (deterministic dry-run diffs; not a wall-clock)
WEIGHT = 0.6


def _mk_attack_pair(i, j, detector, confidence, tau):
    """Symmetric contradiction → two directed attack edges (both endpoints tested), fully tagged."""
    def one(s, t):
        return {"source": f"inst-{s}", "target": f"inst-{t}", "type": "attacks", "weight": WEIGHT,
                "attack_type": "rebut", "edge_origin": "semantic", "detector": detector,
                "confidence": round(float(confidence), 4), "tau": tau, "symmetric": True,
                "claim_origin": "observed", "classifier": "enrichment.contradiction-classify",
                "register": "t/3342"}
    return [one(i, j), one(j, i)]


def _run_bridge_batch(graphs):
    """Recompute DF-QuAD strengths for a batch of {nodes, edges} graphs via qbaf-bridge.mjs."""
    if not graphs:
        return []
    payload = {"batch": [{"nodes": g["nodes"], "edges": [{k: v for k, v in e.items() if k != "attack_type"}
                                                          for e in g["edges"]]} for g in graphs]}
    npx = "npx.cmd" if sys.platform == "win32" else "npx"
    res = subprocess.run([npx, "tsx", BRIDGE], input=json.dumps(payload), capture_output=True,
                         text=True, cwd=_PROJECT_ROOT)
    if res.returncode != 0:
        raise RuntimeError(f"qbaf-bridge failed: {res.stderr.strip()[:300]}")
    return json.loads(res.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="mutate conflicts.json in place (owner only)")
    ap.add_argument("--out", default=os.path.join(os.path.expanduser("~"), "conflicts.merged.json"),
                    help="dry-run sidecar output path (default: home dir — never the data repo)")
    ap.add_argument("--conflicts", default=CONFLICTS)
    ap.add_argument("--manifest", default=MANIFEST)
    args = ap.parse_args()

    doc = json.load(open(args.conflicts, encoding="utf-8"))
    conflicts = doc["conflicts"]
    manifest = json.load(open(args.manifest, encoding="utf-8"))
    tau = manifest["_meta"]["tau"]
    orig = copy.deepcopy(conflicts)   # for the collateral verifier

    by_id = {}
    for idx, c in enumerate(conflicts):
        by_id[c.get("claim_id") or c.get("claim_label")] = idx

    touched, new_confs, edges_added, missing = [], [], 0, []
    recompute = []   # (conflict_ref, graph) to recompute strengths for

    # ---- same-doc: add symmetric edges within existing conflicts ----
    for e in manifest["same_doc"]:
        cid = e["conflict_id"]
        if cid not in by_id:
            missing.append(("same_doc", cid)); continue
        c = conflicts[by_id[cid]]
        g = c.setdefault("qbaf", {}).setdefault("graph", {"nodes": [], "edges": []})
        i = int(e["source"].split("-")[1]); j = int(e["target"].split("-")[1])
        have = {(x["source"], x["target"]) for x in g.get("edges", [])}
        for edge in _mk_attack_pair(i, j, e.get("detector", "llm"), e["confidence"], tau):
            if (edge["source"], edge["target"]) not in have:
                g["edges"].append(edge); edges_added += 1
        c["qbaf"]["computed_at"] = STAMP
        if cid not in touched:
            touched.append(cid); recompute.append(c)

    # ---- cross-conflict: new 2-instance conflicts ----
    for m in manifest["cross_conflict"]:
        new_id = f"xmerge-{m['pair_id']}"
        nodes = [{"id": "inst-0", "text": m["stance_text"], "source_pov": "situations",
                  "base_strength": 0.6, "computed_strength": 0.6},
                 {"id": "inst-1", "text": m["cand_text"], "source_pov": "situations",
                  "base_strength": 0.6, "computed_strength": 0.6}]
        edges = _mk_attack_pair(0, 1, "llm", m["confidence"], tau)
        nc = {
            "claim_id": new_id,
            "claim_label": (m["stance_text"][:80]),
            "description": "Fork-B cross-conflict census merge (t/3339): verified contradiction across conflicts.",
            "status": "active",
            "linked_taxonomy_nodes": [],
            "claim_origin": "observed",
            "merge_provenance": {"pair_id": m["pair_id"], "stance_conflict_id": m["stance_conflict_id"],
                                 "cand_conflict_id": m["cand_conflict_id"], "register": "t/3342",
                                 "verified": "PI-dual-verified (t/3339#13)"},
            "instances": [
                {"doc_id": m["stance_conflict_id"], "stance": "neutral", "assertion": m["stance_text"]},
                {"doc_id": m["cand_conflict_id"], "stance": "neutral", "assertion": m["cand_text"]},
            ],
            "human_notes": "",
            "qbaf": {"graph": {"nodes": nodes, "edges": edges}, "computed_at": STAMP,
                     "algorithm": "DF-QuAD", "iterations": 0},
        }
        conflicts.append(nc)
        new_confs.append(new_id)
        recompute.append(nc)

    # ---- recompute DF-QuAD strengths for touched + new conflicts ----
    graphs = [c["qbaf"]["graph"] for c in recompute]
    results = _run_bridge_batch(graphs)
    for c, r in zip(recompute, results):
        strengths = r.get("strengths", {})
        for n in c["qbaf"]["graph"]["nodes"]:
            if n["id"] in strengths:
                n["computed_strength"] = strengths[n["id"]]
        c["qbaf"]["iterations"] = r.get("iterations", c["qbaf"].get("iterations", 0))

    # ---- 0-collateral verifier: every untouched original conflict must be byte-identical ----
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
    clean = (len(collateral) == 0 and not missing)

    print("=== Fork-B census-merge — change manifest ===")
    print(f"same-doc conflicts touched : {len(touched)}  (+{edges_added} symmetric attack edges)")
    print(f"cross-conflict new conflicts: {len(new_confs)}")
    print(f"conflicts before/after     : {len(orig)} -> {len(conflicts)}  (+{len(conflicts)-len(orig)})")
    print(f"manifest IDs not found     : {missing if missing else 'none'}")
    print(f"COLLATERAL (unexpected changes to untouched conflicts): "
          f"{'ZERO ✓' if not collateral else collateral}")
    print(f"VERIFIED-CLEAN: {'YES' if clean else 'NO — DO NOT PUSH'}")

    if args.write:
        if not clean:
            print("Refusing --write: not verified-clean.", file=sys.stderr); return 2
        json.dump(doc, open(args.conflicts, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"WROTE in place: {args.conflicts}")
    else:
        json.dump(doc, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"DRY-RUN sidecar: {args.out}  (review, then owner re-runs with --write)")
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
