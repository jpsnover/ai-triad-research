#!/usr/bin/env python3

# Copyright (c) 2026 Jeffrey Snover. All rights reserved.
# Licensed under the MIT License. See LICENSE file in the project root.

"""splice_embeddings.py — targeted embedding splice for t/2408 node authoring.

Adds embedding entries for a small set of NEW taxonomy nodes to an existing
embeddings.json WITHOUT re-encoding the ~2846 existing vectors. This keeps the
retrieval baseline for the whole corpus byte-identical while the 4 new nodes are
added (design t/2408#2, TL-approved t/2408#3).

Composition (CRITICAL — empirically matched to the shipped corpus):
    The production embeddings.json was empirically determined to be
    DESCRIPTION-ONLY (single-field `description`, L2-normalized) — 25/25 sampled
    nodes reproduce at cosine 1.000000. The envelope's `field_weights`
    (description=0.8, assumes=0.2) does NOT match the actual vectors: the 0.8/0.2
    blend reproduces at only ~0.99. This is a deviation from the t/2408#2 design,
    which named 0.8/0.2 from the envelope; the byte-stability gate below is what
    surfaced it. We splice with the composition that actually reproduces the
    corpus (description-only), so the new vectors live in the same space.

    exclusion_vector = L2-normalized encode of the node's `Excludes:` clause
    (reproduces at cosine 1.000000 on sampled nodes).

Byte-stability gate (BOTH ARMS, threshold GATE_COS = 0.9999):
    clean arm   — re-encode N existing nodes description-only; assert every one
                  reproduces its shipped vector at cosine >= GATE_COS.
    failure arm — perturb a reference vector and assert the SAME check REJECTS it
                  (cosine < GATE_COS), proving the gate can actually fail.
    If the clean arm fails, the installed encoder has drifted from the baseline
    and we ABORT rather than splice inconsistent vectors.

Usage:
    python splice_embeddings.py --taxonomy-dir <dir> --new-nodes new_nodes.json \
        [--out <path>] [--gate-only] [--dry-run]

    --taxonomy-dir  dir containing embeddings.json (+ POV json for the proof).
    --out           where to write the spliced embeddings.json (default: in place).
    --gate-only     run the byte-stability gate (both arms) and exit.
    --dry-run       run gate + compose + proof but DO NOT write.
"""

import argparse
import json
import re
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import numpy as np

MODEL_NAME = "all-MiniLM-L6-v2"
GATE_COS = 0.9999          # byte-stability threshold (co-located with the gate)
GATE_SAMPLE_N = 8          # existing nodes checked in the clean arm
PERTURB_EPS = 0.02         # failure-arm perturbation magnitude

_EXCLUDES_EXTRACT_RE = re.compile(r"\bExcludes:\s*(.*?)\.?\s*$", re.DOTALL)


def _pkg(pkg: str) -> str:
    try:
        return version(pkg)
    except PackageNotFoundError:
        return "unknown"


def _extract_excludes(description: str) -> str:
    m = _EXCLUDES_EXTRACT_RE.search(description or "")
    return m.group(1).strip() if m else ""


def _load_model():
    from sentence_transformers import SentenceTransformer
    print(f"Loading model '{MODEL_NAME}'...", file=sys.stderr)
    return SentenceTransformer(MODEL_NAME)


def _encode_norm(model, texts):
    """Encode and L2-normalize (matches the shipped description-only recipe)."""
    return model.encode(texts, normalize_embeddings=True, show_progress_bar=False)


def _cos(u, v):
    u = np.asarray(u, dtype=np.float64)
    v = np.asarray(v, dtype=np.float64)
    return float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v)))


def _load_pov_nodes(tax_dir: Path):
    """id -> node dict, across all POV json files (skips index/embedding files)."""
    out = {}
    skip = {"embeddings.json", "edges.json", "policy_actions.json",
            "lineage_categories.json", "_archived_edges.json",
            "interpretation_embeddings.json"}
    for p in sorted(tax_dir.glob("*.json")):
        if p.name in skip or p.stem.startswith("embeddings-"):
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8-sig"))
        except (json.JSONDecodeError, OSError):
            continue
        for n in data.get("nodes", []):
            if isinstance(n, dict) and isinstance(n.get("id"), str):
                out[n["id"]] = n
    return out


