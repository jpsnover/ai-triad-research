#!/usr/bin/env python
"""Linchpin check for t/2392:
(A) top-1 distribution split by attribution_text PRESENT vs ABSENT.
(B) sample of <0.30 'genuine_weak' items for hand review.
"""
import json, glob, os, re, random
import numpy as np

DR = os.path.abspath('../ai-triad-data')
HERE = os.path.dirname(__file__)
random.seed(2392)

base = json.load(open(DR + '/taxonomy/Origin/embeddings.json', encoding='utf-8'))['nodes']
pov_mats, pov_ids = {}, {}
for pref, pov in [('acc-', 'acc'), ('saf-', 'saf'), ('skp-', 'skp')]:
    ids = [k for k in base if k.startswith(pref)]
    M = np.asarray([base[k]['vector'] for k in ids], dtype=np.float32)
    M = M / np.clip(np.linalg.norm(M, axis=1, keepdims=True), 1e-9, None)
    pov_mats[pov] = M; pov_ids[pov] = ids

rows = []  # (pov, node, text, has_attr, file)
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
                at = o.get('attribution_text')
                has_attr = bool(at)
                txt = at if has_attr else (o.get('verbatim') or o.get('point') or '')
                txt = ' '.join(txt) if isinstance(txt, list) else txt
                if isinstance(txt, str) and len(txt) >= 20:
                    rows.append((nid[:3], nid, txt, has_attr, fn))
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(d)

from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
emb = model.encode([r[2] for r in rows], batch_size=256, convert_to_numpy=True, show_progress_bar=False)
emb = emb / np.clip(np.linalg.norm(emb, axis=1, keepdims=True), 1e-9, None)
top1 = np.empty(len(rows), dtype=np.float32)
for pov in ('acc', 'saf', 'skp'):
    idxs = [i for i, r in enumerate(rows) if r[0] == pov]
    if not idxs: continue
    sims = emb[idxs] @ pov_mats[pov].T
    mx = sims.max(axis=1)
    for j, i in enumerate(idxs): top1[i] = mx[j]

has = np.array([r[3] for r in rows])
print('total key_points:', len(rows))
print('WITH attribution_text:', int(has.sum()), ' WITHOUT:', int((~has).sum()))
for label, mask in [('WITH attr', has), ('WITHOUT attr', ~has)]:
    t = top1[mask]
    pct = np.percentile(t, [0, 1, 5, 25, 50])
    print(f'\n{label} (n={mask.sum()}): min={t.min():.3f} p1={pct[1]:.3f} p5={pct[2]:.3f} p25={pct[3]:.3f} median={pct[4]:.3f}')
    for thr in (0.30, 0.35, 0.40, 0.45):
        print(f'   < {thr}: {int((t<thr).sum())} ({100*(t<thr).mean():.1f}%)')

# cross-tab: of the <0.30 population, how many have attribution_text?
lo = top1 < 0.30
print(f'\n<0.30 population n={int(lo.sum())}: with_attr={int((lo & has).sum())}  without_attr={int((lo & ~has).sum())}')

# sample genuine_weak (WITHOUT attr, <0.30, not matching noise regexes) for hand review
noise_re = re.compile(r'\b\d{3}-\d{2}-\d{4}\b|[A-Za-z]{24,}|AATMF|====|Theorem|iff\b|Credal|Hahn-Banach|et al', re.I)
cand = [i for i in range(len(rows)) if lo[i] and not rows[i][3] and not noise_re.search(rows[i][2])]
print(f'\n--- {len(cand)} <0.30 non-regex-noise samples; showing 40 random for hand review ---')
for i in random.sample(cand, min(40, len(cand))):
    print(f'  [{rows[i][1]} {top1[i]:.3f}] {rows[i][2][:150]}')
