# Drift-state applicability pass: results + a high-stakes finding (t/3630)

**Author:** Computational Linguist
**Phase:** the two-blind applicability pass (design.md protocol step 2). **This is NOT the reliability result** (step 3, human-gated). Reproduce with `score_drift.py` over the two label files here.

## Method

Two **independent blind** LLM annotators (fresh general-purpose instances, frozen core/adjacent/drifted codebook, the rehydrated worksheet = target turn + prior context + `seeded_question` + `active_cruxes`, **no cosines, no stratum, no hypothesis, no sight of each other**) labeled all **120** turns of the stratified sample (40 deepening_candidate + 40 drift_candidate + 40 core_control). 0 uncodeable. Raw labels: `applicability-annotator-{A,B}.json`.

## Results

| | core | adjacent | drifted |
|---|---|---|---|
| Annotator A | 114 | 6 | 0 |
| Annotator B | 112 | 8 | 0 |

- **Observed agreement Po = 0.967 (N=120); Cohen κ = 0.697** (chance pe = 0.890). The κ is **depressed by extreme prevalence**, the distribution is ~94% `core`, so agreement is dominated by the shared-`core` mass. Read Po and κ together, not κ alone.
- Per-state one-vs-rest agreement: core 0.967, adjacent 0.967, drifted 1.000. Confusion: 111 core-core, 5 adjacent-adjacent, 4 disagreements (3 core↔adjacent A→core/B→adjacent, 1 the reverse). **0 `drifted` from either annotator.**
- **Non-degenerate check: narrowly passes** (neither annotator is *literally* all-one-state, A has 6 adjacent, B has 8), but the distribution is near-constant-core. Treat this as a skew flag, not a clean pass.

## The finding (LLM-applicability + HYPOTHESIS, not validated)

Two things, both consequential:

1. **Both blind annotators independently find ~0 drift and ~94% core**, across a sample **deliberately oversampled** for the low-`s_seed` turns the cosine flagged as drift/deepening candidates.
2. **The cosine strata do NOT predict the topical-state label.** The 40 `drift_candidate` turns (low `s_seed` AND low `s_crux`, the cosine's "genuine drift" cell) were labeled **`core` 37/40**. The `deepening_candidate` cell: also 37/40 core. `s_seed`/`s_crux` and the human-style topical judgment are essentially uncorrelated in this sample.

**Two readings, disambiguated only by the human B1.5:**
- **(a) Genuine topical drift is ~0 in these debates.** Debaters stay on the seeded question; low seed-cosine is a *wording-distance artifact*, not topic departure. If so, ArCo's 66.6%-of-turns "drift" flag (deepening-cell run) is almost entirely false positives, and **the 3-band drift estimator is solving a near-nonexistent problem**, its value proposition collapses, and t/3602/t/3603 should be reconsidered before more is built on the cosine signal.
- **(b) The two LLM annotators share a `core`-over-calling bias** (reluctant to call a substantive, fluent turn `drifted`). If so, the estimator may still be warranted, but *LLM annotation cannot validate it*, the human is required, and the codebook may need a sharper `core` boundary.

Distinguishing (a) from (b) is exactly what the human adjudication resolves. It is **not** decidable from LLM labels, two LLMs agreeing does not rule out correlated error, and here the agreement sits on a near-degenerate distribution.

## B1.5 handoff (the decisive human step)

`drift-b15-package.json`: **4 disagreements** + **15 agreement spot-checks**. The spot-checks are now the pivotal probe (not a formality): they are agreed-`core` turns drawn from all three cosine strata. If the human **overturns** agreed-`core` items to `drifted`/`adjacent`, reading (b) holds (LLM core-bias). If the human **confirms** them, reading (a) holds (drift is genuinely ~0), a result that reframes the entire drift-estimator effort. Either outcome is a real finding.

## Consequences

- **AC 2 (reliability) / AC 3 (tuning): still open, human-gated.** Threshold tuning is moot until the human resolves whether a `drifted` class meaningfully exists at all, you can't tune bands for a state with zero instances.
- **Upstream flag (not a halt, theirs to decide):** t/3603 (DebateTool drift telemetry) will, on this evidence, log ~all `core`; and t/3602's estimator premise rests on the cosine signal this pass found uncorrelated with topical judgment. Surfacing to the PI/PM so the human validation is prioritized *before* more is built on the drift signal.
- Provenance: LLM-applicability, anchors nothing. `topical_state` stays stipulated until human B1.5 (which now also has to settle whether the construct is populated at all).
