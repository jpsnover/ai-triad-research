#!/usr/bin/env python3
"""Fold filled B1.5 answers (b1.5-answers.csv) back into the adjudication package (t/3611).

Reads `b1.5-answers.csv` (from make_b15_worksheet.py, GOLD columns filled with 0/1),
validates every row, writes GOLD_concession / GOLD_retained_hold (+ note) into the
matching items of `b1.5-adjudication-package.json`, and reports.

Refuses to write unless EVERY package item (disagreements + spot-checks) has a valid
0/1 in both GOLD columns, so a partial fill cannot silently produce a half-baked gold set.

Usage: python import_b15_answers.py           # validate + write the package
       python import_b15_answers.py --run      # also run finalize_b1_gold.py after
"""
import json, os, csv, sys, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))

def load(name):
    return json.load(open(os.path.join(HERE, name), encoding='utf-8'))

pkg = load('b1.5-adjudication-package.json')
items = pkg.get('disagreements', []) + pkg.get('agreement_spotcheck', [])
pkg_ids = {r['sample_id'] for r in items}

# read answers
ans = {}
errors = []
csv_path = os.path.join(HERE, 'b1.5-answers.csv')
if not os.path.exists(csv_path):
    sys.exit("b1.5-answers.csv not found. Run make_b15_worksheet.py first.")
with open(csv_path, encoding='utf-8', newline='') as fh:
    for i, row in enumerate(csv.DictReader(fh), start=2):
        sid = (row.get('sample_id') or '').strip()
        if not sid:
            continue
        def parse(col):
            v = (row.get(col) or '').strip()
            if v not in ('0', '1'):
                errors.append(f"row {i} ({sid}): {col} = '{v}' (must be 0 or 1)")
                return None
            return int(v)
        c = parse('GOLD_concession'); h = parse('GOLD_retained_hold')
        ans[sid] = {'concession': c, 'retained_hold': h, 'note': (row.get('note') or '').strip()}

# completeness: every package item present + valid
missing = pkg_ids - set(ans)
if missing:
    errors.append(f"{len(missing)} package item(s) have no CSV row: {sorted(missing)[:8]}")
extra = set(ans) - pkg_ids
if extra:
    errors.append(f"{len(extra)} CSV row(s) not in the package (typo?): {sorted(extra)[:8]}")

if errors:
    print("WILL NOT WRITE - fix these first:")
    for e in errors:
        print("  -", e)
    sys.exit(1)

# write GOLD_* back
for r in items:
    a = ans[r['sample_id']]
    r['GOLD_concession'] = a['concession']
    r['GOLD_retained_hold'] = a['retained_hold']
    if a['note']:
        r['adjudicator_note'] = a['note']

with open(os.path.join(HERE, 'b1.5-adjudication-package.json'), 'w', encoding='utf-8') as fh:
    json.dump(pkg, fh, indent=1, ensure_ascii=False)

print(f"wrote {len(items)} adjudicated items into b1.5-adjudication-package.json.")
if '--run' in sys.argv:
    print("running finalize_b1_gold.py ...\n")
    subprocess.run([sys.executable, os.path.join(HERE, 'finalize_b1_gold.py')])
else:
    print("Next: python finalize_b1_gold.py")
