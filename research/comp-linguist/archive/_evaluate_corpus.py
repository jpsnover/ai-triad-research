"""Evaluate synthetic corpus quality against the golden test set.

Computes attribution metrics (MRR, Recall@k, NDCG), poaching analysis,
and cluster separation for confusable neighbor pairs.

Ticket: t/558

Usage:
    python _evaluate_corpus.py [--corpus-dir PATH] [--golden-set PATH]
    python _evaluate_corpus.py --poaching-only
    python _evaluate_corpus.py --cluster-only [--scope neighbors_only]

Output:
    _evaluation_report.json
"""
import sys
import json
import os
import argparse
import hashlib
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

sys.stdout.reconfigure(encoding='utf-8')

RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(RESEARCH_DIR))


def resolve_data_root():
    config_path = os.path.join(REPO_ROOT, '.aitriad.json')
    if os.path.exists(config_path):
        try:
            with open(config_path, encoding='utf-8') as fh:
                cfg = json.load(fh)
            data_root = cfg.get('data_root', '.')
            tax_dir = cfg.get('taxonomy_dir', 'taxonomy/Origin')
            if os.path.isabs(data_root):
                base = data_root
            else:
                base = os.path.join(REPO_ROOT, data_root)
            return os.path.normpath(os.path.join(base, tax_dir))
        except (json.JSONDecodeError, OSError):
            pass
    return os.path.normpath(os.path.join(REPO_ROOT, 'taxonomy', 'Origin'))


def load_golden_set(path):
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    return data


def load_claim_vectors(research_dir):
    vec_path = os.path.join(research_dir, '_golden_claim_vectors.npy')
    idx_path = os.path.join(research_dir, '_golden_claim_index.json')
    if not os.path.exists(vec_path) or not os.path.exists(idx_path):
        return None, None
    vectors = np.load(vec_path)
    with open(idx_path, encoding='utf-8') as f:
        index = json.load(f)
    return vectors, index


def load_description_vectors(tax_dir):
    """Load node description vectors from embeddings.json (baseline vectors)."""
    emb_path = os.path.join(tax_dir, 'embeddings.json')
    if not os.path.exists(emb_path):
        return {}
    with open(emb_path, encoding='utf-8') as f:
        data = json.load(f)
    vectors = {}
    nodes = data.get('nodes', {})
    if isinstance(nodes, dict):
        for nid, info in nodes.items():
            vec = info.get('vector')
            if vec:
                vectors[nid] = np.array(vec, dtype=np.float32)
    elif isinstance(nodes, list):
        for node in nodes:
            nid = node.get('node_id') or node.get('id')
            vec = node.get('vector')
            if nid and vec:
                vectors[nid] = np.array(vec, dtype=np.float32)
    return vectors


def load_corpus(corpus_dir):
    """Load all per-POV corpus files and return entries grouped by node_id."""
    entries_by_node = defaultdict(list)
    all_entries = []
    for fname in os.listdir(corpus_dir):
        if not fname.startswith('corpus_') or not fname.endswith('.json'):
            continue
        path = os.path.join(corpus_dir, fname)
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for entry in data.get('entries', []):
            if not entry.get('pruned', False):
                entries_by_node[entry['node_id']].append(entry)
                all_entries.append(entry)
    return entries_by_node, all_entries


_model_cache = {}


def get_model(model_name='all-MiniLM-L6-v2'):
    """Load and cache the sentence-transformers model."""
    if model_name not in _model_cache:
        from sentence_transformers import SentenceTransformer
        _model_cache[model_name] = SentenceTransformer(model_name)
    return _model_cache[model_name]


def embed_texts(texts, model_name='all-MiniLM-L6-v2'):
    """Embed texts using sentence-transformers (shared model instance)."""
    try:
        model = get_model(model_name)
        vectors = model.encode(texts, show_progress_bar=len(texts) > 100,
                               batch_size=64, normalize_embeddings=True)
        return np.array(vectors)
    except ImportError:
        print("  sentence-transformers not available, using TF-IDF fallback")
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.preprocessing import normalize
        vectorizer = TfidfVectorizer(max_features=5000, sublinear_tf=True)
        matrix = vectorizer.fit_transform(texts)
        return normalize(matrix.toarray()).astype(np.float32)


