#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""Stage-0 (t/2440): golden-set MRR across embedding compositions.

PI-approved Stage-0 measurement for option B (t/2425). Pre-registered at t/2440#4;
results at t/2440#5 (NO-GO: description-only ties/beats every weighted composition
on human labels; 0.611/0.389 is -10.7%, refuting the register's "+14%").

Datasets:
  PRIMARY   — human-labeled (n=25): _golden_validation_results.json, gold node =
              corrected_node (verdict incorrect) or original_node (correct);
              uncertain/novel excluded. The decision basis.
  SECONDARY — pipeline-attributed (n=664, CONFOUNDED): _golden_test_set.json
              `attributed_node`. Biased toward its build composition; direction only.

Method (identical across compositions): node vectors composed via
embed_taxonomy._compose_field_texts (raw per-field encode → weighted sum → single
L2); claim vector = claim_text normalized; rank the gold node among the candidate
pool (same-POV [registered] and all-node [sensitivity, since 16/25 human-gold are
cross-POV]). Metrics: MRR, Top-1, Recall@3.

Usage:  AI_TRIAD_DATA_ROOT=<data-repo> python stage0_mrr.py
"""
import glob
import importlib.util
import json
import os
import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve()
_REPO = _HERE.parents[4]                                  # …/ai-triad-research
RESEARCH = _REPO / "research" / "comp-linguist"


def _data_origin() -> Path:
    env = os.environ.get("AI_TRIAD_DATA_ROOT")
    if env:
        return Path(env) / "taxonomy" / "Origin"
    cfg = json.loads((_REPO / ".aitriad.json").read_text(encoding="utf-8"))
    root = Path(cfg.get("data_root", ".."))
    base = root if root.is_absolute() else (_REPO / root)
    return base / cfg.get("taxonomy_dir", "taxonomy/Origin")


ORIGIN = _data_origin()
_spec = importlib.util.spec_from_file_location("embed_taxonomy", _REPO / "scripts" / "embed_taxonomy.py")
et = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(et)

COMPS = {
    "description-only (1,0,0,0,0)": (1.0, 0.0, 0.0, 0.0, 0.0),
    "0.8/0.2":                      (0.8, 0.2, 0.0, 0.0, 0.0),
    "0.611/0.389":                  (0.611, 0.389, 0.0, 0.0, 0.0),
    "0.55/0.35/0.10 (lineage)":     (0.55, 0.35, 0.10, 0.0, 0.0),
}
_POV = {"accelerationist": "acc", "safetyist": "saf", "skeptic": "skp", "situations": "sit"}


def load_nodes():
    allnodes, node_pov, by_pov = [], {}, {}
    for p in sorted(glob.glob(str(ORIGIN / "*.json"))):
        b = os.path.basename(p)
        if b in et.SKIP_FILES or b.startswith("embeddings-"):
            continue
        try:
            d = json.loads(Path(p).read_text(encoding="utf-8-sig"))
        except (json.JSONDecodeError, OSError):
            continue
        pov = _POV.get(b[:-5].lower(), b[:-5].lower())
        for n in d.get("nodes", []):
            if isinstance(n, dict) and isinstance(n.get("id"), str):
                allnodes.append(n); node_pov[n["id"]] = pov
                by_pov.setdefault(pov, []).append(n["id"])
    return allnodes, node_pov, by_pov


def main():
    allnodes, node_pov, by_pov = load_nodes()
    ids = [n["id"] for n in allnodes]
    idx_of = {nid: i for i, nid in enumerate(ids)}

    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("all-MiniLM-L6-v2")
    et.TAXONOMY_DIR = ORIGIN
    try:
        lineage_map = et._load_lineage_categories()
    except Exception:
        lineage_map = {}
    fields = [et._compose_field_texts(n, lineage_map) for n in allnodes]
    print(f"encoding {len(ids)} nodes x 5 fields...", file=sys.stderr)
    raw = [np.asarray(model.encode([ft[f] for ft in fields], normalize_embeddings=False, show_progress_bar=False), dtype=np.float64)
           for f in range(5)]

    def node_matrix(w):
        v = sum(w[f] * raw[f] for f in range(5))
        nn = np.linalg.norm(v, axis=1, keepdims=True); nn[nn == 0] = 1.0
        return v / nn

    # claims keyed by (debate_id, claim_id) — claim_id repeats across debates
    gs = {(c.get("debate_id"), c["claim_id"]): c
          for c in json.loads((RESEARCH / "_golden_test_set.json").read_text(encoding="utf-8"))["claims"]}
    gv = json.loads((RESEARCH / "_golden_validation_results.json").read_text(encoding="utf-8"))["results"]

    primary = []
    for r in gv:
        v = r["verdict"]; key = (r.get("debate_id"), r["claim_id"])
        gold = r.get("original_node") if v == "correct" else (r.get("corrected_node") if v == "incorrect" else None)
        if gold and gold in idx_of and key in gs:
            primary.append((gs[key]["claim_text"], gs[key]["pov"], gold))
    secondary = [(c["claim_text"], c["pov"], c["attributed_node"]) for c in gs.values()
                 if c.get("attributed_node") in idx_of]

    def evaluate(dataset, w, scope):
        nv = node_matrix(w)
        qv = np.asarray(model.encode([d[0] for d in dataset], normalize_embeddings=True, show_progress_bar=False), dtype=np.float64)
        rr, top1, rec3, scored = [], 0, 0, 0
        for i, (_, pov, gold) in enumerate(dataset):
            cand = by_pov.get(pov, []) if scope == "same-pov" else ids
            if gold not in cand:
                continue
            ci = [idx_of[c] for c in cand]
            sims = nv[ci] @ qv[i]
            rank = list(np.array(cand)[np.argsort(-sims)]).index(gold) + 1
            rr.append(1.0 / rank); scored += 1
            top1 += rank == 1; rec3 += rank <= 3
        return {"n": scored, "MRR": float(np.mean(rr)) if rr else 0.0,
                "Top1": top1 / scored if scored else 0.0, "R3": rec3 / scored if scored else 0.0}

    for label, ds, scope in [
        ("PRIMARY human-labeled | same-POV pool (REGISTERED)", primary, "same-pov"),
        ("PRIMARY human-labeled | ALL-node pool (sensitivity)", primary, "all"),
        ("SECONDARY pipeline-attributed CONFOUNDED | same-POV pool", secondary, "same-pov"),
    ]:
        print(f"\n=== {label} ===")
        base = None
        print(f"{'composition':32s} {'n':>4} {'MRR':>7} {'dMRR%':>7} {'Top1':>6} {'R@3':>6}")
        for cname, w in COMPS.items():
            r = evaluate(ds, w, scope)
            if base is None:
                base = r["MRR"]
            dd = 100 * (r["MRR"] - base) / base if base else 0.0
            print(f"{cname:32s} {r['n']:>4} {r['MRR']:>7.4f} {dd:>+7.1f} {r['Top1']:>6.3f} {r['R3']:>6.3f}")


if __name__ == "__main__":
    main()
