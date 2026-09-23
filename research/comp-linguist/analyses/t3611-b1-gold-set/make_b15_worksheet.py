#!/usr/bin/env python3
"""Generate a readable B1.5 adjudication worksheet + a CSV answer template (t/3611).

Reads `b1.5-adjudication-package.json` (siblings) and writes two LOCAL files (not
committed; they re-render the debate text already in the package):
- `b1.5-worksheet.md`  : one readable block per item (context, target turn, what
  annotators A/B said + evidence, codebook reminder, and a GOLD decision line).
- `b1.5-answers.csv`   : columns sample_id, GOLD_concession, GOLD_retained_hold, note;
  one row per item, the GOLD columns blank for you to fill (0 or 1).

Adjudicate by reading the worksheet, then fill the CSV, then run import_b15_answers.py.

Usage: python make_b15_worksheet.py
"""
import json, os, csv

HERE = os.path.dirname(os.path.abspath(__file__))
CTX_TRUNC = 700  # prior-context turns truncated for readability; target turn is shown in full

def load(name):
    return json.load(open(os.path.join(HERE, name), encoding='utf-8'))

pkg = load('b1.5-adjudication-package.json')
dis = pkg.get('disagreements', [])
spot = pkg.get('agreement_spotcheck', [])

CODEBOOK = (
    "CODEBOOK (frozen, design.md sec 2):\n"
    "- concession = 1 iff the TARGET speaker grants a SPECIFIC opposing proposition as correct/valid "
    "(partial grant counts; NOT politeness, NOT restating-to-attack, NOT self-correction).\n"
    "- retained_hold = 1 iff the TARGET speaker reasserts a claim THEY previously held, IN RESPONSE to "
    "an incoming attack on it (needs a prior hold + an intervening attack; NOT a first statement, "
    "NOT reasserting when unchallenged).\n"
    "- A turn may be positive for BOTH, one, or neither."
)

def trunc(t, n):
    t = (t or '').strip()
    return t if len(t) <= n else t[:n] + " [...truncated for reading; full text in the package...]"

lines = []
lines.append("# B1.5 adjudication worksheet (t/3611)\n")
lines.append("Read each item and decide `concession` and `retained_hold` (0/1) per the codebook. "
             "Record your answers in `b1.5-answers.csv`, then run `python import_b15_answers.py`.\n")
lines.append("```\n" + CODEBOOK + "\n```\n")
lines.append(f"**{len(dis)} disagreements + {len(spot)} agreement spot-checks = {len(dis)+len(spot)} items.** "
             "Disagreements: A and B differed, your call breaks the tie. Spot-checks: A and B agreed; "
             "confirm or overturn (overturns flag shared-LLM over-labeling).\n")

def block(r, kind):
    out = []
    out.append(f"\n---\n\n## {r['sample_id']}  ({kind})")
    out.append(f"*round {r.get('round')}, speaker: {r.get('target_speaker')}*")
    if kind == 'disagreement':
        out.append(f"**In dispute:** {', '.join(r.get('classes_in_dispute', []))}")
        a = r.get('annotator_A', {}); b = r.get('annotator_B', {})
        out.append(f"- **A:** concession={a.get('concession')}, retained_hold={a.get('retained_hold')}"
                   + (f"  | c-evidence: {a.get('concession_evidence','')}" if a.get('concession_evidence') else '')
                   + (f"  | h-evidence: {a.get('hold_evidence','')}" if a.get('hold_evidence') else ''))
        out.append(f"- **B:** concession={b.get('concession')}, retained_hold={b.get('retained_hold')}"
                   + (f"  | c-evidence: {b.get('concession_evidence','')}" if b.get('concession_evidence') else '')
                   + (f"  | h-evidence: {b.get('hold_evidence','')}" if b.get('hold_evidence') else ''))
    else:
        ba = r.get('both_agree', {}); ev = r.get('A_evidence', {})
        out.append(f"**Both annotators agreed:** concession={ba.get('concession')}, retained_hold={ba.get('retained_hold')} "
                   "(confirm, or overturn if wrong)")
        if ev.get('c'):
            out.append(f"- evidence (concession): {ev.get('c')}")
        if ev.get('h'):
            out.append(f"- evidence (retained_hold): {ev.get('h')}")
    ctx = r.get('context_prior_turns', [])
    if ctx:
        out.append("\n**Prior context:**")
        for c in ctx:
            out.append(f"> _{c.get('speaker')}:_ {trunc(c.get('text'), CTX_TRUNC)}")
    out.append("\n**TARGET turn (judge this):**")
    out.append(f"> {r.get('target_text','')}")
    out.append(f"\n**YOUR CALL -> {r['sample_id']}: concession = __ , retained_hold = __**")
    return "\n".join(out)

for r in dis:
    lines.append(block(r, 'disagreement'))
for r in spot:
    lines.append(block(r, 'spot-check'))

with open(os.path.join(HERE, 'b1.5-worksheet.md'), 'w', encoding='utf-8') as fh:
    fh.write("\n".join(lines) + "\n")

# CSV answer template
rows = [{'sample_id': r['sample_id'], 'kind': 'disagreement', 'GOLD_concession': '', 'GOLD_retained_hold': '', 'note': ''} for r in dis]
rows += [{'sample_id': r['sample_id'], 'kind': 'spot-check', 'GOLD_concession': '', 'GOLD_retained_hold': '', 'note': ''} for r in spot]
with open(os.path.join(HERE, 'b1.5-answers.csv'), 'w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=['sample_id', 'kind', 'GOLD_concession', 'GOLD_retained_hold', 'note'])
    w.writeheader()
    w.writerows(rows)

print(f"wrote b1.5-worksheet.md ({len(dis)+len(spot)} items) and b1.5-answers.csv (blank template).")
print("Next: read b1.5-worksheet.md, fill GOLD_concession/GOLD_retained_hold (0/1) in b1.5-answers.csv, then: python import_b15_answers.py")
