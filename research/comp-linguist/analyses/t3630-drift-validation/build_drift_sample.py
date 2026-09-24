#!/usr/bin/env python3
"""Build the low-s_seed-oversampled drift-state annotation sample (t/3630).

Reuses the deepening_cell embedding approach: seed (core_proposition|topic.final)
+ crux descriptions embedded via embed_taxonomy.py batch-encode, cosined against
persisted turn_embeddings. Then stratified deterministic sampling that oversamples
the DISCRIMINATING region (low s_seed) and balances the two low-seed cells so the
annotation can separate legitimate deepening (low s_seed / high s_crux) from genuine
drift (low both). Annotators never see the cosines — they go in a separate signals
file used only for the later threshold tuning against human labels.

Emits (to scratchpad first for inspection):
  drift-annotation-manifest.json  — refs only (sample_id, debate_id, turn_id, round, speaker, stratum). NO cosines, NO text.
  drift-signals.json              — sample_id -> {s_seed, s_crux, stratum}  (tuning input; annotators DO NOT see this)
Usage: AI_TRIAD_DATA_ROOT=<data> python build_drift_sample.py
"""
import json, glob, os, subprocess, sys, hashlib, statistics
from collections import Counter

DATA = os.environ['AI_TRIAD_DATA_ROOT']
EMBED = os.path.join(os.environ['REPO'], 'scripts', 'embed_taxonomy.py')
SP = r"C:\Users\jsnov\AppData\Local\Temp\claude\C--Users-jsnov-repos-ai-triad-research-research-comp-linguist\01a0a9ce-3623-70e6-aaa4-77fcf8bac0d4\scratchpad"
SEED_LO = 0.50           # ArCo drift threshold: below = "drift" per the binary baseline
CRUX_HI = 0.50           # provisional high-crux cut (from the deepening-cell run)
TARGET_PER_CELL = 40     # ~40 each: deepening-candidate, drift-candidate, core-control


def cos(a, b):
    return sum(x * y for x, y in zip(a, b))


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
        seed = (topic.get('scope') or {}).get('core_proposition') or topic.get('final') or ''
        if not seed.strip():
            continue
        turns = [{'tid': e['id'], 'round': (i // 3 + 1), 'speaker': e.get('speaker'), 'vec': te[e['id']]}
                 for i, e in enumerate([x for x in (d.get('transcript') or [])
                                        if isinstance(x, dict) and x.get('type') in ('statement', 'opening')
                                        and x.get('id') in te and isinstance(te[x['id']], list)])]
        cruxes = [c.get('description', '').strip() for c in cx if (c.get('description') or '').strip()]
        if not turns or not cruxes:
            continue
        to_embed.append({'id': f'seed::{did}', 'text': seed[:900]})
        for j, ct in enumerate(cruxes):
            to_embed.append({'id': f'crux::{did}::{j}', 'text': ct[:900]})
        debates.append({'did': did, 'turns': turns, 'ncrux': len(cruxes)})

    print(f"both-debates: {len(debates)}; embedding {len(to_embed)} seed+crux texts", file=sys.stderr)
    out = subprocess.run([sys.executable, EMBED, 'batch-encode'], input=json.dumps(to_embed),
                         capture_output=True, text=True, timeout=1800)
    if out.returncode != 0:
        sys.exit(f'batch-encode failed: {out.stderr[-400:]}')
    emb = json.loads(out.stdout)

    rows = []  # per-turn with signals
    for d in debates:
        sv = emb.get(f"seed::{d['did']}")
        cvs = [emb[f"crux::{d['did']}::{j}"] for j in range(d['ncrux']) if f"crux::{d['did']}::{j}" in emb]
        if not sv or not cvs:
            continue
        for t in d['turns']:
            s_seed = cos(t['vec'], sv)
            s_crux = max(cos(t['vec'], cv) for cv in cvs)
            rows.append({'debate_id': d['did'], 'turn_id': t['tid'], 'round': t['round'],
                         'speaker': t['speaker'], 's_seed': round(s_seed, 4), 's_crux': round(s_crux, 4)})

    # stratify
    for r in rows:
        if r['s_seed'] >= SEED_LO:
            r['stratum'] = 'core_control'
        elif r['s_crux'] >= CRUX_HI:
            r['stratum'] = 'deepening_candidate'   # low seed, high crux — the cell the crux dim must rescue
        else:
            r['stratum'] = 'drift_candidate'       # low seed, low crux — genuine-drift candidate
    by = {}
    for r in rows:
        by.setdefault(r['stratum'], []).append(r)

    def det_sample(items, k):
        items = sorted(items, key=lambda r: hashlib.sha256(f"{r['debate_id']}|{r['turn_id']}".encode()).hexdigest())
        if len(items) <= k:
            return items
        stride = len(items) / k
        return [items[int(i * stride)] for i in range(k)]

    sample = []
    for stratum in ('deepening_candidate', 'drift_candidate', 'core_control'):
        sample += det_sample(by.get(stratum, []), TARGET_PER_CELL)
    for j, r in enumerate(sorted(sample, key=lambda r: (r['stratum'], r['debate_id'], r['turn_id']))):
        r['sample_id'] = f'd-{j:03d}'

    manifest = {'meta': {'ticket': 't/3630', 'total_turns_scored': len(rows), 'debates': len(debates),
                         'stratum_populations': {k: len(v) for k, v in by.items()},
                         'sampled': len(sample), 'per_cell_target': TARGET_PER_CELL,
                         'seed_lo': SEED_LO, 'crux_hi': CRUX_HI,
                         'sampling': 'deterministic sha256(debate|turn) sort + stride per stratum; annotators DO NOT see cosines'},
                'sample': [{k: r[k] for k in ('sample_id', 'debate_id', 'turn_id', 'round', 'speaker', 'stratum')} for r in sample]}
    signals = {'meta': manifest['meta'], 'signals': {r['sample_id']: {'s_seed': r['s_seed'], 's_crux': r['s_crux'], 'stratum': r['stratum']} for r in sample}}
    json.dump(manifest, open(os.path.join(SP, 'drift-annotation-manifest.json'), 'w'), indent=1)
    json.dump(signals, open(os.path.join(SP, 'drift-signals.json'), 'w'), indent=1)

    print(f"turns scored: {len(rows)} across {len(debates)} debates")
    print(f"stratum populations: { {k: len(v) for k, v in by.items()} }")
    print(f"sampled: {len(sample)} -> {dict(Counter(r['stratum'] for r in sample))}")
    ss = [r['s_seed'] for r in rows]
    print(f"s_seed dist: med {statistics.median(ss):.3f}; <{SEED_LO}: {sum(1 for x in ss if x < SEED_LO)}/{len(ss)}")
    print("wrote drift-annotation-manifest.json + drift-signals.json")


if __name__ == '__main__':
    main()