def run_gate(model, emb_nodes, pov_nodes):
    """Byte-stability gate, both arms. Returns (passed: bool, report: dict)."""
    # Sample existing nodes that have both a stored vector and a description.
    ids = [nid for nid, n in pov_nodes.items()
           if nid in emb_nodes and n.get("description")
           and not emb_nodes[nid].get("degenerate")][:GATE_SAMPLE_N]
    if len(ids) < 3:
        return False, {"error": "insufficient existing nodes to gate-check"}

    descs = [pov_nodes[i]["description"] for i in ids]
    vecs = _encode_norm(model, descs)

    clean = []
    for i, nid in enumerate(ids):
        c = _cos(vecs[i], emb_nodes[nid]["vector"])
        clean.append((nid, c))
    clean_pass = all(c >= GATE_COS for _, c in clean)

    # Failure arm: perturb the first reference vector; the same check MUST reject.
    ref = np.asarray(emb_nodes[ids[0]]["vector"], dtype=np.float64)
    rng = np.arange(ref.shape[0], dtype=np.float64)
    perturbed = ref + PERTURB_EPS * np.sin(rng)          # deterministic perturbation
    perturbed = perturbed / np.linalg.norm(perturbed)
    fail_cos = _cos(vecs[0], perturbed)
    failure_arm_rejects = fail_cos < GATE_COS

    report = {
        "threshold": GATE_COS,
        "model": MODEL_NAME,
        "sentence_transformers_version": _pkg("sentence-transformers"),
        "transformers_version": _pkg("transformers"),
        "clean_arm": [{"id": nid, "cos": round(c, 6)} for nid, c in clean],
        "clean_arm_min_cos": round(min(c for _, c in clean), 6),
        "clean_arm_passes": clean_pass,
        "failure_arm_perturbed_cos": round(fail_cos, 6),
        "failure_arm_rejects": failure_arm_rejects,
    }
    return (clean_pass and failure_arm_rejects), report


def compose_new_vectors(model, new_nodes):
    """description-only main vector + Excludes-only exclusion_vector, both L2."""
    descs = [n["description"] for n in new_nodes]
    excl_texts = [_extract_excludes(n["description"]) for n in new_nodes]
    main = _encode_norm(model, descs)
    nonempty = [t for t in excl_texts if t]
    excl_enc = _encode_norm(model, nonempty) if nonempty else []
    excl_iter = iter(excl_enc)
    entries = {}
    for i, n in enumerate(new_nodes):
        entries[n["id"]] = {
            "pov": "safetyist",
            "vector": main[i].tolist(),
            "exclusion_vector": (next(excl_iter).tolist() if excl_texts[i] else None),
        }
    return entries


def retrieval_proof(model, emb_nodes, new_nodes, source_queries):
    """Confirm each coverage gap is closed.

    For each new node, query with the ORIGINAL GAP SOURCE TEXT (the same text that
    scored 0.43-0.68 against existing nodes in t/2371, NOT the node's own
    description — that would be circular) and confirm the new node is now the
    nearest saf-* hit, at a score that beats the prior baseline. Same scoring as
    gap_nearest.py (normalized query · normalized stored vectors) so scores are
    directly comparable to the shipped baselines.
    """
    saf_ids = [k for k in emb_nodes if k.startswith("saf-")]
    M = np.asarray([emb_nodes[k]["vector"] for k in saf_ids], dtype=np.float64)
    M = M / np.clip(np.linalg.norm(M, axis=1, keepdims=True), 1e-9, None)
    results = []
    for n in new_nodes:
        sq = source_queries.get(n["id"])
        if not sq:
            results.append({"new_node": n["id"], "error": "no source_query mapping"})
            continue
        q = _encode_norm(model, [sq["query"]])[0]
        sims = M @ q
        order = np.argsort(-sims)[:3]
        top3 = [{"node": saf_ids[i], "score": round(float(sims[i]), 4)} for i in order]
        new_score = round(float(sims[saf_ids.index(n["id"])]), 4)
        results.append({
            "new_node": n["id"],
            "gap_query": sq["query"][:80] + "...",
            "rank1": top3[0]["node"],
            "rank1_is_new_node": top3[0]["node"] == n["id"],
            "new_node_score": new_score,
            "baseline_nearest": sq.get("baseline_nearest"),
            "baseline_score": sq.get("baseline_score"),
            "delta_vs_baseline": round(new_score - sq.get("baseline_score", 0), 4),
            "top3": top3,
        })
    return results


