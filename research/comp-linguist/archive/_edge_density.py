"""Analyze cross-POV edge density for counter-weight experiment feasibility.

For recent debates, check: do the taxonomy nodes selected for injection have
enough cross-POV adversarial edges to supply meaningful counter-weights?
"""
import sys, json, glob, os
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data'
DEBATE_DIR = os.path.join(DATA_ROOT, 'debates')
TAXONOMY_DIR = os.path.join(DATA_ROOT, 'taxonomy/Origin')

# Load taxonomy edges
with open(os.path.join(TAXONOMY_DIR, 'edges.json'), encoding='utf-8') as f:
    edges_data = json.load(f)

# edges.json may be a list or have a 'edges' key
if isinstance(edges_data, dict):
    all_edges = edges_data.get('edges', [])
elif isinstance(edges_data, list):
    all_edges = edges_data
else:
    all_edges = []

print(f"Total taxonomy edges: {len(all_edges)}")

# Categorize edge types
ADVERSARIAL_TYPES = {'CONTRADICTS', 'WEAKENS', 'TENSION_WITH'}
RESPONSIVE_TYPES = {'RESPONDS_TO', 'ASSUMES'}
SUPPORTIVE_TYPES = {'SUPPORTS', 'CONVERGES_WITH', 'INTERPRETS'}

edge_type_counts = defaultdict(int)
for e in all_edges:
    edge_type_counts[e.get('type', 'unknown')] += 1

print(f"\nEdge type distribution:")
for t, c in sorted(edge_type_counts.items(), key=lambda x: -x[1]):
    category = 'adversarial' if t in ADVERSARIAL_TYPES else 'responsive' if t in RESPONSIVE_TYPES else 'supportive' if t in SUPPORTIVE_TYPES else 'other'
    print(f"  {t:20s}: {c:4d}  ({category})")

# POV prefixes
def get_pov(node_id):
    if node_id.startswith('acc-'): return 'acc'
    if node_id.startswith('saf-'): return 'saf'
    if node_id.startswith('skp-'): return 'skp'
    if node_id.startswith('cc-'): return 'cc'
    if node_id.startswith('pol-'): return 'pol'
    if node_id.startswith('sit-'): return 'sit'
    return 'other'

# Build cross-POV adversarial edge index: node_id -> [(edge_type, opposing_node_id)]
cross_pov_adversarial = defaultdict(list)
cross_pov_all = defaultdict(list)

for e in all_edges:
    src = e.get('source', '')
    tgt = e.get('target', '')
    etype = e.get('type', '')
    src_pov = get_pov(src)
    tgt_pov = get_pov(tgt)

    if src_pov != tgt_pov and src_pov not in ('pol', 'sit', 'other') and tgt_pov not in ('pol', 'sit', 'other'):
        cross_pov_all[src].append((etype, tgt))
        cross_pov_all[tgt].append((etype, src))
        if etype in ADVERSARIAL_TYPES:
            cross_pov_adversarial[src].append((etype, tgt))
            cross_pov_adversarial[tgt].append((etype, src))

print(f"\nCross-POV edge summary:")
print(f"  Nodes with any cross-POV edge: {len(cross_pov_all)}")
print(f"  Nodes with adversarial cross-POV edge: {len(cross_pov_adversarial)}")

# Now check recent debates
files = sorted(glob.glob(os.path.join(DEBATE_DIR, 'debate-*.json')), key=os.path.getmtime, reverse=True)

print(f"\n{'='*80}")
print("CROSS-POV EDGE COVERAGE IN RECENT DEBATES")
print(f"{'='*80}")

for fp in files[:5]:
    with open(fp, encoding='utf-8') as f:
        d = json.load(f)

    title = d.get('title', '')[:60]
    debate_id = d.get('id', '')[:8]

    # Get taxonomy refs used in this debate (from AN nodes)
    an_nodes = d.get('argument_network', {}).get('nodes', [])
    refs_by_speaker = defaultdict(set)
    all_refs = set()
    for n in an_nodes:
        attr = n.get('claim_taxonomy_attribution', {})
        speaker = n.get('speaker', 'unknown')
        if attr and attr.get('primary_ref'):
            ref = attr['primary_ref']
            refs_by_speaker[speaker].add(ref)
            all_refs.add(ref)

    # Also check taxonomy_refs from transcript entries
    for entry in d.get('transcript', []):
        if entry.get('taxonomy_refs'):
            speaker = entry.get('speaker', 'unknown')
            for tr in entry['taxonomy_refs']:
                nid = tr.get('node_id', '')
                if nid:
                    refs_by_speaker[speaker].add(nid)
                    all_refs.add(nid)

    print(f"\n--- {debate_id}: {title} ---")
    print(f"  Total unique refs: {len(all_refs)}")

    # For each speaker, how many of their refs have cross-POV adversarial edges?
    for speaker in ['accelerationist', 'safetyist', 'skeptic']:
        refs = refs_by_speaker.get(speaker, set())
        if not refs:
            continue

        with_adversarial = 0
        with_any_cross = 0
        total_adversarial_edges = 0
        adversarial_targets_by_pov = defaultdict(int)

        for ref in refs:
            adv = cross_pov_adversarial.get(ref, [])
            any_cross = cross_pov_all.get(ref, [])
            if adv:
                with_adversarial += 1
                total_adversarial_edges += len(adv)
                for etype, tgt in adv:
                    adversarial_targets_by_pov[get_pov(tgt)] += 1
            if any_cross:
                with_any_cross += 1

        pov_prefix = get_pov(list(refs)[0]) if refs else '?'
        adv_pct = with_adversarial / len(refs) * 100 if refs else 0
        cross_pct = with_any_cross / len(refs) * 100 if refs else 0

        print(f"  {speaker:15s}: {len(refs):2d} refs | {with_adversarial:2d} with adversarial edges ({adv_pct:.0f}%) | {with_any_cross:2d} with any cross-POV ({cross_pct:.0f}%) | {total_adversarial_edges} adversarial edges total")
        if adversarial_targets_by_pov:
            targets = ', '.join(f"{pov}:{c}" for pov, c in sorted(adversarial_targets_by_pov.items()))
            print(f"                   adversarial targets: {targets}")

# Overall coverage stats
print(f"\n{'='*80}")
print("OVERALL TAXONOMY CROSS-POV ADVERSARIAL COVERAGE")
print(f"{'='*80}")

# Count by POV
pov_nodes = defaultdict(int)
pov_with_adversarial = defaultdict(int)

# Load all POV node lists
for pov_file in ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'cross-cutting.json']:
    fpath = os.path.join(TAXONOMY_DIR, pov_file)
    if not os.path.exists(fpath):
        continue
    with open(fpath, encoding='utf-8') as f:
        pov_data = json.load(f)
    nodes = pov_data.get('nodes', [])
    for n in nodes:
        nid = n.get('id', '')
        pov = get_pov(nid)
        pov_nodes[pov] += 1
        if nid in cross_pov_adversarial:
            pov_with_adversarial[pov] += 1

print(f"\n{'POV':6s} {'Total':>6s} {'w/ Adv Edge':>12s} {'Coverage':>9s}")
print(f"{'='*6} {'='*6} {'='*12} {'='*9}")
for pov in ['acc', 'saf', 'skp', 'cc']:
    total = pov_nodes.get(pov, 0)
    with_adv = pov_with_adversarial.get(pov, 0)
    pct = with_adv / total * 100 if total else 0
    print(f"{pov:6s} {total:6d} {with_adv:12d} {pct:8.1f}%")
