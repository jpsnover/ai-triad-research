# logical_form v3: defect scan + Part-1 wrapper-strip dry-run (t/3351)

**Author:** Computational Linguist. **Status (2026-10-04):** Part 1 (code, class B) landed (#2497). Part 2 (prompt, class A) landed (#2739) and was dry-run measured: **no net gain on true defects**, and the class-A scanner count turned out to be mostly false positives (see "Part 2 dry-run results"). The recommendation changes from a 641-node apply to a **targeted 10-node class-B apply**, still gated on PI /data-mutation authorization.

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

**Ordering (corrected):** this line originally said to dry-run *before* landing, which contradicted t/3881 (land first, then dry-run). The edits landed first (#2739); that was safe because nothing invokes this prompt automatically (`formalize_node_lf.py`, `Invoke-LogicalFormPass` and `fol-eval-fol.ps1` are all operator-run). The dry-run is below.

## Part 2 dry-run results (v2 vs v3 prompt)

**Design:** the same 23 baseline defect nodes, 3 drafts per prompt, v2 = `13bf5c8b~1` vs v3 = `13bf5c8b` (#2739), gemini-3.5-flash-lite at temperature 0.2, dry-run only. Per-node data: `dryrun-part2.json`.

**Harness note:** `formalize_node_lf.py` hardcodes `REPO` to the shared checkout, which was at `31d2a6ad` *without* the v3 edit. Run as-is, it would have silently measured the old prompt. The run imported the worktree copy, repointed `PROMPT_PATH`, and asserted the v3 markers were present (and absent for v2) before any model call.

**Raw scanner counts (class A / class B per draft):** v2 10/1, 11/1, 11/1 · v3 11/1, 11/1, 11/1. On these counts v3 shows no improvement. The model is near-deterministic at this temperature (most nodes return the same predicate in all 3 drafts), so the v2-vs-v3 differences below are real effects, not sampling noise.

**Adjudication (each flagged v3 frame read against its node description):** the class-A scanner flags any predicate on the ban list, but in most of these frames the verb is the proposition's *content*, not the camp's stance leaking through.

| Outcome | Nodes |
|---|---|
| Fixed by v3 (true stance leak removed) | acc-desires-021 (`prioritize` → `develop`) |
| Improved, unstable | acc-intentions-103 (`impose` → `prohibit` in 2/3 drafts; not scanner-visible) |
| **Regressed by v3** | **saf-intentions-127** (`give` → `hold`: the EXCEPTION licensed the purpose clause "held accountable" over the main act) |
| Scanner false positive (verb is content) | saf-beliefs-095 `seek`, skp-beliefs-196 `favor`, saf-intentions-076 `prioritize`, skp-desires-011 `prioritize`, skp-desires-075 `align`, saf-desires-025 `maintain` (aspectual; `oversee` would be better) |
| Correct KEEP under the exception | saf-desires-002, skp-intentions-040 (`hold`); skp-desires-076, skp-intentions-079 (`report`) |
| Scanner false positive, class B | skp-beliefs-125 (v3 agent is "Machine-Generated Fear"; "Public AI Discourse" is content) |

**True stance-leak defects on this set: 1 under v2, 1 under v3.** v3 fixed one and introduced another, so the net change is zero. Provenance: n = 23 nodes × 3 drafts per prompt; observed outputs; **single annotator (CL), no inter-rater agreement**. Treat the adjudication as indicative, not human-validated.

**What this changes:**
1. **The baseline statistic is inflated.** The "14 stance-verb (10 pure + 4 borderline)" count, and with it the 24/641 = 3.7% (and t/3239's ~4.2%) clear-defect rate, counts lexemes, not defects. On this set the class-A scanner's precision is roughly 1 in 10. The scanner needs a role-based stance test (is the verb the *camp's* attitude toward the content, or the content itself?).
2. **The prompt's line-39 self-check has the same flaw** (it treats any ban-list predicate as unstripped stance). The model correctly resists it in the content cases. The v3 EXCEPTION patches two lexemes but over-applies on saf-intentions-127, and the `maintain` anchor contradicts this ticket's own premise (t/3351 description: "maintain oversight" is content).
3. **Class B is the real, fixable defect.** All 10 corpus class-B nodes get clean v3 frames.

**Golden re-score: NOT run.** `score_lf_golden.py` scores human `VERDICT:` labels; it cannot score fresh frames without someone hand-labeling the 45 golden nodes again. That is moot while no broad apply is proposed. Any future broad apply must pass this gate first (v2 baseline strict 0.778 / lenient 0.978; lenient must not regress).

## Gated next step (NOT done here)

**Superseded recommendation (2026-10-04): a targeted 10-node class-B apply, not the 641-node apply below.** `formalize_node_lf.py --ids <the 10 class-B nodes> --apply` rewrites only those nodes' `logical_form` (the file is re-serialized, but only the listed nodes change). Every one of the 10 is a real fix per the dry-run, and saf-intentions-127 (the v3 regression) is not among them. Conditions: /data-mutation discipline (frozen 10-id list, recorded PI authorization, a 0-collateral diff proving only those 10 `logical_form` values changed); CL reviews each written frame, picking `prohibit` for the unstable acc-intentions-103; the 10 nodes return to `status: proposed` and are re-promoted after review. A broad apply is **not** recommended. It gives no net class-A gain, carries the saf-intentions-127-style regression risk, reverts all t/3239 approvals, and is blocked on the unrun golden gate.

**Original text (kept for the record):**

`formalize_node_lf.py --apply` overwrites `logical_form` on all 641 grounded nodes across `ai-triad-data/taxonomy/Origin/{acc,saf,skp}.json`, a corpus-wide /data-mutation write (frozen list + recorded PI authorization + second-agent verify + 0-collateral proof, per the v2 precedent `6b14b701`), and re-stamps `status: proposed`, reverting the t/3239 approvals (needs a re-run of `promote_node_lf_status.py --apply`). **Low-priority + gated:** the apply-run waits for PI authorization when prioritized. This increment delivers the reproducible instrument + the validated class-B fix + the authored class-A prompt edits, all without a corpus write.
