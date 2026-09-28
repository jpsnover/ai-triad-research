# logical_form v3: defect scan + Part-1 wrapper-strip dry-run (t/3351)

**Author:** Computational Linguist. **Status:** Part 1 (code, class B) validated by dry-run and ready to land; Part 2 (prompt, class A) authored below, routes to PowerShell; the corpus `--apply` is gated on PI /data-mutation authorization.

Closes the "the 27 defects exist only in live data, no scan code survives" gap (t/3351#1) with a committed, deterministic instrument, and proves the class-B fix without any corpus write.

## Reproducible baseline (committed tool)

`scan_lf_defects.py` (this dir) deterministically scans the live corpus `logical_form` frames for the two clear-defect classes. Current baseline (641 formalized frames):

| Class | Count | Notes |
|---|---|---|
| A, stance-verb predicate | **14** (10 pure + 4 borderline) | pure: prioritize/maintain/seek/align/favor; borderline: `hold`/`report` (may be legitimate content, hold-liable, mandated report-to-body) |
| B, discourse-as-agent | **10** | args ref = `lit:"<camp> discourse"` (9) + one `"public AI discourse"` |
| **Total** | **24 / 641 = 3.7%** | ~matches the t/3239 promotion's ~4.2% (27); the small delta is corpus evolution since + a broader `[auto]` regex in the original that wasn't preserved |

The 14 stance count reproduces the t/3351#1 design exactly. The count is now reproducible on demand, not stranded in one analysis.

## Part 1 (code, class B): wrapper-strip, VALIDATED by dry-run

**Root cause:** node descriptions verbatim begin `A(n) <Belief|Desire|Intention> within <camp> discourse that <verb>...` (917/959 frames). The model read that literal wrapper as an AGENT (`<camp> discourse`) despite the prompt's line-37 ban, it was being asked to ignore text it was handed.

**Fix:** `formalize_node_lf.py` `build_prompt` now strips the wrapper prefix at the source (`strip_discourse_wrapper`), so "discourse" is never a candidate agent; the camp is carried by `modality.holder`.

**Dry-run (the 23 unique defect nodes, v2 prompt + wrapper-strip, no corpus write):**

| | baseline (v2) | dry-run (v2 + wrapper-strip) |
|---|---|---|
| Class B discourse-as-agent | 10 | **1** |
| Class A stance-verb | 14 | 12 (~unchanged, within LLM noise) |

**Class B: 10 → 1.** The wrapper-strip eliminated 9/10. The survivor (skp-beliefs-125, `"public AI discourse"`) is a *content* phrase, not the `within <camp> discourse` wrapper, a different, rarer pattern the regex correctly does not touch. This is a mechanistic result (the wrapper is deterministically absent from the model input), so it is robust to the n=23 / single-draft caveat below. Class A is unchanged, as expected, Part 1 does not target it.

**Provenance caveat:** n=23, single dry-run draft, LLM-stochastic. The class-B result is mechanistic (robust); the class-A numbers are noisy at this n and are not a reliability claim.

## Part 2 (prompt, class A): authored, routes to PowerShell (`scripts/` scope)

The 12 residual class-A defects need the prompt, not code (every one is ALREADY in the line-39 ban list yet emitted). Prompt content is CL's artifact class; the file lives in PowerShell's scope, so these edits route to them to land. Two surgical edits to `scripts/AITriad/Prompts/logical-form-formalization.prompt`:

**Edit 1, disambiguation sub-rule, appended to the line-39 self-check** (protects the borderline `hold`/`report` from over-strip):

> EXCEPTION, the following are CONTENT, not stance, and stay as the predicate: `hold` when it means hold-liable / hold-accountable (legal responsibility); `report` / `disclose` when it names a mandated disclosure act to a body. All OTHER uses of the banned verbs (including `maintain`, `prioritize`, `favor`, `align`, `seek`) strip to the embedded content action.

**Edit 2, three few-shot before/after anchors** (the abstract list demonstrably isn't enough, these verbs are banned yet emitted):
- `maintain` → strip: "…maintain human oversight of AI" ⇒ predicate `oversee`/`control` (the content act), not `maintain`.
- `prioritize` → strip: "…prioritize safety research funding" ⇒ predicate `fund`/`allocate`, not `prioritize`.
- `hold-liable` → KEEP: "…hold developers liable for harms" ⇒ predicate `hold` (content: legal responsibility), the anchor that prevents the new over-strip.

**Before landing Edit 1+2:** a follow-up dry-run WITH the edited prompt (same 23 nodes, `--ids`) should measure the class-A delta and confirm the KEEP anchor protects the borderline cases (no over-strip regression), re-scored against `analyses/lf-golden-v2/` (v2 baseline strict 0.778 / lenient 0.978, v3 must not regress lenient). That dry-run pairs with PowerShell once they apply the prompt edits.

## Gated next step (NOT done here)

`formalize_node_lf.py --apply` overwrites `logical_form` on all 641 grounded nodes across `ai-triad-data/taxonomy/Origin/{acc,saf,skp}.json`, a corpus-wide /data-mutation write (frozen list + recorded PI authorization + second-agent verify + 0-collateral proof, per the v2 precedent `6b14b701`), and re-stamps `status: proposed`, reverting the t/3239 approvals (needs a re-run of `promote_node_lf_status.py --apply`). **Low-priority + gated:** the apply-run waits for PI authorization when prioritized. This increment delivers the reproducible instrument + the validated class-B fix + the authored class-A prompt edits, all without a corpus write.
