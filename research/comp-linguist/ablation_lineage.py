#!/usr/bin/env python3
"""
Ablation study: Does the lineage field (10% weight) improve embedding quality?

Compares three conditions:
  A: Current weights (0.55, 0.35, 0.10, 0, 0)
  B: No lineage    (0.611, 0.389, 0, 0, 0)
  C: Concatenation (single-pass embed of all fields as one string)

Metrics:
  1. Mean intra-cluster cosine similarity (higher = tighter clusters)
  2. Mean inter-cluster centroid distance (higher = better separation)
  3. Known-pair retrieval: mean reciprocal rank for related node pairs

Outputs JSON results to stdout.
"""

import json
import sys
import time
from pathlib import Path

import numpy as np

# Resolve paths
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

# Import shared utilities from embed_taxonomy.py
from embed_taxonomy import (
    _load_taxonomy_nodes,
    _load_model,
    _compose_field_texts,
    _load_lineage_categories,
    _strip_excludes,
    _resolve_taxonomy_dir,
)

# Resolve taxonomy directory from .aitriad.json before any data loading
TAXONOMY_DIR = _resolve_taxonomy_dir()


def safe_compose_field_texts(node, lineage_map):
    """Wrapper that handles dict-type lineage entries (data format issue)."""
    ga = node.get("graph_attributes", {}) or {}
    # Sanitize lineage: some entries are dicts instead of strings
    lineage_values = ga.get("intellectual_lineage", []) or []
    sanitized = []
    for val in lineage_values:
        if isinstance(val, str):
            sanitized.append(val)
        elif isinstance(val, dict):
            sanitized.append(val.get("category", val.get("label", "Other")))
    ga["intellectual_lineage"] = sanitized
    return _compose_field_texts(node, lineage_map)


