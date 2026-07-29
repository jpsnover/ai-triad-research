#!/usr/bin/env python3
"""t/1586 — generate the pass-2 rating sheet for the intra-rater test-retest leg.

Per PREREG-t1586-single-rater.md §2: same frozen 60 items, freshly reshuffled row
order (seed=15862), rating columns blanked so pass-1 answers are not visible.
Run AFTER pass 1 is complete and only hand the output to the rater once the
>=48h washout has elapsed.

    python generate_pass2_sheet.py
"""
import csv, os, sys
import numpy as np
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

RESHUFFLE_SEED = 15862   # per prereg — do not change
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'debate-tested-rating-sheet.csv')
OUT = os.path.join(HERE, 'debate-tested-rating-sheet-pass2.csv')


def main():
    with open(SRC, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = [r for r in reader if (r.get('item_id') or '').strip()]
    if os.path.exists(OUT):
        sys.exit(f"ERROR: {os.path.basename(OUT)} already exists — the pass-2 sheet is "
                 "generated once. Delete it deliberately if you really mean to regenerate.")

    rng = np.random.default_rng(RESHUFFLE_SEED)
    order = rng.permutation(len(rows))
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for idx in order:
            row = dict(rows[idx])
            row['rater_assigned_tier'] = ''
            row['rater_notes'] = ''
            writer.writerow(row)
    print(f"wrote {OUT} ({len(rows)} items, reshuffled seed={RESHUFFLE_SEED}, ratings blanked)")


if __name__ == '__main__':
    main()
