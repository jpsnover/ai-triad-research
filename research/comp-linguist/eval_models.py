#!/usr/bin/env python3
"""
Embedding model evaluation: compare candidate models on taxonomy retrieval quality.

Metrics:
  - MRR (Mean Reciprocal Rank) on known edge pairs
  - Intra-cluster coherence
  - Encoding speed (full taxonomy)
"""

import json
import sys
import time
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from embed_taxonomy import _load_taxonomy_nodes, _resolve_taxonomy_dir, _compose_field_texts, _load_lineage_categories

# Resolve data paths
TAXONOMY_DIR = _resolve_taxonomy_dir()
from embed_taxonomy import TAXONOMY_DIR


def safe_compose(node, lineage_map):
    """Handle dict-type lineage entries."""
    ga = node.get("graph_attributes", {}) or {}
    lineage_values = ga.get("intellectual_lineage", []) or []
    sanitized = []
    for val in lineage_values:
        if isinstance(val, str):
            sanitized.append(val)
        elif isinstance(val, dict):
            sanitized.append(val.get("name", val.get("category", "Other")))
    ga["intellectual_lineage"] = sanitized
    return _compose_field_texts(node, lineage_map)


MODELS = [
    ("all-MiniLM-L6-v2", "all-MiniLM-L6-v2"),
    ("all-MiniLM-L12-v2", "all-MiniLM-L12-v2"),
    ("bge-small-en-v1.5", "BAAI/bge-small-en-v1.5"),
    ("gte-small", "thenlper/gte-small"),
]

# Weights from t/268 fix
W_DESC, W_ASSUMES = 0.611, 0.389


