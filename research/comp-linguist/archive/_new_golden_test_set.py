"""Build golden test set from debate argument network claims.

Extracts AN claims from recent debates, embeds against current taxonomy,
computes attribution with primary/secondary refs, exports annotation
template for IAA measurement, and reports baseline metrics.

Replaces: _rebuild_golden_set.py
Ticket: t/553

Usage:
    python _new_golden_test_set.py [--debates N] [--annotation-sample N] [--dedup-threshold F]

Outputs:
    _golden_test_set.json        - Full golden set with attribution
    _golden_claim_vectors.npy    - Claim embedding vectors (for reuse by t/554)
    _golden_claim_index.json     - Claim ID → vector index mapping
    _annotation_template.json    - Stratified sample for human IAA annotation
"""
import sys
import json
import glob
import os
import math
import argparse
import hashlib
from datetime import datetime, timezone
from collections import defaultdict

import numpy as np

sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'
DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))

POV_FILES = ['accelerationist.json', 'safetyist.json', 'skeptic.json']
SPEAKER_POV = {
    'accelerationist': 'acc',
    'safetyist': 'saf',
    'skeptic': 'skp',
}

DEFAULTS = {
    'debates': 20,
    'annotation_sample': 100,
    'dedup_threshold': 0.95,
    'secondary_k': 5,
}


def cosine_sim(a, b):
    dot = np.dot(a, b)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(dot / (na * nb))


def batch_cosine_sim(query_vec, matrix):
    """Cosine similarity between a single query and a matrix of vectors."""
    norms = np.linalg.norm(matrix, axis=1)
    norms[norms == 0] = 1.0
    q_norm = np.linalg.norm(query_vec)
    if q_norm == 0:
        return np.zeros(matrix.shape[0])
    return np.dot(matrix, query_vec) / (norms * q_norm)


def load_taxonomy_nodes():
    """Load all POV taxonomy nodes."""
    all_nodes = {}
    for pov_file in POV_FILES:
        path = os.path.join(DATA_ROOT, pov_file)
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for n in data.get('nodes', []):
            nid = n.get('id', '')
            all_nodes[nid] = {
                'id': nid,
                'label': n.get('label', ''),
                'description': n.get('description', ''),
                'category': n.get('category', ''),
                'parent_id': n.get('parent_id', ''),
            }
    return all_nodes


def load_embeddings(all_nodes):
    """Load production embeddings, return {node_id: np.array} for nodes in all_nodes."""
    emb_path = os.path.join(DATA_ROOT, 'embeddings.json')
    with open(emb_path, encoding='utf-8') as f:
        emb_data = json.load(f)

    node_embeddings = {}
    for nid, entry in emb_data.get('nodes', {}).items():
        if nid in all_nodes:
            vec = entry.get('vector', [])
            if vec:
                node_embeddings[nid] = np.array(vec, dtype=np.float32)
    return node_embeddings


def extract_claims(debate_count):
    """Extract debater claims from recent debates."""
    files = sorted(
        glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')),
        key=os.path.getmtime, reverse=True,
    )

    raw_claims = []
    stats = {'processed': 0, 'with_claims': 0}

    for fp in files[:debate_count]:
        with open(fp, encoding='utf-8') as f:
            d = json.load(f)

        debate_id = d.get('id', '')[:8]
        title = d.get('title', '')[:80]
        stats['processed'] += 1

        an_nodes = d.get('argument_network', {}).get('nodes', [])
        if not an_nodes:
            continue

        debate_claims = 0
        for n in an_nodes:
            speaker = n.get('speaker', '')
            if speaker not in SPEAKER_POV:
                continue
            claim_text = n.get('text', n.get('label', ''))
            if not claim_text or len(claim_text.strip()) < 10:
                continue

            raw_claims.append({
                'claim_text': claim_text,
                'claim_id': n.get('id', ''),
                'speaker': speaker,
                'pov': SPEAKER_POV[speaker],
                'debate_id': debate_id,
                'debate_title': title,
                'bdi_category': n.get('bdi_category', n.get('node_scope', n.get('type', ''))),
                'turn_number': n.get('turn_number'),
                'computed_strength': n.get('computed_strength'),
                'base_strength': n.get('base_strength'),
                'specificity': n.get('specificity'),
                'text_hash': hashlib.md5(claim_text.strip().lower().encode()).hexdigest(),
            })
            debate_claims += 1

        if debate_claims > 0:
            stats['with_claims'] += 1
            print(f"  {debate_id}: {title[:50]} — {debate_claims} claims")

    return raw_claims, stats


