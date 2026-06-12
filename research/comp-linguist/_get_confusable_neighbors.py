"""Identify confusable taxonomy node neighbors using content + graph proximity.

No embedding signal — embeddings are contaminated by the model being fixed.

Algorithm:
  Graph signal (weight 0.4): same BDI category + same POV → 0.4, shared parent → +0.1
  Content signal (weight 0.6): TF-IDF cosine similarity on description + assumes
  Final score = content * 0.6 + graph_score

Ticket: t/555

Usage:
    python _get_confusable_neighbors.py [--top-n N] [--node-id ID]

Output:
    _confusable_neighbors.json
"""
import sys
import json
import os
import argparse
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'
RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))
POV_FILES = ['accelerationist.json', 'safetyist.json', 'skeptic.json']


def load_nodes():
    """Load all taxonomy nodes with text and structural metadata."""
    nodes = {}
    for pov_file in POV_FILES:
        with open(os.path.join(DATA_ROOT, pov_file), encoding='utf-8') as f:
            data = json.load(f)
        for n in data.get('nodes', []):
            nid = n.get('id', '')
            assumes = n.get('assumes', [])
            if isinstance(assumes, list):
                assumes_text = ' '.join(assumes)
            elif isinstance(assumes, str):
                assumes_text = assumes
            else:
                assumes_text = ''

            description = n.get('description', '')
            combined_text = f"{description} {assumes_text}".strip()

            nodes[nid] = {
                'id': nid,
                'label': n.get('label', ''),
                'description': description,
                'assumes_text': assumes_text,
                'combined_text': combined_text,
                'category': n.get('category', ''),
                'parent_id': n.get('parent_id', ''),
                'pov': nid.split('-')[0],
            }
    return nodes


def compute_content_similarity(nodes):
    """Compute pairwise TF-IDF cosine similarity on combined text."""
    node_ids = sorted(nodes.keys())
    corpus = [nodes[nid]['combined_text'] for nid in node_ids]

    vectorizer = TfidfVectorizer(
        max_features=10000,
        ngram_range=(1, 2),
        min_df=2,
        stop_words='english',
        sublinear_tf=True,
    )
    tfidf_matrix = vectorizer.fit_transform(corpus)
    sim_matrix = cosine_similarity(tfidf_matrix)
    np.fill_diagonal(sim_matrix, 0.0)

    return node_ids, sim_matrix


def compute_graph_scores(nodes, node_ids):
    """Compute pairwise graph proximity scores."""
    n = len(node_ids)
    graph_matrix = np.zeros((n, n), dtype=np.float32)
    id_to_idx = {nid: i for i, nid in enumerate(node_ids)}

    for i, nid_a in enumerate(node_ids):
        a = nodes[nid_a]
        for j, nid_b in enumerate(node_ids):
            if i == j:
                continue
            b = nodes[nid_b]

            score = 0.0
            if a['pov'] == b['pov'] and a['category'] == b['category']:
                score = 1.0
            if (a['parent_id'] and a['parent_id'] == b['parent_id']):
                score += 0.25

            graph_matrix[i, j] = min(score, 1.25)

    return graph_matrix


def find_neighbors(nodes, node_ids, content_matrix, graph_matrix, top_n, target_node=None):
    """Blend content and graph signals, rank neighbors."""
    blended = content_matrix * 0.6 + graph_matrix * 0.4
    id_to_idx = {nid: i for i, nid in enumerate(node_ids)}

    results = {}
    indices = [id_to_idx[target_node]] if target_node else range(len(node_ids))

    for i in indices:
        nid = node_ids[i]
        scores = blended[i]
        sorted_idx = np.argsort(-scores)

        neighbors = []
        for j in sorted_idx[:top_n]:
            neighbor_id = node_ids[j]
            if scores[j] <= 0:
                break
            neighbors.append({
                'node_id': neighbor_id,
                'label': nodes[neighbor_id]['label'],
                'blended_score': round(float(scores[j]), 4),
                'content_score': round(float(content_matrix[i, j]), 4),
                'graph_score': round(float(graph_matrix[i, j]), 4),
                'same_pov': nodes[nid]['pov'] == nodes[neighbor_id]['pov'],
                'same_category': nodes[nid]['category'] == nodes[neighbor_id]['category'],
                'shared_parent': (nodes[nid]['parent_id'] == nodes[neighbor_id]['parent_id']
                                  and nodes[nid]['parent_id'] != ''),
            })

        results[nid] = {
            'node_id': nid,
            'label': nodes[nid]['label'],
            'pov': nodes[nid]['pov'],
            'category': nodes[nid]['category'],
            'neighbors': neighbors,
        }

    return results


