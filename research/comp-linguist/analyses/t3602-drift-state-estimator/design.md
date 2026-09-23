# Drift-state estimator: design + validation plan (t/3602)

**Author:** Computational Linguist
**Status:** design milestone (definition + validation plan). Reliability estimate is the next phase and needs the annotation study below. **Gates nothing until reliability-established** (same posture as the AIF crux metrics).
**Origin:** Jeffrey's topic-drift proposal (p/314) and the CL review; prerequisite for the shadow-telemetry ticket (t/3603) and any later drift-aware turn policy.

## 1. The key finding: most of this already exists

A per-turn topical-drift signal is already computed and persisted. We are **not** building a parallel estimator; we are adding a validated banding layer on top of the existing signal and one missing dimension.

Existing machinery (verified in `lib/debate`):
- **ArCo (Argument Coherence)** in `convergenceSignals.ts` (`computeConvergenceSignals`, ArCo block): per turn it computes `arco.turn_similarity = cosineSimilarity(turnEmbedding, topic.embedding)`, a running `phase_mean`, and a binary `drift_warning` against `ARCO_DRIFT_THRESHOLD = 0.5`. Persisted in `ConvergenceSignals.arco` per transcript entry.
- **The seed anchor:** `session.topic.embedding` (384-dim all-MiniLM of `topic.final`, computed once at setup by `topicPipeline.ts embedResolutionAnchors`), plus `session.topic.clause_embeddings[]` (per decomposed clause) and the persisted `clause_coverage.best_similarity`.
- **Cruxes:** `session.crux_tracker[]` (`TrackedCrux`: id, description, speakers_involved, node embeddings available via the AN); `computeTopicCoherence` already uses a crux-centroid cosine pattern (whole-debate, per-speaker).
- **Substrate:** per-turn `turn_embeddings` (Map entryId to vector) and `cosineSimilarity` (`lib/embeddings/similarity.ts`, re-exported via `taxonomyRelevance.ts`).

So `1 - arco.turn_similarity` is essentially the raw drift the proposal describes, already per-turn. The gap t/3602 fills is (a) three interpretable **bands** instead of one binary threshold, and (b) the **deepening-vs-drift** discrimination that a single seed-similarity threshold cannot make.

## 2. Naming and collision (load-bearing)

The output is `topical_state` (with an underlying continuous `topical_drift_score`). It is **distinct from two existing signals** and must not be conflated with them:
- `position_drift[]` measures speaker **self-similarity** round-over-round and similarity to opponents (stance consistency / convergence). It is not topical.
- `per_claim_drift[]` measures whether individual claims are maintained/refined/abandoned. Also not topical.

`topical_state` measures distance of a turn from the **seeded question**, not a speaker's self-consistency. It **extends ArCo** (same substrate, same anchor) from a binary `drift_warning` to a 3-band state plus a crux dimension. Implementation should mirror or extend the ArCo block in `computeConvergenceSignals`, not add a parallel path.

## 3. The definition (candidate; thresholds stipulated until validated)

Per turn, from existing embeddings:
- `s_seed` = `cosineSimilarity(turnEmbedding, topic.embedding)` (this is `arco.turn_similarity`).
- `s_clause` = `clause_coverage.best_similarity` (nearest topic clause).
- `s_crux` = `max` over **active** cruxes `c` of `cosineSimilarity(turnEmbedding, embedding(c))`. This is the one new per-turn computation (the crux-centroid pattern from `computeTopicCoherence`, applied per turn and per crux rather than whole-debate).

States:
- **core**: the turn engages the seed or its clauses directly, `max(s_seed, s_clause) >= tau_core`.
- **adjacent**: not core, but the turn engages an active contested crux, `s_crux >= tau_adj`. This is the band that captures **legitimate deepening** into a sub-question that is far from the seed's wording but on the debate's actual contested ground.
- **drifted**: the turn is far from the seed, its clauses, and every active crux, `max(s_seed, s_clause, s_crux) < tau_drift`.

`topical_drift_score` = `1 - max(s_seed, s_clause, s_crux)` (continuous, for logging and trend).

Thresholds `tau_core`, `tau_adj`, `tau_drift` are **stipulated** initially (seeded from `ARCO_DRIFT_THRESHOLD = 0.5`) and **tuned against the labeled set** in section 5. They ship as nothing until validated.

## 4. Why the crux dimension is the whole point (hypothesis, not yet asserted)

The **primary validation question**, stated as a hypothesis to test rather than a claim: a single seed-similarity threshold (today's ArCo `drift_warning`) misclassifies **legitimate deepening** as drift. A turn that dives into a contested sub-mechanism can have low `s_seed` (far from the resolution wording) while being squarely on the debate's real disagreement, that is, high `s_crux`. If the hypothesis holds, adding `s_crux` reclassifies those turns from `drifted` to `adjacent`, and the 3-band estimator strictly dominates the binary one on the deepening cases.

This is explicitly a hypothesis. Per the t/3587 discipline it is not established until the annotation study below shows it against human labels; asserting it un-run is exactly the error we avoid.

## 5. Validation plan (the deliverable that makes this reportable)

Measurement-first. The estimator is not "done" until reliability is estimated.

1. **Sample** turns across a representative debate set, **oversampling low-`s_seed` turns** (that is where deepening-vs-drift is decided; a random sample would be dominated by easy core turns and hide the discriminating cases). Record that the sample is oversampled and why; it is a **reliability sample**, not a representative eval corpus (the t/3587 stratification lesson).
2. **Codebook** defining `core`/`adjacent`/`drifted`, pinning the load-bearing distinction explicitly: **deepening into an active crux counts as `adjacent`, never `drifted`**. Do not smuggle the seed-similarity threshold into the codebook (annotators judge topical relationship, not cosine).
3. **Double-annotate** (>= 2 annotators, including at least one human per t/3603's B1.5 pattern). Compute inter-annotator reliability with its **count** attached (statistic-provenance rule): report agreement / kappa as "on N turns," and distinguish applicability-demonstrated from reliability-estimated.
4. **Tune** `tau_core`/`tau_adj`/`tau_drift` on a train split; report the confusion matrix on a **held-out** split, for both the 3-band estimator and the ArCo-binary baseline. The value claim (section 4) stands or falls on this comparison.
5. **Non-degenerate-threshold check** (t/3587): the chosen thresholds must exclude both degenerate modes, everything-core and everything-drifted. A band criterion that all turns pass, or none pass, fails regardless of agreement.

## 6. Provenance declaration

- Class: **derived** (computed from persisted embeddings + link structure; no new annotation on the corpus, only on the validation sample).
- Thresholds are **stipulated** until section 5 tunes them against human labels; at that point they become **human-validated** and the register entry is updated with the count.
- Register: add `topical_state` / `topical_drift_score` to `research/comp-linguist/docs/metric-provenance-register.md` in the implementation PR.
- **Gates nothing** until reliability-established.

## 7. Seam for t/3603 (shadow telemetry)

The shadow-log "state" column is exactly this estimator's per-turn output: `{ topical_state, topical_drift_score, s_seed, s_clause, s_crux }`. Because ArCo already persists `s_seed` per entry and the substrate exists, the added cost is `s_crux` + the banding. The action / outcome / cost columns of t/3603 do not depend on this and can land first. DebateTool owns the pipeline hook and the calibration-schema wiring; CL owns these field definitions (this document). We align on the schema shape before the hook lands.
