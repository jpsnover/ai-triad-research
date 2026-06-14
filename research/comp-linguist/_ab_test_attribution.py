"""A/B test attribution_text rewrite strategies.

Compares three claim text variants against taxonomy node descriptions:
  - Baseline: original claim_text (near-verbatim from debate)
  - Variant A: attribution_text_freeform (self-contained rewrite)
  - Variant B: attribution_text_genus (genus-differentia mirrored)

Metrics computed:
  - MRR against golden set attributions (caveat: golden attributions are
    algorithmically assigned, not human-validated — use for relative
    comparison between variants only)
  - Mean max cosine similarity (higher = claim lands closer to some node)
  - Per-claim rank comparison (which variant ranks the best candidate highest)
  - Per-underspecification-category breakdown

Ticket: t/568

Usage:
    python _ab_test_attribution.py [--limit N]
"""
import json
import os
import sys
from collections import defaultdict

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

sys.stdout.reconfigure(encoding='utf-8')

RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(RESEARCH_DIR))


def resolve_data_root():
    config_path = os.path.join(REPO_ROOT, '.aitriad.json')
    with open(config_path, encoding='utf-8') as fh:
        cfg = json.load(fh)
    data_root = cfg.get('data_root', '.')
    if not os.path.isabs(data_root):
        data_root = os.path.join(REPO_ROOT, data_root)
    return os.path.normpath(data_root)


