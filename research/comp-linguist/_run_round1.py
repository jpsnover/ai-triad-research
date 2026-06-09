"""Round 1: Evaluate 6 POV node embedding variants against golden set claims.

Variants (all using raw claim text — claim variant i):
  A: Current baseline — DOLCE description minus Excludes
  B: Full description WITH Excludes
  C: Plain differentia — strip DOLCE prefix + Encompasses/Excludes
  D: Label + differentia
  E: Claim-style rephrase (skipped — requires LLM, deferred)
  G: Label + differentia + adversarial edge target labels

Metrics per variant:
  - Top-1 accuracy (does highest-scoring node match current attribution?)
  - Top-3 accuracy (is current attribution in top 3?)
  - Mean Reciprocal Rank (MRR)
  - Mean similarity (avg cosine sim of top match)
  - Discriminability gap (avg top-1 minus top-2 score)
  - Novel argument rate (% claims below 0.35 on all nodes)
"""
import sys, json, glob, os, re, math, time
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

# ── Config ──
DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_round1_results.json'

SPEAKER_POV = {
    'accelerationist': 'accelerationist',
    'safetyist': 'safetyist',
    'skeptic': 'skeptic',
}
POV_FILE = {
    'accelerationist': 'accelerationist.json',
    'safetyist': 'safetyist.json',
    'skeptic': 'skeptic.json',
}

# ── Load taxonomy ──
print("Loading taxonomy nodes...")
pov_nodes = {}  # pov -> list of node dicts
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    pov_nodes[pov] = data.get('nodes', [])
    belief_count = sum(1 for n in pov_nodes[pov] if n.get('category') == 'Beliefs')
    print(f"  {pov}: {len(pov_nodes[pov])} nodes ({belief_count} Beliefs)")

# ── Load edges for variant G ──
print("Loading edges...")
with open(os.path.join(TAXONOMY_DIR, 'edges.json'), encoding='utf-8') as f:
    edges_data = json.load(f)
all_edges = edges_data if isinstance(edges_data, list) else edges_data.get('edges', [])

ADVERSARIAL_TYPES = {'CONTRADICTS', 'WEAKENS', 'TENSION_WITH'}
adversarial_targets = defaultdict(list)  # node_id -> [(edge_type, target_id)]
for e in all_edges:
    if e.get('type') in ADVERSARIAL_TYPES:
        adversarial_targets[e['source']].append((e['type'], e['target']))
        adversarial_targets[e['target']].append((e['type'], e['source']))
print(f"  {len(all_edges)} total edges, {sum(len(v) for v in adversarial_targets.values())//2} adversarial pairs")

# Build label lookup
node_labels = {}
for pov, nodes in pov_nodes.items():
    for n in nodes:
        node_labels[n['id']] = n.get('label', n['id'])

# ── Load golden set ──
print("Loading golden set...")
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']
print(f"  {len(claims)} claims")

# ── Load claim embeddings from debate files ──
print("Loading claim embeddings from debates...")
claim_embeddings = {}  # claim_id -> embedding vector
debate_files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
for fp in debate_files[:20]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    for n in d.get('argument_network', {}).get('nodes', []):
        if n.get('embedding') and n.get('id'):
            claim_embeddings[n['id']] = n['embedding']

claims_with_emb = sum(1 for c in claims if c['claim_id'] in claim_embeddings)
print(f"  {claims_with_emb}/{len(claims)} claims have embeddings")

# ── Helper functions ──
def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

def strip_excludes(text):
    return re.sub(r'\s*Excludes:.*', '', text, flags=re.DOTALL).strip()

def extract_differentia(text):
    """Strip DOLCE prefix, Encompasses, and Excludes — keep only core meaning."""
    # Remove "A [BDI] within [POV] discourse that "
    t = re.sub(r'^An?\s+(?:Belief|Desire|Intention)\s+within\s+\w+\s+discourse\s+that\s+', '', text, flags=re.IGNORECASE)
    # Remove Encompasses and Excludes
    t = re.sub(r'\s*Encompasses:.*', '', t, flags=re.DOTALL)
    t = re.sub(r'\s*Excludes:.*', '', t, flags=re.DOTALL)
    return t.strip().rstrip('.')

def get_adversarial_labels(node_id, max_targets=3):
    """Get labels of top adversarial targets for a node."""
    targets = adversarial_targets.get(node_id, [])
    # Count frequency per target
    target_counts = defaultdict(int)
    for etype, tid in targets:
        target_counts[tid] += 1
    # Sort by count, take top N
    sorted_targets = sorted(target_counts.items(), key=lambda x: -x[1])[:max_targets]
    return [node_labels.get(tid, tid) for tid, _ in sorted_targets]

# ── Build variant text constructors ──
def variant_A(node):
    """Current baseline: DOLCE description minus Excludes."""
    return strip_excludes(node['description'])

def variant_B(node):
    """Full description WITH Excludes."""
    return node['description']

def variant_C(node):
    """Plain differentia only."""
    return extract_differentia(node['description'])

def variant_D(node):
    """Label + differentia."""
    diff = extract_differentia(node['description'])
    label = node.get('label', '')
    return f"{label}. {diff}" if label else diff

