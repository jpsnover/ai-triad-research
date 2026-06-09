"""t/536 Phase 1: Evaluate canonical_proposition effect on MRR.

Generates canonical_proposition for existing golden set claims,
embeds with all-MiniLM-L6-v2, and re-computes MRR against taxonomy nodes.

Variants:
  A: Baseline — raw claim_text (existing)
  B: canonical_proposition only
  C: Blended — weighted average of claim_text and canonical_proposition embeddings
"""
import sys, json, os, math, time, re
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'
EMBEDDINGS_PATH = os.path.join(TAXONOMY_DIR, 'embeddings.json')
CACHE_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_canonical_prop_cache.json'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_canonical_prop_results.json'

SPEAKER_POV = {'accelerationist': 'accelerationist', 'safetyist': 'safetyist', 'skeptic': 'skeptic'}
POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}

BDI_FROM_NODE_ID = {
    'beliefs': 'belief',
    'desires': 'desire',
    'intentions': 'intention',
}


def infer_bdi(node_id: str) -> str:
    for key, val in BDI_FROM_NODE_ID.items():
        if key in node_id:
            return val
    return 'belief'


CANONICAL_PROMPT = """Rewrite this debate claim as a canonical proposition for taxonomy matching.

Rules:
- One sentence, maximum 30 words
- Strip ALL debate rhetoric, hedging, informal language, speaker references
- Match modal register to BDI type:
  {bdi_instruction}
- Use controlled vocabulary terms where applicable
- State the core proposition directly

BDI type: {bdi_category}
Claim: {claim_text}

Return ONLY the canonical proposition, nothing else."""

BDI_INSTRUCTIONS = {
    'belief': 'Beliefs: indicative assertion ("X is/causes Y")',
    'desire': 'Desires: deontic frame ("X ought to be the case" / "It is necessary that X")',
    'intention': 'Intentions: instrumental frame ("Achieve X by means of Y")',
}


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def blend_vectors(v1, v2, w1=0.5, w2=0.5):
    blended = [w1 * a + w2 * b for a, b in zip(v1, v2)]
    norm = math.sqrt(sum(x * x for x in blended))
    if norm == 0:
        return blended
    return [x / norm for x in blended]


print("Loading taxonomy nodes...")
all_nodes = {}
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        data = json.load(f)
    for n in data.get('nodes', []):
        nid = n.get('id', '')
        all_nodes[nid] = {
            'id': nid,
            'description': n.get('description', ''),
            'pov': pov,
            'category': n.get('category', ''),
        }
print(f"  Total nodes: {len(all_nodes)}")

print("Loading production embeddings...")
with open(EMBEDDINGS_PATH, encoding='utf-8') as f:
    emb_data = json.load(f)

node_embeddings = {}
emb_nodes = emb_data.get('nodes', {})
for nid, entry in emb_nodes.items():
    vec = entry.get('vector', [])
    if nid in all_nodes and vec:
        node_embeddings[nid] = vec
print(f"  Nodes with embeddings: {len(node_embeddings)}")

print("Loading golden test set...")
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']
print(f"  Claims: {len(claims)}")

# Load or initialize cache
if os.path.exists(CACHE_PATH):
    with open(CACHE_PATH, encoding='utf-8') as f:
        cache = json.load(f)
    print(f"  Cache: {len(cache)} propositions cached")
else:
    cache = {}

# ── Generate canonical propositions ──
claims_needing_props = [c for c in claims if c['claim_text'] not in cache]
if claims_needing_props:
    print(f"\nGenerating canonical propositions for {len(claims_needing_props)} claims...")
    import google.generativeai as genai
    genai.configure(api_key=os.environ.get('GEMINI_API_KEY', os.environ.get('AI_API_KEY', '')))
    model = genai.GenerativeModel('gemini-2.5-flash')

    for i, claim in enumerate(claims_needing_props):
        bdi = infer_bdi(claim['attributed_node'])
        prompt = CANONICAL_PROMPT.format(
            bdi_instruction=BDI_INSTRUCTIONS[bdi],
            bdi_category=bdi,
            claim_text=claim['claim_text'],
        )
        try:
            response = model.generate_content(prompt)
            prop = response.text.strip().strip('"').strip("'")
            cache[claim['claim_text']] = {'proposition': prop, 'bdi': bdi}
            if (i + 1) % 25 == 0:
                print(f"  {i+1}/{len(claims_needing_props)} done")
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(cache, f, indent=2)
        except Exception as e:
            print(f"  ERROR on claim {i}: {e}")
            cache[claim['claim_text']] = {'proposition': claim['claim_text'], 'bdi': bdi}
        time.sleep(0.2)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2)
    print(f"  All propositions generated and cached.")
else:
    print("  All propositions already cached.")

