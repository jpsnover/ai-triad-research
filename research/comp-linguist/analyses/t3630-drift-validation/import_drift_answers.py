#!/usr/bin/env python3
"""Import human GOLD_topical_state from drift-answers.csv into drift-b15-package.json (t/3630).
Validates the 3-class label, writes GOLD into every matching item, optionally runs the finalizer.

Usage: python import_drift_answers.py [--run]
"""
import json, os, csv, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
STATES = {'core', 'adjacent', 'drifted'}
pkg = json.load(open(os.path.join(HERE, 'drift-b15-package.json'), encoding='utf-8'))
ans = {r['sample_id']: r for r in csv.DictReader(open(os.path.join(HERE, 'drift-answers.csv'), encoding='utf-8'))}

items = pkg['disagreements'] + pkg['agreement_spotcheck']
by_id = {it['sample_id']: it for it in items}
missing = [sid for sid in by_id if sid not in ans]
if missing:
    sys.exit(f"ERROR: {len(missing)} package items absent from CSV: {missing[:5]}")

filled, bad = 0, []
for sid, row in ans.items():
    if sid not in by_id:
        bad.append(f"{sid}: not in package"); continue
    g = (row.get('GOLD_topical_state') or '').strip().lower()
    if g == '':
        bad.append(f"{sid}: blank"); continue
    if g not in STATES:
        bad.append(f"{sid}: '{g}' not in {sorted(STATES)}"); continue
    by_id[sid]['GOLD_topical_state'] = g
    if (row.get('note') or '').strip():
        by_id[sid]['adjudicator_note'] = row['note'].strip()
    filled += 1

if bad:
    sys.exit("ERROR: fix these rows before import:\n  " + "\n  ".join(bad))

json.dump(pkg, open(os.path.join(HERE, 'drift-b15-package.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"imported {filled}/{len(by_id)} GOLD labels into drift-b15-package.json")
if '--run' in sys.argv:
    print("--- running finalize_drift.py ---")
    subprocess.run([sys.executable, os.path.join(HERE, 'finalize_drift.py')], check=True)
else:
    print("Next: python finalize_drift.py")
