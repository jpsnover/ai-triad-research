"""Round 2: Evaluate claim embedding variants against best POV variant (B: with Excludes).

Claim variants:
  i:   Raw claim text (baseline — reuses Round 1 variant B results)
  ii:  Decontextualized — strip hedging, debate-specific references, filler
  iii: BDI-tagged — prepend "Belief: " / "Desire: " / "Intention: " based on bdi_category
  iv:  POV-prefixed — prepend "{speaker} argument: "
"""
import sys, json, glob, os, re, math, time
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

# ── Config ──
DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
ROUND1_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_round1_results.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_round2_results.json'

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

# ── Load taxonomy (variant B: full description WITH Excludes) ──
print("Loading taxonomy nodes (Variant B: with Excludes)...")
pov_nodes = {}
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    pov_nodes[pov] = [n for n in data.get('nodes', []) if n.get('category') == 'Beliefs']
    print(f"  {pov}: {len(pov_nodes[pov])} Belief nodes")

# ── Load golden set ──
print("Loading golden set...")
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']
print(f"  {len(claims)} claims")

# ── Load claim data from debate files (need text, embedding, bdi_category, speaker) ──
print("Loading claim data from debates...")
claim_data = {}  # claim_id -> {text, embedding, bdi_category, speaker}
debate_files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
for fp in debate_files[:20]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    for n in d.get('argument_network', {}).get('nodes', []):
        if n.get('embedding') and n.get('id'):
            claim_data[n['id']] = {
                'text': n.get('text', n.get('label', '')),
                'embedding': n['embedding'],
                'bdi_category': n.get('bdi_category', ''),
                'speaker': n.get('speaker', ''),
            }

claims_with_data = sum(1 for c in claims if c['claim_id'] in claim_data)
print(f"  {claims_with_data}/{len(claims)} claims have full data")

# ── Helper ──
def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# ── Claim text transformations ──
HEDGE_PATTERNS = re.compile(
    r'\b(?:perhaps|maybe|it could be argued that|one might say|'
    r'it seems|arguably|in some sense|to some extent|'
    r'I would suggest|it is worth noting|as I mentioned|'
    r'in this debate|the previous speaker|my opponent|'
    r'as we discussed|let me point out)\b',
    re.IGNORECASE
)
FILLER_PATTERNS = re.compile(
    r'\b(?:basically|essentially|actually|really|very|quite|'
    r'simply|just|clearly|obviously|of course|certainly|'
    r'indeed|naturally|frankly)\b',
    re.IGNORECASE
)

def decontextualize(text):
    """Strip hedging, debate-specific references, filler words."""
    t = HEDGE_PATTERNS.sub('', text)
    t = FILLER_PATTERNS.sub('', t)
    t = re.sub(r'\s{2,}', ' ', t).strip()
    return t

BDI_PREFIX = {
    'Beliefs': 'Belief: ',
    'Desires': 'Desire: ',
    'Intentions': 'Intention: ',
    'belief': 'Belief: ',
    'desire': 'Desire: ',
    'intention': 'Intention: ',
}

def bdi_tag(text, bdi_category):
    """Prepend BDI category tag."""
    prefix = BDI_PREFIX.get(bdi_category, '')
    return f"{prefix}{text}" if prefix else text

def pov_prefix(text, speaker):
    """Prepend speaker POV."""
    return f"{speaker} argument: {text}"

# ── Load model ──
print("\nLoading sentence-transformers model...")
t0 = time.time()
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
print(f"  Model loaded in {time.time()-t0:.1f}s")

# ── Generate POV embeddings (Variant B: full description) ──
print("\nGenerating POV embeddings (Variant B)...")
pov_embeddings = {}
for pov, nodes in pov_nodes.items():
    texts = [n['description'] for n in nodes]
    ids = [n['id'] for n in nodes]
    vectors = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    pov_embeddings[pov] = {nid: vec.tolist() for nid, vec in zip(ids, vectors)}
    print(f"  {pov}: {len(texts)} nodes embedded")

# ── Define claim variants ──
def build_claim_vectors(variant_name):
    """Generate claim embeddings for a given variant. Returns {claim_id: vector}."""
    texts = []
    cids = []
    for c in claims:
        cid = c['claim_id']
        if cid not in claim_data:
            continue
        cd = claim_data[cid]
        raw_text = cd['text']

        if variant_name == 'i':
            # Use original embeddings directly — no re-encoding needed
            return {cid: claim_data[cid]['embedding'] for cid in [c['claim_id'] for c in claims] if cid in claim_data}
        elif variant_name == 'ii':
            texts.append(decontextualize(raw_text))
        elif variant_name == 'iii':
            texts.append(bdi_tag(raw_text, cd['bdi_category']))
        elif variant_name == 'iv':
            texts.append(pov_prefix(raw_text, cd['speaker']))

        cids.append(cid)

    if not texts:
        return {}

    vectors = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    return {cid: vec.tolist() for cid, vec in zip(cids, vectors)}

