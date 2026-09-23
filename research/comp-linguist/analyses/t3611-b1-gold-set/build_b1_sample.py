#!/usr/bin/env python3
"""B1 gold-set candidate sampler (t/3611).

Deterministically selects the scaffold-dense (round>=3) pov-turn stratum for
concession/retained_hold annotation. No RNG: stable sha256(debate_id|turn_id)
sort + even stride, so re-runs are byte-identical.

Usage:
  AI_TRIAD_DATA_ROOT=... python build_b1_sample.py            # writes b1-sample-manifest.json (references only)
  AI_TRIAD_DATA_ROOT=... python build_b1_sample.py --hydrate  # ALSO prints turns with text for the annotation harness

The committed manifest stores references only (sample_id -> debate_id/turn_id/round/speaker);
turn TEXT is re-hydrated from the data repo at annotation time (the data repo is the text SoT;
we do not duplicate debate prose into the code repo).
"""
import json, glob, os, hashlib, sys

TARGET = 150  # provisional; the two-blind applicability pass (AC 2) drives final sizing.
HERE = os.path.dirname(os.path.abspath(__file__))


def collect(data_root):
    cands = []
    for f in sorted(glob.glob(os.path.join(data_root, 'debates', 'debate-*.json'))):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        tr = d.get('transcript')
        if not isinstance(tr, list) or not tr:
            continue
        did = d.get('id') or os.path.basename(f)
        pov = [e for e in tr if isinstance(e, dict) and e.get('type') in ('statement', 'opening')
               and e.get('speaker') in ('accelerationist', 'safetyist', 'skeptic', 'user')]
        for i, e in enumerate(pov):
            rnd = i // 3 + 1
            if rnd < 3:
                continue
            txt = (e.get('content') or '').strip()
            if len(txt) < 40:
                continue
            cands.append({'debate_id': did, 'turn_id': e.get('id'), 'round': rnd,
                          'speaker': e.get('speaker'), 'text': txt})
    return cands


def sample(cands):
    cands.sort(key=lambda c: hashlib.sha256(f"{c['debate_id']}|{c['turn_id']}".encode()).hexdigest())
    n = len(cands)
    picked = cands if n <= TARGET else [cands[int(k * (n / TARGET))] for k in range(TARGET)]
    for j, c in enumerate(picked):
        c['sample_id'] = f'b1-{j:03d}'
    return picked, n


def main():
    data_root = os.environ.get('AI_TRIAD_DATA_ROOT')
    if not data_root:
        sys.exit('set AI_TRIAD_DATA_ROOT to the ai-triad-data checkout')
    picked, pop = sample(collect(data_root))
    meta = {'ticket': 't/3611', 'stratum': 'round>=3 pov statement/opening turns (scaffold-dense)',
            'population_late_round': pop, 'target': TARGET, 'sampled': len(picked),
            'sampling': 'deterministic: sha256(debate_id|turn_id) sort + even stride, no RNG',
            'debates_represented': len(set(c['debate_id'] for c in picked))}
    if '--hydrate' in sys.argv:
        json.dump({'meta': meta, 'sample': picked}, sys.stdout, indent=1, ensure_ascii=False)
        return
    man = {'meta': meta, 'sample': [{k: c[k] for k in ('sample_id', 'debate_id', 'turn_id', 'round', 'speaker')}
                                    for c in picked]}
    with open(os.path.join(HERE, 'b1-sample-manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(man, fh, indent=1, ensure_ascii=False)
    print(f"late-round population {pop}; sampled {len(picked)} across {meta['debates_represented']} debates")


if __name__ == '__main__':
    main()
