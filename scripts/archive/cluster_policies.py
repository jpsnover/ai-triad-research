#!/usr/bin/env python3
"""
Cluster policies by embedding similarity into topic groups, then split
each group into "for" and "against" buckets based on opposition detection.

Within each bucket, near-duplicates are merged (lowest pol-NNN kept).
Opposing policies are preserved as separate entries linked by a shared cluster.

Usage:
    python3 scripts/cluster_policies.py [--dry-run] [--threshold 0.80]
"""

import json
import os
import sys
import math
import re
from collections import defaultdict

DRY_RUN = '--dry-run' in sys.argv
THRESHOLD = 0.80
for i, arg in enumerate(sys.argv):
    if arg == '--threshold' and i + 1 < len(sys.argv):
        THRESHOLD = float(sys.argv[i + 1])

config_path = os.path.join(os.path.dirname(__file__), '..', '.aitriad.json')
with open(config_path) as f:
    config = json.load(f)
data_root = os.path.join(os.path.dirname(config_path), config['data_root'])
tax_dir = os.path.join(data_root, config['taxonomy_dir'])

# ── Load ──────────────────────────────────────────────────

with open(os.path.join(tax_dir, 'policy_actions.json')) as f:
    registry = json.load(f)
with open(os.path.join(tax_dir, 'embeddings.json')) as f:
    emb = json.load(f)

policies = {p['id']: p for p in registry['policies'] if p.get('status') != 'merged'}
pol_vecs = {k: v['vector'] for k, v in emb.get('nodes', {}).items()
            if k.startswith('pol-') and k in policies}

print(f'Active policies: {len(policies)}')
print(f'With embeddings: {len(pol_vecs)}')
print(f'Threshold: {THRESHOLD}')
if DRY_RUN:
    print('DRY RUN — no files will be modified')

# ── Helpers ───────────────────────────────────────────────

