"""H5: Hybrid BM25 + embedding fusion experiment for claim attribution.

Tests whether combining keyword matching (BM25) with embedding similarity
improves claim-to-POV-node attribution accuracy.

Fusion strategies:
  - BM25 only (baseline)
  - Linear fusion: α × cosine + (1-α) × BM25_normalized, α in [0.3, 0.5, 0.7, 0.9]
  - Reciprocal Rank Fusion (RRF)
"""
import sys, json, glob, os, math
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_h5_results.json'

SPEAKER_POV = {'accelerationist': 'accelerationist', 'safetyist': 'safetyist', 'skeptic': 'skeptic'}
POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}

def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# ── Load taxonomy ──
print("Loading taxonomy nodes...")
pov_nodes = {}
node_lookup = {}
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    beliefs = [n for n in data.get('nodes', []) if n.get('category') == 'Beliefs']
    pov_nodes[pov] = beliefs
    for n in beliefs:
        node_lookup[n['id']] = n
    print(f"  {pov}: {len(beliefs)} Belief nodes")

# ── Load embeddings ──
print("Loading embeddings.json...")
emb_path = os.path.join(TAXONOMY_DIR, 'embeddings.json')
with open(emb_path, encoding='utf-8') as f:
    emb_data = json.load(f)
emb_nodes = emb_data.get('nodes', {})

# ── Load golden set and claim data ──
print("Loading golden set...")
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']
print(f"  {len(claims)} claims")

print("Loading claim data from debates...")
claim_data = {}
debate_files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
for fp in debate_files[:20]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    for n in d.get('argument_network', {}).get('nodes', []):
        if n.get('id'):
            claim_data[n['id']] = {
                'text': n.get('text', n.get('label', '')),
                'embedding': n.get('embedding'),
            }

# ── Build BM25 index per POV ──
print("\nBuilding BM25 indices...")
try:
    from rank_bm25 import BM25Okapi
