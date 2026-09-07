# Logical-form golden v2 (formalization_accuracy) — committed for paper reproducibility

CL single-annotator blind golden for the `logical_form` layer's `formalization_accuracy` metric, v2.
Committed per t/2294 (a paper figure must be reproducible) for the t/3346 paper integration.

## Result (paper-canonical)
- **strict (exact-match): 0.778 — the paper HEADLINE accuracy (n=45).**
- lenient: 0.978 — a **diagnostic upper bound** that also credits minor argument-role imprecision; NOT the headline.
- breakdown: 35 correct / 9 minor / 1 wrong. off-enum-sort gate: PASS.

## Reproduce
```
python research/comp-linguist/tools/score_lf_golden.py --worksheet research/comp-linguist/analyses/lf-golden-v2/worksheet-v2-labeled.md
```
Expected: `overall strict=0.778 lenient=0.978 (correct=35 minor=9 wrong=1)`, off-enum-sort PASS.

## Provenance
- **Prompt:** v2 stance-strip (#1917, commit `a9c93103`) — the CURRENT production formalization prompt.
- **Supersedes:** the earlier `0.802 / n=31` measurement on the prior single-prompt golden (`1103ed06`), now marked superseded.
- **Labeling:** CL single-annotator, blind — judged from each frame + its claim text. The gemini AI-judge was NOT used (it over-flags content verbs like "operationalize" as stance and returned a false-low 0.62). This is the load-bearing caveat for the paper: single-annotator reference, not inter-annotator agreement.
- **Grades:** `correct` = predicate + arg roles/sorts + polarity + modality all faithful; `minor` = right predicate + modality but one arg role/sort off or one arg missing; `wrong` = wrong predicate, stance-verb left in, discourse-as-agent, or inverted polarity.
- **match_level:** exact-only in practice (t/3238) — a `minor` frame counts against strict accuracy with no partial credit.

## Files
- `worksheet-v2-labeled.md` — the 45-frame golden with CL blind VERDICT + NOTES per frame (the scoring input).
- `worksheet-v2-unlabeled.md` — the same 45 frames without labels (for independent blind re-labeling).
