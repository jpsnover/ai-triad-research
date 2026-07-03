"""H4: LLM Claim Abstraction experiment.

Uses Gemini Flash to extract core propositions from debate claims,
then re-embeds and evaluates against POV nodes.

Variants:
  H4a: Core proposition only
  H4b: Proposition + original claim (concatenated)
  H4c: Proposition + BDI tag
"""
import sys, json, glob, os, math, time, re
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
EMBEDDINGS_PATH = os.path.join(TAXONOMY_DIR, 'embeddings.json')
CACHE_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_h4_propositions_cache.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_h4_results.json'

SPEAKER_POV = {'accelerationist': 'accelerationist', 'safetyist': 'safetyist', 'skeptic': 'skeptic'}
POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}

ABSTRACTION_PROMPT = """Extract the core abstract proposition from this debate claim.
Strip: specific names, numbers, dates, citations, rhetorical devices, hedging, debate references, and examples.
Keep: the fundamental assertion about AI policy, safety, or governance.
Return ONLY the proposition in one sentence, no explanation.

Claim: {claim_text}"""

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
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    beliefs = [n for n in data.get('nodes', []) if n.get('category') == 'Beliefs']
    pov_nodes[pov] = beliefs
    print(f"  {pov}: {len(beliefs)} Belief nodes")

# ── Load production embeddings ──
print("Loading production embeddings...")
with open(EMBEDDINGS_PATH, encoding='utf-8') as f:
    emb_data = json.load(f)
emb_nodes = emb_data.get('nodes', {})
print(f"  {len(emb_nodes)} nodes")

pov_belief_ids = {}
for pov, nodes in pov_nodes.items():
    pov_belief_ids[pov] = [n['id'] for n in nodes]

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
                'bdi_category': n.get('bdi_category', ''),
            }
print(f"  {sum(1 for c in claims if c['claim_id'] in claim_data)}/{len(claims)} claims have data")

# ── Generate or load cached propositions ──
propositions = {}
if os.path.exists(CACHE_PATH):
    print(f"\nLoading cached propositions from {CACHE_PATH}...")
    with open(CACHE_PATH, encoding='utf-8') as f:
        propositions = json.load(f)
    print(f"  {len(propositions)} cached")

# Find claims needing abstraction
needs_abstraction = []
for c in claims:
    cid = c['claim_id']
    if cid not in propositions and cid in claim_data:
        needs_abstraction.append(cid)

if needs_abstraction:
    print(f"\nGenerating {len(needs_abstraction)} propositions via Gemini Flash...")

    import google.generativeai as genai
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("ERROR: GEMINI_API_KEY not set")
        sys.exit(1)
    genai.configure(api_key=api_key)
    model_llm = genai.GenerativeModel('gemini-2.5-flash')

    batch_size = 20
    for i in range(0, len(needs_abstraction), batch_size):
        batch = needs_abstraction[i:i+batch_size]
        for cid in batch:
            claim_text = claim_data[cid]['text']
            prompt = ABSTRACTION_PROMPT.format(claim_text=claim_text)
            try:
                response = model_llm.generate_content(
                    prompt,
                    generation_config=genai.types.GenerationConfig(temperature=0.0, max_output_tokens=150)
                )
                proposition = response.text.strip()
                propositions[cid] = proposition
            except Exception as e:
                print(f"  Error on {cid}: {e}")
                propositions[cid] = claim_data[cid]['text']  # fallback to original

        done = min(i + batch_size, len(needs_abstraction))
        print(f"  {done}/{len(needs_abstraction)} done")
        time.sleep(0.5)  # rate limiting

    # Cache results
    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(propositions, f, indent=2, ensure_ascii=False)
    print(f"  Cached to {CACHE_PATH}")

# ── Show samples ──
print(f"\nSample abstractions:")
samples = list(propositions.items())[:5]
for cid, prop in samples:
    original = claim_data.get(cid, {}).get('text', '')[:80]
    print(f"  Original:    {original}...")
    print(f"  Proposition: {prop[:80]}...")
    print()

