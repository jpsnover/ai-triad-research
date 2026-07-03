#!/usr/bin/env python3
"""Scan all POV nodes for plain_description fields that are actually DOLCE genus-differentia
statements (mis-populated) rather than genuine plain-language rewrites."""
import json, os, re, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ORIGIN = r"C:/Users/jsnov/repos/ai-triad-data/taxonomy/Origin"
POV = ['accelerationist.json','safetyist.json','skeptic.json']

# DOLCE / genus-differentia signatures
GENUS = re.compile(r'^\s*A[n]?\s+(Belief|Desire|Intention)\b', re.I)
WITHIN = re.compile(r'within\s+\w+(ist|ic)?\s+discourse', re.I)
ENC = 'Encompasses:'
EXC = 'Excludes:'

def is_dolce(text):
    if not isinstance(text,str) or not text.strip(): return False
    hits = []
    if GENUS.match(text): hits.append('genus-opener')
    if WITHIN.search(text): hits.append('within-discourse')
    if ENC in text: hits.append('Encompasses')
    if EXC in text: hits.append('Excludes')
    return hits

grand_total=0; grand_flagged=0; grand_missing=0
by_pov={}
examples=[]
for f in POV:
    d = json.load(open(os.path.join(ORIGIN,f),encoding='utf-8'))
    nodes = d.get('nodes') if isinstance(d,dict) else d
    total=len(nodes); flagged=0; missing=0; ver=Counter() if False else {}
    for n in nodes:
        pd = n.get('plain_description')
        if not isinstance(pd,str) or not pd.strip():
            missing+=1; continue
        hits = is_dolce(pd)
        if hits:
            flagged+=1
            v=n.get('plain_description_version','?')
            ver[v]=ver.get(v,0)+1
            if len(examples)<8:
                examples.append((n.get('id'), v, hits, pd[:130]))
    by_pov[f]=(total,flagged,missing,ver)
    grand_total+=total; grand_flagged+=flagged; grand_missing+=missing

print(f"{'file':22} {'nodes':>6} {'DOLCE-shaped plain_desc':>24} {'missing plain_desc':>19}")
for f,(t,fl,mi,ver) in by_pov.items():
    print(f"{f:22} {t:>6} {fl:>24} {mi:>19}   versions={ver}")
print(f"{'TOTAL':22} {grand_total:>6} {grand_flagged:>24} {grand_missing:>19}")

print("\n--- example flagged plain_descriptions (should be plain, but look DOLCE) ---")
for id_,v,hits,txt in examples:
    print(f"  [{id_}] ver={v} signals={hits}\n     {txt}\n")
