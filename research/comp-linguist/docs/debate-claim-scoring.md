# How Debate Claims Are Scored

**Last updated:** 2026-08-11 · **Owner:** Computational Linguist

This document traces a single debate claim from the moment it is extracted or
generated to the moment it contributes a strength number to convergence,
crux resolution, and calibration. It is the missing companion to
[`calibration-methodology.md`](calibration-methodology.md). That document
explains how the *parameters* are tuned; this one explains how a *claim* is
scored under those parameters.

The load-bearing thing to understand first is that a claim carries two
independent numbers, not one.

| Number | Question it answers | Range | Where it lives |
|--------|--------------------|-------|----------------|
| `extraction_confidence` (**FIRE**) | *Is this claim faithfully grounded in the source text?* | 0–1 | `i-node` field |
| `base_strength` | *How strong is this claim as an argument, before rebuttal?* | 0–1 | QBAF node field |

The two are orthogonal. FIRE is a grounding/faithfulness gate; `base_strength`
is an argument-quality score. A well-grounded claim (FIRE 1.0) can be a weak
argument (`base_strength` 0.2), and the reverse happens just as often. No code
path reads `extraction_confidence` into `base_strength`. Mixing the two up is
the most common error when reasoning about scores.

---

## Stage 0 · FIRE grounding gate (does the claim get in at all?)

FIRE (`extraction_confidence`) is a **word-overlap** faithfulness heuristic, not
a semantic one. When a claim is extracted from a document, its overlap with the
source span is bucketed by `overlapToExtractionConfidence` in
`lib/debate/argumentNetwork/strength.ts`:

```
overlap ≥ 0.7 → 1.0
overlap ≥ 0.5 → 0.8
overlap ≥ 0.3 → 0.6
otherwise     → 0.5
```

Applied at `argumentNetwork/processClaims.ts:224`. If overlap is below the
grounding threshold, the claim is **rejected before scoring** with
`reason: 'low_overlap'` (`processClaims.ts:196`).

The **FIRE confidence threshold** (calibration Parameter P13, default **0.7**)
is not a hardcoded gate here. It is a tunable knob optimized in
`calibrationOptimizer.ts:709` (`optimizeFireThreshold`) against
`borderline_claim_survival_rate`, the fraction of claims accepted at confidence
0.70–0.75 that survive debate un-refuted. See `calibration-methodology.md` P13.

**Takeaway:** FIRE decides admission and survival-tracking. It never sets a
claim's argument strength.

---

## Stage 1 · `base_strength` (how strong is the claim, unopposed?)

Every accepted claim becomes a QBAF node with a `base_strength` in [0,1]. How it
is scored depends on the claim's **BDI category**. All scoring lives in
`lib/debate/argumentNetwork/strength.ts` and is assigned in
`processClaims.ts`. The `scoring_method` field records which path was taken.

- **Default fallback** (`processClaims.ts:214`): `0.5` when no scorer applies.

- **Desire (BDI composite):** mean of three rubric sub-scores,
  `base_strength = (values_grounding + tradeoff_acknowledgment + precedent_citation) / 3`

- **Intention (BDI composite):** mean of three sub-scores,
  `base_strength = (mechanism_specificity + scope_bounding + failure_mode_addressing) / 3`

- **Belief:** scored through a small pipeline, in precedence order.
  - **Fact-check** (`factCheckToBaseStrength`): supported → 0.85 / 0.70 / 0.55,
    disputed/false → 0.15 / 0.30 / 0.40, unverifiable → 0.50. If a web-evidence
    QBAF result exists, its `evidenceStrength` takes precedence (see Stage 3).
  - **ThinkPRM verification** (`beliefVerificationToStrength`):
    `raw = 0.4·locationScore + 0.6·supportScore − counterPenalty − ambiguityPenalty`,
    clamped to `[0.1, 0.95]`.
  - **Specificity proxy** (`BELIEF_SPECIFICITY_MAP`): precise 0.70 / general 0.50 / abstract 0.35.
  - **Discrete NLI proxy** (`normalizeExtractedClaim`): grounded 0.8 / reasoned 0.5 / asserted 0.2
    (belief only; Desire and Intention are pinned to 0.5 at this stage).