def cosine_sim(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0
    return dot / (na * nb)

# Opposition signals
OPPOSING_VERBS = [
    (r'\bfund\b', r'\bdefund\b'), (r'\bmandate\b', r'\bprohibit\b'),
    (r'\brequire\b', r'\bexempt\b'), (r'\bregulat', r'\bderegulat'),
    (r'\bincrease\b', r'\breduce\b'), (r'\bexpand\b', r'\brestrict\b'),
    (r'\bstrengthen\b', r'\bweaken\b'), (r'\benforce\b', r'\brelax\b'),
    (r'\bban\b', r'\bpermit\b'), (r'\blimit\b', r'\bremove\s+limit'),
]

OPPOSITION_SIGNALS = [
    r'\bover\b.*\bsafety\b', r'\babove all\b', r'\bwithout\b.*\bregulat',
    r'\binstead of\b', r'\brather than\b', r'\bminimal\s+oversight\b',
    r'\bwithout\s+significant\s+regulat',
]

PRO_VERBS = re.compile(r'\bfund|invest|allocat|establish|create|develop|implement|mandate|require|enact|strengthen', re.I)
ANTI_VERBS = re.compile(r'\brestrict|limit|ban|halt|moratorium|pause|prohibit|deregulat|reduce|streamline|exempt|remove', re.I)

def are_opposing(pol_a, pol_b):
    text_a = pol_a['action'].lower()
    text_b = pol_b['action'].lower()
    for va, vb in OPPOSING_VERBS:
        if (re.search(va, text_a) and re.search(vb, text_b)) or \
           (re.search(vb, text_a) and re.search(va, text_b)):
            return True
    for sig in OPPOSITION_SIGNALS:
        if bool(re.search(sig, text_a)) != bool(re.search(sig, text_b)):
            return True
    # Pro vs anti verb mismatch
    a_pro = bool(PRO_VERBS.search(text_a)) and not ANTI_VERBS.search(text_a)
    b_anti = bool(ANTI_VERBS.search(text_b)) and not PRO_VERBS.search(text_b)
    a_anti = bool(ANTI_VERBS.search(text_a)) and not PRO_VERBS.search(text_a)
    b_pro = bool(PRO_VERBS.search(text_b)) and not ANTI_VERBS.search(text_b)
    if (a_pro and b_anti) or (a_anti and b_pro):
        return True
    return False

# ── Step 1: Find all similar pairs ───────────────────────

print('\nFinding similar pairs...')
pol_ids = sorted(pol_vecs.keys())
similar_pairs = []

for i in range(len(pol_ids)):
    for j in range(i + 1, len(pol_ids)):
        sim = cosine_sim(pol_vecs[pol_ids[i]], pol_vecs[pol_ids[j]])
        if sim >= THRESHOLD:
            similar_pairs.append((sim, pol_ids[i], pol_ids[j]))
    if (i + 1) % 200 == 0:
        print(f'  [{i+1}/{len(pol_ids)}] pairs: {len(similar_pairs)}')

print(f'Similar pairs: {len(similar_pairs)}')

# ── Step 2: Union-Find to build topic clusters ────────────

parent = {pid: pid for pid in pol_ids}

def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x

def union(a, b):
    ra, rb = find(a), find(b)
    if ra == rb:
        return
    na = int(ra.replace('pol-', ''))
    nb = int(rb.replace('pol-', ''))
    if na <= nb:
        parent[rb] = ra
    else:
        parent[ra] = rb

for sim, a, b in similar_pairs:
    union(a, b)

raw_clusters = defaultdict(list)
for pid in pol_ids:
    root = find(pid)
    raw_clusters[root].append(pid)

topic_clusters = {root: members for root, members in raw_clusters.items() if len(members) > 1}
singleton_count = sum(1 for members in raw_clusters.values() if len(members) == 1)

print(f'Topic clusters: {len(topic_clusters)} (covering {sum(len(m) for m in topic_clusters.values())} policies)')
print(f'Singletons: {singleton_count}')

# ── Step 3: Split each cluster into for/against buckets ───

clusters_output = []
total_merges = 0
id_remap = {}

for root, members in sorted(topic_clusters.items()):
    # Build opposition graph within the cluster
    # Start with the root in bucket A, assign others based on opposition
    bucket_a = [root]  # "for" bucket
    bucket_b = []      # "against" bucket
    unassigned = [m for m in members if m != root]

    for pid in unassigned:
        # Check if this policy opposes anything in bucket A
        opposes_a = any(are_opposing(policies[pid], policies[a]) for a in bucket_a)
        opposes_b = any(are_opposing(policies[pid], policies[b]) for b in bucket_b) if bucket_b else False

        if opposes_a and not opposes_b:
            bucket_b.append(pid)
        elif opposes_b and not opposes_a:
            bucket_a.append(pid)
        else:
            # No opposition detected or ambiguous — put in bucket A (same direction as root)
            bucket_a.append(pid)

    # Within each bucket, merge duplicates (keep lowest pol-NNN)
    def merge_bucket(bucket):
        if len(bucket) <= 1:
            return bucket[0] if bucket else None, bucket, {}
        # Keep the lowest ID as canonical
        canonical = min(bucket, key=lambda p: int(p.replace('pol-', '')))
        merged = {}
        for pid in bucket:
            if pid != canonical:
                merged[pid] = canonical
        return canonical, bucket, merged

    canon_a, _, merges_a = merge_bucket(bucket_a)
    canon_b, _, merges_b = merge_bucket(bucket_b)

    id_remap.update(merges_a)
    id_remap.update(merges_b)
    total_merges += len(merges_a) + len(merges_b)

    cluster_info = {
        'root': root,
        'topic_label': policies[root]['action'][:60],
        'bucket_a': {'canonical': canon_a, 'members': bucket_a, 'merged': len(merges_a)},
    }
    if bucket_b:
        cluster_info['bucket_b'] = {'canonical': canon_b, 'members': bucket_b, 'merged': len(merges_b)}

    clusters_output.append(cluster_info)

print(f'\nClusters with opposition (2 buckets): {sum(1 for c in clusters_output if "bucket_b" in c)}')
print(f'Clusters single-direction (1 bucket): {sum(1 for c in clusters_output if "bucket_b" not in c)}')
print(f'Total merges within buckets: {total_merges}')
print(f'Active policies after merge: {len(policies) - total_merges}')

# ── Show results ──────────────────────────────────────────

print(f'\n{"="*80}')
print(f'CLUSTERS WITH OPPOSING POSITIONS:')
print(f'{"="*80}')
for c in clusters_output:
    if 'bucket_b' not in c:
        continue
    ba = c['bucket_a']
    bb = c['bucket_b']
    print(f'\nTopic: {c["topic_label"]}...')
    print(f'  FOR ({len(ba["members"])} policies, canonical={ba["canonical"]}):')
    for pid in ba['members'][:3]:
        print(f'    {pid}: {policies[pid]["action"][:70]}')
    if len(ba['members']) > 3:
        print(f'    ... +{len(ba["members"])-3} more')
    print(f'  AGAINST ({len(bb["members"])} policies, canonical={bb["canonical"]}):')
    for pid in bb['members'][:3]:
        print(f'    {pid}: {policies[pid]["action"][:70]}')
    if len(bb['members']) > 3:
        print(f'    ... +{len(bb["members"])-3} more')

print(f'\n{"="*80}')
print(f'LARGEST SINGLE-DIRECTION CLUSTERS (top 10):')
print(f'{"="*80}')
single_clusters = sorted(
    [c for c in clusters_output if 'bucket_b' not in c],
    key=lambda c: -len(c['bucket_a']['members'])
)
for c in single_clusters[:10]:
    ba = c['bucket_a']
    print(f'\n  {ba["canonical"]} ({len(ba["members"])} policies, merging {ba["merged"]}):')
    print(f'    "{policies[ba["canonical"]]["action"]}"')
    for pid in ba['members'][:3]:
        if pid != ba['canonical']:
            print(f'    <- {pid}: {policies[pid]["action"][:70]}')
    if len(ba['members']) > 4:
        print(f'    ... +{len(ba["members"])-4} more')

if DRY_RUN:
    print(f'\nDRY RUN complete. Would merge {total_merges} policies.')
    sys.exit(0)

# ── Apply merges ──────────────────────────────────────────

# Merge source_povs and member_count into canonical entries
for old_id, new_id in id_remap.items():
    canon = policies.get(new_id)
    other = policies.get(old_id)
    if not canon or not other:
        continue
    merged_povs = set(canon.get('source_povs', []))
    merged_povs.update(other.get('source_povs', []))
    canon['source_povs'] = sorted(merged_povs)
    canon['member_count'] = (canon.get('member_count', 0) or 0) + (other.get('member_count', 0) or 0)
    if not canon.get('status'):
        canon['status'] = 'active'
    # Mark in registry
    for p in registry['policies']:
        if p['id'] == old_id:
            p['status'] = 'merged'
            p['merged_into'] = new_id
            break
    for p in registry['policies']:
        if p['id'] == new_id:
            p['source_povs'] = canon['source_povs']
            p['member_count'] = canon['member_count']
            if not p.get('status'):
                p['status'] = 'active'
            break

# Save cluster metadata
cluster_meta = []
for c in clusters_output:
    entry = {
        'topic': policies[c['root']]['action'],
        'bucket_a': c['bucket_a']['canonical'],
        'bucket_a_count': len(c['bucket_a']['members']),
    }
    if 'bucket_b' in c:
        entry['bucket_b'] = c['bucket_b']['canonical']
        entry['bucket_b_count'] = len(c['bucket_b']['members'])
        entry['tension'] = True
    cluster_meta.append(entry)

active_count = sum(1 for p in registry['policies'] if p.get('status') != 'merged')
registry['policy_count'] = active_count
registry['policy_clusters'] = cluster_meta

with open(os.path.join(tax_dir, 'policy_actions.json'), 'w') as f:
    json.dump(registry, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f'\nRegistry saved: {active_count} active, {len(cluster_meta)} clusters ({sum(1 for c in cluster_meta if c.get("tension"))} with tensions)')

# ── Cascade to taxonomy files ─────────────────────────────

pov_files = ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json']
total_remaps = 0
for fname in pov_files:
    fpath = os.path.join(tax_dir, fname)
    if not os.path.exists(fpath):
        continue
    with open(fpath) as f:
        tax_data = json.load(f)
    changed = False
    for node in tax_data.get('nodes', []):
        ga = node.get('graph_attributes')
        if not ga:
            continue
        for pa in ga.get('policy_actions', []):
            old_pid = pa.get('policy_id')
            if old_pid and old_pid in id_remap:
                pa['policy_id'] = id_remap[old_pid]
                changed = True
                total_remaps += 1
    if changed:
        with open(fpath, 'w') as f:
            json.dump(tax_data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f'{fname}: updated')
print(f'Node references remapped: {total_remaps}')

# ── Cascade to edges ──────────────────────────────────────

edges_path = os.path.join(tax_dir, 'edges.json')
if os.path.exists(edges_path):
    with open(edges_path) as f:
        edges_data = json.load(f)
    edge_remaps = 0
    for e in edges_data.get('edges', []):
        if e.get('source') in id_remap:
            e['source'] = id_remap[e['source']]
            edge_remaps += 1
        if e.get('target') in id_remap:
            e['target'] = id_remap[e['target']]
            edge_remaps += 1
    if edge_remaps:
        with open(edges_path, 'w') as f:
            json.dump(edges_data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f'edges.json: {edge_remaps} remapped')

print('\nDone.')
