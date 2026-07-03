#!/usr/bin/env python3
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ORIGIN = r"C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin"
d = json.load(open(os.path.join(ORIGIN,'accelerationist.json'),encoding='utf-8'))
nodes = d.get('nodes') if isinstance(d,dict) else d
print("top-level keys:", list(d.keys())[:15] if isinstance(d,dict) else "(list)")
print("node count:", len(nodes))
n = nodes[0]
print("\n--- sample node keys ---")
print(list(n.keys()))
print("\n--- sample node (first) ---")
print(json.dumps(n, indent=2, ensure_ascii=False)[:2500])
# Look for any description-ish fields across a few nodes
print("\n--- description-like fields across first 3 nodes ---")
for nn in nodes[:3]:
    print("id:", nn.get('id'))
    for k,v in nn.items():
        if 'desc' in k.lower() or 'plain' in k.lower() or 'vernacular' in k.lower() or k in ('summary','label','definition'):
            sv = v if isinstance(v,str) else json.dumps(v,ensure_ascii=False)
            print(f"   {k}: {sv[:160]}")
    ga = nn.get('graph_attributes')
    if isinstance(ga, dict):
        for k,v in ga.items():
            if 'desc' in k.lower() or 'plain' in k.lower() or 'vernacular' in k.lower():
                sv = v if isinstance(v,str) else json.dumps(v,ensure_ascii=False)
                print(f"   graph_attributes.{k}: {sv[:160]}")
    print()