def main():
    ap = argparse.ArgumentParser(description="Targeted embedding splice for new taxonomy nodes (t/2408).")
    ap.add_argument("--taxonomy-dir", required=True)
    ap.add_argument("--new-nodes", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--gate-only", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    tax_dir = Path(args.taxonomy_dir).resolve()
    emb_path = tax_dir / "embeddings.json"
    envelope = json.loads(emb_path.read_text(encoding="utf-8"))
    emb_nodes = envelope["nodes"]
    pov_nodes = _load_pov_nodes(tax_dir)

    model = _load_model()

    # ── Byte-stability gate (both arms) ──────────────────────────────
    passed, report = run_gate(model, emb_nodes, pov_nodes)
    print("=== BYTE-STABILITY GATE ===", file=sys.stderr)
    print(json.dumps(report, indent=2))
    if not passed:
        print("GATE FAILED — installed encoder has drifted from the shipped baseline. "
              "ABORTING splice (escalate; do not write).", file=sys.stderr)
        sys.exit(2)
    print("GATE PASSED (clean arm reproduces >= threshold; failure arm rejects).", file=sys.stderr)
    if args.gate_only:
        return

    # ── Compose + splice ─────────────────────────────────────────────
    new_doc = json.loads(Path(args.new_nodes).read_text(encoding="utf-8"))
    new_nodes = new_doc["nodes"]
    dup = [n["id"] for n in new_nodes if n["id"] in emb_nodes]
    if dup:
        print(f"ERROR: ids already present in embeddings.json: {dup}", file=sys.stderr)
        sys.exit(3)

    new_entries = compose_new_vectors(model, new_nodes)
    spliced = dict(envelope)
    spliced_nodes = dict(emb_nodes)
    spliced_nodes.update(new_entries)
    spliced["nodes"] = spliced_nodes
    spliced["node_count"] = len(spliced_nodes)
    spliced.setdefault("_splices", []).append({
        "ticket": "t/2408",
        "added": [n["id"] for n in new_nodes],
        "composition": "description-only (w=1.0), L2-normalized; exclusion_vector = Excludes-clause encode, L2; matches shipped corpus empirically (gate clean-arm cos 1.0)",
        "sentence_transformers_version": _pkg("sentence-transformers"),
        "transformers_version": _pkg("transformers"),
        "gate_clean_arm_min_cos": report["clean_arm_min_cos"],
    })

    # ── Retrieval proof (over the SPLICED vectors) ───────────────────
    proof = retrieval_proof(model, spliced_nodes, new_nodes, new_doc.get("_source_queries", {}))
    print("=== RETRIEVAL PROOF (new node must be rank-1 for its gap text) ===", file=sys.stderr)
    print(json.dumps(proof, indent=2))
    all_rank1 = all(p["rank1_is_new_node"] for p in proof)
    print(f"ALL new nodes rank-1: {all_rank1}", file=sys.stderr)
    print(f"node_count {envelope['node_count']} -> {spliced['node_count']}", file=sys.stderr)

    if args.dry_run:
        print("DRY-RUN — not writing.", file=sys.stderr)
        return

    out_path = Path(args.out).resolve() if args.out else emb_path
    out_path.write_text(json.dumps(spliced, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote spliced embeddings ({spliced['node_count']} entries) to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
