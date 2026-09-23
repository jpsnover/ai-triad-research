#!/usr/bin/env python3
"""Deepening-cell hypothesis check for the drift-state estimator (t/3602).

Tests the design's load-bearing premise: does the low-s_seed / high-s_crux cell
exist? If ArCo-binary (a single seed-similarity threshold) flags turns as "drift"
that actually engage an active crux, the crux dimension is warranted.

PRECONDITION CHECK, NOT VALIDATION. These are un-annotated cosine scores; "high
s_crux = deepening" is a stipulated interpretation the human study (AC 3-4) must
confirm. Reports structure, not a validated metric.

Method:
- turn vectors: persisted `turn_embeddings` (engine ONNX all-MiniLM, ~half the corpus).
- seed vector: embed topic.scope.core_proposition (fallback topic.final) via
  scripts/embed_taxonomy.py batch-encode (pytorch sentence-transformers all-MiniLM).
- crux vectors: embed each crux_tracker[].description likewise.
- s_seed = cos(turn, seed); s_crux = max_c cos(turn, crux_c).

Caveat: the two embedder backends agree at cosine ~0.98 on a short turn, so a ~0.02
systematic offset is mixed in. It does not affect the qualitative result (the effect
sizes here are ~0.2, an order of magnitude larger), but a fully rigorous run would
embed turns through the same path.

Usage: AI_TRIAD_DATA_ROOT=<data checkout> python deepening_cell.py
"""
import json, glob, os, subprocess, sys, math, statistics
from collections import Counter

DATA = os.environ.get('AI_TRIAD_DATA_ROOT')
if not DATA:
    sys.exit('set AI_TRIAD_DATA_ROOT to the ai-triad-data checkout')
# repo root = 4 levels up from this file (research/comp-linguist/analyses/t3602-.../)
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
EMBED = os.path.join(REPO, 'scripts', 'embed_taxonomy.py')


def cos(a, b):
    return sum(x * y for x, y in zip(a, b))  # both L2-normalized -> dot == cosine


def main():
    debates, to_embed = [], []
    for f in sorted(glob.glob(os.path.join(DATA, 'debates', 'debate-*.json'))):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        te = d.get('turn_embeddings') or {}
        cx = d.get('crux_tracker') or []
        if not (hasattr(te, '__len__') and len(te) and cx):
            continue
        did = d.get('id')
        topic = d.get('topic') or {}
        cp = (topic.get('scope') or {}).get('core_proposition')
        seed = cp or topic.get('final') or ''
        if not seed.strip():
            continue
        turns = [{'tid': e['id'], 'vec': te[e['id']]} for e in (d.get('transcript') or [])
                 if isinstance(e, dict) and e.get('id') in te and isinstance(te[e['id']], list)]
        cruxes = [{'id': c.get('id'), 'text': (c.get('description') or '').strip()}
                  for c in cx if (c.get('description') or '').strip()]
        if not turns or not cruxes:
            continue
        to_embed.append({'id': f'seed::{did}', 'text': seed[:900]})
        for c in cruxes:
            to_embed.append({'id': f"crux::{did}::{c['id']}", 'text': c['text'][:900]})
        debates.append({'did': did, 'seed_from': 'core_proposition' if cp else 'topic.final',
                        'turns': turns, 'crux_ids': [c['id'] for c in cruxes]})

    print(f"both-debates: {len(debates)}; texts embedded: {len(to_embed)}; "
          f"seed source: {dict(Counter(d['seed_from'] for d in debates))}", file=sys.stderr)
    out = subprocess.run([sys.executable, EMBED, 'batch-encode'], input=json.dumps(to_embed),
                         capture_output=True, text=True, timeout=1800)
    if out.returncode != 0:
        sys.exit(f'batch-encode failed rc={out.returncode}: {out.stderr[-400:]}')
    emb = json.loads(out.stdout)

    rows = []
    for d in debates:
        sv = emb.get(f"seed::{d['did']}")
        cvs = [emb[f"crux::{d['did']}::{cid}"] for cid in d['crux_ids'] if f"crux::{d['did']}::{cid}" in emb]
        if not sv or not cvs:
            continue
        for t in d['turns']:
            rows.append((cos(t['vec'], sv), max(cos(t['vec'], cv) for cv in cvs)))

    n = len(rows)
    ss, sc = [r[0] for r in rows], [r[1] for r in rows]
    mss, msc = statistics.mean(ss), statistics.mean(sc)
    r = (sum((a - mss) * (b - msc) for a, b in rows) / n) / (statistics.pstdev(ss) * statistics.pstdev(sc))
    print(f"\nturns analyzed: {n} across {len(debates)} debates")
    print(f"s_seed: med {statistics.median(ss):.3f} mean {mss:.3f} [{min(ss):.3f}, {max(ss):.3f}]")
    print(f"s_crux: med {statistics.median(sc):.3f} mean {msc:.3f} [{min(sc):.3f}, {max(sc):.3f}]")
    print(f"corr(s_seed, s_crux) = {r:.3f}")
    ARCO = 0.5
    low = [x for x in rows if x[0] < ARCO]
    print(f"\nArCo-binary drift set (s_seed < {ARCO}): {len(low)} ({100*len(low)/n:.1f}%)")
    for thr in (0.5, 0.45, 0.4, 0.35):
        cell = [x for x in low if x[1] >= thr]
        print(f"  deepening cell (s_seed<{ARCO} and s_crux>={thr}): {len(cell)} "
              f"({100*len(cell)/n:.1f}% of all; {100*len(cell)/max(1,len(low)):.1f}% of drift set)")
    gaps = [x[1] - x[0] for x in low]
    print(f"  low-seed turns: s_crux-s_seed med {statistics.median(gaps):+.3f}; "
          f"s_crux>s_seed in {sum(1 for g in gaps if g>0)}/{len(gaps)}")


if __name__ == '__main__':
    main()
