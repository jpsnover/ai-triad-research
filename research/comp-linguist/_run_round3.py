"""Round 3: Field weight experiment for POV node embeddings.

Replicates the production embedding pipeline (embed_taxonomy.py) with
different field weight combinations to find the optimal balance.

Production pipeline:
  1. Encode 5 fields separately WITHOUT normalization
  2. Weighted combination: w_desc * desc + w_assumes * assumes + ...
  3. Single L2 normalization at the end

Weight variants:
  W1: desc=0.611, assumes=0.389 (current production)
  W2: desc=1.0,   assumes=0.0   (description only)
  W3: desc=0.8,   assumes=0.2
  W4: desc=0.9,   assumes=0.1
  W5: desc=0.7,   assumes=0.3
"""
import sys, json, glob, os, re, math, time
import numpy as np
sys.stdout.reconfigure(encoding='utf-8')

# ── Config ──
DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_round3_results.json'

SPEAKER_POV = {'accelerationist': 'accelerationist', 'safetyist': 'safetyist', 'skeptic': 'skeptic'}
POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}

WEIGHT_VARIANTS = {
    'W1': {'desc': 0.611, 'assumes': 0.389, 'label': 'Current production (0.611/0.389)'},
    'W2': {'desc': 1.0,   'assumes': 0.0,   'label': 'Description only (1.0/0.0)'},
    'W3': {'desc': 0.8,   'assumes': 0.2,   'label': 'Light assumes (0.8/0.2)'},
    'W4': {'desc': 0.9,   'assumes': 0.1,   'label': 'Minimal assumes (0.9/0.1)'},
    'W5': {'desc': 0.7,   'assumes': 0.3,   'label': 'Moderate assumes (0.7/0.3)'},
}

def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# ── Load taxonomy nodes ──
print("Loading taxonomy nodes...")
all_nodes = []  # (pov, node_dict)
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    for n in data.get('nodes', []):
        if n.get('category') == 'Beliefs':
            all_nodes.append((pov, n))
    print(f"  {pov}: {sum(1 for p, _ in all_nodes if p == pov)} Belief nodes")
print(f"  Total: {len(all_nodes)} Belief nodes")

# ── Extract field texts (replicating embed_taxonomy.py _compose_field_texts) ──
print("\nExtracting field texts...")
desc_texts = []
assumes_texts = []

for pov, node in all_nodes:
    # Field 1: label + description (production includes label)
    parts = []
    label = node.get('label', '')
    if label:
        parts.append(label)
    desc = node.get('description', '')
    if desc:
        parts.append(desc)
    desc_texts.append('. '.join(parts) if parts else '')

    # Field 2: assumes from graph_attributes
    ga = node.get('graph_attributes', {}) or {}
    assumes = ga.get('assumes', []) or []
    assumes_texts.append('. '.join(assumes) if assumes else '')

has_assumes = sum(1 for t in assumes_texts if t)
print(f"  Nodes with assumes text: {has_assumes}/{len(all_nodes)}")
if has_assumes > 0:
    sample_idx = next(i for i, t in enumerate(assumes_texts) if t)
    print(f"  Sample assumes: {assumes_texts[sample_idx][:100]}...")

# ── Load model ──
print("\nLoading sentence-transformers model...")
t0 = time.time()
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
print(f"  Model loaded in {time.time()-t0:.1f}s")

# ── Encode all field texts WITHOUT normalization (matching production) ──
print("\nEncoding field texts (no pre-normalization)...")
t0 = time.time()
desc_vecs = model.encode(desc_texts, show_progress_bar=False, normalize_embeddings=False)
assumes_vecs = model.encode(assumes_texts, show_progress_bar=False, normalize_embeddings=False)
print(f"  Encoded in {time.time()-t0:.1f}s")

# ── Load golden set and claim embeddings ──
print("\nLoading golden set...")
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']
print(f"  {len(claims)} claims")

print("Loading claim embeddings from debates...")
claim_embeddings = {}
debate_files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
for fp in debate_files[:20]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    for n in d.get('argument_network', {}).get('nodes', []):
        if n.get('embedding') and n.get('id'):
            claim_embeddings[n['id']] = n['embedding']
print(f"  {sum(1 for c in claims if c['claim_id'] in claim_embeddings)}/{len(claims)} claims have embeddings")

# ── Build node index ──
node_index = {}  # node_id -> index in all_nodes
for i, (pov, node) in enumerate(all_nodes):
    node_index[node['id']] = i

