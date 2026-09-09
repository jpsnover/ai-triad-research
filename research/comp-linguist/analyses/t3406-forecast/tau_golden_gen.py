#!/usr/bin/env python3
"""t/3406 tau-golden worksheet generator (READ-ONLY). Sample (anticipated_challenge, best-matching
opponent-ATTACK) pairs stratified across the cosine range so CL can hand-label materialized=1/0 and
calibrate tau precision-first. Uses the v2 valence-aware matching (atomic AN attack moves)."""
import json, glob, os, re, sys
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")
from sentence_transformers import SentenceTransformer
DATA = r"C:\Users\jsnov\repos\ai-triad-data"

def spk(p):
    m = re.search(r"You are (Safetyist|Accelerationist|Skeptic)", p or "", re.I); return m.group(1).lower() if m else None
def challenges(s):
    out={}; ents=(s.get("diagnostics") or {}).get("entries") or {}
    for _,e in (ents.items() if isinstance(ents,dict) else enumerate(ents)):
        sp=spk(e.get("prompt",""));
        if not sp: continue
        for st in (e.get("stage_diagnostics") or []):
            ac=(st.get("work_product") or {}).get("anticipated_challenges")
            if ac: out.setdefault(sp,[]).extend([c for c in ac if isinstance(c,str)])
    return out
def opp_attacks(s):
    an=s.get("argument_network") or (s.get("session") or {}).get("argument_network")
    if not an: return {}
    nodes={n["id"]:n for n in an.get("nodes",[]) if n.get("id")}; res={}
    for ed in an.get("edges",[]):
        if ed.get("type")!="attacks": continue
        src=nodes.get(ed.get("source")); tgt=nodes.get(ed.get("target"))
        if src and tgt and (src.get("speaker","") or "").lower()!=(tgt.get("speaker","") or "").lower() and src.get("text"):
            res.setdefault((tgt.get("speaker","") or "").lower(),[]).append(src["text"])
    return res

fs=[f for f in sorted(glob.glob(os.path.join(DATA,"debates","debate-*.json"))) if "undefined" not in f][-90:]
model=SentenceTransformer("all-MiniLM-L6-v2")
pairs=[]  # (cosine, challenge, attack)
for f in fs:
    try: s=json.load(open(f,encoding="utf-8"))
    except: continue
    ch=challenges(s); at=opp_attacks(s)
    for sp,cl in ch.items():
        al=at.get(sp,[])
        if not cl or not al: continue
        ce=model.encode(cl,normalize_embeddings=True); ae=model.encode(al,normalize_embeddings=True)
        sims=ce@ae.T
        for j in range(len(cl)):
            k=int(sims[j].argmax()); pairs.append((float(sims[j][k]), cl[j], al[k]))

# stratified sample across cosine bins 0.30-0.75
bins=[(0.30,0.40),(0.40,0.48),(0.48,0.55),(0.55,0.62),(0.62,0.75)]
sel=[]
for lo,hi in bins:
    cand=[p for p in pairs if lo<=p[0]<hi]
    cand.sort(key=lambda x:x[1])  # deterministic order (no RNG available)
    step=max(1,len(cand)//8)
    sel += cand[::step][:8]
print(f"# tau-golden worksheet: {len(sel)} pairs across cosine bins (label MATERIALIZED 1/0)\n")
for i,(c,ch,at) in enumerate(sorted(sel,reverse=True),1):
    print(f"[{i}] cos={c:.3f}  LABEL=__")
    print(f"   CH : {ch[:200]}")
    print(f"   ATK: {at[:200]}\n")
