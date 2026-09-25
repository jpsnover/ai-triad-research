#!/usr/bin/env python3
"""Generate a readable B1.5 adjudication worksheet + CSV answer template for the
drift-state study (t/3630). Reads drift-b15-package.json (siblings); writes LOCAL
drift-worksheet.md (read) + drift-answers.csv (fill GOLD_topical_state).

Usage: python make_drift_worksheet.py
"""
import json, os, csv
HERE = os.path.dirname(os.path.abspath(__file__))
pkg = json.load(open(os.path.join(HERE, 'drift-b15-package.json'), encoding='utf-8'))
dis, spot = pkg.get('disagreements', []), pkg.get('agreement_spotcheck', [])

CODEBOOK = (
    "CODEBOOK (core/adjacent/drifted). Judge the TARGET turn's topical relationship to the seeded question + active cruxes:\n"
    "- core: engages the SEEDED QUESTION directly (advances/attacks the core proposition or a sub-claim head-on).\n"
    "- adjacent: not the seed head-on, but engages an ACTIVE CRUX (legitimate deepening). Deepening-into-a-crux = adjacent, NEVER drifted.\n"
    "- drifted: off the seeded question AND not on any active crux (genuine topic departure).\n"
    "Judge the relationship, not keyword overlap; a fluent substantive turn can still be drifted."
)

def trunc(t, n):
    t = (t or '').strip()
    return t if len(t) <= n else t[:n] + " [...truncated; full text in package...]"

L = ["# B1.5 drift-state adjudication worksheet (t/3630)\n",
     "Read each item; set `topical_state` (core/adjacent/drifted) in `drift-answers.csv`, then run `python import_drift_answers.py --run`.\n",
     "```\n" + CODEBOOK + "\n```\n",
     f"**{len(dis)} disagreements + {len(spot)} agreement spot-checks = {len(dis)+len(spot)} items.** "
     "The spot-checks are agreed-`core` turns: confirm, or overturn if the LLMs over-called `core` (that would mean drift is being missed).\n"]

def block(r, kind, agreed=None):
    o = [f"\n---\n\n## {r['sample_id']}  ({kind})"]
    if agreed: o.append(f"**Both LLMs said:** {agreed} (confirm or overturn)")
    else:
        o.append(f"- **A:** {r['annotator_A']['state']} - {r['annotator_A'].get('note','')}")
        o.append(f"- **B:** {r['annotator_B']['state']} - {r['annotator_B'].get('note','')}")
    o.append(f"\n**Seeded question:** {r.get('seeded_question','')}")
    cx = r.get('active_cruxes', [])
    o.append(f"**Active cruxes ({len(cx)}):**")
    for c in cx[:12]: o.append(f"  - {trunc(c, 200)}")
    ctx = r.get('context_prior_turns', [])
    if ctx:
        o.append("\n**Prior context:**")
        for c in ctx: o.append(f"> _{c.get('speaker')}:_ {trunc(c.get('text'), 500)}")
    o.append(f"\n**TARGET turn (judge this):**\n> {r.get('target_text','')}")
    o.append(f"\n**YOUR CALL -> {r['sample_id']}: topical_state = ______**")
    return "\n".join(o)

for r in dis: L.append(block(r, 'disagreement'))
for r in spot: L.append(block(r, 'spot-check', agreed=r.get('both_agree')))
open(os.path.join(HERE, 'drift-worksheet.md'), 'w', encoding='utf-8').write("\n".join(L) + "\n")

rows = [{'sample_id': r['sample_id'], 'kind': 'disagreement', 'GOLD_topical_state': '', 'note': ''} for r in dis] \
     + [{'sample_id': r['sample_id'], 'kind': 'spot-check', 'GOLD_topical_state': '', 'note': ''} for r in spot]
with open(os.path.join(HERE, 'drift-answers.csv'), 'w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=['sample_id', 'kind', 'GOLD_topical_state', 'note']); w.writeheader(); w.writerows(rows)
print(f"wrote drift-worksheet.md ({len(dis)+len(spot)} items) + drift-answers.csv (blank).")
print("Next: read drift-worksheet.md, fill GOLD_topical_state (core|adjacent|drifted) in drift-answers.csv, then python import_drift_answers.py --run")
