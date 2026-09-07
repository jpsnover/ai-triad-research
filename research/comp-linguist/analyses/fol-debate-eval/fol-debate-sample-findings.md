# FOL-on-debate: sample-labeling findings (t/3354, step 1)

**Author:** Computational Linguist
**Sample:** 3 observed (phase=closed) debate sessions, 27 statement-type turns total
- b45f82f7 (Sanders Ban-ASI bill PDF), 8 statements
- 7a75e42f (NM v. Meta news article), 10 statements
- cb5c96e3 (abstract proposition), 9 statements

**Status:** first-pass, single-annotator CL read. No second annotator ran, so inter-annotator reliability is NOT established. The numbers are calibrated estimates: I close-read 6 turns claim-by-claim, then skim-classified the rest against that calibration. They are reported with ranges, not point precision.

---

## Headline finding (changes the filter design)

**No turn is homogeneous.** Every statement turn mixes claim types. Even the most fact-dense turn ends with 1-3 normative or rhetorical closers ("Citizens should watch..."; "Who gave regulators the authority...?"). The later-round turns *open* with a non-assertoric belief-revision block (the "I conditionally agree / I still hold / I would change if" triad).

**Consequence:** a *turn-level* assertoric filter is the wrong unit. It either admits large non-assertoric spans or drops turns that carry valuable factual claims. The filter has to run at **clause/sentence level**. Segment the turn, type-classify each clause, then formalize only the assertoric-factual/causal clauses.

---

## The three numbers (claim-level, not turn-level)

### (a) Assertoric factual/causal fraction ≈ 60% (range 55-65%)
Per-claim distribution across the sample:
- **Assertoric factual/causal ≈ 60%**, formalizable in neo-Davidsonian, split into two sub-classes:
  - *Cited/quantitative factual* ≈ 20-25% ("seven firms control 35% of the S&P 500"; "data centers consumed 415 TWh in 2024"; "monitors clusters above 10^26 ops"). Self-contained, cleanest to formalize, and the cleanest contradiction targets.
  - *Generic/dispositional causal* ≈ 35-40% ("caps protect incumbents"; "post-disaster penalties cannot rebuild grids"). Formalizable but usually universally-quantified generics, often value-laden.
- **Normative/deontic ≈ 15-20%** ("must", "should", "Congress should bifurcate liability"). Needs deontic operators, and concentrates in the closers.
- **Speech-act / belief-revision meta ≈ 10-15%** ("I concede", "I still hold", "I would change if…"). Spikes to ~25-30% in the structured later-round turns.
- **Rhetorical / evaluative ≈ 8-12%.** Category-error charges ("comparing X to a 737 MAX is a category error") and rhetorical questions (most turns end on one).

### (b) Anaphora/ellipsis break rate on isolated-turn formalization ≈ 40% (range 35-45%)
Of the *assertoric* claims, ~40% carry a cross-turn referential dependency that isolated-turn formalization would break or under-specify:
- demonstratives pointing at prior turns ("that approach", "those notes", "this design", bare "it");
- attributed restatements ("Accelerationist proposes that…", "Safetyist demands…");
- topic ellipsis (bare "the ban" / "the 10^26 threshold" / "the platform" assume the shared debate referent).

The cited/quantitative factual sub-class is mostly self-contained, so it breaks rarely. The generic-causal and attributed-restatement sub-classes are heavily anaphoric and break often.

**Central design tension.** The single most contradiction-relevant sub-class is the attributed restatement of the opponent ("X argues P, but…"), and that sub-class is also the most anaphora-dependent. So the highest-value claims for contradiction detection are the ones most at risk from isolated formalization. Coreference and attribution resolution is therefore not optional. It gates the whole value case.

