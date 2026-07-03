"""Test whether genus-format claims still win when scored against multi-vector
(node description + synthetic phrases) rather than description-only.

The concern: genus rewrites mirror the DOLCE format of node descriptions but
the ~28K synthetic phrases are natural conversational language. If genus format
maximizes similarity to 1 formal description but reduces similarity to 44
conversational synthetics, the mean-of-top-3 scoring could favor original text.

Usage:
    python _multivec_genus_test.py [--top-n 3]
"""
import json
import os
import sys
import time
from collections import defaultdict

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

sys.stdout.reconfigure(encoding='utf-8')

RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(RESEARCH_DIR))
DATA_ROOT = os.path.join(REPO_ROOT, '..', 'ai-triad-data', 'taxonomy', 'Origin')


def load_taxonomy_descriptions(tax_dir):
    nodes = {}
    for fname in ['accelerationist.json', 'safetyist.json', 'skeptic.json']:
        path = os.path.join(tax_dir, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for node in data.get('nodes', []):
            nid = node.get('id')
            if nid:
                nodes[nid] = node.get('description', '')
    return nodes


def load_synthetic_phrases(tax_dir):
    """Load synthetic phrases grouped by node_id."""
    synth_dir = os.path.join(tax_dir, 'synthetic')
    node_phrases = defaultdict(list)
    for fname in ['corpus_acc.json', 'corpus_saf.json', 'corpus_skp.json']:
        path = os.path.join(synth_dir, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for entry in data.get('entries', []):
            node_phrases[entry['node_id']].append(entry['statement'])
    return dict(node_phrases)


_model = None


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer('all-MiniLM-L6-v2')
    return _model


def embed_texts(texts, batch_size=256):
    model = get_model()
    return model.encode(texts, show_progress_bar=len(texts) > 100,
                        batch_size=batch_size, normalize_embeddings=True)


def mean_of_top_n(query_vec, node_vectors, n=3):
    """Score a query against a set of node vectors using mean-of-top-N."""
    if len(node_vectors) == 0:
        return 0.0
    sims = cosine_similarity([query_vec], node_vectors)[0]
    top = sorted(sims, reverse=True)[:n]
    return float(np.mean(top))


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--top-n', type=int, default=3)
    args = parser.parse_args()

    # Load annotation template with genus rewrites
    template_path = os.path.join(RESEARCH_DIR, '_annotation_template.json')
    with open(template_path, encoding='utf-8') as f:
        template = json.load(f)
    claims = template['claims']
    print(f"Claims: {len(claims)}")

    # Load taxonomy
    print("Loading taxonomy descriptions...")
    descriptions = load_taxonomy_descriptions(DATA_ROOT)
    node_ids = sorted(descriptions.keys())
    print(f"  {len(node_ids)} nodes")

    # Load synthetic phrases
    print("Loading synthetic phrases...")
    synthetics = load_synthetic_phrases(DATA_ROOT)
    total_phrases = sum(len(v) for v in synthetics.values())
    print(f"  {total_phrases} phrases across {len(synthetics)} nodes")

    # Embed node descriptions
    print("Embedding node descriptions...")
    desc_texts = [descriptions[nid] for nid in node_ids]
    desc_vecs = embed_texts(desc_texts)

    # Embed synthetic phrases (this is the big one)
    print(f"Embedding {total_phrases} synthetic phrases (this will take a minute)...")
    all_synth_texts = []
    synth_node_map = []  # (node_id, index_in_all_synth)
    for nid in node_ids:
        phrases = synthetics.get(nid, [])
        for p in phrases:
            synth_node_map.append(nid)
            all_synth_texts.append(p)

    t0 = time.time()
    synth_vecs = embed_texts(all_synth_texts, batch_size=512)
    print(f"  Done in {time.time()-t0:.1f}s")

    # Build per-node vector sets: description + synthetics
    node_desc_vec = {nid: desc_vecs[i] for i, nid in enumerate(node_ids)}
    node_synth_vecs = defaultdict(list)
    for i, nid in enumerate(synth_node_map):
        node_synth_vecs[nid].append(synth_vecs[i])

    node_multi_vecs = {}
    for nid in node_ids:
        vecs = [node_desc_vec[nid]]
        vecs.extend(node_synth_vecs.get(nid, []))
        node_multi_vecs[nid] = np.array(vecs)

    # Embed claims: original text and genus rewrite
    print("Embedding claim texts...")
    orig_texts = [c['claim_text'] for c in claims]
    genus_texts = [c['attribution_text_genus'] for c in claims]
    orig_vecs = embed_texts(orig_texts)
    genus_vecs = embed_texts(genus_texts)

    # Score each claim against each node using 3 methods:
    # 1. description-only (single vector cosine)
    # 2. multi-vector mean-of-top-N (description + synthetics)
    # 3. synthetics-only mean-of-top-N (no description)
    print(f"Scoring {len(claims)} claims x {len(node_ids)} nodes (3 modes x 2 text variants)...")

    results = []
    genus_wins_desc = 0
    genus_wins_multi = 0
    genus_wins_synth = 0

    for ci, claim in enumerate(claims):
        ov = orig_vecs[ci]
        gv = genus_vecs[ci]

        # Mode 1: Description-only (fast — matrix multiply)
        orig_desc_sims = cosine_similarity([ov], desc_vecs)[0]
        genus_desc_sims = cosine_similarity([gv], desc_vecs)[0]
        orig_desc_max = float(np.max(orig_desc_sims))
        genus_desc_max = float(np.max(genus_desc_sims))

        # Mode 2 & 3: Multi-vector and synthetics-only (per-node mean-of-top-N)
        orig_multi_scores = {}
        genus_multi_scores = {}
        orig_synth_scores = {}
        genus_synth_scores = {}

        for nid in node_ids:
            multi = node_multi_vecs[nid]
            orig_multi_scores[nid] = mean_of_top_n(ov, multi, args.top_n)
            genus_multi_scores[nid] = mean_of_top_n(gv, multi, args.top_n)

            synth_only = node_synth_vecs.get(nid, [])
            if synth_only:
                synth_arr = np.array(synth_only)
                orig_synth_scores[nid] = mean_of_top_n(ov, synth_arr, args.top_n)
                genus_synth_scores[nid] = mean_of_top_n(gv, synth_arr, args.top_n)

        orig_multi_max = max(orig_multi_scores.values())
        genus_multi_max = max(genus_multi_scores.values())
        orig_synth_max = max(orig_synth_scores.values()) if orig_synth_scores else 0
        genus_synth_max = max(genus_synth_scores.values()) if genus_synth_scores else 0

        if genus_desc_max > orig_desc_max:
            genus_wins_desc += 1
        if genus_multi_max > orig_multi_max:
            genus_wins_multi += 1
        if genus_synth_max > orig_synth_max:
            genus_wins_synth += 1

        results.append({
            'claim_id': claim['claim_id'],
            'orig_desc_maxsim': round(orig_desc_max, 4),
            'genus_desc_maxsim': round(genus_desc_max, 4),
            'orig_multi_maxsim': round(orig_multi_max, 4),
            'genus_multi_maxsim': round(genus_multi_max, 4),
            'orig_synth_maxsim': round(orig_synth_max, 4),
            'genus_synth_maxsim': round(genus_synth_max, 4),
        })

        if (ci + 1) % 20 == 0:
            print(f"  {ci+1}/{len(claims)} scored")

    # Aggregate
    n = len(claims)
    print(f"\n{'='*70}")
    print(f"RESULTS: Genus vs Original text ({n} claims, top-{args.top_n} scoring)")
    print(f"{'='*70}")

    print(f"\n{'Mode':<30} {'Orig MaxSim':>12} {'Genus MaxSim':>13} {'Genus Wins':>11}")
    print(f"{'-'*70}")

    orig_desc_mean = np.mean([r['orig_desc_maxsim'] for r in results])
    genus_desc_mean = np.mean([r['genus_desc_maxsim'] for r in results])
    print(f"{'Description-only':<30} {orig_desc_mean:>12.4f} {genus_desc_mean:>13.4f} {genus_wins_desc:>8}/{n}")

    orig_multi_mean = np.mean([r['orig_multi_maxsim'] for r in results])
    genus_multi_mean = np.mean([r['genus_multi_maxsim'] for r in results])
    print(f"{'Multi-vector (desc+synth)':<30} {orig_multi_mean:>12.4f} {genus_multi_mean:>13.4f} {genus_wins_multi:>8}/{n}")

    orig_synth_mean = np.mean([r['orig_synth_maxsim'] for r in results])
    genus_synth_mean = np.mean([r['genus_synth_maxsim'] for r in results])
    print(f"{'Synthetics-only':<30} {orig_synth_mean:>12.4f} {genus_synth_mean:>13.4f} {genus_wins_synth:>8}/{n}")

    # Delta analysis
    print(f"\n{'Mode':<30} {'Delta (genus-orig)':>18} {'% improvement':>14}")
    print(f"{'-'*65}")
    print(f"{'Description-only':<30} {genus_desc_mean - orig_desc_mean:>+18.4f} {(genus_desc_mean - orig_desc_mean)/orig_desc_mean*100:>+13.1f}%")
    print(f"{'Multi-vector (desc+synth)':<30} {genus_multi_mean - orig_multi_mean:>+18.4f} {(genus_multi_mean - orig_multi_mean)/orig_multi_mean*100:>+13.1f}%")
    print(f"{'Synthetics-only':<30} {genus_synth_mean - orig_synth_mean:>+18.4f} {(genus_synth_mean - orig_synth_mean)/orig_synth_mean*100:>+13.1f}%")

    # Per-claim breakdown: cases where genus loses on multi but wins on desc
    disagree = [r for r in results if r['genus_multi_maxsim'] < r['orig_multi_maxsim']
                and r['genus_desc_maxsim'] > r['orig_desc_maxsim']]
    print(f"\nDisagreement cases (genus wins desc-only but loses multi-vector): {len(disagree)}")
    for r in disagree[:5]:
        print(f"  {r['claim_id']}: desc {r['orig_desc_maxsim']:.4f}->{r['genus_desc_maxsim']:.4f}, "
              f"multi {r['orig_multi_maxsim']:.4f}->{r['genus_multi_maxsim']:.4f}")

    # Save full results
    report = {
        'config': {'top_n': args.top_n, 'claim_count': n, 'node_count': len(node_ids),
                   'synthetic_phrase_count': total_phrases},
        'summary': {
            'description_only': {'orig_mean': round(orig_desc_mean, 4), 'genus_mean': round(genus_desc_mean, 4),
                                  'genus_wins': genus_wins_desc},
            'multi_vector': {'orig_mean': round(orig_multi_mean, 4), 'genus_mean': round(genus_multi_mean, 4),
                              'genus_wins': genus_wins_multi},
            'synthetics_only': {'orig_mean': round(orig_synth_mean, 4), 'genus_mean': round(genus_synth_mean, 4),
                                 'genus_wins': genus_wins_synth},
        },
        'per_claim': results,
    }
    report_path = os.path.join(RESEARCH_DIR, '_multivec_genus_report.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    print(f"\nFull report saved to {report_path}")


if __name__ == '__main__':
    main()
