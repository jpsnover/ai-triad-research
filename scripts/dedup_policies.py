#!/usr/bin/env python3
"""
Deduplicate the policy registry by merging near-duplicate entries.

Finds pairs with high text similarity, merges them (keeping the lowest pol-NNN ID),
and cascades the ID change to all taxonomy node references.

Usage:
    python3 scripts/dedup_policies.py [--dry-run] [--threshold 0.75]
"""

import json
import os
import sys
from difflib import SequenceMatcher
from collections import defaultdict

DRY_RUN = '--dry-run' in sys.argv
THRESHOLD = 0.75
for i, arg in enumerate(sys.argv):
    if arg == '--threshold' and i + 1 < len(sys.argv):
        THRESHOLD = float(sys.argv[i + 1])

config_path = os.path.join(os.path.dirname(__file__), '..', '.aitriad.json')
with open(config_path) as f:
    config = json.load(f)
data_root = os.path.join(os.path.dirname(config_path), config['data_root'])
tax_dir = os.path.join(data_root, config['taxonomy_dir'])

# ── Load registry ─────────────────────────────────────────

registry_path = os.path.join(tax_dir, 'policy_actions.json')
with open(registry_path) as f:
    registry = json.load(f)

policies = registry['policies']
print(f'Loaded {len(policies)} policies')
if DRY_RUN:
    print('DRY RUN — no files will be modified')

# ── Find merge candidates ─────────────────────────────────

# Build similarity pairs
policy_map = {p['id']: p for p in policies}
actions = [(p['id'], p['action'].lower().strip()) for p in policies]

# Use Union-Find to group transitive duplicates
parent = {pid: pid for pid, _ in actions}

def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x

def union(a, b):
    ra, rb = find(a), find(b)
    if ra == rb:
        return
    # Keep the lower pol-NNN as root
    na = int(ra.replace('pol-', ''))
    nb = int(rb.replace('pol-', ''))
    if na <= nb:
        parent[rb] = ra
    else:
        parent[ra] = rb

# Compare all pairs — use bucket optimization for speed
# First pass: bucket by first 2 words for fast comparison
buckets = defaultdict(list)
for pid, text in actions:
    words = text.split()
    key = ' '.join(words[:2]) if len(words) >= 2 else text
    buckets[key].append((pid, text))

merge_count = 0
for key, group in buckets.items():
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            sim = SequenceMatcher(None, group[i][1], group[j][1]).ratio()
            if sim >= THRESHOLD:
                union(group[i][0], group[j][0])
                merge_count += 1

# Also check cross-bucket for high-similarity pairs (slower, sample-based)
# Compare first word buckets that share the same verb
verb_groups = defaultdict(list)
for key, group in buckets.items():
    verb = key.split()[0] if key.split() else ''
    verb_groups[verb].extend(group)

cross_merges = 0
for verb, group in verb_groups.items():
    if len(group) <= 1:
        continue
    # For large groups, compare each against all others in the verb group
    # but only if they're not already in the same bucket
    seen_pairs = set()
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            pair_key = (min(group[i][0], group[j][0]), max(group[i][0], group[j][0]))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            if find(group[i][0]) == find(group[j][0]):
                continue  # already merged
            sim = SequenceMatcher(None, group[i][1], group[j][1]).ratio()
            if sim >= THRESHOLD:
                union(group[i][0], group[j][0])
                cross_merges += 1

print(f'Found {merge_count} within-bucket merges + {cross_merges} cross-bucket merges')

# ── Build merge groups ────────────────────────────────────

groups = defaultdict(list)
for pid, _ in actions:
    root = find(pid)
    groups[root].append(pid)

# Filter to groups with actual merges
merge_groups = {root: members for root, members in groups.items() if len(members) > 1}
total_merged = sum(len(m) for m in merge_groups.values())
print(f'Merge groups: {len(merge_groups)} (covering {total_merged} policies, reducing to {len(merge_groups)})')
print(f'Policies to remove: {total_merged - len(merge_groups)}')

# Build the ID mapping: old_id → new_id (the group root)
id_remap = {}
for root, members in merge_groups.items():
    for pid in members:
        if pid != root:
            id_remap[pid] = root

# Show sample merges
print(f'\nSample merges (first 15):')
for i, (root, members) in enumerate(sorted(merge_groups.items())[:15]):
    root_action = policy_map[root]['action']
    print(f'  {root}: "{root_action}"')
    for pid in members:
        if pid == root:
            continue
        print(f'    <- {pid}: "{policy_map[pid]["action"]}"')
    print()

if DRY_RUN:
    print('DRY RUN complete. No files modified.')
    sys.exit(0)

# ── Apply merges to registry ──────────────────────────────

# Merge source_povs and member_count into root entries
for root, members in merge_groups.items():
    root_pol = policy_map[root]
    merged_povs = set(root_pol.get('source_povs', []))
    merged_count = root_pol.get('member_count', 0) or 0
    for pid in members:
        if pid == root:
            continue
        other = policy_map[pid]
        merged_povs.update(other.get('source_povs', []))
        merged_count += other.get('member_count', 0) or 0
        # Mark as merged
        other['status'] = 'merged'
        other['merged_into'] = root
    root_pol['source_povs'] = sorted(merged_povs)
    root_pol['member_count'] = merged_count
    if not root_pol.get('status'):
        root_pol['status'] = 'active'

# Remove merged entries from active list (keep in registry with merged status)
active_policies = [p for p in policies if p.get('status') != 'merged']
merged_policies = [p for p in policies if p.get('status') == 'merged']

print(f'\nActive policies after dedup: {len(active_policies)} (was {len(policies)})')
print(f'Merged entries (preserved with status=merged): {len(merged_policies)}')

registry['policies'] = policies  # keep all, status field distinguishes
registry['policy_count'] = len(active_policies)

with open(registry_path, 'w') as f:
    json.dump(registry, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f'Registry saved')

# ── Cascade ID changes to taxonomy files ──────────────────

pov_files = ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json']
total_node_updates = 0

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
        pa_list = ga.get('policy_actions', [])
        if not pa_list:
            continue
        for pa in pa_list:
            old_pid = pa.get('policy_id')
            if old_pid and old_pid in id_remap:
                pa['policy_id'] = id_remap[old_pid]
                changed = True
                total_node_updates += 1

    if changed:
        with open(fpath, 'w') as f:
            json.dump(tax_data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f'{fname}: updated policy references')

print(f'Total node policy_action references remapped: {total_node_updates}')

# ── Cascade to edges.json (PROPOSES edges) ────────────────

edges_path = os.path.join(tax_dir, 'edges.json')
if os.path.exists(edges_path):
    with open(edges_path) as f:
        edges_data = json.load(f)

    edge_updates = 0
    for e in edges_data.get('edges', []):
        if e.get('source') in id_remap:
            e['source'] = id_remap[e['source']]
            edge_updates += 1
        if e.get('target') in id_remap:
            e['target'] = id_remap[e['target']]
            edge_updates += 1

    if edge_updates > 0:
        with open(edges_path, 'w') as f:
            json.dump(edges_data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f'edges.json: {edge_updates} edge references remapped')

print('\nDone.')