# ── Embed claims ──
print("\nLoading embedding model...")
from sentence_transformers import SentenceTransformer
st_model = SentenceTransformer('all-MiniLM-L6-v2')

raw_texts = [c['claim_text'] for c in claims]
prop_texts = [cache.get(c['claim_text'], {}).get('proposition', c['claim_text']) for c in claims]

print("Embedding raw claims...")
raw_vecs = st_model.encode(raw_texts, normalize_embeddings=True, show_progress_bar=False)

print("Embedding canonical propositions...")
prop_vecs = st_model.encode(prop_texts, normalize_embeddings=True, show_progress_bar=False)


def evaluate(claim_vecs, label, blend_weight=None, raw_vecs_for_blend=None):
    """Compute MRR, Top-1, Top-5 for claim vectors against taxonomy node embeddings."""
    reciprocal_ranks = []
    top1_hits = 0
    top5_hits = 0

    for i, claim in enumerate(claims):
        pov = SPEAKER_POV.get(claim['speaker'])
        if not pov:
            continue

        target_node = claim['attributed_node']
        if target_node not in node_embeddings:
            continue

        if blend_weight is not None and raw_vecs_for_blend is not None:
            cv = blend_vectors(
                list(raw_vecs_for_blend[i]),
                list(claim_vecs[i]),
                w1=1 - blend_weight,
                w2=blend_weight,
            )
        else:
            cv = list(claim_vecs[i])

        scored = []
        for nid, nvec in node_embeddings.items():
            if not nid.startswith(pov[:3]):
                continue
            sim = cosine_similarity(cv, nvec)
            scored.append((nid, sim))

        scored.sort(key=lambda x: x[1], reverse=True)

        rank = None
        for j, (nid, _) in enumerate(scored):
            if nid == target_node:
                rank = j + 1
                break

        if rank is not None:
            reciprocal_ranks.append(1.0 / rank)
            if rank == 1:
                top1_hits += 1
            if rank <= 5:
                top5_hits += 1
        else:
            reciprocal_ranks.append(0.0)

    n = len(reciprocal_ranks)
    mrr = sum(reciprocal_ranks) / n if n > 0 else 0
    top1 = top1_hits / n if n > 0 else 0
    top5 = top5_hits / n if n > 0 else 0

    print(f"\n  [{label}] n={n}")
    print(f"    MRR:   {mrr:.4f}")
    print(f"    Top-1: {top1:.4f} ({top1_hits}/{n})")
    print(f"    Top-5: {top5:.4f} ({top5_hits}/{n})")

    return {'label': label, 'mrr': mrr, 'top1': top1, 'top5': top5, 'count': n}


# ── Run evaluations ──
print("\n" + "=" * 60)
print("EVALUATION RESULTS")
print("=" * 60)

results = []

results.append(evaluate(raw_vecs, "A: raw claim_text (baseline)"))
results.append(evaluate(prop_vecs, "B: canonical_proposition"))

for w in [0.3, 0.5, 0.7]:
    results.append(evaluate(
        prop_vecs,
        f"C: blended (canon_weight={w})",
        blend_weight=w,
        raw_vecs_for_blend=raw_vecs,
    ))

# ── Summary ──
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
baseline_mrr = results[0]['mrr']
for r in results:
    delta = r['mrr'] - baseline_mrr
    delta_pct = (delta / baseline_mrr * 100) if baseline_mrr > 0 else 0
    print(f"  {r['label']}: MRR={r['mrr']:.4f} (delta={delta:+.4f}, {delta_pct:+.1f}%)")

# ── Canonical proposition quality stats ──
print("\n" + "=" * 60)
print("CANONICAL PROPOSITION QUALITY")
print("=" * 60)
word_counts = []
for c in claims:
    prop = cache.get(c['claim_text'], {}).get('proposition', '')
    if prop:
        word_counts.append(len(prop.split()))

if word_counts:
    within_limit = sum(1 for wc in word_counts if wc <= 30)
    print(f"  Total propositions: {len(word_counts)}")
    print(f"  Mean word count: {sum(word_counts)/len(word_counts):.1f}")
    print(f"  Max word count: {max(word_counts)}")
    print(f"  Within 30-word limit: {within_limit}/{len(word_counts)} ({within_limit/len(word_counts)*100:.1f}%)")

# ── Save results ──
output = {
    'experiment': 't/536 Phase 1',
    'date': time.strftime('%Y-%m-%d'),
    'golden_set_size': len(claims),
    'results': results,
    'quality': {
        'mean_word_count': sum(word_counts) / len(word_counts) if word_counts else 0,
        'max_word_count': max(word_counts) if word_counts else 0,
        'within_30_words_pct': within_limit / len(word_counts) * 100 if word_counts else 0,
    },
}
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2)
print(f"\nResults saved to: {OUTPUT_PATH}")