# ── Evaluate function ──
def evaluate(claim_vectors, variant_label):
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

        if cid not in claim_vectors:
            continue
        pov = SPEAKER_POV.get(speaker)
        if not pov or pov not in pov_embeddings:
            continue

        claim_vec = claim_vectors[cid]
        candidates = pov_embeddings[pov]
        if not candidates:
            continue

        sims = [(nid, cosine_similarity(claim_vec, nvec)) for nid, nvec in candidates.items()]
        sims.sort(key=lambda x: -x[1])

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

# ── Run all claim variants ──
CLAIM_VARIANTS = {
    'B×i': ('i', 'Raw claim text (baseline)'),
    'B×ii': ('ii', 'Decontextualized'),
    'B×iii': ('iii', 'BDI-tagged'),
    'B×iv': ('iv', 'POV-prefixed'),
}

results = {}
for label, (variant, desc) in CLAIM_VARIANTS.items():
    print(f"\n{'='*60}")
    print(f"{label}: {desc}")
    print(f"{'='*60}")

    claim_vecs = build_claim_vectors(variant)
    print(f"  {len(claim_vecs)} claims embedded")

    if variant != 'i':
        # Show a sample
        sample_cid = list(claim_vecs.keys())[0]
        cd = claim_data[sample_cid]
        raw = cd['text'][:80]
        if variant == 'ii':
            transformed = decontextualize(cd['text'])[:80]
        elif variant == 'iii':
            transformed = bdi_tag(cd['text'], cd['bdi_category'])[:80]
        elif variant == 'iv':
            transformed = pov_prefix(cd['text'], cd['speaker'])[:80]
        print(f"  Sample raw:         {raw}...")
        print(f"  Sample transformed: {transformed}...")

    r = evaluate(claim_vecs, label)
    results[label] = r

    print(f"\n  Results (n={r['evaluated']}):")
    print(f"    Top-1 accuracy:      {r['top1_accuracy']:6.1f}%")
    print(f"    Top-3 accuracy:      {r['top3_accuracy']:6.1f}%")
    print(f"    MRR:                 {r['mrr']:6.4f}")
    print(f"    Mean similarity:     {r['mean_similarity']:6.4f}")
    print(f"    Discriminability gap: {r['discriminability_gap']:6.4f}")
    print(f"    Novel argument rate: {r['novel_argument_rate']:6.1f}%")

# ── Summary ──
print(f"\n{'='*80}")
print("ROUND 2 SUMMARY (POV Variant B: with Excludes)")
print(f"{'='*80}")
print(f"{'Combo':8s} {'Top-1':>7s} {'Top-3':>7s} {'MRR':>8s} {'Avg Sim':>8s} {'Gap':>8s} {'Novel%':>7s}")
print(f"{'='*8} {'='*7} {'='*7} {'='*8} {'='*8} {'='*8} {'='*7}")
for label in ['B×i', 'B×ii', 'B×iii', 'B×iv']:
    r = results[label]
    print(f"{label:8s} {r['top1_accuracy']:6.1f}% {r['top3_accuracy']:6.1f}% {r['mrr']:8.4f} {r['mean_similarity']:8.4f} {r['discriminability_gap']:8.4f} {r['novel_argument_rate']:6.1f}%")

best_mrr = max(results.items(), key=lambda x: x[1]['mrr'])
best_top1 = max(results.items(), key=lambda x: x[1]['top1_accuracy'])
print(f"\nBest MRR:   {best_mrr[0]} ({best_mrr[1]['mrr']:.4f})")
print(f"Best Top-1: {best_top1[0]} ({best_top1[1]['top1_accuracy']:.1f}%)")

# Also compare against Round 1 baseline (A×i)
with open(ROUND1_PATH, encoding='utf-8') as f:
    r1 = json.load(f)
print(f"\nComparison to Round 1 baseline (A×i):")
print(f"  A×i  MRR: {r1['A']['mrr']:.4f}  Top-1: {r1['A']['top1_accuracy']:.1f}%")
print(f"  Best MRR: {best_mrr[1]['mrr']:.4f}  Top-1: {best_top1[1]['top1_accuracy']:.1f}%")
delta_mrr = best_mrr[1]['mrr'] - r1['A']['mrr']
delta_top1 = best_top1[1]['top1_accuracy'] - r1['A']['top1_accuracy']
print(f"  Delta MRR: {delta_mrr:+.4f}  Delta Top-1: {delta_top1:+.1f}%")

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to {OUTPUT_PATH}")
