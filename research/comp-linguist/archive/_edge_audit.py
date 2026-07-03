#!/usr/bin/env python3
"""One-off edge-quality audit against the real taxonomy/Origin store."""
import json, os, sys
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ORIGIN = r"C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin"

def load(name):
    p = os.path.join(ORIGIN, name)
    with open(p, encoding='utf-8') as f:
        return json.load(f)

ed = load('edges.json')
# edges.json shape: could be {'edges':[...]} or list or {'data':...}
if isinstance(ed, dict):
    edges = ed.get('edges') or ed.get('data') or []
    print("edges.json top keys:", list(ed.keys())[:10])
else:
    edges = ed
print("TOTAL edges:", len(edges))

# Gather node ids from the 4 POV files + situations + policy
nodeids = set()
for f in ['accelerationist.json','safetyist.json','skeptic.json','situations.json','policy_actions.json']:
    try:
        d = load(f)
        items = d.get('nodes') if isinstance(d, dict) else d
        if items is None and isinstance(d, dict):
            # situations/policy may key differently
            for k in ('situations','policies','actions','data'):
                if k in d: items = d[k]; break
        for n in (items or []):
            if isinstance(n, dict) and n.get('id'):
                nodeids.add(n['id'])
    except Exception as e:
        print(f"  (skip {f}: {e})")
print("known node ids:", len(nodeids))

def g(e,*ks):
    for k in ks:
        if k in e and e[k] is not None: return e[k]
    return None

types = Counter(g(e,'type','edge_type','relation') for e in edges)
print("\n--- by type ---")
for t,c in types.most_common():
    print(f"  {c:7}  {t}")

# quality dimensions
dangling = [e for e in edges if g(e,'source','from') not in nodeids or g(e,'target','to') not in nodeids]
selfloop = [e for e in edges if g(e,'source','from')==g(e,'target','to') and g(e,'source','from') is not None]
seen=set(); dup=0
for e in edges:
    key=(g(e,'source','from'),g(e,'target','to'),g(e,'type','edge_type','relation'))
    if key in seen: dup+=1
    seen.add(key)
noweight = [e for e in edges if g(e,'weight')is None]
lowconf  = [e for e in edges if isinstance(g(e,'confidence'),(int,float)) and g(e,'confidence')<0.3]
disc = [e for e in edges if g(e,'status','review_status')=='discovered' or g(e,'source_type')=='discovery' or g(e,'auto_generated') is True]
statuses = Counter(g(e,'status','review_status') for e in edges)

print("\n--- quality flags ---")
print(f"  dangling endpoint : {len(dangling)}")
print(f"  self-loops        : {len(selfloop)}")
print(f"  exact duplicates  : {dup}")
print(f"  missing weight    : {len(noweight)}")
print(f"  confidence < 0.3  : {len(lowconf)}")
print("\n--- by status ---")
for s,c in statuses.most_common():
    print(f"  {c:7}  {s}")

# sample one edge to show the schema
if edges:
    print("\n--- sample edge keys ---", list(edges[0].keys()))
    print("--- sample edge ---")
    print(json.dumps(edges[0], indent=2)[:800])
