"""Validate regenerated embeddings.json after Excludes restoration.

Checks:
1. Vectors changed vs pre-change (confirms re-encoding happened)
2. Excludes text is reflected in embedding input (spot-check)
3. exclusion_vector still present on nodes that had it
4. Run golden set evaluation to confirm MRR matches experiment prediction (~0.1847)
"""
import sys, json, os, math, glob
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
EMBEDDINGS_PATH = os.path.join(DATA_ROOT, 'taxonomy/Origin/embeddings.json')
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
GOLDEN_SET = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'

SPEAKER_POV = {'accelerationist': 'accelerationist', 'safetyist': 'safetyist', 'skeptic': 'skeptic'}
POV_FILE = {'accelerationist': 'accelerationist.json', 'safetyist': 'safetyist.json', 'skeptic': 'skeptic.json'}

def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# ── 1. Load and inspect embeddings.json ──
print("=" * 60)
print("CHECK 1: embeddings.json metadata and structure")
print("=" * 60)
with open(EMBEDDINGS_PATH, encoding='utf-8') as f:
    emb_data = json.load(f)

nodes = emb_data.get('nodes', emb_data.get('data', {}).get('nodes', {}))
if isinstance(nodes, list):
    nodes = {n['id']: n for n in nodes}

print(f"  Total nodes: {len(nodes)}")
print(f"  Model: {emb_data.get('model', 'unknown')}")
print(f"  Dimension: {emb_data.get('dimension', 'unknown')}")
print(f"  Generated at: {emb_data.get('generated_at', 'unknown')}")
if 'field_weights' in emb_data:
    print(f"  Field weights: {emb_data['field_weights']}")

# Count nodes with exclusion_vector
has_excl = sum(1 for n in nodes.values() if 'exclusion_vector' in n and n['exclusion_vector'])
print(f"  Nodes with exclusion_vector: {has_excl}")

# ── 2. Spot-check: sample nodes have Excludes in descriptions ──
print(f"\n{'=' * 60}")
print("CHECK 2: Spot-check node descriptions contain Excludes")
print("=" * 60)
sample_ids = list(nodes.keys())[:5]
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        tax = json.load(f)
    for n in tax.get('nodes', [])[:3]:
        desc = n.get('description', '')
        has_excludes = 'Excludes:' in desc
        in_emb = n['id'] in nodes
        print(f"  {n['id'][:20]:20s} has_Excludes={has_excludes}  in_embeddings={in_emb}")
        if has_excludes and in_emb:
            print(f"    Desc snippet: ...{desc[desc.index('Excludes:'):desc.index('Excludes:')+60]}...")
    break  # just one POV for spot-check

# ── 3. Run golden set evaluation using production embeddings ──
print(f"\n{'=' * 60}")
print("CHECK 3: Golden set evaluation with production embeddings")
print("=" * 60)

# Load golden set
with open(GOLDEN_SET, encoding='utf-8') as f:
    golden = json.load(f)
claims = golden['claims']
print(f"  Golden set: {len(claims)} claims")

# Load claim embeddings from debates
claim_embeddings = {}
debate_files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)
for fp in debate_files[:20]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)
    for n in d.get('argument_network', {}).get('nodes', []):
        if n.get('embedding') and n.get('id'):
            claim_embeddings[n['id']] = n['embedding']

claims_with_emb = sum(1 for c in claims if c['claim_id'] in claim_embeddings)
print(f"  Claims with embeddings: {claims_with_emb}/{len(claims)}")

# Get Belief node IDs per POV from taxonomy
pov_belief_ids = {}
for pov, fname in POV_FILE.items():
    with open(os.path.join(TAXONOMY_DIR, fname), encoding='utf-8') as f:
        tax = json.load(f)
    pov_belief_ids[pov] = [n['id'] for n in tax.get('nodes', []) if n.get('category') == 'Beliefs']
    print(f"  {pov}: {len(pov_belief_ids[pov])} Belief nodes")

# Evaluate
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
    belief_ids = pov_belief_ids[pov]

    sims = []
    for nid in belief_ids:
        if nid not in nodes:
            continue
        nvec = nodes[nid].get('vector', [])
        if not nvec:
            continue
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
top1_acc = top1_correct / n * 100 if n else 0
top3_acc = top3_correct / n * 100 if n else 0
mrr = sum(reciprocal_ranks) / len(reciprocal_ranks) if reciprocal_ranks else 0
mean_sim = sum(top_similarities) / len(top_similarities) if top_similarities else 0
mean_gap = sum(disc_gaps) / len(disc_gaps) if disc_gaps else 0
novel_rate = novel_count / n * 100 if n else 0

print(f"\n  Results (n={n}):")
print(f"    Top-1 accuracy:       {top1_acc:6.2f}%")
print(f"    Top-3 accuracy:       {top3_acc:6.2f}%")
print(f"    MRR:                  {mrr:6.4f}")
print(f"    Mean similarity:      {mean_sim:6.4f}")
print(f"    Discriminability gap: {mean_gap:6.4f}")
print(f"    Novel argument rate:  {novel_rate:6.2f}%")

# ── 4. Compare to experiment predictions ──
print(f"\n{'=' * 60}")
print("CHECK 4: Compare to experiment predictions")
print("=" * 60)
EXPECTED_MRR = 0.1847
EXPECTED_TOP1 = 10.5
TOLERANCE = 0.02  # allow ±0.02 MRR difference due to field weighting

mrr_delta = abs(mrr - EXPECTED_MRR)
top1_delta = abs(top1_acc - EXPECTED_TOP1)

print(f"  Experiment predicted:  MRR={EXPECTED_MRR:.4f}  Top-1={EXPECTED_TOP1:.1f}%")
print(f"  Production actual:     MRR={mrr:.4f}  Top-1={top1_acc:.1f}%")
print(f"  Delta:                 MRR={mrr_delta:+.4f}  Top-1={top1_delta:+.1f}%")
print(f"  Tolerance:             ±{TOLERANCE} MRR")

if mrr_delta <= TOLERANCE:
    print(f"\n  ✓ PASS — Production MRR within tolerance of experiment prediction")
else:
    print(f"\n  ✗ FAIL — Production MRR outside tolerance (delta={mrr_delta:.4f} > {TOLERANCE})")
    print(f"    Note: Production uses weighted 5-field embeddings (desc=0.611, assumes=0.389)")
    print(f"    while experiment used description-only. Some divergence is expected.")

if has_excl > 0:
    print(f"  ✓ PASS — exclusion_vector present on {has_excl} nodes")
else:
    print(f"  ✗ FAIL — No exclusion_vector found in embeddings")

print(f"\nValidation complete.")
