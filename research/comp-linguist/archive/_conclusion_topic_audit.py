#!/usr/bin/env python3
"""t/1246: do CLOSED debates' final/concluding statements tie back to & address the original topic?
Closed = session has a type:'concluding' transcript entry. Scores topic key-term overlap in the
concluding synthesis text + inspects synthesis structure for an explicit topic/verdict field."""
import json, os, re, glob, sys
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
DEB = r"C:/Users/jsnov/repos/ai-triad-data/debates"
STOP = set('the a an of to in and or for on with that this these those is are be as by it its their our we they you what under given how which whether should would could can will may might into about not no yes than then from at more most such very any all each both while when where who whom your his her them there here'.split())

def topic_str(d):
    t = d.get('topic')
    if isinstance(t, str): return t
    if isinstance(t, dict):
        for k in ('text', 'question', 'topic', 'refined', 'title', 'original'):
            if isinstance(t.get(k), str): return t[k]
        return json.dumps(t, ensure_ascii=False)
    return d.get('title') or ''

def keyterms(s):
    return {w for w in re.findall(r"[a-z][a-z'-]{3,}", (s or '').lower()) if w not in STOP}

def synth_text(syn):
    """flatten synthesis dict into text for term-overlap scoring"""
    if isinstance(syn, str): return syn
    if isinstance(syn, dict):
        parts = []
        for v in syn.values():
            if isinstance(v, str): parts.append(v)
            elif isinstance(v, list):
                for it in v:
                    if isinstance(it, str): parts.append(it)
                    elif isinstance(it, dict): parts.append(' '.join(str(x) for x in it.values() if isinstance(x, str)))
        return ' '.join(parts)
    return ''

rows = []
synth_keys_seen = Counter()
for f in glob.glob(os.path.join(DEB, 'debate-*.json')):
    try: d = json.load(open(f, encoding='utf-8'))
    except Exception: continue
    conc = [e for e in d.get('transcript', []) if e.get('type') == 'concluding']
    if not conc: continue  # not closed
    topic = topic_str(d)
    tk = keyterms(topic)
    if not tk: continue
    meta = conc[0].get('metadata') or {}
    syn = meta.get('synthesis') if isinstance(meta, dict) else None
    if isinstance(syn, dict):
        for k in syn.keys(): synth_keys_seen[k] += 1
    st = synth_text(syn)
    sk = keyterms(st)
    overlap = len(tk & sk) / len(tk) if tk else 0
    # does synthesis have any field that names the topic / a verdict?
    has_verdict_field = isinstance(syn, dict) and any(k.lower() in
        ('verdict','answer','position','resolution','topic','question','conclusion','bottom_line','summary','headline') for k in syn.keys())
    rows.append((os.path.basename(f)[:20], round(overlap, 2), len(tk), has_verdict_field, topic[:70]))

rows.sort(key=lambda r: r[1])
print(f"CLOSED debates audited: {len(rows)}")
print(f"synthesis field keys (freq): {dict(synth_keys_seen.most_common())}")
import statistics
ovs = [r[1] for r in rows]
print(f"topic-keyterm overlap in conclusion — mean {statistics.mean(ovs):.2f}, median {statistics.median(ovs):.2f}, min {min(ovs):.2f}, max {max(ovs):.2f}")
print(f"conclusions with an explicit verdict/answer/topic field: {sum(1 for r in rows if r[3])}/{len(rows)}")
print("\n=== lowest-overlap conclusions (weakest tie-back) ===")
for r in rows[:8]:
    print(f"  overlap={r[1]:.2f} verdictField={r[3]} | topic: {r[4]}")
print("=== highest-overlap ===")
for r in rows[-4:]:
    print(f"  overlap={r[1]:.2f} verdictField={r[3]} | topic: {r[4]}")
