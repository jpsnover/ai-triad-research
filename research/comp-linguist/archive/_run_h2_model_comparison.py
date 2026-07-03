"""H2: Larger embedding model comparison + Matryoshka dimension sweep.

Tests whether larger models or Matryoshka truncation improve claim attribution.

Models tested:
  1. all-MiniLM-L6-v2       — 22M params, 384-dim (current production baseline)
  2. all-mpnet-base-v2       — 110M params, 768-dim (same training, 5x capacity)
  3. BAAI/bge-base-en-v1.5   — 109M params, 768-dim (state-of-art general)
  4. nomic-ai/nomic-embed-text-v1.5 — 137M params, 768-dim (MRL-capable)

For MRL-capable models, also test truncated dimensions (64, 128, 256, 512).

All models re-embed BOTH claims and POV nodes (vectors are model-specific).
Uses description-only (no label, matching Round 1-2 best config).
"""
import sys, json, glob, os, math, time
import numpy as np
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_h2_results.json'

SPEAKER_POV = {'accelerationist': 'accelerationist', 'safetyist': 'safetyist', 'skeptic': 'skeptic'}
POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}

MODELS = [
    {'name': 'all-MiniLM-L6-v2', 'dim': 384, 'mrl': False, 'prefix': None},
    {'name': 'all-mpnet-base-v2', 'dim': 768, 'mrl': False, 'prefix': None},
    {'name': 'BAAI/bge-base-en-v1.5', 'dim': 768, 'mrl': False, 'prefix': None},
    {'name': 'nomic-ai/nomic-embed-text-v1.5', 'dim': 768, 'mrl': True,
     'prefix': {'query': 'search_query: ', 'document': 'search_document: '}},
]

MRL_DIMS = [64, 128, 256, 512]

def cosine_similarity(a, b):
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))

# ── Load taxonomy (description only, no label — best config from Round 1) ──
print("Loading taxonomy nodes...")
pov_nodes = {}
node_descriptions = {}  # node_id -> description text
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    beliefs = [n for n in data.get('nodes', []) if n.get('category') == 'Beliefs']
    pov_nodes[pov] = beliefs
    for n in beliefs:
        node_descriptions[n['id']] = n.get('description', '')
    print(f"  {pov}: {len(beliefs)} Belief nodes")

# ── Load golden set and claim texts ──
print("Loading golden set...")
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']
print(f"  {len(claims)} claims")

print("Loading claim texts from debates...")
claim_texts = {}
debate_files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
for fp in debate_files[:20]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    for n in d.get('argument_network', {}).get('nodes', []):
        if n.get('id') and n.get('text', n.get('label', '')):
            claim_texts[n['id']] = n.get('text', n.get('label', ''))
print(f"  {sum(1 for c in claims if c['claim_id'] in claim_texts)}/{len(claims)} claims have text")

# Build node ID lists per POV
pov_belief_ids = {}
for pov, nodes in pov_nodes.items():
    pov_belief_ids[pov] = [n['id'] for n in nodes]

# ── Evaluation function ──
def evaluate(claim_vecs, node_vecs, dim_label="full"):
    top1_correct = 0
    top3_correct = 0
    reciprocal_ranks = []
    top_similarities = []
    disc_gaps = []
    novel_count = 0
    evaluated = 0

    for claim in claims:
        cid = claim['claim_id']
        speaker = claim['speaker']
        expected_node = claim['attributed_node']

        if cid not in claim_vecs:
            continue
        pov = SPEAKER_POV.get(speaker)
        if not pov or pov not in pov_belief_ids:
            continue

        cv = claim_vecs[cid]
        candidates = pov_belief_ids[pov]

        sims = []
        for nid in candidates:
            if nid not in node_vecs:
                continue
            nv = node_vecs[nid]
            sim = cosine_similarity(cv, nv)
            sims.append((nid, sim))
        sims.sort(key=lambda x: -x[1])

        if not sims:
            continue

        evaluated += 1
        best_id, best_sim = sims[0]
        top_similarities.append(best_sim)

        if len(sims) > 1:
            disc_gaps.append(sims[0][1] - sims[1][1])

        if best_sim < 0.35:
            novel_count += 1
            continue

        if best_id == expected_node:
            top1_correct += 1
        if expected_node in [s[0] for s in sims[:3]]:
            top3_correct += 1

        rank = next((i + 1 for i, (nid, _) in enumerate(sims) if nid == expected_node), len(sims) + 1)
        reciprocal_ranks.append(1.0 / rank)

    n = evaluated
    return {
        'evaluated': n,
        'top1_accuracy': round(top1_correct / n * 100, 2) if n else 0,
        'top3_accuracy': round(top3_correct / n * 100, 2) if n else 0,
        'mrr': round(sum(reciprocal_ranks) / len(reciprocal_ranks), 4) if reciprocal_ranks else 0,
        'mean_similarity': round(sum(top_similarities) / len(top_similarities), 4) if top_similarities else 0,
        'discriminability_gap': round(sum(disc_gaps) / len(disc_gaps), 4) if disc_gaps else 0,
        'novel_argument_rate': round(novel_count / n * 100, 2) if n else 0,
    }

# ── Run all models ──
from sentence_transformers import SentenceTransformer

all_results = {}

# Prepare text lists (ordered, for batch encoding)
node_ids_ordered = list(node_descriptions.keys())
node_texts_ordered = [node_descriptions[nid] for nid in node_ids_ordered]