This is the number that seeds the QBAF engine. Everything after this is
*propagation*: how the claim's strength changes once other claims attack or
support it.

---

## Stage 2 · QBAF acceptability (how strong is the claim after the debate argues over it?)

The `base_strength` values are the *initial* strengths. The debate graph adds
`attacks` and `supports` edges between claims. `computeQbafStrengths`
(`lib/debate/qbaf.ts:118`) runs **gradual semantics**, a Jacobi-style
fixed-point iteration that runs until strengths converge (Δ < 0.001) or 100
iterations elapse. The result is each claim's **acceptability strength**, the
score used downstream. It is the number shown on the strength badge in the
debate workspace and the diagnostics Argument Network view.

### Edge weighting

Attack edges are scaled by an **attack-type weight** (P3) before aggregation
(`qbaf.ts:151`):

```
rebut 1.0 · undercut 1.05 · undermine 1.1
```

An undercut or undermine bites slightly harder than a plain rebut.

### Aggregation + combination (DF-QuAD, the default)

For each node, incoming attack strengths and support strengths are aggregated
separately, then combined with the node's base:

```
aggregate(influences)      = 1 − Π(1 − vᵢ)                 # DF-QuAD, qbaf.ts:84
combine(base, att, sup):
    if sup ≥ att:  base + (1 − base)·(sup − att)           # qbaf.ts:90
    else:          base − base·(att − sup)
```

Net support pushes strength up toward 1; net attack pulls it down toward 0; the
base anchors where it starts. A legacy `saturating-sum` semantics
(`base·(1−att)·(1+sup)`) is selectable but not the default (superseded at t/1402).

### Stability guards

- **Oscillation damping:** if the max delta stops shrinking (≥95% of prior for 3
  consecutive iterations), damping escalates through `[0.3, 0.5, 0.7, 0.85]`.
- **Non-convergence fallback:** the final strengths are the average of the last
  two iterations. That is exact for 2-cycles and approximate for higher periods.

### From strengths to convergence

`computeQbafConvergence` (`qbaf.ts:251`) averages the acceptability strengths of
a claim set. A **higher score means stronger disagreement**: both sides hold
well-supported claims, so the debate has real tension rather than one side
collapsing.

---

## Stage 3 · Web-evidence adjustment (fact-check)

When a belief claim is fact-checked against retrieved web evidence,
`computeFactCheckStrength` (`qbaf.ts:292`) models the claim as a QBAF node and
each evidence item as a supporting or attacking neighbor:

```
evidence node base_strength = clamp(source_reliability × relevance)   # qbaf.ts:302
evidence edge weight        = relevance                               # qbaf.ts:308
```

The engine re-runs and returns `adjusted_strength`, the claim's post-evidence
strength. This value feeds back into belief scoring via the `evidenceStrength`
precedence path in Stage 1.

---

## Stage 4 · Crux resolution (is the disagreement settled?)

Cruxes are the cross-POV points of contention. Resolution is scored by
**polarity**, not raw strength, in `lib/debate/cruxResolution.ts`:

- **Polarity** (`computeCruxPolarity`): `supportCount / crossPovEdges.length`
  over cross-POV edges only (0.5 if there are none).
- **Resolved** when polarity is decisively one-sided. That means
  `polarity ≥ 0.85` (support wins) **or** `polarity ≤ 0.15` (attack wins), where
  `POLARITY_RESOLVED_THRESHOLD = 0.85` (`constants.ts:13`).
- **Irreducible** when polarity sits near 0.5 (within ±0.10) and stays stable for
  `IRREDUCIBLE_STABLE_TURNS = 3`. The two sides genuinely can't be reconciled.
- **Concession** (`checkOneSideConceded`): all of one speaker's attacks fall
  below the concession strength threshold.

A crux only enters detection at all if its `base_strength` clears
`crux_detection.min_base_strength` (default **0.3**, `phaseTransitions.ts`).
The **resolution ratio**, `(resolved + irreducible) / total`, feeds the
maturity score that drives phase transitions:
`maturity = 0.6·baseMaturity + 0.4·resolutionRatio` (`phaseTransitions.ts:252`).

