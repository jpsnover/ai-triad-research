"""Phase 1: Build golden test set for embedding experiment (t/507).

Extract all claims with taxonomy attributions from recent debates.
Output: JSON file with (claim_text, attributed_node, similarity_score, speaker, debate_id).
"""
import sys, json, glob, os
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

DEBATE_DIR = 'C:/Users/jsnov/repos/ai-triad-data/debates'
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_golden_test_set.json'

files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)

golden_set = []
debates_processed = 0
debates_with_claims = 0

for fp in files[:20]:
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
        attr = n.get('claim_taxonomy_attribution', {})
        if not attr or not attr.get('primary_ref'):
            continue

        claim_text = n.get('text', n.get('label', ''))
        if not claim_text:
            continue

        entry = {
            'claim_text': claim_text,
            'claim_id': n.get('id', ''),
            'speaker': n.get('speaker', ''),
            'attributed_node': attr['primary_ref'],
            'similarity_score': attr.get('attribution_confidence', attr.get('similarity', attr.get('confidence', None))),
            'secondary_refs': attr.get('secondary_refs', []),
            'debate_id': debate_id,
            'debate_title': title,
            'node_type': n.get('node_scope', n.get('type', '')),
            'turn_number': n.get('turn_number', None),
            'computed_strength': n.get('computed_strength', None),
        }
        golden_set.append(entry)
        debate_claims += 1

    if debate_claims > 0:
        debates_with_claims += 1
        print(f"  {debate_id}: {title[:50]} — {debate_claims} claims")

print(f"\nDebates processed: {debates_processed}")
print(f"Debates with attributed claims: {debates_with_claims}")
print(f"Total claims in golden set: {len(golden_set)}")

# Stats
speakers = defaultdict(int)
nodes_referenced = defaultdict(int)
has_similarity = 0
no_similarity = 0
for c in golden_set:
    speakers[c['speaker']] += 1
    nodes_referenced[c['attributed_node']] += 1
    if c['similarity_score'] is not None:
        has_similarity += 1
    else:
        no_similarity += 1

print(f"\nBy speaker: {dict(speakers)}")
print(f"Unique nodes referenced: {len(nodes_referenced)}")
print(f"Claims with similarity score: {has_similarity}")
print(f"Claims without similarity score: {no_similarity}")

if has_similarity > 0:
    scores = [c['similarity_score'] for c in golden_set if c['similarity_score'] is not None]
    print(f"Similarity scores: min={min(scores):.3f} max={max(scores):.3f} avg={sum(scores)/len(scores):.3f}")

    # Distribution
    brackets = [(0, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.85), (0.85, 1.0)]
    print(f"\nSimilarity distribution:")
    for lo, hi in brackets:
        count = sum(1 for s in scores if lo <= s < hi)
        pct = count / len(scores) * 100
        bar = '#' * int(pct / 2)
        print(f"  [{lo:.1f}, {hi:.1f}): {count:4d} ({pct:5.1f}%) {bar}")

# Save
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump({
        'metadata': {
            'debates_processed': debates_processed,
            'debates_with_claims': debates_with_claims,
            'total_claims': len(golden_set),
            'has_similarity_score': has_similarity,
        },
        'claims': golden_set,
    }, f, indent=2, ensure_ascii=False)

print(f"\nGolden set saved to {OUTPUT_PATH}")