def embed_taxonomy(model, nodes, lineage_map):
    """Embed all nodes using the t/268 pipeline (raw + weighted + normalize once)."""
    desc_texts, assumes_texts = [], []
    for _, node in nodes:
        d, a, _, _, _ = safe_compose(node, lineage_map)
        desc_texts.append(d)
        assumes_texts.append(a)

    n = len(nodes)
    all_texts = desc_texts + assumes_texts

    t0 = time.time()
    all_vecs = model.encode(all_texts, normalize_embeddings=False, show_progress_bar=False)
    encode_time = time.time() - t0

    desc_vecs = all_vecs[0:n]
    assumes_vecs = all_vecs[n:2*n]

    combined = W_DESC * desc_vecs + W_ASSUMES * assumes_vecs
    norms = np.linalg.norm(combined, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    vectors = combined / norms

    return vectors, encode_time


def compute_mrr(vectors, ids, edges_file, sample_size=50):
    """MRR on known edge pairs."""
    if not edges_file.exists():
        return None, 0

    data = json.loads(edges_file.read_text(encoding="utf-8"))
    edges = data.get("edges", [])

    id_to_idx = {id_: i for i, id_ in enumerate(ids)}
    pairs = [(e["source"], e["target"]) for e in edges
             if e.get("source") in id_to_idx and e.get("target") in id_to_idx]

    if len(pairs) < 5:
        return None, len(pairs)

    rng = np.random.default_rng(42)
    if len(pairs) > sample_size:
        indices = rng.choice(len(pairs), size=sample_size, replace=False)
        pairs = [pairs[i] for i in indices]

    sim_matrix = vectors @ vectors.T
    reciprocal_ranks = []
    for src, tgt in pairs:
        src_idx = id_to_idx[src]
        tgt_idx = id_to_idx[tgt]
        sims = sim_matrix[src_idx]
        ranked = np.argsort(-sims)
        rank = int(np.where(ranked == tgt_idx)[0][0]) + 1
        reciprocal_ranks.append(1.0 / rank)

    return float(np.mean(reciprocal_ranks)), len(pairs)


def compute_cluster_coherence(vectors, ids, max_clusters=10, min_sim=0.55):
    """Mean intra-cluster similarity using agglomerative clustering."""
    n = len(ids)
    if n < 2:
        return 0.0, 0

    sim_matrix = vectors @ vectors.T
    clusters = [[i] for i in range(n)]

    while len(clusters) > max_clusters:
        best_sim = -1.0
        best_i, best_j = 0, 1
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                total = sum(sim_matrix[a, b] for a in clusters[i] for b in clusters[j])
                avg = total / (len(clusters[i]) * len(clusters[j]))
                if avg > best_sim:
                    best_sim = avg
                    best_i, best_j = i, j
        if best_sim < min_sim:
            break
        clusters[best_i] = clusters[best_i] + clusters[best_j]
        clusters.pop(best_j)

    # Compute intra-cluster coherence
    intra_sims = []
    for cluster in clusters:
        if len(cluster) < 2:
            continue
        pairs_count = 0
        total = 0.0
        for i in range(len(cluster)):
            for j in range(i + 1, len(cluster)):
                total += sim_matrix[cluster[i], cluster[j]]
                pairs_count += 1
        if pairs_count > 0:
            intra_sims.append(total / pairs_count)

    return float(np.mean(intra_sims)) if intra_sims else 0.0, len(clusters)


def main():
    from sentence_transformers import SentenceTransformer

    print("Loading taxonomy...", file=sys.stderr)
    nodes = _load_taxonomy_nodes()
    lineage_map = _load_lineage_categories()
    ids = [node["id"] for _, node in nodes]
    edges_file = TAXONOMY_DIR / "edges.json"
    print(f"  {len(nodes)} nodes loaded", file=sys.stderr)

    results = {}

    for label, model_name in MODELS:
        print(f"\n[{label}] Loading model...", file=sys.stderr)
        model = SentenceTransformer(model_name)

        print(f"  Encoding {len(nodes)} nodes...", file=sys.stderr)
        vectors, encode_time = embed_taxonomy(model, nodes, lineage_map)

        print(f"  Computing MRR...", file=sys.stderr)
        mrr, pairs = compute_mrr(vectors, ids, edges_file)

        print(f"  Computing cluster coherence (sampled)...", file=sys.stderr)
        # Sample 200 nodes for speed (full clustering is O(n^3))
        rng = np.random.default_rng(42)
        sample_idx = rng.choice(len(ids), size=min(200, len(ids)), replace=False)
        sample_vecs = vectors[sample_idx]
        sample_ids = [ids[i] for i in sample_idx]
        coherence, num_clusters = compute_cluster_coherence(sample_vecs, sample_ids)

        results[label] = {
            "model": model_name,
            "dimension": int(vectors.shape[1]),
            "encode_time_s": round(encode_time, 2),
            "mrr": round(mrr, 4) if mrr is not None else None,
            "pairs_evaluated": pairs,
            "cluster_coherence": round(coherence, 4),
            "num_clusters": num_clusters,
        }
        print(f"  Done: MRR={mrr:.4f}, coherence={coherence:.4f}, time={encode_time:.1f}s", file=sys.stderr)

    # Summary table
    print("\n=== MODEL COMPARISON ===", file=sys.stderr)
    print(f"{'Model':<22} {'MRR':>8} {'Coherence':>10} {'Time(s)':>8} {'Clusters':>9}", file=sys.stderr)
    print("-" * 60, file=sys.stderr)
    baseline_mrr = results["all-MiniLM-L6-v2"]["mrr"]
    for label, data in results.items():
        mrr = data["mrr"]
        delta = ((mrr - baseline_mrr) / baseline_mrr * 100) if baseline_mrr and mrr else 0
        print(
            f"{label:<22} {mrr:>8.4f} {data['cluster_coherence']:>10.4f} "
            f"{data['encode_time_s']:>8.1f} {data['num_clusters']:>9}  "
            f"({'baseline' if label == 'all-MiniLM-L6-v2' else f'{delta:+.1f}%'})",
            file=sys.stderr,
        )

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