def variant_G(node):
    """Label + differentia + adversarial edge targets."""
    diff = extract_differentia(node['description'])
    label = node.get('label', '')
    base = f"{label}. {diff}" if label else diff
    adv_labels = get_adversarial_labels(node['id'])
    if adv_labels:
        return f"{base}. Opposed by: {'; '.join(adv_labels)}"
    return base

VARIANTS = {
    'A': variant_A,
    'B': variant_B,
    'C': variant_C,
    'D': variant_D,
    'G': variant_G,
}

# ── Generate embeddings ──
print("\nLoading sentence-transformers model...")
t0 = time.time()
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
print(f"  Model loaded in {time.time()-t0:.1f}s")

results = {}

for variant_name, text_fn in VARIANTS.items():
    print(f"\n{'='*60}")
    print(f"VARIANT {variant_name}")
    print(f"{'='*60}")

    # Build embedding texts for all Belief nodes per POV
    pov_embeddings = {}  # pov -> {node_id: vector}
    for pov, nodes in pov_nodes.items():
        belief_nodes = [n for n in nodes if n.get('category') == 'Beliefs']
        texts = []
        ids = []
        for n in belief_nodes:
            text = text_fn(n)
            texts.append(text)
            ids.append(n['id'])

        if variant_name == 'A' and pov == 'accelerationist':
            print(f"  Sample text ({ids[0]}): {texts[0][:120]}...")

        # Generate embeddings
        vectors = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
        pov_embeddings[pov] = {nid: vec.tolist() for nid, vec in zip(ids, vectors)}
        print(f"  {pov}: embedded {len(texts)} Belief nodes")

    # Evaluate against golden set
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
        if not pov or pov not in pov_embeddings:
            continue

        claim_vec = claim_embeddings[cid]
        candidates = pov_embeddings[pov]

        if not candidates:
            continue

        # Compute similarities
        sims = []
        for nid, nvec in candidates.items():
            sim = cosine_similarity(claim_vec, nvec)
            sims.append((nid, sim))
        sims.sort(key=lambda x: -x[1])

        evaluated += 1
        best_id, best_sim = sims[0]
        top_similarities.append(best_sim)

        # Discriminability gap
        if len(sims) > 1:
            disc_gaps.append(sims[0][1] - sims[1][1])

        # Novel argument rate
        if best_sim < 0.35:
            novel_count += 1
            continue

        # Top-1 accuracy
        if best_id == expected_node:
            top1_correct += 1

        # Top-3 accuracy
        top3_ids = [s[0] for s in sims[:3]]
        if expected_node in top3_ids:
            top3_correct += 1

        # MRR
        rank = next((i + 1 for i, (nid, _) in enumerate(sims) if nid == expected_node), len(sims) + 1)
        reciprocal_ranks.append(1.0 / rank)

    # Compute metrics
    n = evaluated
    top1_acc = top1_correct / n * 100 if n else 0
    top3_acc = top3_correct / n * 100 if n else 0
    mrr = sum(reciprocal_ranks) / len(reciprocal_ranks) if reciprocal_ranks else 0
    mean_sim = sum(top_similarities) / len(top_similarities) if top_similarities else 0
    mean_gap = sum(disc_gaps) / len(disc_gaps) if disc_gaps else 0
    novel_rate = novel_count / n * 100 if n else 0

    print(f"\n  Results (n={n}):")
    print(f"    Top-1 accuracy:      {top1_acc:6.1f}%")
    print(f"    Top-3 accuracy:      {top3_acc:6.1f}%")
    print(f"    MRR:                 {mrr:6.4f}")
    print(f"    Mean similarity:     {mean_sim:6.4f}")
    print(f"    Discriminability gap: {mean_gap:6.4f}")
    print(f"    Novel argument rate: {novel_rate:6.1f}%")

    results[variant_name] = {
        'evaluated': n,
        'top1_accuracy': round(top1_acc, 2),
        'top3_accuracy': round(top3_acc, 2),
        'mrr': round(mrr, 4),
        'mean_similarity': round(mean_sim, 4),
        'discriminability_gap': round(mean_gap, 4),
        'novel_argument_rate': round(novel_rate, 2),
    }

# ── Summary comparison ──
print(f"\n{'='*80}")
print("ROUND 1 SUMMARY")
print(f"{'='*80}")
print(f"{'Variant':8s} {'Top-1':>7s} {'Top-3':>7s} {'MRR':>8s} {'Avg Sim':>8s} {'Gap':>8s} {'Novel%':>7s}")
print(f"{'='*8} {'='*7} {'='*7} {'='*8} {'='*8} {'='*8} {'='*7}")
for v in ['A', 'B', 'C', 'D', 'G']:
    r = results[v]
    print(f"{v:8s} {r['top1_accuracy']:6.1f}% {r['top3_accuracy']:6.1f}% {r['mrr']:8.4f} {r['mean_similarity']:8.4f} {r['discriminability_gap']:8.4f} {r['novel_argument_rate']:6.1f}%")

# Highlight best
best_mrr = max(results.items(), key=lambda x: x[1]['mrr'])
best_top1 = max(results.items(), key=lambda x: x[1]['top1_accuracy'])
print(f"\nBest MRR:   Variant {best_mrr[0]} ({best_mrr[1]['mrr']:.4f})")
print(f"Best Top-1: Variant {best_top1[0]} ({best_top1[1]['top1_accuracy']:.1f}%)")

# Save results
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to {OUTPUT_PATH}")
