#!/usr/bin/env python3
"""3-way: expensive (all-Opus) vs cite-only (cite=flash-lite) vs brief+cite (both flash-lite).
Isolates whether the brief+cite regression comes from BRIEF or CITE."""
import json, glob, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
DATA = r"C:/Users/jsnov/repos/ai-triad-data"
CR = os.path.join(DATA, 'debates', 'cli-runs')

idx = {}
for jf in glob.glob(os.path.join(DATA,'calibration/**/calibration-log.jsonl'),recursive=True)+\
          glob.glob(os.path.join(DATA,'debates/calibration/**/calibration-log.jsonl'),recursive=True):
    for line in open(jf,encoding='utf-8'):
        line=line.strip()
        if not line: continue
        try:
            e=json.loads(line); d=e.get('debate_id')
            if d: idx[d]=e
        except: pass

def cal(path):
    try:
        i=json.load(open(path,encoding='utf-8')).get('id')
        return idx.get(i)
    except: return None

def diag(path):
    p=path.replace('-debate.json','-diagnostics.json')
    if os.path.exists(p):
        return json.load(open(p,encoding='utf-8')).get('overview',{})
    return {}

KEY = [  # the 3 regressions + context
    ('crux_addressed_ratio','crux_addressed',True),
    ('claims_forgotten_rate','claims_forgotten',False),
    ('avg_utilization_rate','utilization',True),
    ('avg_grounding_confidence','grounding',True),
    ('process_reward_mean','PRM_mean',True),
    ('topic_alignment_rate','topic_align',True),
]

for topic in ['compute-licensing','labor-policy']:
    exp = os.path.join(CR,f'exp-phase2-{topic}-expensive-debate.json')
    cite= os.path.join(CR,f'exp-citeonly-{topic}-cheap-debate.json')
    bc  = os.path.join(CR,f'exp-phase2-{topic}-cheap-debate.json')
    ce, cc, cb = cal(exp), cal(cite), cal(bc)
    print(f"\n{'='*72}\nTOPIC: {topic}")
    if not (ce and cc and cb):
        print(f"  missing calib — exp={bool(ce)} cite-only={bool(cc)} brief+cite={bool(cb)}"); continue
    de,dc,db = diag(exp),diag(cite),diag(bc)
    def spd(d):
        v=d.get('total_response_time_ms'); return f"{v/1000:.0f}s" if v else "?"
    print(f"  SPEED   expensive={spd(de)}  cite-only={spd(dc)}  brief+cite={spd(db)}")
    print(f"  {'metric':20} {'expensive':>10} {'cite-only':>10} {'brief+cite':>11}   cite-only vs exp")
    for k,label,hib in KEY:
        e,c,b = ce.get(k),cc.get(k),cb.get(k)
        if not all(isinstance(x,(int,float)) for x in (e,c,b)):
            print(f"  {label:20} {str(e):>10} {str(c):>10} {str(b):>11}"); continue
        d_cite = c-e
        bad = (d_cite < -0.05) if hib else (d_cite > 0.05)
        flag = 'WORSE' if bad else ('better' if ((d_cite>0.05) if hib else (d_cite<-0.05)) else 'clean')
        print(f"  {label:20} {e:>10.3f} {c:>10.3f} {b:>11.3f}   {d_cite:+.3f} {flag}")

print("\n  Interpretation: if cite-only ≈ expensive on crux_addressed/claims_forgotten/utilization")
print("  (all 'clean'/'better'), then BRIEF drives the regression and cite=flash-lite is safe.")
