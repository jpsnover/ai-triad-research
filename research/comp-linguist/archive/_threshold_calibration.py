"""
Threshold calibration sweep for exclusion enforcement guards.
t/452: Calibrate EXCLUSION_RATIO_THRESHOLD and SCOPE_BOUNDARY_THRESHOLD.
"""
import sys, json, glob, os, math
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
EMB_PATH = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin/embeddings.json'

def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# Load embeddings
with open(EMB_PATH, encoding='utf-8') as f:
    emb_data = json.load(f)
node_embeddings = emb_data.get('nodes', {})

# Load debates
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)

# ── Guard #1: Claim Exclusion Boundary ──
# For each AN node with embedding + taxonomy ref + exclusion_vector:
#   sim_main = cosine(node.embedding, ref.vector)
#   sim_excl = cosine(node.embedding, ref.exclusion_vector)
#   Violation if sim_excl > sim_main * threshold

EXCL_THRESHOLDS = [0.70, 0.75, 0.80, 0.85, 0.90, 0.95]

print("=" * 80)
print("GUARD #1: CLAIM EXCLUSION BOUNDARY — THRESHOLD SWEEP")
print("=" * 80)

all_claim_data = []
debate_count = 0

for fp in files[:20]:
    try:
        with open(fp, encoding='utf-8') as f:
            d = json.load(f)
    except Exception:
        continue

    an_nodes = d.get('argument_network', {}).get('nodes', [])
    statements = [e for e in d.get('transcript', []) if e.get('type') == 'statement']
    if len(statements) < 3:
        continue

    debate_count += 1
    debate_id = d.get('id', '')[:8]

    for node in an_nodes:
        if not node.get('embedding'):
            continue
        ref = (node.get('claim_taxonomy_attribution') or {}).get('primary_ref')
        if not ref:
            continue
        entry = node_embeddings.get(ref)
        if not entry or not entry.get('exclusion_vector'):
            continue

        sim_main = cosine_similarity(node['embedding'], entry['vector'])
        sim_excl = cosine_similarity(node['embedding'], entry['exclusion_vector'])

        all_claim_data.append({
            'debate': debate_id,
            'node_id': node['id'],
            'node_text': node.get('text', '')[:80],
            'speaker': node.get('speaker', ''),
            'ref': ref,
            'sim_main': sim_main,
            'sim_excl': sim_excl,
            'ratio': sim_excl / sim_main if sim_main > 0 else 0,
        })

print(f"\nDebates analyzed: {debate_count}")
print(f"AN nodes with embedding + taxonomy ref + exclusion_vector: {len(all_claim_data)}")

# Sweep thresholds
print(f"\n{'Threshold':>10s} {'Violations':>10s} {'Rate':>8s} {'Avg ratio':>10s}")
print(f"{'─'*10} {'─'*10} {'─'*8} {'─'*10}")

for t in EXCL_THRESHOLDS:
    violations = [c for c in all_claim_data if c['sim_excl'] > c['sim_main'] * t]
    rate = len(violations) / len(all_claim_data) * 100 if all_claim_data else 0
    avg_ratio = sum(v['ratio'] for v in violations) / len(violations) if violations else 0
    print(f"{t:>10.2f} {len(violations):>10d} {rate:>7.1f}% {avg_ratio:>10.3f}")

# Distribution of exclusion ratios
ratios = sorted([c['ratio'] for c in all_claim_data])
if ratios:
    print(f"\nRatio distribution (sim_excl / sim_main):")
    percentiles = [10, 25, 50, 75, 90, 95, 99]
    for p in percentiles:
        idx = min(int(len(ratios) * p / 100), len(ratios) - 1)
        print(f"  P{p:2d}: {ratios[idx]:.4f}")
    print(f"  Min: {ratios[0]:.4f}")
    print(f"  Max: {ratios[-1]:.4f}")
    print(f"  Mean: {sum(ratios)/len(ratios):.4f}")

