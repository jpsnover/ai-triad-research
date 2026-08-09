#!/usr/bin/env python
"""t/2381 out_of_scope_ceiling calibration — reproduce two named misfires + control set
in BOTH base and synthetic-mean embedding spaces. Faithful to Get-RelevantTaxonomyNodes.ps1
scoring: base = cosine to single node['vector']; synthetic = per-node mean of top-N (N=3)
per-synthetic-vector cosines, ranked; base fallback for nodes lacking synthetic vecs."""
import json, glob, os, sys
import numpy as np

DR = os.path.abspath('../ai-triad-data')
SYN_TOP_N = 3
POV_PREFIX = 'saf-'

# ---- load base ----
base = json.load(open(DR + '/taxonomy/Origin/embeddings.json', encoding='utf-8'))['nodes']
base_saf = {k: np.asarray(v['vector'], dtype=np.float32)
            for k, v in base.items() if k.startswith(POV_PREFIX)}

# ---- load synthetic ----
idx = json.load(open(DR + '/taxonomy/Origin/synthetic/index_saf.json', encoding='utf-8'))
npy = np.load(DR + '/taxonomy/Origin/synthetic/embeddings_saf.npy')  # (14216, 384)
syn_saf = {nid: npy[e['start']:e['start'] + e['count']] for nid, e in idx.items()}

def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 0 else v

def base_scores(q):
    qn = unit(q)
    return {k: float(np.dot(qn, unit(v))) for k, v in base_saf.items()}

def syn_scores(q):
    """Mirror the PS scoring: synthetic-mean when available, else base fallback."""
    qn = unit(q)
    out = {}
    for k in base_saf:
        if k in syn_saf and len(syn_saf[k]) > 0:
            M = syn_saf[k]
            Mn = M / np.clip(np.linalg.norm(M, axis=1, keepdims=True), 1e-9, None)
            sims = Mn @ qn
            sims.sort()
            top = sims[::-1][:min(SYN_TOP_N, len(sims))]
            out[k] = float(top.mean())
        else:
            out[k] = float(np.dot(qn, unit(base_saf[k])))
    return out

def topk(scores, k=5):
    return sorted(scores.items(), key=lambda x: -x[1])[:k]

# ---- gather query texts from real summaries ----
def kp_text(o):
    t = o.get('attribution_text') or o.get('verbatim') or o.get('point') or ''
    return ' '.join(t) if isinstance(t, list) else t

CASE_FILES = {
    'saf-beliefs-129': 'advancing-deliberative-discourse-measurement-intersection-2026.json',
    'saf-intentions-008': 'clean-energy-resources-meet-data-center-electricity-demand-2026.json',
}
cases = {}
for node, fn in CASE_FILES.items():
    d = json.load(open(DR + '/summaries/' + fn, encoding='utf-8'))
    found = None
    def walk(o):
        global found
        if isinstance(o, dict):
            if o.get('taxonomy_node_id') == node:
                txt = kp_text(o)
                # pick the on-topic one (deliberation / grid) not the node-description echoes
                if node == 'saf-beliefs-129' and 'deliberation' in txt.lower() and found is None:
                    found = txt
                elif node == 'saf-intentions-008' and 'grid' in txt.lower() and found is None:
                    found = txt
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(d)
    cases[node] = found

# ---- control set: saf key_points where assigned node == base top-1 (LLM/retrieval agree = genuine home) ----
controls = []
seen_files = sorted(glob.glob(DR + '/summaries/*.json'))
for fp in seen_files:
    if len(controls) >= 14:
        break
    try:
        d = json.load(open(fp, encoding='utf-8'))
    except Exception:
        continue
    coll = []
    def walk2(o):
        if isinstance(o, dict):
            nid = o.get('taxonomy_node_id')
            if isinstance(nid, str) and nid.startswith('saf-') and nid not in CASE_FILES:
                txt = kp_text(o)
                if isinstance(txt, str) and len(txt) > 40 and not txt.startswith('A Belief') and not txt.startswith('An Intention') and not txt.startswith('A Desire'):
                    coll.append((nid, txt))
            for v in o.values(): walk2(v)
        elif isinstance(o, list):
            for v in o: walk2(v)
    walk2(d)
    if coll:
        controls.append((os.path.basename(fp), coll[0][0], coll[0][1]))

# ---- embed ----
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')

def report(label, node_assigned, text):
    q = model.encode(text, convert_to_numpy=True)
    b = base_scores(q); s = syn_scores(q)
    bt, st = topk(b), topk(s)
    print(f'\n=== {label} ===')
    print(f'  assigned: {node_assigned}')
    print(f'  text: {text[:180]!r}')
    print(f'  BASE      top-1: {bt[0][0]} = {bt[0][1]:.3f}   | top5: ' + ', '.join(f'{n}:{v:.2f}' for n, v in bt))
    print(f'  SYNTHETIC top-1: {st[0][0]} = {st[0][1]:.3f}   | top5: ' + ', '.join(f'{n}:{v:.2f}' for n, v in st))
    # spotlight candidate homes
    for probe in ('saf-intentions-212', node_assigned):
        if probe in b:
            rb = 1 + sorted(b.values(), reverse=True).index(b[probe])
            rs = 1 + sorted(s.values(), reverse=True).index(s[probe])
            print(f'    probe {probe}: base={b[probe]:.3f}(rank {rb}) syn={s[probe]:.3f}(rank {rs})')
    return bt[0][1], st[0][1]

print('#'*70)
print('NAMED MISFIRES (ticket claims: out-of-scope, no home)')
print('#'*70)
for node, txt in cases.items():
    if txt:
        report(f'MISFIRE {node}', node, txt)
    else:
        print(f'\n!! could not locate on-topic key_point for {node}')

print('\n' + '#'*70)
print('CONTROL SET (in-scope key_points — expect top-1 >= 0.45 both spaces)')
print('#'*70)
cb, cs = [], []
for fn, nid, txt in controls:
    b1, s1 = report(f'CTRL {nid} ({fn})', nid, txt)
    cb.append(b1); cs.append(s1)

print('\n' + '='*70)
print('SUMMARY')
print('='*70)
if cb:
    import statistics as st_
    print(f'control base  top-1: min={min(cb):.3f} med={st_.median(cb):.3f} max={max(cb):.3f} (n={len(cb)})')
    print(f'control synth top-1: min={min(cs):.3f} med={st_.median(cs):.3f} max={max(cs):.3f}')
    print(f'control base  >=0.45: {sum(1 for x in cb if x>=0.45)}/{len(cb)}')
    print(f'control synth >=0.45: {sum(1 for x in cs if x>=0.45)}/{len(cs)}')
