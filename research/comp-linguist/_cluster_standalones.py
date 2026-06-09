"""t/528: Cluster 136 standalone situation nodes to propose parent assignments.

Uses embedding cosine similarity against root category centroids (computed
from each root + its existing children). Outputs ranked proposals for review.
Also analyzes sit-154 for potential split and sit-156/sit-157 for merge.
"""
import json, sys, math, os
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8')

DATA_ROOT = 'C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin'
SITUATIONS_PATH = os.path.join(DATA_ROOT, 'situations.json')
EMBEDDINGS_PATH = os.path.join(DATA_ROOT, 'embeddings.json')
OUTPUT_PATH = 'C:/Users/jsnov/repos/ai-triad-research/research/comp-linguist/_t528_cluster_proposals.json'


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def normalize(v):
    norm = math.sqrt(sum(x * x for x in v))
    if norm == 0:
        return v
    return [x / norm for x in v]


def centroid(vectors):
    if not vectors:
        return None
    dim = len(vectors[0])
    avg = [sum(v[i] for v in vectors) / len(vectors) for i in range(dim)]
    return normalize(avg)


print("Loading situations...")
with open(SITUATIONS_PATH, encoding='utf-8') as f:
    sit_data = json.load(f)
nodes = sit_data['nodes']
node_map = {n['id']: n for n in nodes}

print("Loading embeddings...")
with open(EMBEDDINGS_PATH, encoding='utf-8') as f:
    emb_data = json.load(f)
emb_nodes = emb_data['nodes']

sit_embeddings = {}
for nid, entry in emb_nodes.items():
    if nid.startswith(('sit-', 'cc-')):
        vec = entry.get('vector', [])
        if vec:
            sit_embeddings[nid] = vec

print(f"  {len(nodes)} situation nodes, {len(sit_embeddings)} with embeddings")

# Build hierarchy maps
all_parent_ids = set()
children_of = defaultdict(list)
for n in nodes:
    pid = n.get('parent_id')
    if pid:
        all_parent_ids.add(pid)
        children_of[pid].append(n['id'])

roots = [n for n in nodes if n['id'] in all_parent_ids and not n.get('parent_id')]
standalones = [n for n in nodes if not n.get('parent_id') and n['id'] not in all_parent_ids]

print(f"  {len(roots)} root categories, {len(standalones)} standalones")

# Compute root centroids (root embedding + children embeddings)
root_centroids = {}
for root in roots:
    rid = root['id']
    vecs = []
    if rid in sit_embeddings:
        vecs.append(sit_embeddings[rid])
    for cid in children_of[rid]:
        if cid in sit_embeddings:
            vecs.append(sit_embeddings[cid])
        # Include grandchildren
        for gcid in children_of.get(cid, []):
            if gcid in sit_embeddings:
                vecs.append(sit_embeddings[gcid])
    if vecs:
        root_centroids[rid] = centroid(vecs)
        print(f"  {rid} ({root['label'][:40]}): centroid from {len(vecs)} vectors")

# Cluster standalones
print(f"\nClustering {len(standalones)} standalones against {len(root_centroids)} root centroids...")

proposals = []
cluster_counts = Counter()

for node in standalones:
    nid = node['id']
    if nid not in sit_embeddings:
        proposals.append({
            'node_id': nid,
            'label': node.get('label', ''),
            'proposed_parent': None,
            'reason': 'No embedding available',
            'scores': {},
        })
        continue

    vec = sit_embeddings[nid]
    scores = {}
    for rid, cvec in root_centroids.items():
        scores[rid] = cosine_similarity(vec, cvec)

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    best_id, best_score = ranked[0]
    second_id, second_score = ranked[1] if len(ranked) > 1 else (None, 0)

    confidence = 'high' if best_score > 0.6 else ('medium' if best_score > 0.45 else 'low')
    ambiguous = (best_score - second_score) < 0.05

    cluster_counts[best_id] += 1
    proposals.append({
        'node_id': nid,
        'label': node.get('label', ''),
        'proposed_parent': best_id,
        'proposed_parent_label': node_map[best_id]['label'] if best_id in node_map else '',
        'similarity': round(best_score, 4),
        'runner_up': second_id,
        'runner_up_label': node_map[second_id]['label'] if second_id and second_id in node_map else '',
        'runner_up_similarity': round(second_score, 4),
        'confidence': confidence,
        'ambiguous': ambiguous,
    })

# Sort by proposed parent then similarity
proposals.sort(key=lambda p: (p.get('proposed_parent', '') or '', -(p.get('similarity', 0))))

# Summary
print("\n" + "=" * 70)
print("CLUSTER ASSIGNMENT SUMMARY")
print("=" * 70)
for root in sorted(roots, key=lambda r: r['id']):
    rid = root['id']
    existing = len(children_of[rid])
    proposed = cluster_counts.get(rid, 0)
    total = existing + proposed
    print(f"  {rid} ({root['label'][:45]}): {existing} existing + {proposed} proposed = {total}")

# Confidence breakdown
conf_counts = Counter(p.get('confidence', '') for p in proposals if p.get('proposed_parent'))
ambig_count = sum(1 for p in proposals if p.get('ambiguous'))
print(f"\nConfidence: high={conf_counts['high']}, medium={conf_counts['medium']}, low={conf_counts['low']}")
print(f"Ambiguous (top-2 delta < 0.05): {ambig_count}")

# sit-154 sub-cluster analysis
print("\n" + "=" * 70)
print("sit-154 SUB-CLUSTER ANALYSIS (39 children — candidate for split)")
print("=" * 70)

