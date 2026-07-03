#!/usr/bin/env python3
"""
Embedding-based policy deduplication and matching.

Compares all active policy embeddings and merges entries above a cosine
similarity threshold. No LLM calls — pure vector math.

Usage:
    python3 scripts/match_policies_by_embedding.py [--dry-run] [--threshold 0.92]
"""

import json
import os
import sys
import math
from collections import defaultdict

DRY_RUN = '--dry-run' in sys.argv
THRESHOLD = 0.92
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

# ── Cosine similarity ─────────────────────────────────────

def cosine_sim(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0
    return dot / (na * nb)

# ── Opposition detection ──────────────────────────────────

import re

# Verb pairs that signal opposite policy intent
OPPOSING_VERBS = [
    (r'\bfund\b', r'\bdefund\b'),
    (r'\bmandate\b', r'\bprohibit\b'),
    (r'\brequire\b', r'\bexempt\b'),
    (r'\bregulat', r'\bderegulat'),
    (r'\bincrease\b', r'\breduce\b'),
    (r'\bexpand\b', r'\brestrict\b'),
    (r'\bstrengthen\b', r'\bweaken\b'),
    (r'\benforce\b', r'\brelax\b'),
    (r'\bban\b', r'\bpermit\b'),
    (r'\blimit\b', r'\bremove\s+limit'),
]

# Phrases that flip intent within similar domains
OPPOSITION_SIGNALS = [
    r'\bover\b.*\bsafety\b',       # "prioritize X over safety"
    r'\babove all\b',               # "above all other concerns"
    r'\bwithout\b.*\bregulat',      # "without regulation"
    r'\binstead of\b',
    r'\brather than\b',
    r'\bminimal\s+oversight\b',
    r'\bwithout\s+significant\s+regulat',
]

def are_opposing(pol_a: dict, pol_b: dict) -> bool:
    """Detect if two semantically similar policies have opposing intent."""
    text_a = pol_a['action'].lower()
    text_b = pol_b['action'].lower()

    # Check opposing verb pairs
    for verb_a, verb_b in OPPOSING_VERBS:
        if (re.search(verb_a, text_a) and re.search(verb_b, text_b)) or \
           (re.search(verb_b, text_a) and re.search(verb_a, text_b)):
            return True

    # Check if one has an opposition signal and the other doesn't
    for signal in OPPOSITION_SIGNALS:
        a_has = bool(re.search(signal, text_a))
        b_has = bool(re.search(signal, text_b))
        if a_has != b_has:
            return True

    # Check POV opposition: acc vs saf on same domain is suspicious
    povs_a = set(pol_a.get('source_povs', []))
    povs_b = set(pol_b.get('source_povs', []))
    acc_saf_split = (
        ('accelerationist' in povs_a and 'safetyist' in povs_b) or
        ('safetyist' in povs_a and 'accelerationist' in povs_b)
    )
    if acc_saf_split:
        # Same domain + opposing camps = likely tension, not duplication
        # But only flag if the verbs suggest different directions
        fund_like_a = bool(re.search(r'\bfund|invest|allocat|prioritiz', text_a))
        fund_like_b = bool(re.search(r'\bfund|invest|allocat|prioritiz', text_b))
        restrict_like_a = bool(re.search(r'\brestrict|limit|ban|halt|moratorium|pause', text_a))
        restrict_like_b = bool(re.search(r'\brestrict|limit|ban|halt|moratorium|pause', text_b))
        if (fund_like_a and restrict_like_b) or (restrict_like_b and fund_like_a):
            return True

    return False

# ── Find all pairs above threshold ────────────────────────

pol_ids = sorted(pol_vecs.keys())
pairs = []
skipped_opposing = 0

for i in range(len(pol_ids)):
    for j in range(i + 1, len(pol_ids)):
        sim = cosine_sim(pol_vecs[pol_ids[i]], pol_vecs[pol_ids[j]])
        if sim >= THRESHOLD:
            pol_a = policies[pol_ids[i]]
            pol_b = policies[pol_ids[j]]
            if are_opposing(pol_a, pol_b):
                skipped_opposing += 1
            else:
                pairs.append((sim, pol_ids[i], pol_ids[j]))
    if (i + 1) % 200 == 0:
        print(f'  [{i+1}/{len(pol_ids)}] pairs found: {len(pairs)}, opposing skipped: {skipped_opposing}')

pairs.sort(key=lambda x: -x[0])
print(f'\nPairs above {THRESHOLD}: {len(pairs)} (skipped {skipped_opposing} opposing pairs)')

# ── Union-Find to group transitive matches ────────────────

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

for sim, a, b in pairs:
    union(a, b)

groups = defaultdict(list)
for pid in pol_ids:
    root = find(pid)
    groups[root].append(pid)

merge_groups = {root: members for root, members in groups.items() if len(members) > 1}
total_merged = sum(len(m) for m in merge_groups.values())
removals = total_merged - len(merge_groups)

print(f'Merge groups: {len(merge_groups)} (covering {total_merged} policies)')
print(f'Policies to remove: {removals}')

# ── Show merges ───────────────────────────────────────────

id_remap = {}
for root, members in sorted(merge_groups.items()):
    root_action = policies[root]['action']
    print(f'\n  {root}: "{root_action}"')
    for pid in members:
        if pid == root:
            continue
        id_remap[pid] = root
        print(f'    <- {pid}: "{policies[pid]["action"]}"')

if DRY_RUN:
    print(f'\nDRY RUN complete. Would merge {removals} policies into {len(merge_groups)} groups.')
    sys.exit(0)

# ── Apply merges ──────────────────────────────────────────

# Merge source_povs and member_count
for root, members in merge_groups.items():
    root_pol = policies[root]
    merged_povs = set(root_pol.get('source_povs', []))
    merged_count = root_pol.get('member_count', 0) or 0
    for pid in members:
        if pid == root:
            continue
        other = policies[pid]
        merged_povs.update(other.get('source_povs', []))
        merged_count += other.get('member_count', 0) or 0
        # Find in original registry list and mark merged
        for p in registry['policies']:
            if p['id'] == pid:
                p['status'] = 'merged'
                p['merged_into'] = root
                break
    root_pol['source_povs'] = sorted(merged_povs)
    root_pol['member_count'] = merged_count
    if not root_pol.get('status'):
        root_pol['status'] = 'active'
    # Update in registry list
    for p in registry['policies']:
        if p['id'] == root:
            p['source_povs'] = root_pol['source_povs']
            p['member_count'] = root_pol['member_count']
            if not p.get('status'):
                p['status'] = 'active'
            break

active_count = sum(1 for p in registry['policies'] if p.get('status') != 'merged')
registry['policy_count'] = active_count

with open(os.path.join(tax_dir, 'policy_actions.json'), 'w') as f:
    json.dump(registry, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f'\nRegistry saved: {active_count} active (was {len(policies)})')

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
