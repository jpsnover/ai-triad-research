#!/usr/bin/env python3
"""t/1252 verification: for the exp-topicres-* debates (post-fix build), measure whether
(A) the system synthesis conclusion now carries topic_resolution and answers the topic, and
(B) each POV's closing statement ties back to the topic. Compare vs the 0.43 audit baseline."""
import json, os, re, glob, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
CR = os.path.join(DEB, 'cli-runs')
BASELINE = 0.43
STOP = set('the a an of to in and or for on with that this these those is are be as by it its their our we they you what under given how which whether should would could can will may might into about not no yes than then from at more most such very any all each both while when where who whom your his her them there here'.split())

def keyterms(s):
    return {w for w in re.findall(r"[a-z][a-z'-]{3,}", (s or '').lower()) if w not in STOP}

def overlap(topic_kt, text):
    tk = keyterms(text)
    return len(topic_kt & tk) / len(topic_kt) if topic_kt else 0.0

def topic_str(d):
    t = d.get('topic')
    if isinstance(t, str): return t
    if isinstance(t, dict):
        for k in ('text','question','topic','refined','title','original'):
            if isinstance(t.get(k), str): return t[k]
    return d.get('title') or ''

def find_session(slug):
    # this harness persists the full session in cli-runs; fall back to debates/debate-<id>.json
    direct = os.path.join(CR, f'{slug}-debate.json')
    if os.path.exists(direct): return direct
    h = os.path.join(CR, f'{slug}-harvest.json')
    if not os.path.exists(h): return None
    hv = json.load(open(h, encoding='utf-8'))
    did = hv.get('debate_id') or hv.get('id')
    p = os.path.join(DEB, f'debate-{did}.json')
    return p if os.path.exists(p) else None

POVS = ('accelerationist','safetyist','skeptic','Accelerationist','Safetyist','Skeptic')
for slug in ['exp-topicres-binary','exp-topicres-open','exp-topicres-structured']:
    sp = find_session(slug)
    print(f"\n{'='*72}\n{slug}")
    if not sp:
        print("  (no session yet)"); continue
    d = json.load(open(sp, encoding='utf-8'))
    topic = topic_str(d); tkt = keyterms(topic)
    print(f"  topic: {topic[:90]}")
    tr = d.get('transcript', [])
    # (A) system synthesis
    conc = [e for e in tr if e.get('type') == 'concluding']
    if conc:
        syn = (conc[0].get('metadata') or {}).get('synthesis') or {}
        res = syn.get('topic_resolution') if isinstance(syn, dict) else None
        print(f"  [A] topic_resolution present: {bool(res)}")
        if isinstance(res, dict):
            print(f"      restated_question: {str(res.get('restated_question'))[:100]}")
            wl = str(res.get('where_it_landed') or '')
            print(f"      where_it_landed overlap: {overlap(tkt, wl):.2f}  (vs {BASELINE} baseline)")
            print(f"      what_would_resolve_it: {str(res.get('what_would_resolve_it'))[:90]}")
    else:
        print("  [A] no concluding entry")
    # (B) per-POV closing statements = last statement/opening per speaker
    last_by_pov = {}
    for e in tr:
        if e.get('type') in ('statement','opening') and e.get('speaker') in POVS:
            last_by_pov[e['speaker'].lower()] = e.get('content') if isinstance(e.get('content'), str) else ''
    print(f"  [B] per-POV closing-statement topic overlap (vs {BASELINE}):")
    for pov, txt in last_by_pov.items():
        print(f"      {pov:16} overlap={overlap(tkt, txt):.2f}")