claim_ids_ordered = [c['claim_id'] for c in claims if c['claim_id'] in claim_texts]
claim_texts_ordered = [claim_texts[cid] for cid in claim_ids_ordered]

for model_config in MODELS:
    model_name = model_config['name']
    prefix = model_config['prefix']

    print(f"\n{'='*60}")
    print(f"MODEL: {model_name}")
    print(f"{'='*60}")

    t0 = time.time()
    try:
        if 'nomic' in model_name:
            model = SentenceTransformer(model_name, trust_remote_code=True)
        else:
            model = SentenceTransformer(model_name)
        print(f"  Loaded in {time.time()-t0:.1f}s")
    except Exception as e:
        print(f"  FAILED to load: {e}")
        continue

    # Prepare texts with optional prefix
    if prefix:
        node_input = [prefix['document'] + t for t in node_texts_ordered]
        claim_input = [prefix['query'] + t for t in claim_texts_ordered]
    else:
        node_input = node_texts_ordered
        claim_input = claim_texts_ordered

    # Encode at full dimension (no pre-normalization for MRL truncation later)
    print(f"  Encoding {len(node_input)} nodes + {len(claim_input)} claims...")
    t0 = time.time()
    node_raw = model.encode(node_input, show_progress_bar=False, normalize_embeddings=False)
    claim_raw = model.encode(claim_input, show_progress_bar=False, normalize_embeddings=False)
    encode_time = time.time() - t0
    print(f"  Encoded in {encode_time:.1f}s (dim={node_raw.shape[1]})")

    # Evaluate at full dimension (normalized)
    def make_vec_dicts(node_arr, claim_arr):
        node_norms = np.linalg.norm(node_arr, axis=1, keepdims=True)
        node_norms[node_norms == 0] = 1.0
        node_normed = node_arr / node_norms

        claim_norms = np.linalg.norm(claim_arr, axis=1, keepdims=True)
        claim_norms[claim_norms == 0] = 1.0
        claim_normed = claim_arr / claim_norms

        nv = {nid: node_normed[i] for i, nid in enumerate(node_ids_ordered)}
        cv = {cid: claim_normed[i] for i, cid in enumerate(claim_ids_ordered)}
        return cv, nv

    cv, nv = make_vec_dicts(node_raw, claim_raw)
    r = evaluate(cv, nv, f"full-{node_raw.shape[1]}")
    label = f"{model_name} (dim={node_raw.shape[1]})"
    all_results[label] = {**r, 'dim': int(node_raw.shape[1]), 'encode_time_s': round(encode_time, 1)}

    print(f"\n  {label}:")
    print(f"    Top-1: {r['top1_accuracy']:.1f}%  Top-3: {r['top3_accuracy']:.1f}%  MRR: {r['mrr']:.4f}  Gap: {r['discriminability_gap']:.4f}")

    # MRL truncation sweep
    if model_config['mrl']:
        full_dim = node_raw.shape[1]
        for trunc_dim in MRL_DIMS:
            if trunc_dim >= full_dim:
                continue
            node_trunc = node_raw[:, :trunc_dim]
            claim_trunc = claim_raw[:, :trunc_dim]
            cv_t, nv_t = make_vec_dicts(node_trunc, claim_trunc)
            r_t = evaluate(cv_t, nv_t, f"mrl-{trunc_dim}")
            label_t = f"{model_name} (MRL dim={trunc_dim})"
            all_results[label_t] = {**r_t, 'dim': trunc_dim, 'encode_time_s': round(encode_time, 1)}
            print(f"  {label_t}:")
            print(f"    Top-1: {r_t['top1_accuracy']:.1f}%  Top-3: {r_t['top3_accuracy']:.1f}%  MRR: {r_t['mrr']:.4f}  Gap: {r_t['discriminability_gap']:.4f}")

    del model  # free memory before loading next

# ── Summary ──
print(f"\n{'='*80}")
print("H2 SUMMARY: Model Comparison + Matryoshka Dimension Sweep")
print(f"{'='*80}")
print(f"{'Configuration':<50s} {'Dim':>5s} {'Top-1':>7s} {'Top-3':>7s} {'MRR':>8s} {'Gap':>8s} {'Time':>6s}")
print(f"{'='*50} {'='*5} {'='*7} {'='*7} {'='*8} {'='*8} {'='*6}")

for label, r in sorted(all_results.items(), key=lambda x: -x[1]['mrr']):
    print(f"{label:<50s} {r['dim']:>5d} {r['top1_accuracy']:6.1f}% {r['top3_accuracy']:6.1f}% {r['mrr']:8.4f} {r['discriminability_gap']:8.4f} {r['encode_time_s']:5.1f}s")

best = max(all_results.items(), key=lambda x: x[1]['mrr'])
baseline_key = [k for k in all_results if 'MiniLM' in k and 'MRL' not in k]
if baseline_key:
    bl = all_results[baseline_key[0]]
    print(f"\nBaseline: {baseline_key[0]}")
    print(f"  MRR: {bl['mrr']:.4f}  Top-1: {bl['top1_accuracy']:.1f}%")
print(f"Best: {best[0]}")
print(f"  MRR: {best[1]['mrr']:.4f}  Top-1: {best[1]['top1_accuracy']:.1f}%")
if baseline_key:
    print(f"  Delta MRR: {best[1]['mrr'] - bl['mrr']:+.4f}  Delta Top-1: {best[1]['top1_accuracy'] - bl['top1_accuracy']:+.1f}%")

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(all_results, f, indent=2)
print(f"\nResults saved to {OUTPUT_PATH}")