### (c) Do contradictions occur? YES, and richer than expected.
Contradictions occur at the propositional level. Many are **intra-debate cross-agent** contradictions on a *shared predicate*, which makes them more tractable than debate-vs-summary because the shared debate topic anchors the predicate vocabulary. Confirmed examples:
- **Hardware caps and their incumbent effect:** "bright-line hardware tracking does NOT create a federal shield; it strips corporate secrecy" (saf) against "an arbitrary ceiling simply builds an exclusive federal licensing club" / "hands a permanent advantage to a tiny cartel" (acc/skp). Direct P vs ¬P on the same predicate.
- **Agency of engineered software behavior:** "software is stochastic/emergent, defies proximate cause" (acc) against "infinite scroll is a deliberate engineered choice, not emergent" (saf/skp). Direct contradiction on the same event's agency.
- **Design-defect doctrine:** "absence of upstream telemetry IS an actionable design defect" (saf) against "design defect doctrine governs finished products, not general-purpose inputs" (acc). Predicate-level contradiction.

**The paraphrase problem, now confirmed on real data.** One underlying predicate (regulatory regime entrenches incumbents) surfaces five different ways: "protects them", "pull up the drawbridge", "corporate moats", "exclusive federal licensing club", "incumbent compliance cartel". FOL contradiction detection has to normalize all five to one predicate with aligned entity arguments. **Without predicate/entity normalization you get false negatives**, because real disagreements are missed whenever the vocabulary differs. This is the load-bearing risk for the whole eval.

---

## Bonus finding: a better formalization target may exist for debate

The debate is highly *structured*. The "I conditionally agree / I still hold / I would change my position if <defeater>" scaffold appears in nearly every later-round turn. That is an explicit **belief-revision / commitment structure**, and it fits **AIF argument-level formalization** (claim / attack / support edges plus the explicit concession, retained-commitment, and defeater-condition triad) far better than it fits neo-Davidsonian event semantics of individual claims.

**Recommendation to weigh in the design doc.** The higher-value debate formalization may be *argument-level* (AIF, capturing the concession/hold/defeater moves and cross-agent attack edges) rather than *claim-level* neo-Davidsonian. Neo-Davidsonian stays the right tool for the assertoric-factual subset and for linking those claims back to the summary corpus. AIF is the better tool for the debate's dialectical structure. The two are complementary, not competing. (Tracked as CL-owned t/3355.)

---

## Implications for the eval design (for PS to fold in)

1. **Filter unit = clause, not turn.** Segment turns, classify each clause, and formalize only the assertoric-factual/causal clauses (~60% of claims, unevenly distributed within turns).
2. **Coreference/attribution resolution is a hard prerequisite,** not a nice-to-have. About 40% of assertoric claims break without it, and the most valuable attributed-restatement claims break the most.
3. **Predicate normalization is the make-or-break component.** Budget the eval to measure false-negative rate under paraphrase, not just raw contradiction counts. If normalization is weak, FOL contradiction detection will look falsely quiet.
4. **Correlation target (CL side).** Once PS produces FOL-detected contradictions, I correlate them against `crux_addressed_rate` and `convergence_score`. Prediction to test: FOL contradictions will *under-count* relative to crux_addressed_rate because of the paraphrase false-negatives. If they do, that quantifies the normalization gap directly.
5. **Consider scoping AIF argument-structure extraction** as a parallel arm (t/3355). The concession/hold/defeater scaffold is essentially free structured signal and may beat claim-level FOL for crux identification.
6. **Conflict-corpus seam (from Main PS, e/141#3).** FOL-detected contradictions likely want to link to the conflict corpus. `conflicts.json` now carries the 15 fork-B verified semantic-opposition edges under the same claim-level provenance model. If the harness correlates FOL contradictions against the corpus's conflict/QBAF structure, loop in Main PS; that is the natural seam between the FOL track and the QBAF/conflict-corpus track.

## Provenance note
If we proceed past exploration, the labeled sample and this methodology should be committed as the provenance record (per CL metric-provenance discipline). The sample is *observed* (real runs) and the labeling is *single-annotator first-pass*. Upgrade to double-annotated before any number here anchors a threshold.
