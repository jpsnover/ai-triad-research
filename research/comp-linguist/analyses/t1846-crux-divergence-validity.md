# Validity re-examination: `crux_resolution_divergence_rate` (t/1846 §E)

**Author:** Computational Linguist
**Last updated:** 2026-07-28
**Trigger:** TL ruling t/1843#1 — "re-examine whether it measures what it claims — redefine or drop if invalid, don't merely down-weight." RA flag at t/1832#3.

## What the metric claims

Per `calibrationLogger/schema.ts`: "How often engine crux status agrees with neutral evaluator crux status." It is consumed by `optimizeCruxThreshold` (`calibrationOptimizer.ts`), which nudges `crux_resolution.polarity_resolved` toward the center whenever average divergence exceeds 0.4 — i.e., it is (was) an optimizer objective input, not just a diagnostic.

## What the metric actually computes

From `calibrationLogger/extract.ts` (Parameter 8 block): take the engine's `crux_tracker` array and the final neutral evaluation's `cruxes` array, walk them **by position** up to `min(length)`, and count positions where `engineResolved` (`status ∈ {resolved, addressed}`) disagrees with `evalAddressed` (`status === 'addressed'`). Divergences / minLen.

## Three validity defects

**1. Ground-truth circularity (the RA/TL flag — confirmed).** The comparison treats the neutral evaluator as the reference for the engine tracker. The t/1835 probe measured that evaluator's crux judgments moving MAD 0.625 (band ≤0.10) under an evaluator-model swap — the "reference" is itself the least stable instrument in the comparison. A high reading cannot distinguish "engine mis-tracked the crux" from "this evaluator model counts cruxes differently," and the t/1846 pin makes readings *stable*, not *right*. As an agreement-with-truth claim, the metric is invalid by construction.

**2. Positional matching is not identity matching.** The two crux lists are independently generated and never ID- or content-matched; the code comment asserts "both ordered by importance," but the engine's ordering (tracker insertion/importance) and the evaluator's ordering (free-form LLM listing) have no alignment guarantee. A mere permutation of the same cruxes — identical statuses, different order — produces spurious divergence. The signal therefore confounds *status disagreement* with *list-order disagreement*, and the confound grows with crux count.

**3. Direction-blind consumption.** `optimizeCruxThreshold` acknowledges "we can't tell direction from divergence alone" and moves `polarity_resolved` toward the center on a high reading. Adjusting a real engine threshold on a signal that is (per defects 1–2) circular AND order-confounded is exactly the corruption path the t/1843 ruling closed.

## Verdict: **invalid as an objective; redefine as a symmetric disagreement diagnostic**

- The metric does not measure what it claims (engine correctness). It measures *instrument disagreement between two uncalibrated instruments plus alignment noise*.
- **Redefinition (semantic, not schema):** read it as `evaluator_engine_crux_disagreement` — a symmetric divergence *diagnostic* in which neither side is privileged. High values mean "the two crux views differ; look at both," never "the engine is wrong." Field name and historical values are retained (no schema break); the register row below carries the redefinition.
- **Permanent exclusion from config-writing objectives.** The t/1846 `CRUX_AXIS_PARAMS` gate already holds `crux_resolution.polarity_resolved`; for THIS metric the hold is **not** lifted by t/1847 reference-calibration — anchoring `crux_addressed_ratio` against a human-scored set validates the evaluator's *status* judgments, but does not repair the positional-alignment confound (defect 2). Re-entry would additionally require matched-crux comparison (R2).
- **Not dropped:** as a diagnostic it retains value (large sustained readings flagged the t/1835 problem in the first place), and dropping the field would orphan historical rows.

## Recommendations

- **R1 (this change, done):** `optimizeCruxThreshold` output is permanently gated from `--apply` via `CRUX_AXIS_PARAMS` (`calibrationOptimizer.ts`, t/1846) — implements "zero weight," with the stronger note that t/1847 alone does not re-admit this metric.
- **R2 (follow-up ticket):** if directional diagnostic value is wanted, replace positional matching with semantic crux matching (embedding similarity between engine crux `description` and evaluator crux `description`, threshold-gated, unmatched cruxes reported separately). Until then, treat the absolute magnitude as noisy and only large deltas as meaningful.
- **R3 (this change, done):** provenance register row updated with the redefinition and the invalid-as-objective finding.