---

## Stage 5 · Neutral evaluator (the quality oracle)

The final arbiter of debate quality is **not** arithmetic over the QBAF graph.
It is an independent **LLM call** with speaker personas stripped
(`lib/debate/neutralEvaluator.ts`). `runNeutralEvaluation` calls a pinned model
(`gemini-3.5-flash-lite`) at `temperature 0.2` against a fixed response schema.
It reads the full transcript as "Speaker A/B/C" and returns:

- per-crux `status`: `addressed` / `partially_addressed` / `unaddressed`
- `overall_assessment.debate_is_engaging_real_disagreement`: boolean

The arithmetic happens downstream in `calibrationLogger/extract.ts:87`:

```
engaging            = final_eval.overall_assessment.debate_is_engaging_real_disagreement
crux_addressed_ratio = (# cruxes with status 'addressed') / (total cruxes)
quality              = crux_addressed_ratio × (engaging ? 1.0 : 0.5)
```

This `quality` is the primary objective function the calibration optimizer tunes
P1/P5/P8 against. The separation is deliberate. The symbolic system (QBAF, phase
transitions) generates the debate; a persona-free neural evaluator judges it;
the optimizer tunes the symbolic parameters from that judgment.

---

## Appendix · claim-matching / dedup thresholds

Two claims are judged "the same" by different mechanisms at different stages:

| Stage | Mechanism | Threshold | Source |
|-------|-----------|-----------|--------|
| Extraction dedup | **word overlap** (not embeddings) | `dupThreshold` (P12, 0.85) → `reason: 'duplicate_claim'` | `processClaims.ts:181` |
| Topic dedup (cross-debate) | embedding cosine | `TOPIC_DEDUP_THRESHOLD = 0.80` | `confidenceDedup.ts:26` |
| Attack-vector dedup | embedding cosine | `ATTACK_DEDUP_THRESHOLD = 0.85` | `constants.ts:10` |
| Taxonomy-node relevance | embedding cosine (+ lexical) | `embedding_threshold = 0.48`, `lexical_threshold = 0.22` (P2) | `calibration-config.json` |

The extraction-stage duplicate check is **lexical word-overlap**, while the
cross-debate dedup and taxonomy relevance are **embedding cosine**. That split is
a frequent source of confusion when reconciling "why did this near-duplicate
survive?"

---

## Where each number is defined vs. computed

| Number | Provenance class | Register entry |
|--------|-----------------|----------------|
| FIRE overlap buckets (1.0/0.8/0.6/0.5) | stipulated | `metric-provenance-register.md` |
| `base_strength` scorers (BDI composites, belief maps) | stipulated (rubric-derived) | `metric-provenance-register.md` |
| Attack-type weights (1.0/1.05/1.1) | stipulated → calibrated (P3) | `calibration-methodology.md` |
| DF-QuAD semantics | derived (Rago et al., KR 2016) | — |
| `crux_addressed_ratio`, `engaging` | human-validated (neutral evaluator) | `calibration-methodology.md` |
| Resolution / dedup thresholds | stipulated → calibrated (P8/P12) | `metric-provenance-register.md` |

Any change to a threshold, weight, or scorer above must update its provenance
class in [`metric-provenance-register.md`](metric-provenance-register.md) in the
same PR (CL provenance-declaration rule).

---

## Related documents

- [`calibration-methodology.md`](calibration-methodology.md): how the 16 parameters that govern these scores are tuned
- [`metric-provenance-register.md`](metric-provenance-register.md): provenance class of every metric/threshold/weight
- [`debate-output-layout.md`](debate-output-layout.md): where a scored debate's data physically lands
- `lib/debate/qbaf.ts`: the gradual-semantics engine (Stages 2–3)
- `lib/debate/argumentNetwork/strength.ts`: all `base_strength` scorers (Stage 1)
- `lib/debate/cruxResolution.ts`: polarity / resolution (Stage 4)
- `lib/debate/neutralEvaluator.ts`: the quality oracle (Stage 5)

*Created: 2026-08-11 · Computational Linguist · AI Triad Research*
