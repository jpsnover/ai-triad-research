#!/usr/bin/env python
"""t/2392: classify the extraction-noise flag population (top-1 < band) into
categories: math_notation, ocr_garble, table_id, pii_conversational,
citation_ref, genuine_weak. Reuses the t2381 corpus-scan logic + text field.
Dumps full JSON for hand-verification and prints per-band category fractions.
"""
import json, glob, os, re
import numpy as np

DR = os.path.abspath('../ai-triad-data')
HERE = os.path.dirname(__file__)

base = json.load(open(DR + '/taxonomy/Origin/embeddings.json', encoding='utf-8'))['nodes']
pov_mats, pov_ids = {}, {}
for pref, pov in [('acc-', 'acc'), ('saf-', 'saf'), ('skp-', 'skp')]:
    ids = [k for k in base if k.startswith(pref)]
    M = np.asarray([base[k]['vector'] for k in ids], dtype=np.float32)
    M = M / np.clip(np.linalg.norm(M, axis=1, keepdims=True), 1e-9, None)
    pov_mats[pov] = M; pov_ids[pov] = ids

def kp_field(o):
    for f in ('attribution_text', 'verbatim', 'point'):
        t = o.get(f)
        if t:
            return (' '.join(t) if isinstance(t, list) else t), f
    return '', None

rows = []  # (pov, node, text, field, file, conf)
for fp in glob.glob(DR + '/summaries/*.json'):
    try:
        d = json.load(open(fp, encoding='utf-8'))
    except Exception:
        continue
    fn = os.path.basename(fp)
    def walk(o):
        if isinstance(o, dict):
            nid = o.get('taxonomy_node_id')
            if isinstance(nid, str) and nid[:4] in ('acc-', 'saf-', 'skp-'):
                txt, fld = kp_field(o)
                if isinstance(txt, str) and len(txt) >= 20:
                    rows.append((nid[:3], nid, txt, fld, fn, o.get('extraction_confidence')))
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(d)
print('assigned key_points scanned:', len(rows))

from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
emb = model.encode([r[2] for r in rows], batch_size=256, convert_to_numpy=True, show_progress_bar=False)
emb = emb / np.clip(np.linalg.norm(emb, axis=1, keepdims=True), 1e-9, None)

top1 = np.empty(len(rows), dtype=np.float32); top1_node = [None]*len(rows)
for pov in ('acc', 'saf', 'skp'):
    idxs = [i for i, r in enumerate(rows) if r[0] == pov]
    if not idxs: continue
    sims = emb[idxs] @ pov_mats[pov].T
    am, mx = sims.argmax(axis=1), sims.max(axis=1)
    for j, i in enumerate(idxs):
        top1[i] = mx[j]; top1_node[i] = pov_ids[pov][am[j]]

# ---- classifier (ordered; first match wins) ----
SSN = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')
TABLE_ID = re.compile(r'\b([A-Z]{1,5}\d*-[A-Z]{2,4}-\d{2,4}|AATMF|Finding ID|====|\[(?:CRITICAL|HIGH|MEDIUM|LOW)\s*:\s*\d+\])')
MATH = re.compile(r'(iff\b|if and only if|Theorem|Lemma|Proposition|Corollary|Hahn-Banach|Credal|KL divergence|convex|almost surely|\bP0\b|P_0|\?exp|BF\(x\)|\\?\bBT scores|half planes|Separation Theorem|marginally|gambles)')
CITATION = re.compile(r'(et al\.?|see for example|\(19\d\d\)|\(20\d\d\)|Chapter \d|arXiv|doi:|pp\.\s*\d)')
FIRST_PERSON = re.compile(r"\b(I|my|me|you|your)\b", re.I)
EMOTION = re.compile(r"(broke up|lost faith|running out of time|no one to talk|girlfriend|boyfriend|deflecting|blamed you|listens to me)", re.I)

def token_glue_ratio(t):
    toks = re.findall(r'\S+', t)
    if not toks: return 0.0
    longish = sum(1 for w in toks if len(w) >= 22)  # words with stripped spaces
    return longish / len(toks)

def classify(t):
    if SSN.search(t) or EMOTION.search(t):
        return 'pii_conversational'
    if TABLE_ID.search(t):
        return 'table_id'
    if token_glue_ratio(t) >= 0.12 or re.search(r'[A-Za-z]{24,}', t):
        return 'ocr_garble'
    if MATH.search(t):
        return 'math_notation'
    if CITATION.search(t):
        return 'citation_ref'
    # short first-person conversational without emotion keywords
    words = re.findall(r'\S+', t)
    if len(words) <= 14 and FIRST_PERSON.search(t) and not re.search(r'\b(AI|model|system|data|risk|safety|policy|algorithm)\b', t, re.I):
        return 'pii_conversational'
    return 'genuine_weak'

bands = [0.30, 0.35, 0.40]
dump = {}
for thr in bands:
    idxs = [i for i in range(len(rows)) if top1[i] < thr]
    cats = {}
    items = []
    for i in idxs:
        pov, node, txt, fld, fn, conf = rows[i]
        c = classify(txt)
        cats[c] = cats.get(c, 0) + 1
        items.append({'node': node, 'top1': round(float(top1[i]), 3), 'top1_node': top1_node[i],
                      'cat': c, 'field': fld, 'conf': conf, 'file': fn, 'text': txt[:300]})
    n = len(idxs)
    print(f'\n=== band top-1 < {thr}: n={n} ===')
    for c in sorted(cats, key=lambda k: -cats[k]):
        print(f'  {c:20s} {cats[c]:4d}  ({100*cats[c]/n:4.1f}%)')
    dump[str(thr)] = {'n': n, 'cats': cats, 'items': items}

# noise vs genuine summary for the headline band
b = dump['0.3']
noise = sum(v for k, v in b['cats'].items() if k != 'genuine_weak')
print(f"\n<0.30: NOISE {noise}/{b['n']} = {100*noise/b['n']:.1f}%  | genuine_weak {b['cats'].get('genuine_weak',0)} = {100*b['cats'].get('genuine_weak',0)/b['n']:.1f}%")

# field-absence signal: how many flagged lack attribution_text
for thr in bands:
    it = dump[str(thr)]['items']
    no_attr = sum(1 for x in it if x['field'] != 'attribution_text')
    print(f"  <{thr}: {no_attr}/{len(it)} ({100*no_attr/len(it):.0f}%) had NO attribution_text (fell back to verbatim/point)")

json.dump(dump, open(os.path.join(HERE, 'noise_classification.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\nsaved noise_classification.json')