# ── Load embedding model ──
print("Loading sentence-transformers model...")
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
print("  Loaded")

# ── Build claim variant texts ──
def build_variant_texts(variant):
    texts = []
    cids = []
    for c in claims:
        cid = c['claim_id']
        if cid not in claim_data or cid not in propositions:
            continue
        prop = propositions[cid]
        original = claim_data[cid]['text']
        bdi = claim_data[cid].get('bdi_category', '')

        if variant == 'baseline':
            texts.append(original)
        elif variant == 'h4a':
            texts.append(prop)
        elif variant == 'h4b':
            texts.append(f"{prop}. {original}")
        elif variant == 'h4c':
            bdi_prefix = {'Beliefs': 'Belief', 'Desires': 'Desire', 'Intentions': 'Intention',
                          'belief': 'Belief', 'desire': 'Desire', 'intention': 'Intention'}
            prefix = bdi_prefix.get(bdi, '')
            texts.append(f"{prefix}: {prop}" if prefix else prop)

        cids.append(cid)
    return cids, texts

# ── Evaluate function ──
def evaluate(claim_vecs, label):
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
            if nid not in emb_nodes:
                continue
            nvec = emb_nodes[nid].get('vector', [])
            if not nvec:
                continue
            sim = cosine_similarity(cv, nvec)
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

# ── Run all variants ──
VARIANTS = {
    'Baseline (raw claim)': 'baseline',
    'H4a: Core proposition': 'h4a',
    'H4b: Proposition + original': 'h4b',
    'H4c: Proposition + BDI tag': 'h4c',
}

results = {}
for label, variant in VARIANTS.items():
    print(f"\n{'='*60}")
    print(f"{label}")
    print(f"{'='*60}")

    cids, texts = build_variant_texts(variant)
    print(f"  {len(texts)} claims to embed")

    vectors = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    claim_vecs = {cid: vec.tolist() for cid, vec in zip(cids, vectors)}

    r = evaluate(claim_vecs, label)
    results[label] = r

    print(f"  Top-1: {r['top1_accuracy']:.1f}%  Top-3: {r['top3_accuracy']:.1f}%  MRR: {r['mrr']:.4f}")
    print(f"  Avg Sim: {r['mean_similarity']:.4f}  Gap: {r['discriminability_gap']:.4f}  Novel: {r['novel_argument_rate']:.1f}%")

# ── Summary ──
print(f"\n{'='*80}")
print("H4 SUMMARY: LLM Claim Abstraction")
print(f"{'='*80}")
print(f"{'Variant':<35s} {'Top-1':>7s} {'Top-3':>7s} {'MRR':>8s} {'Avg Sim':>8s} {'Gap':>8s} {'Novel%':>7s}")
print(f"{'='*35} {'='*7} {'='*7} {'='*8} {'='*8} {'='*8} {'='*7}")
for label, r in results.items():
    print(f"{label:<35s} {r['top1_accuracy']:6.1f}% {r['top3_accuracy']:6.1f}% {r['mrr']:8.4f} {r['mean_similarity']:8.4f} {r['discriminability_gap']:8.4f} {r['novel_argument_rate']:6.1f}%")

baseline = results['Baseline (raw claim)']
best = max(results.items(), key=lambda x: x[1]['mrr'])
print(f"\nBaseline MRR: {baseline['mrr']:.4f}")
print(f"Best:         {best[0]} — MRR: {best[1]['mrr']:.4f} (delta: {best[1]['mrr'] - baseline['mrr']:+.4f})")

# Compare to current production
print(f"\nComparison to current production (using pre-computed claim embeddings):")
print(f"  Production MRR:     0.1834  Top-1: 10.5%")
print(f"  Best H4 variant:    {best[1]['mrr']:.4f}  Top-1: {best[1]['top1_accuracy']:.1f}%")
print(f"  Delta:              {best[1]['mrr'] - 0.1834:+.4f}  Top-1: {best[1]['top1_accuracy'] - 10.5:+.1f}%")

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to {OUTPUT_PATH}")
