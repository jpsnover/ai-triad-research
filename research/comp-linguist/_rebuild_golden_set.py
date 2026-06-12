"""Rebuild golden test set with fresh taxonomy attribution.

Extracts all AN claim nodes from recent debates, re-embeds them
against the CURRENT taxonomy node embeddings, and computes fresh
attribution (primary + secondary refs). Also clears validation results.
"""
import sys, json, glob, os, math
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'
RESEARCH_DIR = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist'
OUTPUT_PATH = os.path.join(RESEARCH_DIR, '_golden_test_set.json')
VALIDATION_RESULTS_PATH = os.path.join(RESEARCH_DIR, '_golden_validation_results.json')
EMBEDDINGS_PATH = os.path.join(DATA_ROOT, 'embeddings.json')

TOP_N_DEBATES = 20
TOP_K_SECONDARY = 5

SPEAKER_POV = {
    'accelerationist': 'acc',
    'safetyist': 'saf',
    'skeptic': 'skp',
}


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# ── Load current taxonomy nodes ──
print("Loading taxonomy nodes...")
all_nodes = {}
for pov_file in ['accelerationist.json', 'safetyist.json', 'skeptic.json']:
    with open(os.path.join(DATA_ROOT, pov_file), encoding='utf-8') as f:
        data = json.load(f)
    for n in data.get('nodes', []):
        nid = n.get('id', '')
        all_nodes[nid] = {
            'id': nid,
            'description': n.get('description', ''),
            'label': n.get('label', ''),
            'category': n.get('category', ''),
        }
print(f"  {len(all_nodes)} taxonomy nodes loaded")

# ── Load current embeddings ──
print("Loading production embeddings...")
with open(EMBEDDINGS_PATH, encoding='utf-8') as f:
    emb_data = json.load(f)
emb_nodes = emb_data.get('nodes', {})

node_embeddings = {}
for nid, entry in emb_nodes.items():
    if nid in all_nodes:
        vec = entry.get('vector', [])
        if vec:
            node_embeddings[nid] = vec
print(f"  {len(node_embeddings)} nodes with embeddings")

# ── Extract claims from debates ──
print(f"\nExtracting claims from top {TOP_N_DEBATES} debates...")
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')),
               key=os.path.getmtime, reverse=True)

raw_claims = []
debates_processed = 0
debates_with_claims = 0

for fp in files[:TOP_N_DEBATES]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)

    debate_id = d.get('id', '')[:8]
    title = d.get('title', '')[:80]
    debates_processed += 1

    an_nodes = d.get('argument_network', {}).get('nodes', [])
    if not an_nodes:
        continue

    debate_claims = 0
    for n in an_nodes:
        claim_text = n.get('text', n.get('label', ''))
        speaker = n.get('speaker', '')
        if not claim_text or not speaker:
            continue
        if speaker not in SPEAKER_POV:
            continue

        raw_claims.append({
            'claim_text': claim_text,
            'claim_id': n.get('id', ''),
            'speaker': speaker,
            'debate_id': debate_id,
            'debate_title': title,
            'node_type': n.get('node_scope', n.get('type', '')),
            'turn_number': n.get('turn_number', None),
            'computed_strength': n.get('computed_strength', None),
            'canonical_proposition': n.get('canonical_proposition'),
        })
        debate_claims += 1

    if debate_claims > 0:
        debates_with_claims += 1
        print(f"  {debate_id}: {title[:50]} — {debate_claims} claims")

print(f"\nDebates processed: {debates_processed}")
print(f"Debates with claims: {debates_with_claims}")
print(f"Total raw claims: {len(raw_claims)}")

# ── Embed claims and compute attribution ──
print("\nLoading embedding model...")
from sentence_transformers import SentenceTransformer
st_model = SentenceTransformer('all-MiniLM-L6-v2')

claim_texts = [c['claim_text'] for c in raw_claims]
print(f"Embedding {len(claim_texts)} claims...")
claim_vecs = st_model.encode(claim_texts, normalize_embeddings=True, show_progress_bar=False)

print("Computing attribution against current taxonomy...")
golden_set = []
no_match = 0

for i, claim in enumerate(raw_claims):
    speaker_prefix = SPEAKER_POV[claim['speaker']]
    cv = list(claim_vecs[i])

    scored = []
    for nid, nvec in node_embeddings.items():
        if not nid.startswith(speaker_prefix):
            continue
        sim = cosine_similarity(cv, nvec)
        scored.append((nid, sim))

    scored.sort(key=lambda x: x[1], reverse=True)

    if not scored:
        no_match += 1
        continue

    primary_id, primary_sim = scored[0]
    secondary = [
        {'node_id': nid, 'similarity': round(sim, 4)}
        for nid, sim in scored[1:TOP_K_SECONDARY + 1]
    ]

    entry = {
        'claim_text': claim['claim_text'],
        'claim_id': claim['claim_id'],
        'speaker': claim['speaker'],
        'attributed_node': primary_id,
        'similarity_score': round(primary_sim, 4),
        'secondary_refs': secondary,
        'debate_id': claim['debate_id'],
        'debate_title': claim['debate_title'],
        'node_type': claim['node_type'],
        'turn_number': claim['turn_number'],
        'computed_strength': claim['computed_strength'],
    }
    golden_set.append(entry)

print(f"  Attributed: {len(golden_set)}")
print(f"  No matching nodes: {no_match}")

# ── Stats ──
speakers = defaultdict(int)
nodes_referenced = defaultdict(int)
for c in golden_set:
    speakers[c['speaker']] += 1
    nodes_referenced[c['attributed_node']] += 1

scores = [c['similarity_score'] for c in golden_set]
print(f"\nBy speaker: {dict(speakers)}")
print(f"Unique nodes referenced: {len(nodes_referenced)}")
print(f"Similarity: min={min(scores):.3f} max={max(scores):.3f} avg={sum(scores)/len(scores):.3f}")

brackets = [(0, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.85), (0.85, 1.0)]
print(f"\nSimilarity distribution:")
for lo, hi in brackets:
    count = sum(1 for s in scores if lo <= s < hi)
    pct = count / len(scores) * 100
    bar = '#' * int(pct / 2)
    print(f"  [{lo:.1f}, {hi:.1f}): {count:4d} ({pct:5.1f}%) {bar}")

# ── Save golden set ──
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump({
        'metadata': {
            'rebuilt': True,
            'debates_processed': debates_processed,
            'debates_with_claims': debates_with_claims,
            'total_claims': len(golden_set),
            'has_similarity_score': len(golden_set),
            'embedding_model': 'all-MiniLM-L6-v2',
            'taxonomy_nodes': len(all_nodes),
            'nodes_with_embeddings': len(node_embeddings),
        },
        'claims': golden_set,
    }, f, indent=2, ensure_ascii=False)
print(f"\nGolden set saved to {OUTPUT_PATH}")

# ── Clear validation results ──
with open(VALIDATION_RESULTS_PATH, 'w', encoding='utf-8') as f:
    json.dump([], f)
print(f"Validation results cleared: {VALIDATION_RESULTS_PATH}")
print("\nDone. Restart the taxonomy editor to pick up the new golden set.")