pov_belief_ids = {}
for pov in POV_FILE:
    pov_belief_ids[pov] = [node['id'] for p, node in all_nodes if p == pov]

# ── Evaluate function ──
def evaluate(pov_embeddings_map, variant_label):
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

        if cid not in claim_embeddings:
            continue
        pov = SPEAKER_POV.get(speaker)
        if not pov or pov not in pov_belief_ids:
            continue

        claim_vec = claim_embeddings[cid]
        candidates = pov_belief_ids[pov]
        if not candidates:
            continue

        sims = []
        for nid in candidates:
            if nid not in pov_embeddings_map:
                continue
            nvec = pov_embeddings_map[nid]
            sim = cosine_similarity(claim_vec, nvec)
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

# ── Run all weight variants ──
results = {}
for variant_name, config in WEIGHT_VARIANTS.items():
    w_desc = config['desc']
    w_assumes = config['assumes']
    label = config['label']

    print(f"\n{'='*60}")
    print(f"{variant_name}: {label}")
    print(f"{'='*60}")

    # Weighted combination (matching production: raw vecs * weight, then normalize)
    combined = w_desc * desc_vecs + w_assumes * assumes_vecs
    norms = np.linalg.norm(combined, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    normalized = combined / norms

    # Build node_id -> vector map
    emb_map = {}
    for i, (pov, node) in enumerate(all_nodes):
        emb_map[node['id']] = normalized[i].tolist()

    r = evaluate(emb_map, variant_name)
    results[variant_name] = {**r, 'weights': {'desc': w_desc, 'assumes': w_assumes}}

    print(f"\n  Results (n={r['evaluated']}):")
    print(f"    Top-1 accuracy:       {r['top1_accuracy']:6.2f}%")
    print(f"    Top-3 accuracy:       {r['top3_accuracy']:6.2f}%")
    print(f"    MRR:                  {r['mrr']:6.4f}")
    print(f"    Mean similarity:      {r['mean_similarity']:6.4f}")
    print(f"    Discriminability gap: {r['discriminability_gap']:6.4f}")
    print(f"    Novel argument rate:  {r['novel_argument_rate']:6.2f}%")

# ── Summary ──
print(f"\n{'='*80}")
print("ROUND 3 SUMMARY: Field Weight Experiment")
print(f"{'='*80}")
print(f"{'Variant':6s} {'Weights':22s} {'Top-1':>7s} {'Top-3':>7s} {'MRR':>8s} {'Avg Sim':>8s} {'Gap':>8s} {'Novel%':>7s}")
print(f"{'='*6} {'='*22} {'='*7} {'='*7} {'='*8} {'='*8} {'='*8} {'='*7}")
for vn in ['W1', 'W2', 'W3', 'W4', 'W5']:
    r = results[vn]
    w = r['weights']
    wstr = f"d={w['desc']:.1f}/a={w['assumes']:.1f}"
    print(f"{vn:6s} {wstr:22s} {r['top1_accuracy']:6.1f}% {r['top3_accuracy']:6.1f}% {r['mrr']:8.4f} {r['mean_similarity']:8.4f} {r['discriminability_gap']:8.4f} {r['novel_argument_rate']:6.1f}%")

best_mrr = max(results.items(), key=lambda x: x[1]['mrr'])
best_top1 = max(results.items(), key=lambda x: x[1]['top1_accuracy'])
print(f"\nBest MRR:   {best_mrr[0]} ({best_mrr[1]['mrr']:.4f})")
print(f"Best Top-1: {best_top1[0]} ({best_top1[1]['top1_accuracy']:.1f}%)")

# Compare to Round 1-2 experiment baseline
print(f"\nComparison to Round 1-2 (description-only, no label, no assumes):")
print(f"  Round 1-2 B×i:  MRR=0.1847  Top-1=10.5%")
print(f"  Best Round 3:   MRR={best_mrr[1]['mrr']:.4f}  Top-1={best_top1[1]['top1_accuracy']:.1f}%")

# Delta from current production
w1 = results['W1']
print(f"\nDelta from current production (W1):")
for vn in ['W2', 'W3', 'W4', 'W5']:
    r = results[vn]
    d_mrr = r['mrr'] - w1['mrr']
    d_top1 = r['top1_accuracy'] - w1['top1_accuracy']
    print(f"  {vn}: MRR {d_mrr:+.4f}  Top-1 {d_top1:+.1f}%")

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to {OUTPUT_PATH}")
