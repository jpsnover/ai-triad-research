#!/usr/bin/env python3
import json, os, re, sys
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ORIGIN = r"C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin"
POV = ['accelerationist.json','safetyist.json','skeptic.json']

def norm(s): return re.sub(r'\s+',' ',(s or '')).strip().lower()

signals = Counter()
flagged=[]; total=0; missing=0; have=0
for f in POV:
    d = json.load(open(os.path.join(ORIGIN,f),encoding='utf-8'))
    nodes = d.get('nodes') if isinstance(d,dict) else d
    for n in nodes:
        total+=1
        desc = n.get('description') or ''
        pd = n.get('plain_description')
        if not isinstance(pd,str) or not pd.strip():
            missing+=1; continue
        have+=1
        why=[]
        low = pd.lower()
        if 'encompasses:' in low: why.append('Encompasses')
        if 'excludes:' in low: why.append('Excludes')
        if re.search(r'\bwithin\s+\w+\s+discourse', low): why.append('within-discourse')
        if re.match(r'^\s*an?\s+(belief|desire|intention|situation|position|view|stance)\b', low): why.append('genus-opener')
        # copy / near-copy of the DOLCE description
        if norm(pd)==norm(desc): why.append('EXACT-COPY-of-description')
        elif desc and norm(pd)[:80]==norm(desc)[:80] and len(pd)>40: why.append('prefix-copy-of-description')
        # dolce double-dash em-dash pattern "-- ... --" heavy
        if pd.count(' -- ')>=2: why.append('double-dash-scaffold')
        if why:
            for w in why: signals[w]+=1
            if len(flagged)<15: flagged.append((n.get('id'), n.get('plain_description_version','?'), why, pd[:150]))

print(f"POV nodes total={total}  have plain_desc={have}  missing={missing}")
print(f"flagged (looser DOLCE/copy signals): {sum(1 for _ in flagged) if len(flagged)<15 else '15+'}  signal_counts={dict(signals)}")
print("\n--- flagged examples ---")
for id_,v,why,txt in flagged:
    print(f"  [{id_}] ver={v} {why}\n     {txt}\n")
if not flagged:
    print("  (none)")
