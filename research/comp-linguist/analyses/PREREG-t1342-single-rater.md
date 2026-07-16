# Pre-Registration: Affect Instrument Validation (single-rater revision)

**Study ID:** t/1342
**Author:** Computational Linguist (Orca)
**Registered:** 2026-07-16
**Supersedes:** the inter-rater α thresholds in the affect rating protocol (α ≥ 0.6 as-is / 0.4 to 0.6 experimental / < 0.4 retired)
**Sample:** frozen. seed=1342, ~108 debater statements, phase-bucket × speaker strata (9 per cell), manifest `_affect_rating_manifest.json`, blind sheet `affect-rating-sheet.csv`. This revision changes only the estimand and the decision rules, never the sample.

## Why this revision exists

The original design estimated inter-rater reliability (Krippendorff's α) across two or more raters coding the same ~108 statements. That estimator is undefined with one rater, and only one rater is available. The estimand cannot be swapped silently after rating begins, so the new estimand and its decision rules are registered here first.

The affect instrument (`lib/debate/affectSignals.ts`) is a lexicon scorer. It reads a debater statement and emits a graded intensity per dimension. The most direct validation question is whether those lexicon scores track what a human reader perceives in the same statement. That is criterion validity, and it needs one human.

## Dimensions under test

Six per-statement dimensions, each on a 0 to 2 human scale, matched to the instrument's per-dimension scores:

- urgency
- fear
- hope
- outrage
- empathy
- distorts_reasoning (the human counterpart of the instrument's `affect_appropriateness` / distortion signal)

Each dimension is validated independently. The instrument can pass on some dimensions and fail on others, and the register records the outcome per dimension rather than as one verdict.

## Estimands

### 1. Criterion validity (primary, per dimension)

Association between the human 0 to 2 rating and the instrument's score for the same statement, computed separately for each dimension over the ~108 statements.

- Estimator: Spearman's ρ. The human scale is a short ordinal (three points), so a rank correlation is the honest choice over Pearson.
- Report: ρ per dimension with a bootstrap 95% CI (2,000 resamples, seed=1342), plus a scatter or crosstab of human score against binned instrument score so floor and ceiling effects are visible.

### 2. Intra-rater test-retest (reliability leg, per dimension)

The same rater codes the same statements twice. Pass 2 runs after a washout of at least 48 hours, on a freshly reshuffled sheet (new `item_id` order, seed=13422 for the reshuffle), with the pass-1 ratings not visible. Agreement between pass 1 and pass 2 measures whether the human applies each dimension's rubric stably.

- Estimator: Spearman's ρ on pass-1 vs pass-2 human scores, per dimension. Quadratic-weighted κ is reported alongside for dimensions where the three-point scale behaves ordinally.
- This is the reliability estimate that survives with one rater, and it gates the criterion result per dimension.

### 3. LLM as second rater (optional, triangulation only)

A model other than any used to build the affect lexicon scores the same statements on the same 0 to 2 scale. Report human-vs-LLM ρ per dimension. This triangulates, it never gates. An LLM rater shares the single-rater limitation and is discounted accordingly.

## Order of computation

Compute test-retest first, per dimension. A dimension the human cannot re-rate stably cannot yield an interpretable criterion result, so its reliability ρ is read before its criterion ρ.

## Decision rules (pre-registered, no post-hoc adjustment)

Applied per dimension. Let ρ_rt be the test-retest ρ and ρ_cv the criterion ρ for a dimension.

**Reliability gate (read first):**

| ρ_rt | Meaning | Consequence |
|---|---|---|
| ≥ 0.60 | Human applies this dimension's rubric stably. | Criterion ρ is interpretable as instrument behavior. |
| 0.40 – 0.60 | Rubric partially stable. | Criterion ρ carries a stability caveat. |
| < 0.40 | Dimension not stably rateable by the human. | Do not interpret criterion ρ. Sharpen the dimension's operational definition and re-run before any keep-or-drop call. |

**Criterion decision (read second, only where ρ_rt ≥ 0.40):**

| Condition | Outcome for that dimension |
|---|---|
| ρ_cv ≥ 0.50 and ρ_rt ≥ 0.60 | Dimension validated. Lexicon score kept as-is. |
| 0.30 ≤ ρ_cv < 0.50 | Dimension kept with an "experimental" flag on its signal. |
| ρ_cv < 0.30 and ρ_rt ≥ 0.60 | Lexicon does not track human perception, and the human is stable, so the gap is the instrument's. Retire or redesign that dimension's lexicon. |
| ρ_cv < 0.30 and ρ_rt < 0.60 | Uninterpretable. Rater instability confounds the result. Re-run that dimension. |

## The distortion-weight question

The affect distortion weights (fear and outrage weighted above hope and empathy in the reasoning-distortion signal) are currently stipulated, and t/1342 was scoped to derive them or drop them. This study feeds that decision. If the human `distorts_reasoning` rating correlates more strongly with the fear and outrage dimensions than with hope and empathy, that is weak support for the asymmetric weighting. If it does not, the weights are dropped in favor of an unweighted sum. The correlation is reported as secondary evidence, not a gate, and any weight change is registered separately.

## What one rater can and cannot establish

A single-rater criterion result establishes that this rater's perception of affect tracks (or does not track) the lexicon score, per dimension. It does not establish that human readers in general perceive the same affect intensities. An inter-subjective claim still requires at least two humans and remains future work. The write-up states this limitation next to the per-dimension ρ table.

## Provenance

The per-dimension estimators and thresholds are stipulated at registration. When the study runs, each dimension's row in `metric-provenance-register.md` moves from stipulated toward human-validated or validated-negative according to its outcome, and the headline "0 human-validated" count updates. The affect distortion-weight row updates only if the weight decision is taken in the same landing. Design-stage rows are recorded in register § 8 in the same change that registers this document.

## Computation artifacts

`reliability_metrics.py` computes weighted κ today. Add a Spearman-ρ path that takes a human-score column and an instrument-score column and emits ρ + bootstrap CI per dimension, for both the criterion pair and the test-retest pair. The instrument scores come from running `affectSignals.ts` over the sampled statements, joined on `item_id`.