def deduplicate_claims(claims, claim_vecs, threshold):
    """Remove near-duplicate claims by cosine similarity."""
    n = len(claims)
    if n == 0:
        return claims, claim_vecs

    keep = [True] * n
    text_seen = set()

    for i in range(n):
        if not keep[i]:
            continue
        h = claims[i]['text_hash']
        if h in text_seen:
            keep[i] = False
            continue
        text_seen.add(h)

        for j in range(i + 1, n):
            if not keep[j]:
                continue
            sim = cosine_sim(claim_vecs[i], claim_vecs[j])
            if sim >= threshold:
                si = claims[i].get('computed_strength') or 0
                sj = claims[j].get('computed_strength') or 0
                if sj > si:
                    keep[i] = False
                    break
                else:
                    keep[j] = False

    deduped_claims = [c for c, k in zip(claims, keep) if k]
    deduped_vecs = claim_vecs[np.array(keep)]
    return deduped_claims, deduped_vecs


def compute_attribution(claims, claim_vecs, node_embeddings, all_nodes, secondary_k):
    """Compute primary/secondary attribution for each claim."""
    pov_nodes = defaultdict(list)
    pov_vecs = {}
    for nid, vec in node_embeddings.items():
        prefix = nid.split('-')[0]
        pov_nodes[prefix].append(nid)

    for prefix, nids in pov_nodes.items():
        vecs = np.stack([node_embeddings[nid] for nid in nids])
        pov_vecs[prefix] = (nids, vecs)

    all_nids = list(node_embeddings.keys())
    all_vecs_matrix = np.stack([node_embeddings[nid] for nid in all_nids])

    golden_entries = []
    no_match = 0

    for i, claim in enumerate(claims):
        cv = claim_vecs[i]
        pov = claim['pov']

        if pov not in pov_vecs:
            no_match += 1
            continue

        within_nids, within_matrix = pov_vecs[pov]
        within_sims = batch_cosine_sim(cv, within_matrix)
        sorted_idx = np.argsort(-within_sims)

        if len(sorted_idx) == 0:
            no_match += 1
            continue

        primary_idx = sorted_idx[0]
        primary_id = within_nids[primary_idx]
        primary_sim = float(within_sims[primary_idx])

        secondary = []
        for idx in sorted_idx[1:secondary_k + 1]:
            secondary.append({
                'node_id': within_nids[idx],
                'similarity': round(float(within_sims[idx]), 4),
            })

        global_sims = batch_cosine_sim(cv, all_vecs_matrix)
        global_sorted = np.argsort(-global_sims)
        global_rank = int(np.where(np.array(all_nids)[global_sorted] == primary_id)[0][0]) + 1

        cross_pov_top = None
        for gidx in global_sorted:
            gnid = all_nids[gidx]
            if not gnid.startswith(pov):
                cross_pov_top = {
                    'node_id': gnid,
                    'similarity': round(float(global_sims[gidx]), 4),
                }
                break

        entry = {
            'claim_text': claim['claim_text'],
            'claim_id': claim['claim_id'],
            'speaker': claim['speaker'],
            'pov': pov,
            'attributed_node': primary_id,
            'attributed_label': all_nodes.get(primary_id, {}).get('label', ''),
            'similarity_score': round(primary_sim, 4),
            'global_rank': global_rank,
            'cross_pov_top_match': cross_pov_top,
            'secondary_refs': secondary,
            'debate_id': claim['debate_id'],
            'debate_title': claim['debate_title'],
            'bdi_category': claim['bdi_category'],
            'turn_number': claim['turn_number'],
            'computed_strength': claim['computed_strength'],
            'base_strength': claim['base_strength'],
            'specificity': claim['specificity'],
            'claim_vector_idx': i,
        }
        golden_entries.append(entry)

    return golden_entries, no_match