except ImportError:
    print("Installing rank-bm25...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'rank-bm25', '-q'])
    from rank_bm25 import BM25Okapi

import re

def tokenize(text):
    """Simple whitespace + punctuation tokenizer, lowercase."""
    return re.findall(r'\b\w+\b', text.lower())

bm25_indices = {}  # pov -> BM25Okapi
bm25_node_ids = {} # pov -> [node_id, ...]

for pov, nodes in pov_nodes.items():
    corpus = []
    ids = []
    for n in nodes:
        desc = n.get('description', '')
        corpus.append(tokenize(desc))
        ids.append(n['id'])
    bm25_indices[pov] = BM25Okapi(corpus)
    bm25_node_ids[pov] = ids
    print(f"  {pov}: BM25 index with {len(ids)} documents")

# ── Evaluation function ──
def evaluate(ranked_results, label):
    top1_correct = 0
    top3_correct = 0
    reciprocal_ranks = []
    evaluated = 0

    for cid, expected_node, rankings in ranked_results:
        if not rankings:
            continue
        evaluated += 1

        best_id = rankings[0][0]
        if best_id == expected_node:
            top1_correct += 1
        if expected_node in [r[0] for r in rankings[:3]]:
            top3_correct += 1

        rank = next((i + 1 for i, (nid, _) in enumerate(rankings) if nid == expected_node), len(rankings) + 1)
        reciprocal_ranks.append(1.0 / rank)

    n = evaluated
    return {
        'evaluated': n,
        'top1_accuracy': round(top1_correct / n * 100, 2) if n else 0,
        'top3_accuracy': round(top3_correct / n * 100, 2) if n else 0,
        'mrr': round(sum(reciprocal_ranks) / len(reciprocal_ranks), 4) if reciprocal_ranks else 0,
    }

# ── Compute scores for all claims ──
print("\nComputing scores for all claims...")

all_claim_scores = []  # (cid, expected, pov, {nid: cosine}, {nid: bm25})

for claim in claims:
    cid = claim['claim_id']
    speaker = claim['speaker']
    expected_node = claim['attributed_node']

    if cid not in claim_data or not claim_data[cid].get('embedding'):
        continue
    pov = SPEAKER_POV.get(speaker)
    if not pov or pov not in pov_nodes:
        continue

    claim_vec = claim_data[cid]['embedding']
    claim_text = claim_data[cid]['text']
    claim_tokens = tokenize(claim_text)

    # Cosine similarities
    cosine_scores = {}
    for node in pov_nodes[pov]:
        nid = node['id']
        if nid not in emb_nodes:
            continue
        nvec = emb_nodes[nid].get('vector', [])
        if not nvec:
            continue
        cosine_scores[nid] = cosine_similarity(claim_vec, nvec)

    # BM25 scores
    bm25 = bm25_indices[pov]
    node_ids = bm25_node_ids[pov]
    raw_bm25 = bm25.get_scores(claim_tokens)
    bm25_scores = {nid: float(score) for nid, score in zip(node_ids, raw_bm25)}

    all_claim_scores.append((cid, expected_node, pov, cosine_scores, bm25_scores))

print(f"  {len(all_claim_scores)} claims scored")

# ── Strategy: Embedding only (baseline) ──
def rank_cosine_only(scores_list):
    results = []
    for cid, expected, pov, cosine_scores, bm25_scores in scores_list:
        ranked = sorted(cosine_scores.items(), key=lambda x: -x[1])
        results.append((cid, expected, ranked))
    return results

# ── Strategy: BM25 only ──
def rank_bm25_only(scores_list):
    results = []
    for cid, expected, pov, cosine_scores, bm25_scores in scores_list:
        ranked = sorted(bm25_scores.items(), key=lambda x: -x[1])
        results.append((cid, expected, ranked))
    return results

# ── Strategy: Linear fusion ──
def rank_linear_fusion(scores_list, alpha):
    """alpha × cosine + (1-alpha) × bm25_normalized"""
    results = []
    for cid, expected, pov, cosine_scores, bm25_scores in scores_list:
        # Normalize BM25 to [0, 1] range
        bm25_vals = list(bm25_scores.values())
        bm25_max = max(bm25_vals) if bm25_vals else 1.0
        bm25_min = min(bm25_vals) if bm25_vals else 0.0
        bm25_range = bm25_max - bm25_min if bm25_max != bm25_min else 1.0

        fused = {}
        all_nids = set(cosine_scores.keys()) | set(bm25_scores.keys())
        for nid in all_nids:
            cos_val = cosine_scores.get(nid, 0.0)
            bm25_val = (bm25_scores.get(nid, 0.0) - bm25_min) / bm25_range
            fused[nid] = alpha * cos_val + (1 - alpha) * bm25_val

        ranked = sorted(fused.items(), key=lambda x: -x[1])
        results.append((cid, expected, ranked))
    return results

# ── Strategy: Reciprocal Rank Fusion ──
def rank_rrf(scores_list, k=60):
    """RRF: score = sum(1 / (k + rank_i)) across ranking lists."""
    results = []
    for cid, expected, pov, cosine_scores, bm25_scores in scores_list:
        cos_ranked = sorted(cosine_scores.items(), key=lambda x: -x[1])
        bm25_ranked = sorted(bm25_scores.items(), key=lambda x: -x[1])

        cos_rank = {nid: i + 1 for i, (nid, _) in enumerate(cos_ranked)}
        bm25_rank = {nid: i + 1 for i, (nid, _) in enumerate(bm25_ranked)}

        all_nids = set(cos_rank.keys()) | set(bm25_rank.keys())
        max_rank = len(all_nids) + 1

        rrf_scores = {}
        for nid in all_nids:
            r1 = cos_rank.get(nid, max_rank)
            r2 = bm25_rank.get(nid, max_rank)
            rrf_scores[nid] = 1.0 / (k + r1) + 1.0 / (k + r2)

        ranked = sorted(rrf_scores.items(), key=lambda x: -x[1])
        results.append((cid, expected, ranked))
    return results

# ── Run all strategies ──
strategies = {
    'Cosine only': rank_cosine_only(all_claim_scores),
    'BM25 only': rank_bm25_only(all_claim_scores),
    'Linear α=0.3': rank_linear_fusion(all_claim_scores, 0.3),
    'Linear α=0.5': rank_linear_fusion(all_claim_scores, 0.5),
    'Linear α=0.7': rank_linear_fusion(all_claim_scores, 0.7),
    'Linear α=0.9': rank_linear_fusion(all_claim_scores, 0.9),
    'RRF (k=60)': rank_rrf(all_claim_scores, k=60),
}

results = {}
print(f"\n{'='*80}")
print("RESULTS")
print(f"{'='*80}")
print(f"{'Strategy':<20s} {'Top-1':>7s} {'Top-3':>7s} {'MRR':>8s}")
print(f"{'='*20} {'='*7} {'='*7} {'='*8}")

for name, ranked in strategies.items():
    metrics = evaluate(ranked, name)
    results[name] = metrics
    print(f"{name:<20s} {metrics['top1_accuracy']:6.1f}% {metrics['top3_accuracy']:6.1f}% {metrics['mrr']:8.4f}")

# ── Best strategy ──
best = max(results.items(), key=lambda x: x[1]['mrr'])
baseline = results['Cosine only']
print(f"\nBest strategy: {best[0]}")
print(f"  MRR: {best[1]['mrr']:.4f} (vs cosine baseline {baseline['mrr']:.4f}, delta {best[1]['mrr'] - baseline['mrr']:+.4f})")
print(f"  Top-1: {best[1]['top1_accuracy']:.1f}% (vs {baseline['top1_accuracy']:.1f}%, delta {best[1]['top1_accuracy'] - baseline['top1_accuracy']:+.1f}%)")

# ── BM25 vs Cosine disagreement analysis ──
print(f"\n{'='*60}")
print("BM25 vs COSINE DISAGREEMENT ANALYSIS")
print(f"{'='*60}")
cos_ranked = strategies['Cosine only']
bm25_ranked = strategies['BM25 only']

agree_top1 = 0
disagree_cos_wins = 0
disagree_bm25_wins = 0
disagree_neither = 0

for (cid1, exp1, cos_r), (cid2, exp2, bm25_r) in zip(cos_ranked, bm25_ranked):
    if not cos_r or not bm25_r:
        continue
    cos_top = cos_r[0][0]
    bm25_top = bm25_r[0][0]
    if cos_top == bm25_top:
        agree_top1 += 1
    else:
        if cos_top == exp1:
            disagree_cos_wins += 1
        elif bm25_top == exp1:
            disagree_bm25_wins += 1
        else:
            disagree_neither += 1

total_compared = agree_top1 + disagree_cos_wins + disagree_bm25_wins + disagree_neither
print(f"  Top-1 agreement:          {agree_top1}/{total_compared} ({agree_top1/total_compared*100:.1f}%)")
print(f"  Disagree, cosine correct: {disagree_cos_wins}")
print(f"  Disagree, BM25 correct:   {disagree_bm25_wins}")
print(f"  Disagree, neither correct:{disagree_neither}")

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to {OUTPUT_PATH}")