def compute_embeddings_weighted(model, nodes, lineage_map, weights):
    """Compute weighted multi-field embeddings for all nodes."""
    w_desc, w_assumes, w_lineage, w_epi, w_rhet = weights

    desc_texts, assumes_texts, lineage_texts, epi_texts, rhet_texts = [], [], [], [], []
    for _, node in nodes:
        d, a, l, e, r = safe_compose_field_texts(node, lineage_map)
        desc_texts.append(d)
        assumes_texts.append(a)
        lineage_texts.append(l)
        epi_texts.append(e)
        rhet_texts.append(r)

    n = len(nodes)
    all_texts = desc_texts + assumes_texts + lineage_texts + epi_texts + rhet_texts
    all_vecs = model.encode(all_texts, normalize_embeddings=True, show_progress_bar=False)

    desc_vecs = all_vecs[0:n]
    assumes_vecs = all_vecs[n:2*n]
    lineage_vecs = all_vecs[2*n:3*n]
    epi_vecs = all_vecs[3*n:4*n]
    rhet_vecs = all_vecs[4*n:5*n]

    combined = (w_desc * desc_vecs + w_assumes * assumes_vecs +
                w_lineage * lineage_vecs + w_epi * epi_vecs + w_rhet * rhet_vecs)

    norms = np.linalg.norm(combined, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return combined / norms


def compute_embeddings_concat(model, nodes, lineage_map):
    """Compute single-pass concatenation embeddings."""
    texts = []
    for _, node in nodes:
        d, a, l, _, _ = safe_compose_field_texts(node, lineage_map)
        parts = [d]
        if a:
            parts.append(f"Assumes: {a}")
        if l:
            parts.append(f"Lineage: {l}")
        texts.append(" [SEP] ".join(parts))

    vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return vecs


def cosine_sim(a, b):
    """Cosine similarity between two vectors."""
    dot = np.dot(a, b)
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(dot / (na * nb))


def agglomerative_cluster(vectors, ids, max_clusters=10, min_sim=0.55):
    """Simple average-linkage agglomerative clustering (matches PS reference impl)."""
    n = len(ids)
    if n == 0:
        return []

    # Precompute pairwise cosine similarities
    sim_matrix = vectors @ vectors.T  # works because vectors are normalized

    # Init: each node is its own cluster
    clusters = [[i] for i in range(n)]

    while len(clusters) > max_clusters:
        best_sim = -1.0
        best_i, best_j = 0, 1

        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                # Average-linkage
                total = 0.0
                count = 0
                for a in clusters[i]:
                    for b in clusters[j]:
                        total += sim_matrix[a, b]
                        count += 1
                avg = total / count if count > 0 else 0
                if avg > best_sim:
                    best_sim = avg
                    best_i, best_j = i, j

        if best_sim < min_sim:
            break

        # Merge
        clusters[best_i] = clusters[best_i] + clusters[best_j]
        clusters.pop(best_j)

    return [[ids[idx] for idx in c] for c in clusters]


def compute_cluster_metrics(vectors, ids, clusters):
    """Compute intra-cluster coherence and inter-cluster separation."""
    id_to_idx = {id_: i for i, id_ in enumerate(ids)}

    # Intra-cluster: mean pairwise similarity within each cluster
    intra_sims = []
    for cluster in clusters:
        if len(cluster) < 2:
            continue
        indices = [id_to_idx[id_] for id_ in cluster if id_ in id_to_idx]
        if len(indices) < 2:
            continue
        pairs = 0
        total = 0.0
        for i in range(len(indices)):
            for j in range(i + 1, len(indices)):
                total += cosine_sim(vectors[indices[i]], vectors[indices[j]])
                pairs += 1
        if pairs > 0:
            intra_sims.append(total / pairs)

    # Inter-cluster: mean cosine distance between cluster centroids
    centroids = []
    for cluster in clusters:
        if len(cluster) < 1:
            continue
        indices = [id_to_idx[id_] for id_ in cluster if id_ in id_to_idx]
        if not indices:
            continue
        centroid = np.mean(vectors[indices], axis=0)
        norm = np.linalg.norm(centroid)
        if norm > 0:
            centroid = centroid / norm
        centroids.append(centroid)

    inter_sims = []
    for i in range(len(centroids)):
        for j in range(i + 1, len(centroids)):
            inter_sims.append(cosine_sim(centroids[i], centroids[j]))

    return {
        "mean_intra_cluster_sim": float(np.mean(intra_sims)) if intra_sims else 0.0,
        "mean_inter_cluster_sim": float(np.mean(inter_sims)) if inter_sims else 0.0,
        "separation": float(np.mean(intra_sims) - np.mean(inter_sims)) if intra_sims and inter_sims else 0.0,
        "num_clusters": len(clusters),
    }


def compute_retrieval_metrics(vectors, ids, edges_file):
    """Compute mean reciprocal rank for known related pairs from edges.json."""
    if not edges_file.exists():
        return {"mrr": None, "note": "edges.json not found"}

    data = json.loads(edges_file.read_text(encoding="utf-8"))
    edges = data.get("edges", [])

    id_to_idx = {id_: i for i, id_ in enumerate(ids)}

    # Filter to pairs where both nodes have embeddings
    pairs = []
    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if src in id_to_idx and tgt in id_to_idx:
            pairs.append((src, tgt))

    if len(pairs) < 5:
        return {"mrr": None, "pairs_found": len(pairs), "note": "insufficient pairs"}

    # Sample up to 50 pairs for speed
    if len(pairs) > 50:
        rng = np.random.default_rng(42)
        indices = rng.choice(len(pairs), size=50, replace=False)
        pairs = [pairs[i] for i in indices]

    # Compute similarity matrix
    sim_matrix = vectors @ vectors.T

    reciprocal_ranks = []
    for src, tgt in pairs:
        src_idx = id_to_idx[src]
        tgt_idx = id_to_idx[tgt]

        # Rank all nodes by similarity to src
        sims = sim_matrix[src_idx]
        ranked = np.argsort(-sims)
        rank = int(np.where(ranked == tgt_idx)[0][0]) + 1  # 1-based
        reciprocal_ranks.append(1.0 / rank)

    return {
        "mrr": float(np.mean(reciprocal_ranks)),
        "pairs_evaluated": len(pairs),
    }


def main():
    print("Loading taxonomy nodes...", file=sys.stderr)
    nodes = _load_taxonomy_nodes()
    lineage_map = _load_lineage_categories()
    print(f"  {len(nodes)} nodes loaded", file=sys.stderr)

    print("Loading embedding model...", file=sys.stderr)
    model = _load_model()

    ids = [node["id"] for _, node in nodes]
    edges_file = TAXONOMY_DIR / "edges.json"

    results = {}

    # Condition A: Current weights
    print("\n[A] Current weights (0.55, 0.35, 0.10, 0, 0)...", file=sys.stderr)
    t0 = time.time()
    vecs_a = compute_embeddings_weighted(model, nodes, lineage_map, (0.55, 0.35, 0.10, 0.0, 0.0))
    clusters_a = agglomerative_cluster(vecs_a, ids, max_clusters=10, min_sim=0.55)
    results["A_current"] = {
        "weights": "0.55, 0.35, 0.10, 0, 0",
        "cluster_metrics": compute_cluster_metrics(vecs_a, ids, clusters_a),
        "retrieval": compute_retrieval_metrics(vecs_a, ids, edges_file),
        "time_s": round(time.time() - t0, 1),
    }
    print(f"  Done ({results['A_current']['time_s']}s)", file=sys.stderr)

    # Condition B: No lineage
    print("\n[B] No lineage (0.611, 0.389, 0, 0, 0)...", file=sys.stderr)
    t0 = time.time()
    vecs_b = compute_embeddings_weighted(model, nodes, lineage_map, (0.611, 0.389, 0.0, 0.0, 0.0))
    clusters_b = agglomerative_cluster(vecs_b, ids, max_clusters=10, min_sim=0.55)
    results["B_no_lineage"] = {
        "weights": "0.611, 0.389, 0, 0, 0",
        "cluster_metrics": compute_cluster_metrics(vecs_b, ids, clusters_b),
        "retrieval": compute_retrieval_metrics(vecs_b, ids, edges_file),
        "time_s": round(time.time() - t0, 1),
    }
    print(f"  Done ({results['B_no_lineage']['time_s']}s)", file=sys.stderr)

    # Condition C: Concatenation
    print("\n[C] Concatenation (single-pass embed)...", file=sys.stderr)
    t0 = time.time()
    vecs_c = compute_embeddings_concat(model, nodes, lineage_map)
    clusters_c = agglomerative_cluster(vecs_c, ids, max_clusters=10, min_sim=0.55)
    results["C_concatenation"] = {
        "weights": "single-pass (model-weighted)",
        "cluster_metrics": compute_cluster_metrics(vecs_c, ids, clusters_c),
        "retrieval": compute_retrieval_metrics(vecs_c, ids, edges_file),
        "time_s": round(time.time() - t0, 1),
    }
    print(f"  Done ({results['C_concatenation']['time_s']}s)", file=sys.stderr)

    # Summary
    print("\n=== RESULTS ===", file=sys.stderr)
    for cond, data in results.items():
        cm = data["cluster_metrics"]
        ret = data["retrieval"]
        mrr_str = f"{ret['mrr']:.4f}" if ret.get("mrr") is not None else "n/a"
        print(
            f"  {cond}: intra={cm['mean_intra_cluster_sim']:.4f}  "
            f"inter={cm['mean_inter_cluster_sim']:.4f}  "
            f"separation={cm['separation']:.4f}  "
            f"MRR={mrr_str}",
            file=sys.stderr,
        )

    # Output JSON
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
