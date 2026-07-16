# Ablation and Causal Studies for the AI Rosetta Stone System

**Author:** Computational Linguist
**Ticket:** t/1604
**Status:** Draft for PM integration into `docs/academic-paper-draft.md`
**Date:** 2026-07-16

## Purpose

This document proposes the experiments a reader of the paper would need to believe the AI Rosetta Stone system does what it claims. The system asserts that a stack of components together produces debates that engage the real disagreement rather than talking past it. Those components are BDI decomposition, three-POV situation interpretations, relevance-ranked situation injection ordered against Lost-in-the-Middle, AIF edge typing, `disagreement_type` elicitation, and genus-differentia descriptions. Every one is a design bet. None has been isolated. A paper that lists them as features without showing what each one buys is describing an architecture, not defending one.

Each study below answers a narrow question. If we remove or vary one component and hold the rest fixed, does a logged quality metric move, and in the predicted direction? The outcome metrics are the real fields computed in `lib/debate/calibrationLogger.ts`, with no invented measures. Where a study can support a causal claim it is labeled causal; where it can only show an association it is labeled ablation, and the difference in what you may conclude is stated for each.

## Ablation versus causal: the inferential contract

An **ablation** removes or replaces one component, holds everything else fixed, and measures the change in an outcome metric. It licenses a claim of the form "the pipeline that includes component C scores higher on metric M than the pipeline without it." It does not by itself license "C causes M to rise," because in a generative pipeline the removed component changes the text that every downstream stage sees, and the model's stochasticity can swamp a small delta. An ablation is a controlled comparison of two system configurations. That is worth a great deal, and it is not the same as a causal law about a component acting in isolation.

A **causal study** adds an intervention design on top of the comparison. It applies a treatment at one and only one point, adds a control condition matched on everything else, replicates across fixed seeds so the effect can be separated from sampling noise, and where possible sweeps a dose-response gradient so the effect is not just present but ordered. The clean version varies a single continuous input (relevance of injected situations, count of injected situations) while freezing model, prompt, and topic, then reads the outcome as a function of the treatment level. That licenses "increasing the treatment moves the outcome," with a confidence interval, which is the strongest claim this system's telemetry can support without human ground-truth labels.

Two honesty constraints carry through every study. First, the model is a confound whenever the prompt changes, because the same prompt run twice returns different text; studies that vary a prompt must fix the model and seed and report replication variance, or they are measuring the model, not the component. Second, the outcome metrics are themselves unvalidated instruments (the provenance register and the affect-validation work track this). A metric that moves tells us the system's own measurement moved. Whether that measurement tracks a human judgment of debate quality is a separate validation question, flagged where it bites.

## Ranking