def compute_baseline_metrics(entries):
    """Compute baseline MRR, Recall@K, similarity stats."""
    if not entries:
        return {}

    sims = [e['similarity_score'] for e in entries]
    global_ranks = [e['global_rank'] for e in entries]
    reciprocal_ranks = [1.0 / r for r in global_ranks]

    def recall_at_k(ranks, k):
        return sum(1 for r in ranks if r <= k) / len(ranks)

    per_pov = defaultdict(list)
    for e in entries:
        per_pov[e['pov']].append(e)

    pov_metrics = {}
    for pov, pov_entries in per_pov.items():
        pov_sims = [e['similarity_score'] for e in pov_entries]
        pov_ranks = [e['global_rank'] for e in pov_entries]
        pov_metrics[pov] = {
            'count': len(pov_entries),
            'mean_similarity': round(np.mean(pov_sims), 4),
            'global_mrr': round(np.mean([1.0 / r for r in pov_ranks]), 4),
            'recall_at_1': round(recall_at_k(pov_ranks, 1), 4),
            'recall_at_3': round(recall_at_k(pov_ranks, 3), 4),
        }

    brackets = [(0, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.85), (0.85, 1.01)]
    sim_distribution = {}
    for lo, hi in brackets:
        key = f"[{lo:.1f},{hi:.2f})"
        count = sum(1 for s in sims if lo <= s < hi)
        sim_distribution[key] = {'count': count, 'pct': round(count / len(sims) * 100, 1)}

    return {
        'total_claims': len(entries),
        'mean_similarity': round(float(np.mean(sims)), 4),
        'median_similarity': round(float(np.median(sims)), 4),
        'min_similarity': round(float(np.min(sims)), 4),
        'max_similarity': round(float(np.max(sims)), 4),
        'global_mrr': round(float(np.mean(reciprocal_ranks)), 4),
        'recall_at_1_global': round(recall_at_k(global_ranks, 1), 4),
        'recall_at_3_global': round(recall_at_k(global_ranks, 3), 4),
        'recall_at_5_global': round(recall_at_k(global_ranks, 5), 4),
        'recall_at_10_global': round(recall_at_k(global_ranks, 10), 4),
        'per_pov': pov_metrics,
        'similarity_distribution': sim_distribution,
        'unique_nodes_attributed': len(set(e['attributed_node'] for e in entries)),
    }


