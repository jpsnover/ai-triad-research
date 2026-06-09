"""H1: Cross-encoder re-ranking experiment for claim attribution.

For each golden set claim:
1. Retrieve top-20 same-POV Belief candidates via cosine similarity (bi-encoder)
2. Re-rank top-20 using a cross-encoder model
3. Evaluate Top-1/Top-3/MRR on re-ranked results vs bi-encoder baseline
"""
import sys, json, glob, os, math, time
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_h1_results.json'

SPEAKER_POV = {'accelerationist': 'accelerationist', 'safetyist': 'safetyist', 'skeptic': 'skeptic'}
POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}
RERANK_K = 20

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
print(f"  {len(emb_nodes)} nodes loaded")

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
print(f"  {sum(1 for c in claims if c['claim_id'] in claim_data)}/{len(claims)} claims have data")

# ── Load cross-encoder ──
print("\nLoading cross-encoder model...")
t0 = time.time()
from sentence_transformers import CrossEncoder
cross_encoder = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
print(f"  Cross-encoder loaded in {time.time()-t0:.1f}s")

# ── Evaluation function ──
def evaluate(ranked_results, label):
    top1_correct = 0
    top3_correct = 0
    reciprocal_ranks = []
    top_similarities = []
    disc_gaps = []
    novel_count = 0
    evaluated = 0

    for cid, expected_node, rankings in ranked_results:
        if not rankings:
            continue
        evaluated += 1
        best_id, best_score = rankings[0]
        top_similarities.append(best_score)

        if len(rankings) > 1:
            disc_gaps.append(rankings[0][1] - rankings[1][1])

        if best_score < 0.35 and label == 'bi-encoder':
            novel_count += 1
            continue

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
        'mean_score': round(sum(top_similarities) / len(top_similarities), 4) if top_similarities else 0,
        'discriminability_gap': round(sum(disc_gaps) / len(disc_gaps), 4) if disc_gaps else 0,
        'novel_argument_rate': round(novel_count / n * 100, 2) if n else 0,
    }

# ── Run experiment ──
print(f"\nRunning bi-encoder retrieval + cross-encoder re-ranking (top-{RERANK_K})...")
bi_results = []   # (cid, expected, [(nid, cosine_score), ...])
ce_results = []   # (cid, expected, [(nid, ce_score), ...])

ce_times = []
total_claims = 0

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

    # Step 1: Bi-encoder retrieval — rank all same-POV Belief nodes
    sims = []
    for node in pov_nodes[pov]:
        nid = node['id']
        if nid not in emb_nodes:
            continue
        nvec = emb_nodes[nid].get('vector', [])
        if not nvec:
            continue
        sim = cosine_similarity(claim_vec, nvec)
        sims.append((nid, sim))
    sims.sort(key=lambda x: -x[1])

    bi_results.append((cid, expected_node, sims))

    # Step 2: Cross-encoder re-ranking of top-K
    top_k = sims[:RERANK_K]
    if not top_k:
        ce_results.append((cid, expected_node, []))
        continue

    pairs = [(claim_text, node_lookup[nid]['description']) for nid, _ in top_k]

    t_ce = time.time()
    ce_scores = cross_encoder.predict(pairs)
    ce_time = time.time() - t_ce
    ce_times.append(ce_time)

    reranked = [(nid, float(score)) for (nid, _), score in zip(top_k, ce_scores)]
    reranked.sort(key=lambda x: -x[1])
    ce_results.append((cid, expected_node, reranked))

    total_claims += 1
    if total_claims % 100 == 0:
        print(f"  Processed {total_claims} claims...")

print(f"  Total: {total_claims} claims processed")

# ── Evaluate both ──
print(f"\n{'='*60}")
print("BI-ENCODER BASELINE (cosine similarity)")
print(f"{'='*60}")
bi_metrics = evaluate(bi_results, 'bi-encoder')
for k, v in bi_metrics.items():
    print(f"  {k}: {v}")

print(f"\n{'='*60}")
print(f"CROSS-ENCODER RE-RANKING (top-{RERANK_K})")
print(f"{'='*60}")
# For CE evaluation, don't use the novel threshold (CE scores aren't cosine)
ce_metrics = evaluate(ce_results, 'cross-encoder')
for k, v in ce_metrics.items():
    print(f"  {k}: {v}")

# ── Latency ──
avg_ce_time = sum(ce_times) / len(ce_times) if ce_times else 0
print(f"\nCross-encoder latency:")
print(f"  Mean per claim (top-{RERANK_K}): {avg_ce_time*1000:.1f}ms")
print(f"  P95: {sorted(ce_times)[int(len(ce_times)*0.95)]*1000:.1f}ms" if ce_times else "  N/A")

# ── Comparison ──
print(f"\n{'='*60}")
print("COMPARISON")
print(f"{'='*60}")
print(f"  {'Metric':<20s} {'Bi-encoder':>12s} {'Cross-encoder':>14s} {'Delta':>10s}")
print(f"  {'='*20} {'='*12} {'='*14} {'='*10}")
for metric in ['top1_accuracy', 'top3_accuracy', 'mrr', 'discriminability_gap']:
    bi_val = bi_metrics[metric]
    ce_val = ce_metrics[metric]
    delta = ce_val - bi_val
    suffix = '%' if 'accuracy' in metric else ''
    print(f"  {metric:<20s} {bi_val:>11.2f}{suffix} {ce_val:>13.2f}{suffix} {delta:>+9.4f}")

# ── Save results ──
results = {
    'bi_encoder': bi_metrics,
    'cross_encoder': ce_metrics,
    'config': {
        'rerank_k': RERANK_K,
        'cross_encoder_model': 'cross-encoder/ms-marco-MiniLM-L-6-v2',
        'avg_latency_ms': round(avg_ce_time * 1000, 1),
    },
}
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to {OUTPUT_PATH}")