Studies are ranked by **inferential value** (how much a clean result changes what we can assert in the paper) × **feasibility** (cost and design cleanliness) × **relevance** (how central the manipulated component is to the system's core claim). The top of the list is where a cheap, clean design meets a load-bearing claim.

| Rank | Study | Type | Inferential value | Feasibility | Relevance |
|---|---|---|---|---|---|
| 1 | Relevance-as-treatment on situation injection | Causal | High | High | High |
| 2 | Situation injection: none / random / relevance-ranked | Ablation | High | High | High |
| 3 | Situation-count dose-response | Causal | High | Medium | High |
| 4 | Three-POV interpretations versus single shared | Ablation | High | Medium | High |
| 5 | Prompt-only intervention, model held fixed | Causal | Medium | Medium | Medium |
| 6 | Injection ordering: boundaries versus middle | Ablation | Medium | High | Medium |
| 7 | Counterfactual crux removal | Causal | High | Low | High |
| 8 | BDI decomposition on versus off | Ablation | High | Low | High |
| 9 | `disagreement_type` elicitation on versus off | Ablation | Medium | Medium | Medium |
| 10 | AIF edge typing on versus off | Ablation | Medium | Medium | Low |
| 11 | Genus-differentia descriptions versus plain | Ablation | Low | Medium | Low |

The first three are the paper's spine. They share one topic set and one frozen model, they manipulate the component the system is most identified with, engineered relevance, and two of the three are genuinely causal. If only three experiments run, run these.

## The studies

Each study states a hypothesis, the component manipulated or removed, the controls that make the comparison fair, the outcome metric mapped to its `calibrationLogger.ts` field, the expected effect and its direction, the sample and seed plan, and a rough cost. Cost is quoted in debate runs; one run is a full multi-round debate on one topic at one configuration. All studies fix the model (`ai-models.json`, one backend pinned for the whole study to remove silent API drift as a confound) and report effect sizes with bootstrap confidence intervals, not p-values alone.

### 1. Relevance-as-treatment on situation injection (causal)

**Hypothesis.** Injecting situations selected for high relevance to the debate topic raises `situation_crux_alignment` relative to injecting situations selected for low relevance, with model, prompt, topic, and injection count held fixed.

**Manipulated component.** The relevance score that gates situation selection (`relevance_threshold`, default 0.45). The treatment is the relevance band of the injected set. A high-relevance arm draws the top-scoring situations; a low-relevance arm draws situations scoring just above the floor, matched on count.

**Controls.** Same topics, same model and seed schedule, same number of injected situations, same injection ordering. The only thing that differs between arms is which situations get in. This is the cleanest single-point intervention the system affords, because relevance is a continuous input the selector already computes.

**Outcome metrics.** Primary: `situation_crux_alignment` (fraction of neutral-evaluator cruxes whose involved-speaker turns referenced an injected `sit-` node). Secondary: `crux_addressed_ratio`, and `avg_utilization_rate` (referenced-of-injected) to confirm the high-relevance set is actually used and not merely present.

**Expected effect and direction.** High-relevance arm scores higher on `situation_crux_alignment`. If it does not, the system's central claim that engineered relevance shapes debate substance is in doubt, which is a finding worth publishing either way.

**Sample and seed plan.** 12 topics × 2 arms × 5 replications on fixed seeds = 120 runs. Seeds frozen and shared across arms so each topic's high- and low-relevance runs are paired for a within-topic contrast.

**Rough cost.** 120 runs.

### 2. Situation injection: none / random / relevance-ranked (ablation)

**Hypothesis.** A debate with relevance-ranked injection scores higher on `situation_crux_alignment` and `crux_addressed_ratio` than one with random injection, which in turn scores higher than one with no injection.

**Manipulated component.** The situation-selection stage, set to three levels: off, random-sample-at-fixed-count, and the production relevance-ranked selector.

**Controls.** Same topics, model, seed schedule, and injection count for the two arms that inject. The no-injection arm is the true floor.

**Outcome metrics.** `situation_crux_alignment`, `crux_addressed_ratio`, `situation_nodes_referenced` over `situation_nodes_injected`.

**Expected effect and direction.** Monotone ordering ranked > random > none. The random arm is the load-bearing control. It separates "situations help" from "relevance-ranking helps," which the none-versus-production contrast alone cannot.

**Sample and seed plan.** 12 topics × 3 arms × 5 replications = 180 runs, seeds paired within topic.

**Rough cost.** 180 runs.

### 3. Situation-count dose-response (causal)

**Hypothesis.** `convergence_score` rises with the number of injected situations up to a point, then falls as the context fragments. The shape is an inverted-U, not a monotone gain. This is the empirical test of the situation-cap parameter the CL is asked to set from calibration data.

**Manipulated component.** The injection count (`situation_max_nodes`), swept across levels: 0, 2, 5 (near current), 10, 20.

**Controls.** Same topics, model, seed schedule, and relevance-ranked selection; only the cap changes. Situations are added in relevance order so each higher level is a superset of the lower, a genuine dose gradient.

**Outcome metrics.** Primary: `convergence_score`. Secondary: `repetition_rate` and `claims_forgotten_rate` (the fragmentation signature is convergence falling while claims-forgotten rises), and `relevance_score_variance` to confirm higher levels really do reach into lower-relevance material.

**Expected effect and direction.** Inverted-U in `convergence_score`; `claims_forgotten_rate` climbs at the high-count end. The peak location is the recommended cap, reported with a confidence band.

**Sample and seed plan.** 10 topics × 5 levels × 5 replications = 250 runs, seeds paired within topic across levels.

**Rough cost.** 250 runs. The dose gradient is what makes this causal rather than a two-point comparison, and it is the most expensive of the top three.

### 4. Three-POV interpretations versus single shared (ablation)

**Hypothesis.** Giving debate agents all three POV interpretations of each situation raises `situation_crux_alignment` and `convergence_score` relative to a single shared interpretation, because the disagreement is encoded in the interpretations themselves.

**Manipulated component.** The situation-interpretation payload: three-POV (acc/saf/skp) versus one collapsed shared reading.

**Controls.** Same topics, model, seed schedule, situations, and count; only the interpretation multiplicity changes.

**Outcome metrics.** `situation_crux_alignment`, `convergence_score`, `camp_insularity_rate` (do agents engage across camps or stay in their lane).

**Expected effect and direction.** Three-POV scores higher on alignment and convergence. A null here would suggest the three interpretations decorate the context without shaping the exchange, which bears directly on the DOLCE D&S design claim.

**Sample and seed plan.** 12 topics × 2 arms × 5 replications = 120 runs.

**Rough cost.** 120 runs. Feasibility is medium because the single-shared arm needs a collapse function that fairly summarizes three readings into one without smuggling the disagreement back in; that function is a design decision the study must document.

### 5. Prompt-only intervention, model held fixed (causal)

**Hypothesis.** Changing a debate prompt while holding the model and seed fixed moves the target metric, establishing that the prompt, not the model, carries the effect the paper attributes to prompt engineering.

**Manipulated component.** One prompt variant (for example, the `disagreement_type` elicitation instruction) toggled between two authored versions.

**Controls.** Same model, same seed schedule, same topics, same everything except the one prompt string. This is the design that answers the "is it the prompt or the model" confound head-on, and it is the template every prompt-related ablation should follow.

**Outcome metrics.** Depends on the prompt under test; for `disagreement_type` elicitation, `crux_addressed_ratio` primary.

**Expected effect and direction.** The prompt variant designed to sharpen crux engagement scores higher. Replication variance is reported prominently, because a small prompt effect swamped by model stochasticity is the expected failure mode and must be visible.

**Sample and seed plan.** 12 topics × 2 prompt versions × 8 replications = 192 runs. Higher replication than the injection studies because prompt effects are expected to be smaller and need more runs to separate from noise.

**Rough cost.** 192 runs.

### 6. Injection ordering: boundaries versus middle (ablation)

**Hypothesis.** Placing the highest-relevance situations at the boundaries of the injection block raises `avg_primary_utilization` relative to placing them in the middle. This tests the Lost-in-the-Middle mitigation the system already implements rather than assuming it.

**Manipulated component.** The ordering of the injected block: highest-relevance-at-boundaries (production) versus highest-relevance-in-middle versus random order.

**Controls.** Identical situation set and count in every arm; only position changes. This is a pure ordering ablation, the same tokens rearranged.

**Outcome metrics.** `avg_primary_utilization` (referenced-of-injected for the highest-priority items), `situation_crux_alignment`.

**Expected effect and direction.** Boundaries > random > middle for use of the high-priority items. A null would say the ordering rule costs nothing but also buys nothing, which is worth knowing before defending it in print.

**Sample and seed plan.** 10 topics × 3 arms × 5 replications = 150 runs.

**Rough cost.** 150 runs. Feasibility is high because the manipulation is a reorder with no new generation logic.

### 7. Counterfactual crux removal (causal)

**Hypothesis.** Removing the single situation that a debate's crux depends on causes position drift and a rise in `claims_forgotten_rate`, relative to removing a matched non-crux situation. This is the relevance-counterfactual logic the crux mechanism itself uses, turned into an experiment.

**Manipulated component.** One injected situation removed: in the treatment arm the crux-bearing situation, in the control arm a relevance-matched situation the crux does not depend on.

**Controls.** Same topics, model, seed, and full injection set minus one; the two arms differ only in which single situation is dropped, matched on relevance so the effect is attributable to the crux dependency and not to losing a high-relevance item.

**Outcome metrics.** `claims_forgotten_rate` primary; position drift measured as change in `convergence_score` trajectory relative to the full-injection baseline.

**Expected effect and direction.** Dropping the crux situation causes a larger drift and higher claims-forgotten than dropping the matched control.

**Sample and seed plan.** 10 topics × 2 arms × 5 replications = 100 runs, plus a full-injection baseline run per topic-seed (50 more) = 150 runs.

**Rough cost.** 150 runs. Feasibility is low because it requires first identifying, per topic, which situation the crux depends on. That labeling step is itself an application of the crux mechanism and must be pinned before the runs, or the treatment is not well defined.

### 8. BDI decomposition on versus off (ablation)

**Hypothesis.** Typing extracted nodes into Beliefs, Desires, and Intentions, and formatting debate context grouped by BDI layer, raises `crux_addressed_ratio` relative to a flat untyped node list.

**Manipulated component.** The BDI typing and layer-grouped context formatting, toggled off to a flat list.

**Controls.** Same source documents, model, seed, and topics; only the node typing and context grouping change.

**Outcome metrics.** `crux_addressed_ratio`, `convergence_score`, extraction-side `extraction_coverage_rate` to confirm the flat arm is not simply extracting less.

**Expected effect and direction.** BDI-on scores higher on crux engagement. This is a high-relevance claim but low feasibility, because turning BDI off touches the extraction pipeline and the context formatter together, so the "flat" arm is a larger surgery than a single toggle and risks changing more than one thing.

**Sample and seed plan.** 12 topics × 2 arms × 5 replications = 120 runs.

**Rough cost.** 120 runs plus the engineering to build a faithful flat-mode path.

### 9. `disagreement_type` elicitation on versus off (ablation)

**Hypothesis.** Eliciting `disagreement_type` (definitional / interpretive / structural) for each situation and passing it to debaters raises `crux_addressed_ratio` relative to omitting it.

**Manipulated component.** The `disagreement_type` field: elicited and injected versus dropped from the context.

**Controls.** Same situations, topics, model, seed; only the presence of the disagreement-type annotation changes. This overlaps with study 5's mechanism and can share its harness.

**Outcome metrics.** `crux_addressed_ratio` primary, `situation_crux_alignment` secondary.

**Expected effect and direction.** On-arm higher. A small effect is expected; report replication variance.

**Sample and seed plan.** 12 topics × 2 arms × 6 replications = 144 runs.

**Rough cost.** 144 runs.

### 10. AIF edge typing on versus off (ablation)

**Hypothesis.** Typing argumentation edges with the 8 canonical AIF types raises argument-structure quality, read through `local_sufficiency_mean` and `unsupported_claim_rate`, relative to untyped edges.

**Manipulated component.** The AIF edge-typing stage, toggled to untyped generic links.

**Controls.** Same topics, model, seed, and node set; only edge typing changes.

**Outcome metrics.** `local_sufficiency_mean`, `unsupported_claim_rate`, `peer_referencing_rate`.

**Expected effect and direction.** Typed-on scores higher on local sufficiency and lower on unsupported claims. Relevance is lower than the situation studies because edge typing is further from the system's headline claim about engineered relevance.

**Sample and seed plan.** 10 topics × 2 arms × 5 replications = 100 runs.

**Rough cost.** 100 runs.

### 11. Genus-differentia descriptions versus plain (ablation)

**Hypothesis.** Node descriptions written in the genus-differentia form ("A Belief within acc discourse that ... Encompasses: ... Excludes: ...") improve extraction quality relative to plain free-text descriptions.

**Manipulated component.** The description template used at extraction time: genus-differentia versus plain.

**Controls.** Same source documents, model, seed; only the description prompt template changes.

**Outcome metrics.** `extraction_coverage_rate`, `mean_extraction_confidence`, `entailment_pass_rate`, `low_confidence_claims_rate`.

**Expected effect and direction.** Genus-differentia scores higher on coverage and confidence. Lowest rank because the effect is expected to be small and the component is the least central to the system's core argument, but it is cheap and closes a gap a reviewer might raise.

**Sample and seed plan.** 8 document sets × 2 arms × 5 replications = 80 runs.

**Rough cost.** 80 runs.

## What the suite does and does not establish

Run in full, this suite lets the paper say that relevance-ranked situation injection raises crux alignment over random and none (studies 1, 2), the effect is caused by relevance and not mere presence (study 1), situation count has an inverted-U optimum that fixes the cap parameter empirically (study 3), and the three-POV encoding, the ordering rule, the crux dependency, BDI typing, and the argumentation and extraction scaffolds each carry their claimed weight or do not (studies 4–11). Two of the top three are causal; the rest are controlled ablations, labeled as such.

What it does not establish is that any of these metrics tracks a human's judgment of a better debate. Every outcome here is the system measuring itself. That gap is the province of the validation-instrument work (the single-rater criterion-validity studies, the affect instrument, the provenance register), and the paper should cite this suite and that work as two halves of one argument. The ablations show the components move the system's own signals, and the validation studies show whether those signals mean anything to a person. Neither half is sufficient alone. Presented together they are a defensible claim that the architecture earns its complexity.

The recommended minimum for a first paper is studies 1, 2, and 3, sharing one topic set and one frozen model across 550 runs, which carry the system's central relevance claim with a causal result at the center. The remaining eight are the natural extension once the spine holds.