def compute_stats(results):
    """Compute summary statistics over neighbor results."""
    all_scores = []
    cross_pov_confusions = 0
    same_category_pairs = 0
    shared_parent_pairs = 0
    total_pairs = 0

    for nid, data in results.items():
        for nb in data['neighbors']:
            all_scores.append(nb['blended_score'])
            total_pairs += 1
            if not nb['same_pov']:
                cross_pov_confusions += 1
            if nb['same_category']:
                same_category_pairs += 1
            if nb['shared_parent']:
                shared_parent_pairs += 1

    scores = np.array(all_scores) if all_scores else np.array([0])

    high_confusability = sum(1 for nid, d in results.items()
                            if d['neighbors'] and d['neighbors'][0]['blended_score'] > 0.5)

    return {
        'total_nodes': len(results),
        'total_neighbor_pairs': total_pairs,
        'mean_top1_score': round(float(np.mean([d['neighbors'][0]['blended_score']
                                                 for d in results.values()
                                                 if d['neighbors']])), 4),
        'mean_blended_score': round(float(scores.mean()), 4),
        'max_blended_score': round(float(scores.max()), 4),
        'high_confusability_nodes': high_confusability,
        'cross_pov_neighbor_pct': round(cross_pov_confusions / max(total_pairs, 1) * 100, 1),
        'same_category_pct': round(same_category_pairs / max(total_pairs, 1) * 100, 1),
        'shared_parent_pct': round(shared_parent_pairs / max(total_pairs, 1) * 100, 1),
    }


def main():
    parser = argparse.ArgumentParser(description='Identify confusable taxonomy neighbors')
    parser.add_argument('--top-n', type=int, default=4, help='Neighbors per node (default: 4)')
    parser.add_argument('--node-id', type=str, default=None, help='Compute for a single node')
    parser.add_argument('--output-dir', default=RESEARCH_DIR)
    args = parser.parse_args()

    print("=" * 60)
    print("  Confusable Neighbor Identification (t/555)")
    print("=" * 60)

    print("\n[1/4] Loading taxonomy nodes...")
    nodes = load_nodes()
    print(f"  {len(nodes)} nodes loaded")

    per_pov = defaultdict(int)
    per_cat = defaultdict(int)
    for n in nodes.values():
        per_pov[n['pov']] += 1
        per_cat[n['category']] += 1
    print(f"  POV: {dict(per_pov)}")
    print(f"  Category: {dict(per_cat)}")

    print("\n[2/4] Computing TF-IDF content similarity...")
    node_ids, content_matrix = compute_content_similarity(nodes)
    print(f"  {len(node_ids)}×{len(node_ids)} similarity matrix computed")
    content_nonzero = np.count_nonzero(content_matrix > 0.1)
    print(f"  Pairs with content sim > 0.1: {content_nonzero}")

    print("\n[3/4] Computing graph proximity scores...")
    graph_matrix = compute_graph_scores(nodes, node_ids)
    graph_nonzero = np.count_nonzero(graph_matrix > 0)
    print(f"  Pairs with graph signal > 0: {graph_nonzero}")

    print(f"\n[4/4] Finding top-{args.top_n} neighbors per node...")
    results = find_neighbors(nodes, node_ids, content_matrix, graph_matrix,
                             args.top_n, args.node_id)

    stats = compute_stats(results)

    print(f"\n{'─' * 50}")
    print(f"  Nodes analyzed: {stats['total_nodes']}")
    print(f"  Mean top-1 confusability: {stats['mean_top1_score']:.4f}")
    print(f"  High confusability (>0.5): {stats['high_confusability_nodes']} nodes")
    print(f"  Cross-POV neighbors: {stats['cross_pov_neighbor_pct']:.1f}%")
    print(f"  Same-category pairs: {stats['same_category_pct']:.1f}%")
    print(f"  Shared-parent pairs: {stats['shared_parent_pct']:.1f}%")

    print(f"\n  Top 10 most confusable pairs:")
    all_pairs = []
    for nid, data in results.items():
        if data['neighbors']:
            nb = data['neighbors'][0]
            all_pairs.append((nid, nb['node_id'], nb['blended_score'],
                              data['label'][:40], nb['label'][:40]))
    all_pairs.sort(key=lambda x: x[2], reverse=True)
    for nid_a, nid_b, score, label_a, label_b in all_pairs[:10]:
        print(f"    {score:.3f}  {nid_a} ↔ {nid_b}")
        print(f"           {label_a}")
        print(f"           {label_b}")

    output_path = os.path.join(args.output_dir, '_confusable_neighbors.json')
    output = {
        'metadata': {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'algorithm': 'content_tfidf(0.6) + graph_bdi_pov(0.4) + shared_parent(0.1)',
            'top_n': args.top_n,
            'total_nodes': len(results),
            'stats': stats,
        },
        'nodes': results,
    }
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\n  Saved: {output_path}")

    print(f"\n{'=' * 60}")
    print(f"  Done. {len(results)} nodes with top-{args.top_n} confusable neighbors.")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