def load_taxonomy_descriptions(tax_dir):
    descriptions = {}
    for fname in ['accelerationist.json', 'safetyist.json', 'skeptic.json']:
        path = os.path.join(tax_dir, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for node in data.get('nodes', []):
            nid = node.get('id')
            desc = node.get('description', '')
            if nid and desc:
                descriptions[nid] = desc
    return descriptions


_model_cache = {}


def get_model(model_name='all-MiniLM-L6-v2'):
    if model_name not in _model_cache:
        from sentence_transformers import SentenceTransformer
        _model_cache[model_name] = SentenceTransformer(model_name)
    return _model_cache[model_name]


def embed_texts(texts, model_name='all-MiniLM-L6-v2'):
    model = get_model(model_name)
    vectors = model.encode(texts, show_progress_bar=len(texts) > 50,
                           batch_size=64, normalize_embeddings=True)
    return np.array(vectors)


def classify_underspecification(claim_text):
    """Heuristic classification of claim underspecification type."""
    text_lower = claim_text.lower()
    pronouns = ['this ', 'these ', 'that ', 'those ', 'it ', 'they ', 'them ',
                'its ', 'their ', 'here ', 'the model ', 'the framework ']
    if any(p in text_lower for p in pronouns[:8]):
        return 'DEICTIC'
    metaphor_cues = ["teeth", "dentures", "house", "fire", "bridge", "wall",
                     "sword", "shield", "armor", "fortress"]
    if any(m in text_lower for m in metaphor_cues):
        return 'METAPHORICAL'
    if text_lower.count(' ') < 12 and not any(
            d in text_lower for d in ['ai ', 'model', 'algorithm', 'data', 'deploy']):
        return 'TOPIC-IMPLICIT'
    upper_words = sum(1 for w in claim_text.split() if w[0].isupper() and len(w) > 3)
    if upper_words >= 3:
        return 'PROPER-NOUN'
    return 'SELF-CONTAINED'


def compute_metrics(claims, claim_vectors, node_ids, node_vectors, golden_lookup):
    """Compute MRR, Recall@k, mean max similarity for a set of claim vectors."""
    reciprocal_ranks = []
    recall_at = {1: 0, 3: 0, 5: 0}
    max_sims = []
    per_category = defaultdict(lambda: {'mrr': [], 'max_sim': [], 'count': 0})
    per_claim = []

    sim_matrix = cosine_similarity(claim_vectors, node_vectors)

    for i, claim in enumerate(claims):
        cid = claim['claim_id']
        sims = sim_matrix[i]
        ranked_indices = np.argsort(sims)[::-1]
        max_sim = float(sims[ranked_indices[0]])
        max_sims.append(max_sim)

        top5 = [(node_ids[idx], float(sims[idx])) for idx in ranked_indices[:5]]

        golden = golden_lookup.get(cid)
        true_node = golden.get('attributed_node', '') if golden else ''
        category = classify_underspecification(claim.get('claim_text', ''))

        rank = None
        if true_node and true_node in node_ids:
            true_idx = node_ids.index(true_node)
            rank_pos = np.where(ranked_indices == true_idx)[0]
            if len(rank_pos) > 0:
                rank = int(rank_pos[0]) + 1

        if rank is not None:
            rr = 1.0 / rank
            reciprocal_ranks.append(rr)
            for k in recall_at:
                if rank <= k:
                    recall_at[k] += 1
        else:
            reciprocal_ranks.append(0.0)

        per_category[category]['mrr'].append(reciprocal_ranks[-1])
        per_category[category]['max_sim'].append(max_sim)
        per_category[category]['count'] += 1

        per_claim.append({
            'claim_id': cid,
            'category': category,
            'rank': rank,
            'max_sim': round(max_sim, 4),
            'top5': [(nid, round(s, 4)) for nid, s in top5],
        })

    evaluated = len(claims)
    cat_metrics = {}
    for cat, data in per_category.items():
        cat_metrics[cat] = {
            'count': data['count'],
            'mrr': round(float(np.mean(data['mrr'])), 4) if data['mrr'] else 0,
            'mean_max_sim': round(float(np.mean(data['max_sim'])), 4) if data['max_sim'] else 0,
        }

    return {
        'claims_evaluated': evaluated,
        'mrr': round(float(np.mean(reciprocal_ranks)), 4) if reciprocal_ranks else 0,
        'recall_at_1': round(recall_at[1] / max(evaluated, 1) * 100, 1),
        'recall_at_3': round(recall_at[3] / max(evaluated, 1) * 100, 1),
        'recall_at_5': round(recall_at[5] / max(evaluated, 1) * 100, 1),
        'mean_max_sim': round(float(np.mean(max_sims)), 4) if max_sims else 0,
        'per_category': cat_metrics,
        'per_claim': per_claim,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description='A/B test attribution_text rewrite strategies')
    parser.add_argument('--limit', type=int, default=0, help='Evaluate only first N claims')
    args = parser.parse_args()

    data_root = resolve_data_root()
    tax_dir = os.path.join(data_root, 'taxonomy', 'Origin')

    template_path = os.path.join(RESEARCH_DIR, '_annotation_template.json')
    golden_path = os.path.join(RESEARCH_DIR, '_golden_test_set.json')

    with open(template_path, encoding='utf-8') as f:
        template = json.load(f)
    with open(golden_path, encoding='utf-8') as f:
        golden = json.load(f)

    golden_lookup = {c['claim_id']: c for c in golden['claims']}

    claims = template['claims']
    if args.limit > 0:
        claims = claims[:args.limit]

    has_freeform = sum(1 for c in claims if c.get('attribution_text_freeform'))
    has_genus = sum(1 for c in claims if c.get('attribution_text_genus'))
    print(f"Claims: {len(claims)} total, {has_freeform} with freeform, {has_genus} with genus")

    if has_freeform == 0:
        print("ERROR: No attribution_text_freeform found. Run _generate_attribution_text.py first.")
        sys.exit(1)

    eligible = [c for c in claims
                if c.get('attribution_text_freeform') and c.get('attribution_text_genus')]
    print(f"Eligible for A/B test: {len(eligible)} claims")

    print("\nLoading taxonomy descriptions...")
    descriptions = load_taxonomy_descriptions(tax_dir)
    node_ids = sorted(descriptions.keys())
    print(f"  {len(node_ids)} nodes loaded")

    print("\nEmbedding node descriptions...")
    node_texts = [descriptions[nid] for nid in node_ids]
    node_vectors = embed_texts(node_texts)

    baseline_texts = [c['claim_text'] for c in eligible]
    freeform_texts = [c['attribution_text_freeform'] for c in eligible]
    genus_texts = [c['attribution_text_genus'] for c in eligible]

    print(f"\nEmbedding {len(eligible)} claims x 3 variants...")
    baseline_vecs = embed_texts(baseline_texts)
    freeform_vecs = embed_texts(freeform_texts)
    genus_vecs = embed_texts(genus_texts)

    print("\nComputing metrics...")
    print("  Baseline (original claim_text)...")
    baseline_metrics = compute_metrics(eligible, baseline_vecs, node_ids, node_vectors, golden_lookup)
    print("  Variant A (freeform rewrite)...")
    freeform_metrics = compute_metrics(eligible, freeform_vecs, node_ids, node_vectors, golden_lookup)
    print("  Variant B (genus-differentia mirroring)...")
    genus_metrics = compute_metrics(eligible, genus_vecs, node_ids, node_vectors, golden_lookup)

    head_to_head = {'freeform_wins': 0, 'genus_wins': 0, 'tie': 0, 'details': []}
    for i, claim in enumerate(eligible):
        cid = claim['claim_id']
        f_sim = freeform_metrics['per_claim'][i]['max_sim']
        g_sim = genus_metrics['per_claim'][i]['max_sim']
        b_sim = baseline_metrics['per_claim'][i]['max_sim']
        if f_sim > g_sim:
            head_to_head['freeform_wins'] += 1
            winner = 'freeform'
        elif g_sim > f_sim:
            head_to_head['genus_wins'] += 1
            winner = 'genus'
        else:
            head_to_head['tie'] += 1
            winner = 'tie'
        head_to_head['details'].append({
            'claim_id': cid,
            'baseline_max_sim': b_sim,
            'freeform_max_sim': f_sim,
            'genus_max_sim': g_sim,
            'winner': winner,
            'improvement_over_baseline': round(max(f_sim, g_sim) - b_sim, 4),
        })

    report = {
        'test_date': None,
        'claims_tested': len(eligible),
        'caveat': 'Golden set attributions are algorithmically assigned, not human-validated. MRR is for relative comparison between variants only.',
        'summary': {
            'baseline': {
                'mrr': baseline_metrics['mrr'],
                'recall_at_1': baseline_metrics['recall_at_1'],
                'recall_at_5': baseline_metrics['recall_at_5'],
                'mean_max_sim': baseline_metrics['mean_max_sim'],
            },
            'freeform': {
                'mrr': freeform_metrics['mrr'],
                'recall_at_1': freeform_metrics['recall_at_1'],
                'recall_at_5': freeform_metrics['recall_at_5'],
                'mean_max_sim': freeform_metrics['mean_max_sim'],
            },
            'genus': {
                'mrr': genus_metrics['mrr'],
                'recall_at_1': genus_metrics['recall_at_1'],
                'recall_at_5': genus_metrics['recall_at_5'],
                'mean_max_sim': genus_metrics['mean_max_sim'],
            },
        },
        'head_to_head': {
            'freeform_wins': head_to_head['freeform_wins'],
            'genus_wins': head_to_head['genus_wins'],
            'tie': head_to_head['tie'],
        },
        'per_category': {
            'baseline': baseline_metrics['per_category'],
            'freeform': freeform_metrics['per_category'],
            'genus': genus_metrics['per_category'],
        },
        'details': {
            'baseline': baseline_metrics['per_claim'],
            'freeform': freeform_metrics['per_claim'],
            'genus': genus_metrics['per_claim'],
            'head_to_head': head_to_head['details'],
        },
    }

    report_path = os.path.join(RESEARCH_DIR, '_ab_test_report.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*70}")
    print("A/B TEST RESULTS")
    print(f"{'='*70}")
    print(f"Claims tested: {len(eligible)}")
    print(f"\n{'Variant':<20} {'MRR':>8} {'R@1':>8} {'R@5':>8} {'MaxSim':>8}")
    print(f"{'-'*52}")
    for name, m in [('Baseline', baseline_metrics), ('A: Freeform', freeform_metrics), ('B: Genus', genus_metrics)]:
        print(f"{name:<20} {m['mrr']:>8.4f} {m['recall_at_1']:>7.1f}% {m['recall_at_5']:>7.1f}% {m['mean_max_sim']:>8.4f}")

    print(f"\nHead-to-head (max similarity):")
    print(f"  Freeform wins: {head_to_head['freeform_wins']}")
    print(f"  Genus wins:    {head_to_head['genus_wins']}")
    print(f"  Tie:           {head_to_head['tie']}")

    print(f"\nPer-category MRR:")
    cats = sorted(set(list(baseline_metrics['per_category'].keys()) +
                      list(freeform_metrics['per_category'].keys()) +
                      list(genus_metrics['per_category'].keys())))
    print(f"  {'Category':<18} {'n':>4} {'Baseline':>10} {'Freeform':>10} {'Genus':>10}")
    for cat in cats:
        b = baseline_metrics['per_category'].get(cat, {})
        f_met = freeform_metrics['per_category'].get(cat, {})
        g = genus_metrics['per_category'].get(cat, {})
        n = b.get('count', 0)
        print(f"  {cat:<18} {n:>4} {b.get('mrr',0):>10.4f} {f_met.get('mrr',0):>10.4f} {g.get('mrr',0):>10.4f}")

    print(f"\nReport saved to: {report_path}")
    print("\nCAVEAT: Golden set attributions are NOT human-validated.")
    print("Use these metrics for relative comparison between variants only.")


if __name__ == '__main__':
    main()