def load_taxonomy_descriptions(tax_dir):
    """Load node descriptions directly from taxonomy JSON files."""
    descriptions = {}
    pov_files = {
        'acc': 'accelerationist.json',
        'saf': 'safetyist.json',
        'skp': 'skeptic.json',
    }
    for pov, fname in pov_files.items():
        path = os.path.join(tax_dir, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        nodes = data if isinstance(data, list) else data.get('nodes', data.get('entries', []))
        if isinstance(nodes, dict):
            nodes = list(nodes.values())
        for node in nodes:
            nid = node.get('id') or node.get('node_id')
            desc = node.get('description', '')
            if nid and desc:
                descriptions[nid] = desc
    return descriptions


def compute_corpus_vectors(entries_by_node, cache_dir=None):
    """Embed all corpus statements, return per-node vector sets."""
    all_texts = []
    text_to_node = []
    node_ranges = {}

    for node_id in sorted(entries_by_node.keys()):
        start = len(all_texts)
        for entry in entries_by_node[node_id]:
            all_texts.append(entry['statement'])
            text_to_node.append(node_id)
        node_ranges[node_id] = (start, len(all_texts))

    if not all_texts:
        return {}, np.array([])

    cache_path = os.path.join(cache_dir, '_corpus_vectors_cache.npz') if cache_dir else None
    cache_hash = hashlib.md5('|'.join(all_texts[:10] + [str(len(all_texts))]).encode()).hexdigest()

    if cache_path and os.path.exists(cache_path):
        cached = np.load(cache_path, allow_pickle=False)
        if str(cached.get('hash', '')) == cache_hash:
            print("  Using cached corpus vectors")
            vectors = cached['vectors']
            node_ranges = json.loads(str(cached['ranges']))
            return {nid: vectors[s:e] for nid, (s, e) in node_ranges.items()}, vectors

    print(f"  Embedding {len(all_texts)} corpus statements...")
    vectors = embed_texts(all_texts)

    if cache_path:
        np.savez_compressed(cache_path, vectors=vectors,
                            ranges=json.dumps(node_ranges), hash=cache_hash)

    per_node = {}
    for node_id, (start, end) in node_ranges.items():
        per_node[node_id] = vectors[start:end]

    return per_node, vectors


def attribution_score(claim_vec, node_vectors, strategy='max'):
    """Compute attribution score for a claim against a node's vectors."""
    if node_vectors.shape[0] == 0:
        return 0.0
    sims = cosine_similarity(claim_vec.reshape(1, -1), node_vectors).flatten()
    if strategy == 'max':
        return float(np.max(sims))
    elif strategy == 'mean_top_3':
        top_k = min(3, len(sims))
        return float(np.mean(np.sort(sims)[-top_k:]))
    elif strategy == 'mean_top_5':
        top_k = min(5, len(sims))
        return float(np.mean(np.sort(sims)[-top_k:]))
    return float(np.max(sims))


def compute_attribution_metrics(claims, claim_vectors, claim_index,
                                 corpus_vectors_by_node, strategy='max'):
    """Compute MRR, Recall@k, NDCG against golden set attributions."""
    reciprocal_ranks = []
    recall_at = {1: 0, 3: 0, 5: 0}
    ndcg_scores = []
    per_node_difficulty = defaultdict(list)
    per_pov = defaultdict(lambda: {'mrr': [], 'recall1': 0, 'count': 0})
    evaluated = 0

    node_ids = sorted(corpus_vectors_by_node.keys())

    for claim in claims:
        cid = claim['claim_id']
        if cid not in claim_index:
            continue
        vec_idx = claim_index[cid]
        claim_vec = claim_vectors[vec_idx]
        true_node = claim['attributed_node']
        pov = claim['pov']

        if true_node not in corpus_vectors_by_node:
            continue

        scores = []
        for nid in node_ids:
            s = attribution_score(claim_vec, corpus_vectors_by_node[nid], strategy)
            scores.append((nid, s))
        scores.sort(key=lambda x: x[1], reverse=True)

        rank = None
        for i, (nid, _) in enumerate(scores):
            if nid == true_node:
                rank = i + 1
                break

        if rank is None:
            continue

        evaluated += 1
        rr = 1.0 / rank
        reciprocal_ranks.append(rr)

        for k in recall_at:
            if rank <= k:
                recall_at[k] += 1

        dcg = 1.0 / np.log2(rank + 1)
        ndcg_scores.append(dcg)

        per_node_difficulty[true_node].append(rank)
        per_pov[pov]['mrr'].append(rr)
        per_pov[pov]['count'] += 1
        if rank == 1:
            per_pov[pov]['recall1'] += 1

    if evaluated == 0:
        return None

    node_difficulty = {}
    for nid, ranks in per_node_difficulty.items():
        node_difficulty[nid] = {
            'mean_rank': round(float(np.mean(ranks)), 2),
            'median_rank': round(float(np.median(ranks)), 1),
            'claim_count': len(ranks),
            'recall_at_1': sum(1 for r in ranks if r == 1),
            'recall_at_1_pct': round(sum(1 for r in ranks if r == 1) / len(ranks) * 100, 1),
        }

    pov_metrics = {}
    for pov, data in per_pov.items():
        pov_metrics[pov] = {
            'mrr': round(float(np.mean(data['mrr'])), 4) if data['mrr'] else 0,
            'recall_at_1': data['recall1'],
            'recall_at_1_pct': round(data['recall1'] / max(data['count'], 1) * 100, 1),
            'count': data['count'],
        }

    return {
        'strategy': strategy,
        'claims_evaluated': evaluated,
        'nodes_in_corpus': len(node_ids),
        'mrr': round(float(np.mean(reciprocal_ranks)), 4),
        'recall_at_1': round(recall_at[1] / evaluated * 100, 1),
        'recall_at_3': round(recall_at[3] / evaluated * 100, 1),
        'recall_at_5': round(recall_at[5] / evaluated * 100, 1),
        'mean_ndcg': round(float(np.mean(ndcg_scores)), 4),
        'per_pov': pov_metrics,
        'per_node_difficulty': dict(sorted(
            node_difficulty.items(),
            key=lambda x: x[1]['mean_rank'], reverse=True
        )),
    }


def compute_poaching_analysis(claims, claim_vectors, claim_index,
                               corpus_vectors_by_node):
    """Per-vector poaching analysis: which synthetic vectors attract wrong claims."""
    node_ids = sorted(corpus_vectors_by_node.keys())
    poaching_counts = defaultdict(lambda: {'total_attracted': 0, 'wrong_attracted': 0,
                                            'statements': defaultdict(int)})
    per_node_poaching = defaultdict(lambda: {'poached_by': defaultdict(int),
                                              'poaching_from': defaultdict(int),
                                              'claim_count': 0})

    for claim in claims:
        cid = claim['claim_id']
        if cid not in claim_index:
            continue
        vec_idx = claim_index[cid]
        claim_vec = claim_vectors[vec_idx]
        true_node = claim['attributed_node']

        if true_node not in corpus_vectors_by_node:
            continue

        per_node_poaching[true_node]['claim_count'] += 1

        best_node = None
        best_score = -1
        for nid in node_ids:
            s = attribution_score(claim_vec, corpus_vectors_by_node[nid], 'max')
            if s > best_score:
                best_score = s
                best_node = nid

        if best_node and best_node != true_node:
            per_node_poaching[true_node]['poached_by'][best_node] += 1
            per_node_poaching[best_node]['poaching_from'][true_node] += 1

    worst_poached = []
    for nid, data in per_node_poaching.items():
        total_poached = sum(data['poached_by'].values())
        if data['claim_count'] > 0:
            poach_rate = total_poached / data['claim_count']
            worst_poached.append({
                'node_id': nid,
                'claim_count': data['claim_count'],
                'times_poached': total_poached,
                'poach_rate': round(poach_rate, 3),
                'top_poacher': max(data['poached_by'].items(),
                                   key=lambda x: x[1])[0] if data['poached_by'] else None,
            })

    worst_poached.sort(key=lambda x: x['poach_rate'], reverse=True)

    worst_poachers = []
    for nid, data in per_node_poaching.items():
        total_stolen = sum(data['poaching_from'].values())
        if total_stolen > 0:
            worst_poachers.append({
                'node_id': nid,
                'claims_stolen': total_stolen,
                'stolen_from': dict(data['poaching_from']),
            })
    worst_poachers.sort(key=lambda x: x['claims_stolen'], reverse=True)

    return {
        'worst_poached_nodes': worst_poached[:20],
        'worst_poaching_nodes': worst_poachers[:20],
        'total_claims': len([c for c in claims if c['claim_id'] in claim_index]),
        'total_poached': sum(x['times_poached'] for x in worst_poached),
        'overall_poach_rate': round(
            sum(x['times_poached'] for x in worst_poached) /
            max(sum(x['claim_count'] for x in worst_poached), 1), 3
        ),
    }


def compute_cluster_separation(corpus_vectors_by_node, confusable_neighbors=None,
                                scope='all'):
    """Compute inter-node cluster separation metrics."""
    node_ids = sorted(corpus_vectors_by_node.keys())

    if scope == 'neighbors_only' and confusable_neighbors:
        pairs_to_check = set()
        for nid, data in confusable_neighbors.get('nodes', {}).items():
            for nb in data.get('neighbors', []):
                pair = tuple(sorted([nid, nb['node_id']]))
                if pair[0] in corpus_vectors_by_node and pair[1] in corpus_vectors_by_node:
                    pairs_to_check.add(pair)
    else:
        pairs_to_check = set()
        for i, a in enumerate(node_ids):
            for b in node_ids[i+1:]:
                pairs_to_check.add((a, b))

    if not pairs_to_check:
        return None

    centroids = {}
    for nid, vecs in corpus_vectors_by_node.items():
        if len(vecs) > 0:
            centroids[nid] = np.mean(vecs, axis=0)

    pair_distances = []
    for a, b in pairs_to_check:
        if a not in centroids or b not in centroids:
            continue
        centroid_sim = float(cosine_similarity(
            centroids[a].reshape(1, -1), centroids[b].reshape(1, -1)
        )[0, 0])

        cross_sim = float(cosine_similarity(
            corpus_vectors_by_node[a], corpus_vectors_by_node[b]
        ).mean())

        intra_a = float(cosine_similarity(corpus_vectors_by_node[a]).mean()) if len(corpus_vectors_by_node[a]) > 1 else 1.0
        intra_b = float(cosine_similarity(corpus_vectors_by_node[b]).mean()) if len(corpus_vectors_by_node[b]) > 1 else 1.0

        separation = (intra_a + intra_b) / 2 - cross_sim

        same_pov = a.split('-')[0] == b.split('-')[0]

        pair_distances.append({
            'node_a': a,
            'node_b': b,
            'centroid_similarity': round(centroid_sim, 4),
            'mean_cross_similarity': round(cross_sim, 4),
            'mean_intra_a': round(intra_a, 4),
            'mean_intra_b': round(intra_b, 4),
            'separation_score': round(separation, 4),
            'same_pov': same_pov,
        })

    pair_distances.sort(key=lambda x: x['separation_score'])

    seps = [p['separation_score'] for p in pair_distances]

    return {
        'scope': scope,
        'pairs_analyzed': len(pair_distances),
        'mean_separation': round(float(np.mean(seps)), 4) if seps else 0,
        'min_separation': round(float(np.min(seps)), 4) if seps else 0,
        'max_separation': round(float(np.max(seps)), 4) if seps else 0,
        'poorly_separated_pairs': [p for p in pair_distances[:10]],
        'well_separated_pairs': [p for p in pair_distances[-5:]],
        'negative_separation_count': sum(1 for s in seps if s < 0),
    }


def main():
    parser = argparse.ArgumentParser(description='Evaluate synthetic corpus quality')
    parser.add_argument('--corpus-dir', default=None,
                        help='Path to synthetic corpus directory')
    parser.add_argument('--golden-set',
                        default=os.path.join(RESEARCH_DIR, '_golden_test_set.json'))
    parser.add_argument('--strategy', choices=['max', 'mean_top_3', 'mean_top_5', 'all'],
                        default='all', help='Attribution aggregation strategy')
    parser.add_argument('--poaching-only', action='store_true')
    parser.add_argument('--cluster-only', action='store_true')
    parser.add_argument('--scope', choices=['all', 'neighbors_only'],
                        default='neighbors_only')
    parser.add_argument('--output-dir', default=RESEARCH_DIR)
    args = parser.parse_args()

    if args.corpus_dir is None:
        tax_dir = resolve_data_root()
        args.corpus_dir = os.path.join(tax_dir, 'synthetic')

    print("=" * 60)
    print("  Synthetic Corpus Evaluation (t/558)")
    print("=" * 60)

    print("\n[1/5] Loading golden test set...")
    golden = load_golden_set(args.golden_set)
    claims = golden['claims']
    print(f"  {len(claims)} claims loaded")
    baseline = golden.get('metadata', {}).get('baseline_metrics', {})
    print(f"  Baseline MRR: {baseline.get('global_mrr', 'N/A')}")

    print("\n[2/5] Embedding claims (fresh, same model as corpus)...")
    texts = [c['claim_text'] for c in claims]
    claim_vectors = embed_texts(texts)
    claim_index = {c['claim_id']: i for i, c in enumerate(claims)}
    print(f"  {claim_vectors.shape[0]} claims embedded ({claim_vectors.shape[1]}d)")

    print("\n[3/5] Loading and embedding corpus...")
    entries_by_node, all_entries = load_corpus(args.corpus_dir)
    print(f"  {len(all_entries)} statements across {len(entries_by_node)} nodes")
    if not entries_by_node:
        print("  ERROR: No corpus entries found. Run New-SyntheticCorpus first.")
        return

    per_pov = defaultdict(int)
    per_arch = defaultdict(int)
    for e in all_entries:
        per_pov[e['node_id'].split('-')[0]] += 1
        per_arch[e['archetype']] += 1
    print(f"  POV: {dict(per_pov)}")
    print(f"  Archetypes: {dict(per_arch)}")

    corpus_by_node, all_corpus_vecs = compute_corpus_vectors(
        entries_by_node, cache_dir=RESEARCH_DIR
    )

    tax_dir = os.path.dirname(args.corpus_dir)
    corpus_node_ids = set(corpus_by_node.keys())

    print("  Loading production description vectors from embeddings.json...")
    desc_vectors = load_description_vectors(tax_dir)
    print(f"  {len(desc_vectors)} node vectors loaded from embeddings.json")

    desc_merged = 0
    for nid in corpus_node_ids:
        if nid in desc_vectors:
            corpus_by_node[nid] = np.vstack([desc_vectors[nid].reshape(1, -1), corpus_by_node[nid]])
            desc_merged += 1
    print(f"  Merged description vectors for {desc_merged}/{len(corpus_node_ids)} corpus nodes")

    desc_only = {}
    for nid in corpus_node_ids:
        if nid in desc_vectors:
            desc_only[nid] = desc_vectors[nid].reshape(1, -1)
    print(f"  Baseline candidate set: {len(desc_only)} nodes (corpus nodes only)")

    results = {
        'metadata': {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'golden_set': args.golden_set,
            'corpus_dir': args.corpus_dir,
            'total_claims': len(claims),
            'total_corpus_statements': len(all_entries),
            'corpus_nodes': len(entries_by_node),
            'description_vectors_merged': desc_merged,
        }
    }

    if not args.cluster_only:
        print("\n[4a/5] Computing baseline (description-only) metrics...")
        if desc_only:
            baseline_metrics = compute_attribution_metrics(
                claims, claim_vectors, claim_index, desc_only, 'max'
            )
            if baseline_metrics:
                print(f"    MRR:       {baseline_metrics['mrr']:.4f}")
                print(f"    Recall@1:  {baseline_metrics['recall_at_1']:.1f}%")
                print(f"    Recall@3:  {baseline_metrics['recall_at_3']:.1f}%")
                print(f"    Recall@5:  {baseline_metrics['recall_at_5']:.1f}%")
                print(f"    Evaluated: {baseline_metrics['claims_evaluated']} claims against {baseline_metrics['nodes_in_corpus']} nodes")
                results['baseline_computed'] = baseline_metrics

        print("\n[4b/5] Computing attribution metrics (description + synthetic)...")
        strategies = ['max', 'mean_top_3', 'mean_top_5'] if args.strategy == 'all' else [args.strategy]

        attribution_results = {}
        for strat in strategies:
            print(f"\n  ── Strategy: {strat} ──")
            metrics = compute_attribution_metrics(
                claims, claim_vectors, claim_index, corpus_by_node, strat
            )
            if metrics:
                attribution_results[strat] = metrics
                print(f"    MRR:       {metrics['mrr']:.4f}")
                print(f"    Recall@1:  {metrics['recall_at_1']:.1f}%")
                print(f"    Recall@3:  {metrics['recall_at_3']:.1f}%")
                print(f"    Recall@5:  {metrics['recall_at_5']:.1f}%")
                print(f"    NDCG:      {metrics['mean_ndcg']:.4f}")
                print(f"    Evaluated: {metrics['claims_evaluated']} claims against {metrics['nodes_in_corpus']} nodes")

                for pov, pm in metrics['per_pov'].items():
                    print(f"      {pov}: MRR={pm['mrr']:.4f} R@1={pm['recall_at_1_pct']:.1f}% (n={pm['count']})")
            else:
                print("    No claims could be evaluated (check node overlap)")

        results['attribution'] = attribution_results

        if len(strategies) > 1 and attribution_results:
            print(f"\n  ── Strategy Comparison ──")
            print(f"  {'Strategy':<15} {'MRR':>8} {'R@1':>8} {'R@3':>8} {'R@5':>8}")
            for strat in strategies:
                if strat in attribution_results:
                    m = attribution_results[strat]
                    print(f"  {strat:<15} {m['mrr']:>8.4f} {m['recall_at_1']:>7.1f}% {m['recall_at_3']:>7.1f}% {m['recall_at_5']:>7.1f}%")

    if not args.cluster_only:
        print("\n[4b/5] Poaching analysis...")
        poaching = compute_poaching_analysis(
            claims, claim_vectors, claim_index, corpus_by_node
        )
        results['poaching'] = poaching
        print(f"  Overall poach rate: {poaching['overall_poach_rate']:.1%}")
        print(f"  Total poached: {poaching['total_poached']} / {poaching['total_claims']}")
        if poaching['worst_poached_nodes']:
            print(f"  Worst poached nodes:")
            for wp in poaching['worst_poached_nodes'][:5]:
                print(f"    {wp['node_id']}: {wp['poach_rate']:.0%} poached ({wp['times_poached']}/{wp['claim_count']}) by {wp['top_poacher']}")

    if not args.poaching_only:
        print("\n[5/5] Cluster separation...")
        confusable = None
        cn_path = os.path.join(RESEARCH_DIR, '_confusable_neighbors.json')
        if os.path.exists(cn_path):
            with open(cn_path, encoding='utf-8') as f:
                confusable = json.load(f)

        separation = compute_cluster_separation(
            corpus_by_node, confusable, args.scope
        )
        if separation:
            results['cluster_separation'] = separation
            print(f"  Scope: {separation['scope']}")
            print(f"  Pairs analyzed: {separation['pairs_analyzed']}")
            print(f"  Mean separation: {separation['mean_separation']:.4f}")
            print(f"  Negative separation (overlapping clusters): {separation['negative_separation_count']}")
            if separation['poorly_separated_pairs']:
                print(f"  Worst separated pairs:")
                for p in separation['poorly_separated_pairs'][:5]:
                    print(f"    {p['node_a']} ↔ {p['node_b']}: sep={p['separation_score']:.4f} cross_sim={p['mean_cross_similarity']:.4f}")

    baseline_mrr = (results.get('baseline_computed', {}).get('mrr')
                    or golden.get('metadata', {}).get('baseline_metrics', {}).get('global_mrr', 0))
    if 'attribution' in results and results['attribution']:
        best_strat = max(results['attribution'].items(), key=lambda x: x[1]['mrr'])
        best_mrr = best_strat[1]['mrr']
        delta = best_mrr - baseline_mrr
        results['summary'] = {
            'best_strategy': best_strat[0],
            'best_mrr': best_mrr,
            'baseline_mrr': round(baseline_mrr, 4),
            'mrr_delta': round(delta, 4),
            'improvement_pct': round(delta / max(baseline_mrr, 0.001) * 100, 1),
        }
        print(f"\n{'=' * 60}")
        print(f"  SUMMARY")
        print(f"  Baseline MRR (desc only):   {baseline_mrr:.4f}")
        print(f"  Best MRR (desc+synthetic):  {best_mrr:.4f} ({best_strat[0]})")
        print(f"  Improvement:                {'+' if delta >= 0 else ''}{delta:.4f} ({results['summary']['improvement_pct']:+.1f}%)")
        bc = results.get('baseline_computed', {})
        if bc:
            print(f"  Baseline R@1: {bc.get('recall_at_1', 0):.1f}%  →  Best R@1: {best_strat[1].get('recall_at_1', 0):.1f}%")
        print(f"{'=' * 60}")

    output_path = os.path.join(args.output_dir, '_evaluation_report.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n  Saved: {output_path}")


if __name__ == '__main__':
    main()
