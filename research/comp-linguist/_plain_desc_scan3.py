#!/usr/bin/env python3
import json, os, re, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ORIGIN = r"C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin"
POV = ['accelerationist.json','safetyist.json','skeptic.json']
GENUS = re.compile(r'^\s*An?\s+(Belief|Desire|Intention)\b')

nondolce_desc=[]; missing_plain=[]; sample_plain=[]
i=0
for f in POV:
    d = json.load(open(os.path.join(ORIGIN,f),encoding='utf-8'))
    nodes = d.get('nodes') if isinstance(d,dict) else d
    for n in nodes:
        i+=1
        desc = n.get('description') or ''
        pd = n.get('plain_description')
        # descriptions NOT in DOLCE genus-differentia form
        if not GENUS.match(desc):
            nondolce_desc.append((n.get('id'), desc[:120]))
        if not isinstance(pd,str) or not pd.strip():
            missing_plain.append(n.get('id'))
        # sample every ~90th plain_description for tone review
        elif i % 90 == 0:
            sample_plain.append((n.get('id'), pd[:200]))

print(f"POV description fields NOT in DOLCE genus-differentia form: {len(nondolce_desc)}")
for id_,t in nondolce_desc[:20]:
    print(f"  [{id_}] {t}")
print(f"\nmissing plain_description ({len(missing_plain)}): {missing_plain}")
print("\n--- random plain_description samples (tone check) ---")
for id_,t in sample_plain:
    print(f"  [{id_}] {t}\n")