sit154_children = children_of['sit-154']
sit154_proposed = [p['node_id'] for p in proposals if p.get('proposed_parent') == 'sit-154']
sit154_all = sit154_children + sit154_proposed
sit154_vecs = [(nid, sit_embeddings[nid]) for nid in sit154_all if nid in sit_embeddings]

if len(sit154_vecs) >= 3:
    # Simple k-means-ish: find the 3 most distant nodes as seeds, assign rest
    # Use pairwise distance to find 3 diverse seeds
    from itertools import combinations

    best_spread = 0
    best_seeds = None
    sample = sit154_vecs[:min(30, len(sit154_vecs))]
    for combo in combinations(range(len(sample)), 3):
        spread = sum(
            1 - cosine_similarity(sample[i][1], sample[j][1])
            for i, j in combinations(combo, 2)
        )
        if spread > best_spread:
            best_spread = spread
            best_seeds = combo

    if best_seeds:
        seed_vecs = [normalize(sample[i][1]) for i in best_seeds]
        seed_ids = [sample[i][0] for i in best_seeds]
        subclusters = defaultdict(list)

        for nid, vec in sit154_vecs:
            sims = [cosine_similarity(vec, sv) for sv in seed_vecs]
            best_idx = sims.index(max(sims))
            subclusters[best_idx].append(nid)

        for idx in range(3):
            seed_node = node_map.get(seed_ids[idx], {})
            members = subclusters[idx]
            print(f"\n  Sub-cluster {idx+1} (seed: {seed_ids[idx]} - {seed_node.get('label','')[:50]})")
            print(f"  Members: {len(members)}")
            for mid in members[:8]:
                mn = node_map.get(mid, {})
                print(f"    {mid}: {mn.get('label','')[:60]}")
            if len(members) > 8:
                print(f"    ... and {len(members)-8} more")

# sit-156/157 merge analysis
print("\n" + "=" * 70)
print("sit-156/sit-157 MERGE ANALYSIS")
print("=" * 70)
s156_children = children_of.get('sit-156', [])
s157_children = children_of.get('sit-157', [])
s156_vecs = [sit_embeddings[nid] for nid in s156_children if nid in sit_embeddings]
s157_vecs = [sit_embeddings[nid] for nid in s157_children if nid in sit_embeddings]

if s156_vecs and s157_vecs:
    c156 = centroid(s156_vecs)
    c157 = centroid(s157_vecs)
    cross_sim = cosine_similarity(c156, c157)
    print(f"  sit-156 ({node_map['sit-156']['label'][:40]}): {len(s156_children)} children")
    for cid in s156_children:
        print(f"    {cid}: {node_map.get(cid, {}).get('label', '')[:60]}")
    print(f"  sit-157 ({node_map['sit-157']['label'][:40]}): {len(s157_children)} children")
    for cid in s157_children:
        print(f"    {cid}: {node_map.get(cid, {}).get('label', '')[:60]}")
    print(f"\n  Cross-centroid similarity: {cross_sim:.4f}")
    print(f"  Recommendation: {'MERGE' if cross_sim > 0.5 else 'KEEP SEPARATE'} (threshold: 0.5)")

# Relationship type proposal
print("\n" + "=" * 70)
print("PROPOSED RELATIONSHIP TYPE CONVENTIONS")
print("=" * 70)
print("  part_of  — node is a component/aspect of the parent topic")
print("           e.g., 'Data Privacy in AI Healthcare' part_of 'Data-Driven Harms'")
print("  is_a     — node is a specific instance/case of the parent category")
print("           e.g., 'GDPR Enforcement' is_a 'AI Governance and Policy'")
print("  specializes — node narrows the parent's scope to a specific domain")
print("           e.g., 'Military Drone Ethics' specializes 'AI in Military and Warfare'")

# For each proposal, suggest relationship type based on label/description patterns
for p in proposals:
    if not p.get('proposed_parent'):
        continue
    label = p.get('label', '').lower()
    parent_label = p.get('proposed_parent_label', '').lower()
    if any(kw in label for kw in ['case', 'example', 'instance', 'specific']):
        p['proposed_relationship'] = 'is_a'
    elif any(kw in label for kw in ['aspect', 'dimension', 'component', 'role of']):
        p['proposed_relationship'] = 'part_of'
    elif any(kw in label for kw in ['in ', 'for ', 'within']):
        p['proposed_relationship'] = 'specializes'
    else:
        p['proposed_relationship'] = 'part_of'  # default

rel_proposed = Counter(p.get('proposed_relationship', '') for p in proposals if p.get('proposed_parent'))
print(f"\n  Proposed distribution: {dict(rel_proposed)}")

# Save output
output = {
    'experiment': 't/528 standalone clustering',
    'total_nodes': len(nodes),
    'roots': len(roots),
    'standalones_clustered': len([p for p in proposals if p.get('proposed_parent')]),
    'no_embedding': len([p for p in proposals if not p.get('proposed_parent')]),
    'confidence_breakdown': dict(conf_counts),
    'ambiguous_count': ambig_count,
    'cluster_sizes': {
        rid: {
            'existing': len(children_of[rid]),
            'proposed': cluster_counts.get(rid, 0),
            'total': len(children_of[rid]) + cluster_counts.get(rid, 0),
        }
        for rid in sorted(r['id'] for r in roots)
    },
    'proposals': proposals,
}
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"\nProposals saved to: {OUTPUT_PATH}")
