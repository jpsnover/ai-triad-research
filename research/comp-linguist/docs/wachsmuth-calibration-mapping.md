# Wachsmuth et al. (2017) → calibrationLogger.ts Mapping

**Ticket:** t/1118
**Date:** 2026-06-29
**Last updated:** 2026-07-27 (t/1782 AC2 — Credibility section: source-authority metrics shipped per t/1122; expected-null scan rule for non-search adapters)
**Author:** Computational Linguist

Audit of `lib/debate/calibrationLogger.ts` metrics against Wachsmuth et al.'s
three-family argument quality taxonomy (ACL 2017: "Computational Argumentation
Quality Assessment in Natural Language").

## Framework Summary

Wachsmuth et al. organize argument quality into three families, each with a
composite quality and leaf dimensions:

| Family | Composite Quality | Leaf Dimensions |
|--------|------------------|-----------------|
| **Logical** | Cogency | Local Acceptability, Local Relevance, Local Sufficiency |
| **Dialectical** | Reasonableness | Global Acceptability, Global Relevance, Global Sufficiency |
| **Rhetorical** | Effectiveness | Credibility, Emotional Appeal, Clarity, Appropriateness, Arrangement |

11 leaf dimensions, 3 composite qualities, 3 families = the "15-dimension"
framework when counting all levels.

---

## Dimension-by-Dimension Mapping

### I. Logical Quality — Cogency

#### 1. Local Acceptability
*Are individual premises true, well-grounded, or reasonable?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `mean_extraction_confidence` | calibrationLogger.ts:378 | Measures how confidently the system extracted each claim — proxy for parse quality, not truth |
| `entailment_pass_rate` | calibrationLogger.ts:382 | Fraction of claims entailed by source text — strongest acceptability proxy |
| `entailment_repair_rate` | calibrationLogger.ts:384 | Fraction of claims needing text repair — flags dubious premises |
| `avg_grounding_confidence` | calibrationLogger.ts:355 | Cite-stage grounding quality — source attribution fidelity |
| `borderline_claim_survival_rate` | calibrationLogger.ts:223 | Whether low-confidence claims survived QBAF — proxy for acceptance by debate peers |

**Coverage: PARTIAL.** We measure extraction faithfulness (is the claim a faithful
rendering of source text?) but not propositional acceptability (is the claim
reasonable/true?). The gap is *logical validity of the claim itself* as distinct
from its extraction accuracy.

#### 2. Local Relevance
*Are premises relevant to the claims they support?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `topic_coherence_per_speaker` | calibrationLogger.ts:289 | Embedding similarity of speaker claims to crux centroid |
| `taxonomy_mapped_ratio` | calibrationLogger.ts:211 | Fraction of AN nodes grounded in taxonomy |
| `avg_utilization_rate` | calibrationLogger.ts:152 | Referenced/injected taxonomy nodes — are available premises used? |
| `crux_relevance` (PRM component) | processReward.ts:49 | Per-turn crux engagement score |
| `situation_crux_alignment` | calibrationLogger.ts:253 | Are injected situations shaping substance? |

**Coverage: MODERATE.** We measure topic-level relevance (claims relate to the
debate topic) but not premise-to-conclusion relevance (does premise P actually
support conclusion C in a given argument?). The latter requires argument-structure
parsing that we don't perform.

#### 3. Local Sufficiency
*Do premises provide enough evidence for claims?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `extraction_coverage_rate` | calibrationLogger.ts:372 | Fraction of verifiable elements covered by claims |
| `claims_per_1k_words` | calibrationLogger.ts:235 | Extraction density — more claims per word = finer-grained |
| `local_sufficiency_mean` | calibrationLogger.ts (t/1341) | Per-claim weighted-support score from AN supports edges (strength × weight × warrant bonus) |
| `unsupported_claim_rate` | calibrationLogger.ts (t/1341) | Fraction of eligible claims with zero incoming supports — the "bare assertion" rate |
| `local_sufficiency_by_speaker` | calibrationLogger.ts (t/1341) | Per-speaker mean sufficiency |

**Coverage: MODERATE** *(upgraded from WEAK, 2026-07-06, t/1341)*. The Tier-1
structural proxy measures whether claims marshal any weighted premise support.
Semantic adequacy — "do these premises actually suffice for this conclusion?" —
remains open for a Tier-2 LLM-judged pass. Empirical baseline from the first
three scored sessions: `unsupported_claim_rate` ≈ 0.55–0.90 (debate ANs are
systematically attack-heavy; this replicates Wachsmuth's own finding that local
sufficiency is argumentation's weakest dimension). Note: the warrant bonus is
currently non-discriminating — extraction populates `warrant` on 100% of
supports edges — so warrant *quality* must carry the Tier-2 signal.

**Gap classification: MINOR (Tier-2 open).** Was MATERIAL before t/1341.

---

### II. Dialectical Quality — Reasonableness

#### 4. Global Acceptability
*Are key premises mutually recognized by the participants?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `crux_addressed_ratio` | calibrationLogger.ts:148 | Fraction of neutral-evaluator cruxes that debaters addressed |
| `crux_resolution_divergence_rate` | calibrationLogger.ts:192 | Engine vs evaluator agreement on crux status |
| `engaging_real_disagreement` | calibrationLogger.ts:145 | Neutral evaluator: is the debate engaging genuine disagreement? |
| `consistency` (PRM component) | processReward.ts:44 | Commitment consistency + concession responsiveness |

**Coverage: STRONG.** The crux tracking system directly operationalizes global
acceptability — cruxes *are* the points where mutual premise-acceptance breaks
down, and the system tracks whether they're engaged.

#### 5. Global Relevance
*Is the overall debate relevant to the stated issue?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `topic_alignment_rate` | calibrationLogger.ts:325 | Fraction of turns aligned with topic scope |
| `topic_scope_confidence` | calibrationLogger.ts:317 | How reliably the scope was extracted |
| `topic_scope_drift_sigs` | calibrationLogger.ts:321 | Number of drift signatures identified |
| `moderator_drift_intervention_rate` | calibrationLogger.ts:335 | Fraction of moderator turns triggering drift intervention |
| `taxonomy_demotion_rate` | calibrationLogger.ts:331 | Fraction of nodes demoted by scope filter |
| `demoted_node_reference_rate` | calibrationLogger.ts:333 | Whether demoted nodes get referenced anyway |
| `topic_wisdom_total` | calibrationLogger.ts:297 | 20-point topic quality score |

**Coverage: STRONG.** This is our most extensively instrumented dimension, with
scope extraction, drift detection, moderator intervention, and taxonomy filtering
all feeding calibration data.

#### 6. Global Sufficiency
*Are counterarguments adequately addressed? Are dialectical obligations met?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `claims_forgotten_rate` | calibrationLogger.ts:179 | Claims dropped from context without response |
| `claims_abandoned_rate` | calibrationLogger.ts:263 | Fraction of opening claims ended as "abandoned" |
| `claim_outcome_summary` | calibrationLogger.ts:272 | Thrived/survived/died distribution |
| `qbaf_preference_concordance` | calibrationLogger.ts:159 | QBAF ordering vs synthesis preference alignment |
| `engagement` (PRM component) | processReward.ts:39 | Ratio of targeted cross-node claims to standalone |
| `concession_cascades` | calibrationLogger.ts:293 | Premature sequential concessions |

**Coverage: STRONG.** `claims_forgotten_rate` is a direct operationalization of
dialectical sufficiency failure — claims that go unaddressed represent unmet
dialectical obligations.

---

### III. Rhetorical Quality — Effectiveness

#### 7. Credibility
*Is the argument source credible? Are citations authoritative?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `avg_grounding_confidence` | calibrationLogger.ts:355 | Citation-stage source attribution quality |
| `min_grounding_confidence` | calibrationLogger.ts:357 | Worst-case grounding quality |
| `lineage_frame` | calibrationLogger.ts:303 | Dominant intellectual traditions in the debate |
| `lineage_effectiveness` | calibrationLogger.ts:305 | Whether lineage-boosted nodes get referenced |
| `source_authority_mean` | calibrationLogger.ts:342 | Venue-tier authority of cited sources (shipped t/1122) |
| `source_recency_mean` | calibrationLogger.ts:344 | Publication recency of cited sources (shipped t/1122) |

**Coverage: PARTIAL.** We measure whether claims are attributed to sources, whether
intellectual traditions are represented, and — since t/1122 — venue-tier authority and
recency of cited sources. Author expertise and citation count remain unassessed.

**Gap classification: MODERATE**, narrowed by t/1122. The remaining gap is
author/citation-level authority rather than source-level.

> **Scan rule — expected-null source authority on non-search adapters (t/1782).**
> `source_authority_mean` and `source_recency_mean` are **legitimately null** for any
> debate produced by a non-search adapter, and a coverage scan must NOT re-flag that
> null as a dead metric or a defect.
>
> Why: their substrate is `node.evidence_graph.evidence_items`, populated only by
> `verifyPreciseClaims`, which hard-returns unless the adapter implements
> `generateTextWithSearch` (`lib/debate/claimExtractionPipeline/gapAndDrift.ts:581`,
> comment at :571-580, landed `d9874448`). The **CLI adapter has no search capability by
> design**, and the calibration corpus is CLI-batch-produced — so corpus-wide null here
> is the expected reading, not missing instrumentation.
>
> **How to score it in a future scan:** treat these two metrics as *not applicable*
> rather than *absent* whenever the debate's adapter lacks search; report them as null
> with the adapter noted, and compute any coverage fraction over search-adapter debates
> only. Pooling non-search runs into a source-authority coverage denominator is the same
> censoring error the instrument-effects review flags (`docs/instrument-effects-review.md`,
> check 3) — the budget/capability of the run determines which values are observable at
> all. Enabling authority scoring on the calibration corpus is a **feature** (search-capable
> adapter + source corpus, with latency/cost implications), not a bug fix.

#### 8. Emotional Appeal
*Does the argument appropriately engage emotions? Neither sterile nor manipulative?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| (none) | — | — |

**Coverage: ABSENT.** The `pragmaticSignals.ts` module has hedge/assertive/concessive
lexicons but these measure epistemic stance, not emotional register. We have no
sentiment analysis, affect detection, or emotional appeal scoring.

**Gap classification: MATERIAL.** An argument quality framework without emotional
dimension cannot distinguish between a logically sound but persuasively dead
argument and one that appropriately motivates engagement.

#### 9. Clarity
*Is the argument clearly and coherently expressed?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `structural_error_rate` | calibrationLogger.ts:166 | Schema/structural errors per turn — very rough proxy |
| `draft_repair_rate` | calibrationLogger.ts:329 | Fraction of turns needing repair — proxy for generation quality |

**Coverage: WEAK.** Structural errors and repair rates indicate *system*-level
clarity problems (bad JSON, missing fields) but not *linguistic* clarity
(readability, sentence complexity, jargon density, coherence).

**Gap classification: MATERIAL.** Clarity metrics (readability scores, sentence
length distributions, lexical diversity) are cheap to compute deterministically
and would directly improve quality assessment.

#### 10. Appropriateness
*Is the language/style appropriate for the audience and context?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `sycophancy_guard_fired` | calibrationLogger.ts:259 | Detected one form of inappropriate behavior |
| `max_sycophancy_score` | calibrationLogger.ts:261 | Peak sycophancy across speakers |

**Coverage: MINIMAL.** Sycophancy detection catches one narrow failure mode
(excessive capitulation). We don't measure register consistency (are debaters
maintaining character?), tone appropriateness, or audience awareness.

**Gap classification: MINOR.** In a structured debate with assigned personas, the
system already constrains appropriateness through prompts. Less urgent than
clarity or emotional appeal.

#### 11. Arrangement
*Is the argument well-organized? Does it follow logical progression?*

| Our Metric | File | Coverage |
|-----------|------|----------|
| `argumentative_saturation_at_transition` | calibrationLogger.ts:142 | Debate pacing — when to transition phases |
| scheme stagnation (via saturation signals) | schemeStagnation.ts | Scheme diversity over debate lifetime |
| `move_quality` (PRM component) | processReward.ts:47 | Move diversity + specificity |

**Coverage: WEAK.** We measure debate-level pacing (saturation) and scheme variety,
but not the structural organization of individual arguments (claim→evidence→warrant
pattern) or the logical flow between arguments within a turn.

**Gap classification: MODERATE.** Argument structure completeness could be assessed
via the existing move annotation system with additional scoring logic.

---

## Coverage Summary

| Dimension | Family | Coverage Level | Gap Severity |
|-----------|--------|---------------|-------------|
| Local Acceptability | Logical | Partial | Minor |
| Local Relevance | Logical | Moderate | Minor |
| Local Sufficiency | Logical | Moderate (t/1341) | Minor — Tier-2 open |
| Global Acceptability | Dialectical | Strong | — |
| Global Relevance | Dialectical | Strong | — |
| Global Sufficiency | Dialectical | Strong | — |
| Credibility | Rhetorical | Partial (t/1122) | Moderate — expected-null on non-search adapters, see t/1782 scan rule |
| **Emotional Appeal** | **Rhetorical** | **Absent** | **Material** |
| **Clarity** | **Rhetorical** | **Weak** | **Material** |
| Appropriateness | Rhetorical | Minimal | Minor |
| Arrangement | Rhetorical | Weak | Moderate |

**Family-level assessment:**
- **Dialectical (Reasonableness):** Well-covered across all three dimensions. Our
  crux tracking, topic alignment, and claims-forgotten systems directly
  operationalize this family.
- **Logical (Cogency):** Partially covered. Strong on extraction fidelity (a proxy
  for acceptability) but weak on premise-conclusion relevance and sufficiency.
- **Rhetorical (Effectiveness):** Poorly covered. Three material/moderate gaps out
  of five dimensions. This is the family requiring the most investment.

## Unmapped Metrics (Operational Quality)

These calibration metrics serve infrastructure/parameter tuning purposes and don't
correspond to any Wachsmuth dimension. They're not gaps — they're a different
measurement concern.

- Parameter values: all `*_threshold`, `*_weights`, `*_cap` fields
- Resource management: `hit_api_ceiling`, `total_api_calls`, `budget_hard_multiplier`
- Prompt engineering: `max_prompt_chars`, `mean_prompt_chars`, `max_component_chars`
- Memory management: `gc_runs`, `gc_trigger`, `an_nodes_at_synthesis`
- Algorithm stability: `qbaf_oscillation_detected`, `qbaf_iterations`
- Pipeline health: `confidence_deferrals`, `confidence_escalations`, `confidence_bottleneck`
- Deduplication: `near_miss_duplicate_count`, `duplicate_similarity_threshold`
- Exploration seeding: `exploration_source_*`, `seeded_*`

## Recommended Follow-On Work

Prioritized by measurability × impact × alignment with existing infrastructure:

### Priority 1: Clarity Metrics (LOW cost, HIGH impact)
Add deterministic readability scoring to calibration:
- Mean sentence length per speaker
- Lexical diversity (type-token ratio)
- Flesch-Kincaid readability score adapted for debate register
- Jargon density (ratio of domain-specific terms to total tokens)

Implementation: pure function in a new `clarityMetrics.ts`, called from
`extractCalibrationData()`. No LLM calls needed.

### Priority 2: Emotional Appeal Detection (MEDIUM cost, HIGH impact)
Add affect/emotion scoring:
- Sentiment polarity per turn (positive/negative/neutral)
- Emotional appeal lexicon (fear, urgency, hope, outrage markers)
- Affect intensity tracking across debate progression
- Emotional appropriateness score (deviation from expected affect for debate register)

Implementation: lexicon-based approach similar to `pragmaticSignals.ts`, potentially
augmented with a lightweight sentiment model. No new LLM calls.

### Priority 3: Source Authority Scoring — ~~planned~~ **PARTLY SHIPPED (t/1122)**
Venue tier and recency shipped as `source_authority_mean` / `source_recency_mean`
(calibrationLogger.ts:342/344). The venue-tier map is **stipulated** — see
`metric-provenance-register.md`.

Still open:
- Citation count if available from document metadata
- Author expertise signals from ingestion metadata

**Before treating low coverage here as a gap, apply the t/1782 scan rule** (Credibility
section above): these metrics are expected-null on non-search adapters, and the
calibration corpus is CLI-batch-produced. Deciding whether to enable evidence retrieval
on the corpus is a scoping question with latency/cost implications, not a defect fix.

### Priority 4: Local Sufficiency Assessment (HIGH cost, HIGH impact)
Evaluate whether individual arguments have sufficient evidence:
- Premise count per claim (are arguments backed by multiple premises?)
- Evidence-to-claim ratio per speaker
- Warrant identification (is the connection between evidence and claim explicit?)

Implementation: requires argument structure parsing, likely via LLM evaluation
similar to extraction coverage. High cost per debate but high diagnostic value.

### Priority 5: Arrangement Quality (MEDIUM cost, MODERATE impact)
Score structural organization of arguments:
- Claim→evidence→warrant completeness per argument
- Logical flow scoring (does each turn build on previous arguments?)
- Opening-to-closing coherence (does the debate arc make sense?)

Implementation: extend move annotation analysis in convergence signals.

### Priority 6: Appropriateness Metrics (MEDIUM cost, LOW impact)
Register consistency and audience awareness:
- Persona voice consistency score (lexical fingerprinting per speaker)
- Register formality level tracking
- Audience calibration (is technical depth appropriate?)

Implementation: lexical analysis module. Lower priority because prompt constraints
already enforce much of this.

## Process Reward Model Coverage

The PRM (`processReward.ts`) is notable because its six components span multiple
Wachsmuth dimensions:

| PRM Component | Wachsmuth Dimension(s) |
|--------------|----------------------|
| `engagement` | Global Sufficiency (dialectical obligations met) |
| `novelty` | Local Sufficiency (new evidence introduced) |
| `consistency` | Global Acceptability (commitment coherence) |
| `grounding` | Local Acceptability + Credibility (source fidelity) |
| `move_quality` | Arrangement (structural quality) |
| `crux_relevance` | Global Relevance (issue-centrality) |

The PRM is the closest thing we have to a cross-family quality score. However, it
weights Rhetorical dimensions (clarity, emotional appeal, appropriateness) at zero,
reflecting the same blind spot visible in the calibration logger.

## Citation

Wachsmuth, H., Naderi, N., Hou, Y., Bilu, Y., Prabhakaran, V., Thijm, T. A.,
Hirst, G., & Stein, B. (2017). Computational Argumentation Quality Assessment in
Natural Language. *Proceedings of the 15th Conference of the European Chapter of
the Association for Computational Linguistics (EACL 2017)*, 176–187.
