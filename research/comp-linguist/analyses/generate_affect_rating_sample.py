#!/usr/bin/env python3
"""t/1342: build the stratified ~108-turn sample for affect-instrument human validation.

Population: debater statements (opening|statement, POV speakers, non-empty) from
sessions with >=6 such statements. Strata: phase-bucket x speaker. Phase comes from
adaptive_staging_diagnostics.signal_telemetry (round -> phase); sessions without
telemetry fall back to round terciles (early/middle/late). Seeded RNG for
reproducibility. Outputs:
  _affect_rating_manifest.json  (full metadata, NOT shown to raters)
  affect-rating-sheet.csv       (blind: item id + text + empty rating columns)
"""
import json, glob, os, csv, random, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

DEBATES = r"C:/Users/jsnov/repos/ai-triad-data/debates"
OUT_DIR = r"C:/Users/jsnov/repos/ai-triad-data/research-artifacts/comp-linguist/affect-validation"
os.makedirs(OUT_DIR, exist_ok=True)
SEED = 1342
TARGET_PER_CELL = 9   # cells = buckets x 3 speakers; ~108 items at 4 buckets
SPEAKERS = ('accelerationist', 'safetyist', 'skeptic')
PHASE_BUCKETS = ('confrontation', 'argumentation', 'synthesis', 'concluding')

def phase_for_round(session, rnd, max_round):
    tele = (session.get('adaptive_staging_diagnostics') or {}).get('signal_telemetry') or []
    best = None
    for t in tele:
        if isinstance(t, dict) and t.get('round') is not None and t.get('phase'):
            if t['round'] <= rnd and (best is None or t['round'] > best[0]):
                best = (t['round'], t['phase'])
    if best and best[1] in PHASE_BUCKETS:
        return best[1]
    # tercile fallback mapped onto the phase axis
    if max_round <= 1:
        return 'argumentation'
    frac = rnd / max_round
    if frac <= 0.34: return 'confrontation'
    if frac <= 0.67: return 'argumentation'
    if frac <= 0.85: return 'synthesis'
    return 'concluding'

def main():
    rng = random.Random(SEED)
    pool = {}  # (bucket, speaker) -> list of items
    for f in sorted(glob.glob(os.path.join(DEBATES, 'debate-*.json'))):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        tr = d.get('transcript') or []
        stmts = [e for e in tr if e.get('type') in ('opening', 'statement')
                 and e.get('speaker') in SPEAKERS and (e.get('content') or '').strip()]
        if len(stmts) < 6:
            continue
        rounds = [((e.get('metadata') or {}).get('round') or 0) for e in stmts]
        max_round = max(rounds) if rounds else 1
        for e in stmts:
            rnd = (e.get('metadata') or {}).get('round') or 0
            bucket = phase_for_round(d, rnd, max_round)
            key = (bucket, e['speaker'])
            pool.setdefault(key, []).append({
                'debate_id': d.get('id') or os.path.basename(f),
                'file': os.path.basename(f),
                'entry_id': e.get('id'),
                'round': rnd,
                'phase_bucket': bucket,
                'speaker': e['speaker'],
                'text': e['content'].strip(),
            })

    picked = []
    short = []
    for bucket in PHASE_BUCKETS:
        for sp in SPEAKERS:
            cell = pool.get((bucket, sp), [])
            rng.shuffle(cell)
            take = cell[:TARGET_PER_CELL]
            if len(take) < TARGET_PER_CELL:
                short.append((bucket, sp, len(take)))
            picked.extend(take)

    rng.shuffle(picked)  # blind ordering on the sheet
    for i, item in enumerate(picked, 1):
        item['item_id'] = f'A{i:03d}'

    manifest = {
        'ticket': 't/1342', 'seed': SEED, 'target_per_cell': TARGET_PER_CELL,
        'total_items': len(picked),
        'cells_short': [{'bucket': b, 'speaker': s, 'got': n} for b, s, n in short],
        'items': picked,
    }
    mpath = os.path.join(OUT_DIR, '_affect_rating_manifest.json')
    json.dump(manifest, open(mpath, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)

    spath = os.path.join(OUT_DIR, 'affect-rating-sheet.csv')
    with open(spath, 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh)
        w.writerow(['item_id', 'statement',
                    'urgency_0_2', 'fear_0_2', 'hope_0_2', 'outrage_0_2', 'empathy_0_2',
                    'distorts_reasoning_0_2', 'notes'])
        for item in picked:
            w.writerow([item['item_id'], item['text'], '', '', '', '', '', '', ''])

    print(f'items: {len(picked)} | cells short: {len(short)} {short if short else ""}')
    print(f'manifest: {mpath}')
    print(f'sheet:    {spath}')

if __name__ == '__main__':
    main()
