# node.logical_form promotion (t/3239) — v2 refresh + proposed→approved

The 641 grounded BDI node frames were promoted `proposed → approved` on 2026-09-06 (PI-authorized promote-as-is).

## What / how
1. **v2 refresh** — `tools/formalize_node_lf.py --apply` re-formalized all 641 grounded nodes with the current v2 stance-strip prompt (`#1917` / `a9c93103`). The in-data frames were previously old-prompt (~9.5% clear-defect); the refresh dropped this to **4.2%** (discourse-as-agent 6.3%→2.0%, stance-verb predicates 3.3%→2.2%). off-enum-sort gate PASS.
2. **flip** — `tools/promote_node_lf_status.py --apply` set `status: proposed → approved` on all 641.
3. **commit** — `ai-triad-data` `6b14b701` (3 POV files; **0 non-LF node changes vs HEAD** — acc 133 / saf 274 / skp 234; `conflicts.json` untouched). Live on origin (carried up by the Fork-B push `c61ff98c`).

## Gate + provenance
- `formalization_accuracy` = **0.778 strict / 0.978 lenient** (n=45, CL single-annotator, v2 prompt); reproducible golden at `lf-golden-v2/`. Register updated at t/3346 reconciliation (#2018); strict 0.778 is the headline, lenient a diagnostic upper bound.
- All 4 promotion-gate conditions met (t/3239#4): golden ✓, universal-sort ✓ (t/3251), shared Zod schema ✓ (t/3250), read-path ✓ (t/3252).
- Provenance class: `stipulated` (CL single-annotator; PI accepted as-is for v1).

## Residual (v3 targets)
~4.2% of frames (27/641) still trip a clear-defect marker — mostly borderline stance verbs (`prioritize`/`maintain`/`hold`) that are legitimate content verbs in some contexts, plus a few genuine discourse-as-agent residuals. Accepted as the v1 quality; tracked as a v3 prompt-tuning follow-up.

## Reproduce
```
python research/comp-linguist/tools/formalize_node_lf.py --apply        # v2 re-formalize (uses shipped prompt)
python research/comp-linguist/tools/promote_node_lf_status.py --apply    # flip proposed->approved
python research/comp-linguist/tools/score_lf_golden.py --worksheet research/comp-linguist/analyses/lf-golden-v2/worksheet-v2-labeled.md
```
