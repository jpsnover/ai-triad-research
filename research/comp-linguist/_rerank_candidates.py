"""Re-rank annotation template candidates using genus attribution_text embeddings.

Replaces the original machine_similarity scores (based on underspecified claim_text)
with new scores computed from attribution_text_genus embeddings against all 636
taxonomy node descriptions.

Usage:
    python _rerank_candidates.py [--top-k 6]
"""
import json
import os
import sys

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


def load_taxonomy(tax_dir):
    """Load node descriptions and labels from taxonomy JSONs."""
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
                nodes[nid] = {
                    'label': node.get('label', ''),
                    'description': node.get('description', ''),
                }
    return nodes


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


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Re-rank annotation candidates using genus embeddings')
    parser.add_argument('--top-k', type=int, default=6, help='Number of candidates per claim')
    args = parser.parse_args()

    data_root = resolve_data_root()
    tax_dir = os.path.join(data_root, 'taxonomy', 'Origin')

    template_path = os.path.join(RESEARCH_DIR, '_annotation_template.json')
    with open(template_path, encoding='utf-8') as f:
        template = json.load(f)

    claims = template['claims']
    missing = [c['claim_id'] for c in claims if not c.get('attribution_text_genus')]
    if missing:
        print(f"ERROR: {len(missing)} claims missing attribution_text_genus: {missing[:5]}")
        sys.exit(1)

    print("Loading taxonomy...")
    taxonomy = load_taxonomy(tax_dir)
    node_ids = sorted(taxonomy.keys())
    print(f"  {len(node_ids)} nodes")

    print("Embedding node descriptions...")
    node_texts = [taxonomy[nid]['description'] for nid in node_ids]
    node_vectors = embed_texts(node_texts)

    print(f"Embedding {len(claims)} genus rewrites...")
    genus_texts = [c['attribution_text_genus'] for c in claims]
    genus_vectors = embed_texts(genus_texts)

    print("Computing similarities and re-ranking...")
    sim_matrix = cosine_similarity(genus_vectors, node_vectors)

    upgraded = 0
    original_top1_in_new = 0

    for i, claim in enumerate(claims):
        sims = sim_matrix[i]
        ranked_indices = np.argsort(sims)[::-1][:args.top_k]

        old_candidates = {c['node_id']: c for c in claim.get('candidate_nodes', [])}
        old_top1 = claim['candidate_nodes'][0]['node_id'] if claim.get('candidate_nodes') else None

        new_candidates = []
        for idx in ranked_indices:
            nid = node_ids[idx]
            desc = taxonomy[nid]['description']
            if len(desc) > 200:
                desc = desc[:200] + '...'
            new_candidates.append({
                'node_id': nid,
                'label': taxonomy[nid]['label'],
                'description': desc,
                'machine_similarity': round(float(sims[idx]), 4),
                'original_rank': None,
            })

        # Track whether old top-1 is still in new candidates
        new_ids = {c['node_id'] for c in new_candidates}
        if old_top1 and old_top1 in new_ids:
            original_top1_in_new += 1

        # Mark original rank for candidates that were in the old set
        for j, old_c in enumerate(claim.get('candidate_nodes', [])):
            for new_c in new_candidates:
                if new_c['node_id'] == old_c['node_id']:
                    new_c['original_rank'] = j + 1

        if new_candidates[0]['node_id'] != old_top1:
            upgraded += 1

        claim['candidate_nodes'] = new_candidates
        claim['candidate_nodes_source'] = 'genus_embedding'

    template['metadata']['candidates_reranked'] = True
    template['metadata']['candidates_source'] = 'attribution_text_genus'
    template['metadata']['candidates_per_claim'] = args.top_k

    with open(template_path, 'w', encoding='utf-8') as f:
        json.dump(template, f, indent=2, ensure_ascii=False)

    print(f"\nDone:")
    print(f"  Claims re-ranked: {len(claims)}")
    print(f"  Top-1 changed: {upgraded}/{len(claims)} ({round(upgraded/len(claims)*100)}%)")
    print(f"  Old top-1 still in top-{args.top_k}: {original_top1_in_new}/{len(claims)}")

    # Show a few examples of rank changes
    print(f"\nSample re-rankings (first 3 claims):")
    for claim in claims[:3]:
        cid = claim['claim_id']
        top = claim['candidate_nodes'][0]
        print(f"  {cid}: top-1 = {top['node_id']} ({top['machine_similarity']:.4f}) — {top['label'][:60]}")


if __name__ == '__main__':
    main()