def build_annotation_template(entries, all_nodes, sample_size):
    """Build stratified annotation template for IAA measurement."""
    if not entries or sample_size <= 0:
        return {'metadata': {}, 'claims': []}

    by_pov = defaultdict(list)
    for e in entries:
        by_pov[e['pov']].append(e)

    per_pov_budget = max(1, sample_size // len(by_pov))
    selected = []

    for pov, pov_entries in by_pov.items():
        sorted_by_sim = sorted(pov_entries, key=lambda x: x['similarity_score'])
        n = len(sorted_by_sim)
        budget = min(per_pov_budget, n)

        if budget >= 4:
            quartile_size = budget // 4
            remainder = budget - quartile_size * 4
            indices = set()
            for q in range(4):
                start = q * (n // 4)
                end = min((q + 1) * (n // 4), n)
                q_size = quartile_size + (1 if q < remainder else 0)
                step = max(1, (end - start) // q_size) if q_size > 0 else 1
                for idx in range(start, end, step):
                    if len(indices) < budget:
                        indices.add(idx)
            selected.extend(sorted_by_sim[idx] for idx in sorted(indices)[:budget])
        else:
            step = max(1, n // budget)
            selected.extend(sorted_by_sim[i] for i in range(0, n, step)[:budget])

    annotation_claims = []
    for entry in selected:
        candidates = [{'node_id': entry['attributed_node'],
                        'label': all_nodes.get(entry['attributed_node'], {}).get('label', ''),
                        'description': all_nodes.get(entry['attributed_node'], {}).get('description', '')[:200],
                        'machine_similarity': entry['similarity_score']}]
        for ref in entry['secondary_refs']:
            nid = ref['node_id']
            candidates.append({
                'node_id': nid,
                'label': all_nodes.get(nid, {}).get('label', ''),
                'description': all_nodes.get(nid, {}).get('description', '')[:200],
                'machine_similarity': ref['similarity'],
            })

        annotation_claims.append({
            'claim_id': entry['claim_id'],
            'claim_text': entry['claim_text'],
            'speaker': entry['speaker'],
            'pov': entry['pov'],
            'debate_id': entry['debate_id'],
            'bdi_category': entry['bdi_category'],
            'candidate_nodes': candidates,
            'annotation': {
                'annotator': '',
                'selected_node': '',
                'confidence': '',
                'notes': '',
                'none_of_above': False,
            },
        })

    return {
        'metadata': {
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'sample_size': len(annotation_claims),
            'stratification': 'by POV, spread across similarity quartiles',
            'candidates_per_claim': DEFAULTS['secondary_k'] + 1,
            'instructions': (
                'For each claim, select the taxonomy node that best captures '
                'its meaning. If none of the candidates are appropriate, check '
                '"none_of_above". Rate confidence as high/medium/low. '
                'Add notes for ambiguous cases.'
            ),
        },
        'claims': annotation_claims,
    }


def main():
    parser = argparse.ArgumentParser(description='Build golden test set from debate AN claims')
    parser.add_argument('--debates', type=int, default=DEFAULTS['debates'],
                        help=f'Number of recent debates (default: {DEFAULTS["debates"]})')
    parser.add_argument('--annotation-sample', type=int, default=DEFAULTS['annotation_sample'],
                        help=f'Annotation template sample size (default: {DEFAULTS["annotation_sample"]})')
    parser.add_argument('--dedup-threshold', type=float, default=DEFAULTS['dedup_threshold'],
                        help=f'Deduplication cosine threshold (default: {DEFAULTS["dedup_threshold"]})')
    parser.add_argument('--output-dir', default=RESEARCH_DIR,
                        help='Output directory')
    args = parser.parse_args()

    print("=" * 60)
    print("  Golden Test Set Builder (t/553)")
    print("=" * 60)

    # ── Load taxonomy ──
    print("\n[1/7] Loading taxonomy nodes...")
    all_nodes = load_taxonomy_nodes()
    print(f"  {len(all_nodes)} taxonomy nodes loaded")

    print("\n[2/7] Loading production embeddings...")
    node_embeddings = load_embeddings(all_nodes)
    print(f"  {len(node_embeddings)} nodes with embeddings")

    # ── Extract claims ──
    print(f"\n[3/7] Extracting claims from top {args.debates} debates...")
    raw_claims, extract_stats = extract_claims(args.debates)
    print(f"  Debates processed: {extract_stats['processed']}")
    print(f"  Debates with claims: {extract_stats['with_claims']}")
    print(f"  Raw claims extracted: {len(raw_claims)}")

    if not raw_claims:
        print("\nERROR: No claims extracted. Check debate directory.")
        sys.exit(1)

    # ── Embed claims ──
    print("\n[4/7] Embedding claims...")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer('all-MiniLM-L6-v2')
    claim_texts = [c['claim_text'] for c in raw_claims]
    claim_vecs = model.encode(claim_texts, normalize_embeddings=True,
                              show_progress_bar=True, batch_size=64)
    claim_vecs = np.array(claim_vecs, dtype=np.float32)
    print(f"  Embedded {len(claim_texts)} claims ({claim_vecs.shape[1]}-dim)")

    # ── Deduplicate ──
    print(f"\n[5/7] Deduplicating (threshold={args.dedup_threshold})...")
    pre_dedup = len(raw_claims)
    claims, claim_vecs = deduplicate_claims(raw_claims, claim_vecs, args.dedup_threshold)
    removed = pre_dedup - len(claims)
    print(f"  Removed {removed} duplicates, {len(claims)} claims remaining")

    # ── Attribution ──
    print("\n[6/7] Computing attribution...")
    golden_entries, no_match = compute_attribution(
        claims, claim_vecs, node_embeddings, all_nodes, DEFAULTS['secondary_k'],
    )
    print(f"  Attributed: {len(golden_entries)}")
    print(f"  No matching nodes: {no_match}")

    # ── Metrics ──
    print("\n[7/7] Computing baseline metrics...")
    metrics = compute_baseline_metrics(golden_entries)

    print(f"\n{'─' * 50}")
    print(f"  Claims: {metrics['total_claims']}")
    print(f"  Unique nodes attributed: {metrics['unique_nodes_attributed']}")
    print(f"  Mean similarity: {metrics['mean_similarity']:.4f}")
    print(f"  Median similarity: {metrics['median_similarity']:.4f}")
    print(f"  Global MRR: {metrics['global_mrr']:.4f}")
    print(f"  Recall@1 (global): {metrics['recall_at_1_global']:.4f}")
    print(f"  Recall@3 (global): {metrics['recall_at_3_global']:.4f}")
    print(f"  Recall@5 (global): {metrics['recall_at_5_global']:.4f}")

    print(f"\n  Per-POV breakdown:")
    for pov, pm in metrics.get('per_pov', {}).items():
        print(f"    {pov}: n={pm['count']}, mean_sim={pm['mean_similarity']:.3f}, "
              f"global_mrr={pm['global_mrr']:.3f}, R@1={pm['recall_at_1']:.3f}")

    print(f"\n  Similarity distribution:")
    for bracket, info in metrics.get('similarity_distribution', {}).items():
        bar = '#' * int(info['pct'] / 2)
        print(f"    {bracket}: {info['count']:4d} ({info['pct']:5.1f}%) {bar}")

    # ── Save outputs ──
    golden_path = os.path.join(args.output_dir, '_golden_test_set.json')
    vectors_path = os.path.join(args.output_dir, '_golden_claim_vectors.npy')
    index_path = os.path.join(args.output_dir, '_golden_claim_index.json')
    annotation_path = os.path.join(args.output_dir, '_annotation_template.json')

    golden_data = {
        'metadata': {
            'built_at': datetime.now(timezone.utc).isoformat(),
            'debates_processed': extract_stats['processed'],
            'debates_with_claims': extract_stats['with_claims'],
            'total_claims': len(golden_entries),
            'claims_before_dedup': pre_dedup,
            'dedup_threshold': args.dedup_threshold,
            'duplicates_removed': removed,
            'embedding_model': 'all-MiniLM-L6-v2',
            'embedding_dim': int(claim_vecs.shape[1]) if len(claim_vecs) > 0 else 384,
            'taxonomy_nodes': len(all_nodes),
            'nodes_with_embeddings': len(node_embeddings),
            'baseline_metrics': metrics,
        },
        'claims': golden_entries,
    }

    with open(golden_path, 'w', encoding='utf-8') as f:
        json.dump(golden_data, f, indent=2, ensure_ascii=False)
    print(f"\n  Golden set saved: {golden_path}")

    np.save(vectors_path, claim_vecs)
    print(f"  Claim vectors saved: {vectors_path} ({claim_vecs.shape})")

    claim_index = {claims[i]['claim_id']: i for i in range(len(claims))}
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(claim_index, f, indent=2)
    print(f"  Claim index saved: {index_path}")

    # ── Annotation template ──
    print(f"\n  Building annotation template (n={args.annotation_sample})...")
    template = build_annotation_template(golden_entries, all_nodes, args.annotation_sample)
    with open(annotation_path, 'w', encoding='utf-8') as f:
        json.dump(template, f, indent=2, ensure_ascii=False)
    print(f"  Annotation template saved: {annotation_path} ({len(template['claims'])} claims)")

    print(f"\n{'=' * 60}")
    print(f"  Done. Golden set: {len(golden_entries)} claims across "
          f"{metrics['unique_nodes_attributed']} nodes")
    print(f"  Next: human annotation of {annotation_path}")
    print(f"        then Measure-AttributionAgreement for IAA")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
