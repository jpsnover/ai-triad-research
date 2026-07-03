#!/usr/bin/env python3
import json, os, sys
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ORIGIN = r"C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin"
ed = json.load(open(os.path.join(ORIGIN,'edges.json'),encoding='utf-8'))
edges = ed['edges']
def g(e,k,d=None): return e.get(k,d)

print("declared edge_types in file header:", ed.get('edge_types'))
print()
prop = [e for e in edges if g(e,'status')=='proposed']
appr = [e for e in edges if g(e,'status')=='approved']
print(f"proposed={len(prop)}  approved={len(appr)}")

print("\n--- proposed by type ---")
for t,c in Counter(g(e,'type') for e in prop).most_common():
    print(f"  {c:6}  {t}")
print("\n--- proposed by strength ---")
for s,c in Counter(g(e,'strength') for e in prop).most_common():
    print(f"  {c:6}  {s}")
print("\n--- proposed by confidence band ---")
band=Counter()
for e in prop:
    c=g(e,'confidence')
    if not isinstance(c,(int,float)): band['none']+=1
    elif c>=0.8: band['>=0.8']+=1
    elif c>=0.6: band['0.6-0.8']+=1
    elif c>=0.4: band['0.4-0.6']+=1
    else: band['<0.4']+=1
for k in ['>=0.8','0.6-0.8','0.4-0.6','<0.4','none']:
    if band[k]: print(f"  {band[k]:6}  {k}")

print("\n--- SUPPORTS by strength (all statuses) ---")
sup=[e for e in edges if g(e,'type')=='SUPPORTS']
for s,c in Counter(g(e,'strength') for e in sup).most_common():
    print(f"  {c:6}  {s}")
print(f"  weak+proposed SUPPORTS (prune candidates): "
      f"{len([e for e in sup if g(e,'strength')=='weak' and g(e,'status')=='proposed'])}")

# per-node fan-out (over-connected hubs)
from collections import defaultdict
deg=defaultdict(int)
for e in edges:
    deg[g(e,'source')]+=1; deg[g(e,'target')]+=1
top=sorted(deg.items(),key=lambda x:-x[1])[:10]
print("\n--- top-10 highest-degree nodes (hub check) ---")
for n,d in top: print(f"  {d:5}  {n}")
avg=sum(deg.values())/len(deg) if deg else 0
print(f"  avg degree: {avg:.1f}  over {len(deg)} connected nodes")

# CONVERGES_WITH presence
print("\nCONVERGES_WITH edges:", len([e for e in edges if g(e,'type')=='CONVERGES_WITH']))
