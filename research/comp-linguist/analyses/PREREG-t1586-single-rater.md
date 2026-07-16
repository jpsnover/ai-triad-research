# Pre-Registration: Debate-Tested Reliability (single-rater revision)

**Study ID:** t/1586
**Author:** Computational Linguist (Orca)
**Registered:** 2026-07-16
**Supersedes:** the inter-rater decision block in `DEBATE-TESTED-RATING-INSTRUCTIONS.md` (§ "Pre-registered decision thresholds")
**Sample:** frozen. seed=1586, 60 items, 15 per tier, manifest `debate-tested-rating-manifest.json`. This revision changes only the estimand and the decision rules, never the sample.

## Why this revision exists

The original design estimated **inter-rater reliability**, computing quadratic-weighted Cohen's κ and Krippendorff's α across two or more raters coding the same 60 items. That estimator is undefined with one rater, and only one rater is available. The estimand cannot be swapped silently after rating begins, so the new estimand and its decision rules are registered here first.

The reframe answers a question that is arguably more direct for this instrument. The Debate-Tested tier is a **rule-based automated classifier** (`lib/debate/debateTested.ts`): it reads a node's recorded debate history and assigns one of four tiers. What we most want to know is whether that automated tier matches the tier a careful human reaches from the same history. That is **criterion validity**, and it needs exactly one human.

## Estimands

### 1. Criterion validity (primary)

Agreement between the human's `rater_assigned_tier` and the instrument's `current_tier` (the algorithmic classification recorded in the manifest), over the 60 items.

- Estimator: quadratic-weighted Cohen's κ. The four tiers are ordinal (`untested` < `cited` < `contested` < `well_tested`), so a one-step disagreement counts less than a three-step one.
- Report: κ with a bootstrap 95% CI (2,000 resamples, seed=1586), plus the 4×4 confusion matrix so systematic off-by-one-tier bias is visible.

### 2. Intra-rater test-retest (reliability leg)

The same rater codes the same 60 items twice. Pass 2 runs after a washout of at least 48 hours, on a freshly reshuffled sheet (new `item_id` order, seed=15862 for the reshuffle), with the pass-1 ratings not visible. Agreement between pass 1 and pass 2 measures whether the human applies the rubric stably.

- Estimator: quadratic-weighted κ on pass-1 vs pass-2 tiers.
- This is the reliability estimate that survives with one rater. It bounds the criterion result: a rater who cannot reproduce their own tiers cannot meaningfully agree or disagree with the instrument.

### 3. LLM as second classifier (optional, triangulation only)

A model other than any used to build the tier ladder classifies the 60 items from history-only, under the same rubric. Report human-vs-LLM weighted κ. This is a triangulating check, never a gate. The tier ladder is rule-based rather than model-authored, so an LLM classifier is a semi-independent reader of the same evidence, but it shares the general limitation of the human single rater and is discounted accordingly.

## Order of computation

Compute test-retest first. It gates interpretation of the criterion result, so read it before trusting the criterion κ.

## Decision rules (pre-registered, no post-hoc adjustment)

Let κ_rt be the test-retest κ and κ_cv the criterion-validity κ.

**Reliability gate (read first):**

| κ_rt | Meaning | Consequence for the criterion result |
|---|---|---|
| ≥ 0.70 | Rater applies the rubric stably. | Criterion κ is interpretable as instrument behavior. |
| 0.50 – 0.70 | Rubric partially stable. | Criterion κ carries a stability caveat in the write-up. |
| < 0.50 | Rater not stable on this rubric. | Do not interpret criterion κ. Revise the rubric or rater training and re-run before any shipping decision. |

**Criterion decision (read second, only if κ_rt ≥ 0.50):**

| Condition | Outcome |
|---|---|
| κ_cv ≥ 0.70 and κ_rt ≥ 0.70 | Instrument accepted. Phase 1 UI ships without caveat. |
| 0.50 ≤ κ_cv < 0.70 | Instrument accepted with an "experimental" label on the tier chip. |
| κ_cv < 0.50 and κ_rt ≥ 0.70 | The tier ladder diverges from careful human judgment, and the rater is stable, so the divergence is attributable to the instrument. Investigation required before Phase 3 (scheduler) is authorized. |
| κ_cv < 0.50 and κ_rt < 0.50 | Uninterpretable. Rater instability confounds the criterion result. Revise and re-run. |

## What one rater can and cannot establish

A single-rater criterion result establishes that **this** rater's reading of the debate history tracks (or does not track) the automated tier. It does not establish that humans in general agree on the tier of a node. An inter-subjective claim (that independent readers converge on the same tier) still requires at least two humans and remains future work. The write-up states this limitation next to the headline κ, not in a footnote.

## Provenance

The three estimators and their thresholds are **stipulated** at registration (asserted decision rules, no prior evidence pointer). When the study runs, the criterion result converts the Debate-Tested tier ladder row in `metric-provenance-register.md` from `stipulated` toward `human-validated` (or `validated-negative` if κ_cv < 0.50 with a stable rater). The design-stage rows are recorded in the register § 8 in the same change that registers this document.

## Computation artifacts

`reliability_metrics.py` already computes quadratic-weighted κ. Extend it (or add a sibling) to take two tier columns and emit κ + bootstrap CI + confusion matrix for both the criterion pair (human vs `current_tier`) and the test-retest pair (pass-1 vs pass-2). No new estimator library is required.