# Show top 20 highest ratio claims (candidates for true violations)
print(f"\nTop 20 highest exclusion-ratio claims:")
print(f"{'Ratio':>6s} {'SimM':>6s} {'SimE':>6s} {'Speaker':>15s} {'Ref':>20s} {'Text'}")
print(f"{'─'*6} {'─'*6} {'─'*6} {'─'*15} {'─'*20} {'─'*50}")
by_ratio = sorted(all_claim_data, key=lambda x: x['ratio'], reverse=True)
for c in by_ratio[:20]:
    print(f"{c['ratio']:>6.3f} {c['sim_main']:>6.3f} {c['sim_excl']:>6.3f} {c['speaker']:>15s} {c['ref']:>20s} {c['node_text'][:50]}")

# ── Guard #2: Draft Scope Boundary ──
# For each statement, we need statement embedding.
# Check if statements have embeddings or if we need to compute them.
print(f"\n{'=' * 80}")
print("GUARD #2: DRAFT SCOPE BOUNDARY — DATA AVAILABILITY CHECK")
print(f"{'=' * 80}")

SCOPE_THRESHOLDS = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75]

# Check if AN nodes that correspond to statements have the data we need
# The draft scope guard checks draft embedding vs exclusion_vector of referenced taxonomy nodes
# We can approximate: use statement's AN nodes' embeddings as proxy for draft embedding
# Or check if statements themselves have embeddings

all_draft_data = []

for fp in files[:20]:
    try:
        with open(fp, encoding='utf-8') as f:
            d = json.load(f)
    except Exception:
        continue

    statements = [e for e in d.get('transcript', []) if e.get('type') == 'statement']
    if len(statements) < 3:
        continue

    an_nodes = d.get('argument_network', {}).get('nodes', [])
    debate_id = d.get('id', '')[:8]

    # Group AN nodes by speaker to find which taxonomy refs each speaker argues from
    speaker_refs = defaultdict(set)
    speaker_embeddings = defaultdict(list)
    for node in an_nodes:
        speaker = node.get('speaker', '')
        ref = (node.get('claim_taxonomy_attribution') or {}).get('primary_ref')
        if ref:
            speaker_refs[speaker].add(ref)
        if node.get('embedding'):
            speaker_embeddings[speaker].append(node['embedding'])

    # For each statement, use the average embedding of its speaker's AN nodes as proxy
    for i, s in enumerate(statements):
        speaker = s.get('speaker', '')
        if speaker not in speaker_embeddings or not speaker_embeddings[speaker]:
            continue

        # Average embedding as draft proxy
        embs = speaker_embeddings[speaker]
        dim = len(embs[0])
        avg_emb = [sum(e[d] for e in embs) / len(embs) for d in range(dim)]

        # Check against all taxonomy refs this speaker uses
        for ref in speaker_refs.get(speaker, []):
            entry = node_embeddings.get(ref)
            if not entry or not entry.get('exclusion_vector'):
                continue
            sim = cosine_similarity(avg_emb, entry['exclusion_vector'])
            all_draft_data.append({
                'debate': debate_id,
                'statement': i + 1,
                'speaker': speaker,
                'ref': ref,
                'similarity': sim,
            })

print(f"\nDraft-scope data points (speaker avg embedding vs exclusion_vector): {len(all_draft_data)}")

if all_draft_data:
    print(f"\n{'Threshold':>10s} {'Warnings':>10s} {'Rate':>8s}")
    print(f"{'─'*10} {'─'*10} {'─'*8}")
    for t in SCOPE_THRESHOLDS:
        warnings = [d for d in all_draft_data if d['similarity'] > t]
        rate = len(warnings) / len(all_draft_data) * 100
        print(f"{t:>10.2f} {len(warnings):>10d} {rate:>7.1f}%")

    sims = sorted([d['similarity'] for d in all_draft_data])
    print(f"\nSimilarity distribution (draft avg vs exclusion_vector):")
    for p in [10, 25, 50, 75, 90, 95, 99]:
        idx = min(int(len(sims) * p / 100), len(sims) - 1)
        print(f"  P{p:2d}: {sims[idx]:.4f}")
    print(f"  Min: {sims[0]:.4f}")
    print(f"  Max: {sims[-1]:.4f}")
    print(f"  Mean: {sum(sims)/len(sims):.4f}")
else:
    print("No draft-scope data available for calibration.")
