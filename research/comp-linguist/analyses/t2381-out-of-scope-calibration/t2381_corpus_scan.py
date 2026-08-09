#!/usr/bin/env python
"""t/2381 flag-population scan: across ALL assigned key_points in the corpus,
compute POV-filtered base top-1 (the guard's Arm-A signal) and count how many
fall < 0.30 (Arm A; Arm C auto-holds since top-1 is the max < 0.45).
Answers TL: does the out-of-scope flag fire on ANY real key_points?"""
import json, glob, os
import numpy as np

DR = os.path.abspath('../ai-triad-data')
CEIL = 0.30
FLOOR = 0.45

# ---- base vectors per POV ----
base = json.load(open(DR + '/taxonomy/Origin/embeddings.json', encoding='utf-8'))['nodes']
pov_mats = {}
pov_ids = {}
for pref, pov in [('acc-', 'acc'), ('saf-', 'saf'), ('skp-', 'skp')]:
    ids = [k for k in base if k.startswith(pref)]
    M = np.asarray([base[k]['vector'] for k in ids], dtype=np.float32)
    M = M / np.clip(np.linalg.norm(M, axis=1, keepdims=True), 1e-9, None)
    pov_mats[pov] = M
    pov_ids[pov] = ids
print('base nodes:', {p: len(pov_ids[p]) for p in pov_ids})

# ---- gather all assigned key_points ----
def kp_text(o):
    t = o.get('attribution_text') or o.get('verbatim') or o.get('point') or ''
    return ' '.join(t) if isinstance(t, list) else t

rows = []  # (pov, node, text, file)
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
                txt = kp_text(o)
                if isinstance(txt, str) and len(txt) >= 20:
                    rows.append((nid[:3], nid, txt, fn))
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(d)

print('assigned key_points scanned:', len(rows))

# ---- embed all (batched) ----
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
texts = [r[2] for r in rows]
emb = model.encode(texts, batch_size=256, convert_to_numpy=True, show_progress_bar=False)
emb = emb / np.clip(np.linalg.norm(emb, axis=1, keepdims=True), 1e-9, None)

# ---- POV-filtered top-1 per key_point ----
top1 = np.empty(len(rows), dtype=np.float32)
top1_node = [None] * len(rows)
for pov in ('acc', 'saf', 'skp'):
    idxs = [i for i, r in enumerate(rows) if r[0] == pov]
    if not idxs:
        continue
    sims = emb[idxs] @ pov_mats[pov].T   # (n_pov, n_nodes)
    am = sims.argmax(axis=1)
    mx = sims.max(axis=1)
    for j, i in enumerate(idxs):
        top1[i] = mx[j]
        top1_node[i] = pov_ids[pov][am[j]]

# ---- report ----
pct = np.percentile(top1, [1, 5, 10, 25, 50, 90, 100])
print('\n=== POV-filtered base top-1 distribution (n=%d) ===' % len(rows))
print('  min=%.3f  p1=%.3f  p5=%.3f  p10=%.3f  p25=%.3f  median=%.3f  p90=%.3f  max=%.3f'
      % (top1.min(), pct[0], pct[1], pct[2], pct[3], pct[4], pct[5], pct[6]))
for thr in (0.30, 0.35, 0.40, 0.45):
    print('  top-1 < %.2f : %d  (%.2f%%)' % (thr, int((top1 < thr).sum()), 100 * (top1 < thr).mean()))

fire = np.where(top1 < CEIL)[0]
print('\n=== FLAG POPULATION: Arm A (top-1 < %.2f) — %d key_points ===' % (CEIL, len(fire)))
for i in fire[:40]:
    pov, node, txt, fn = rows[i]
    print('  [%s | top1=%.3f -> %s] %s' % (node, top1[i], top1_node[i], txt[:110]))
if len(fire) > 40:
    print('  ... (%d more)' % (len(fire) - 40))
