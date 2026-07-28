# Evaluation of Multi-Agent Debate (MAD) for Divergent Thinking (Liang et al., EMNLP 2024)

**Last updated:** 2026-07-28
**Author:** CL.Investigate1 (Computational Linguist)
**Ticket:** t/1611
**Paper:** Tian Liang, Zhiwei He, Wenxiang Jiao, Xing Wang, Yan Wang, Rui Wang, Yujiu Yang, Shuming Shi, Zhaopeng Tu, *Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate*, EMNLP 2024 (main), https://aclanthology.org/2024.emnlp-main.992/
**Requested by:** owner (jsnover13), 2026-07-17 (t/1611)
**Revision:** 2026-07-28. AC#3 corrected after Risk Assessor's independent code verification (t/1832#1). Two errors were fixed: the per-turn quality axes were misattributed to the neutral evaluator (they are `PROCESS_REWARD_WEIGHTS`, computed from convergence signals, not evaluator-scored), and a subset of evaluator metrics feeds the calibration optimizer, so the original "diagnostic, not verdict" framing understated the coupling. RA verdict: LOW, borderline low-medium; sensitivity probe filed as t/1835.

## Summary of the paper

Liang et al. identify **Degeneration-of-Thought (DoT)**: once an LLM "has established confidence in its solutions, it is unable to generate novel thoughts later through reflection even if its initial stance is incorrect." Self-reflection alone cannot escape this basin. Their remedy is **Multi-Agent Debate (MAD)**, in which agents argue in a "tit for tat" adversarial state while a **judge** manages the process and extracts a final answer. Their headline empirical claims:

- DoT is real and self-reflection does not fix it. A confident model stays wrong; adversarial pressure from a *different* agent is what injects novelty.
- "The adaptive break of debate and the modest level of 'tit for tat' state are required for MAD to obtain good performance." Both excessive and insufficient adversarial intensity hurt, and a fixed round count is worse than adaptive termination.
- Judge fairness caveat: "LLMs might not be a fair judge if different LLMs are used for agents." This is a cross-model bias concern when heterogeneous models participate.
- Evaluated on commonsense machine translation and counter-intuitive arithmetic reasoning.

The paper's *objective* is to preserve and encourage divergence rather than collapse to consensus. Of the three reviewed papers this is the one most aligned with our "surface the disagreement" goal, and unlike Du et al. it does not treat consensus as the win condition.

---

## AC#1: DoT as a motivating citation for our multi-persona design

**Assessment: citable, strong, and load-bearing. Recommend adoption as a motivating citation for t/1606's contribution claims.**

DoT is the cleanest published articulation of why a single agent is insufficient even when it reflects, and of why adversarial multi-agent structure is not mere ensembling. It supplies the theoretical "why" behind our three-persona (acc/saf/skp) architecture. The personas are not three samples of one model averaged for robustness. They are committed adversaries whose standing disagreement is the mechanism that keeps any one line of thought from degenerating into premature confidence.

Two nuances make this citation fit us better than it fits the paper's own framing.

First, we invert their terminal objective. MAD uses debate to reach a better single answer, which a judge then extracts. We use it to keep disagreement legible. DoT motivates both, but for us it motivates the stronger claim that consensus is a failure mode to be detected. Our system already operationalizes that claim. `convergenceSignals.ts:488` defines a `COLLAPSE_THRESHOLD = 0.55` with a `collapse_warning` that fires when composite agreement is high and the agreement looks superficial (`supportRatio > 0.6`). That guard treats suspicious consensus as a warning rather than a success, and DoT is the citation that justifies having it at all.

Second, DoT reframes our personas as anti-degeneration devices rather than viewpoint decoration. This is the framing the owner has asked us to protect elsewhere (the metaphor/insight goal). The personas exist to break a single conceptual basin, which is what DoT names.

**Disposition:** citation-only, routed to PM for `docs/academic-paper-draft.md` (t/1606 motivation section). CL drafts the sentence-level claim below; PM integrates.

> Draft claim for the paper: *"Our three-persona architecture is motivated by the Degeneration-of-Thought problem (Liang et al., 2024). A single model that has committed to a stance cannot reliably generate novel counter-thoughts through self-reflection. We therefore instantiate disagreement as standing adversarial personas rather than as reflective self-critique, and, departing from consensus-seeking multi-agent debate, treat superficial convergence as a measured failure signal (see collapse detection) rather than a success criterion."*

---

## AC#2: Tit-for-tat intensity + adaptive termination vs. our thresholds

**Assessment: their finding supports our design and validates the adaptive-termination machinery already in place. No parameter change required. One provenance note recommended.**

### Adaptive termination is already richer here than in MAD

MAD's "adaptive break" is a judge deciding each round whether an answer has emerged. Our termination in `phaseTransitions.ts` is a strictly richer adaptive controller, not a fixed round count:

- Convergence-driven phase transitions through `confrontation → argumentation → concluding → terminated`, gated by `computeConvergenceScore` (`phaseTransitions.ts:395`), a weighted composite of qbaf agreement density, position stability, irreducible-disagreement ratio, concluding pragmatic signal, and crux-resolution ratio (`:453-457`).
- Early termination on health collapse (`< 0.10`, `:549`) and on sustained health decline (`< 0.20` for 3 rounds, `:552`). That is an adaptive break that stops a *degenerating* debate, which is the DoT failure MAD is trying to avoid.
- A `maxTotalRounds` hard ceiling (`:572`) and an API hard ceiling (`:559`) that act as backstops only. The adaptive signals fire first.
- A `concludingExitThreshold` with a validated floor. `validateAdaptiveConfig` rejects `< 0.30` because "synthesis will exit before meaningful convergence" (`:172`).

MAD's result that an adaptive break beats fixed rounds is therefore direct external corroboration for a design choice already encoded here. It is citable support, not a change request.

### "Modest tit-for-tat" intensity is modulated by phase, and that is where a provenance note belongs

MAD finds a moderate adversarial intensity is optimal. Too stubborn and the debate never converges to the correct answer; too agreeable and DoT returns. We modulate adversarial intensity by phase rather than as one global knob. `convergenceSignals.ts:574` sets `phaseMultiplier = argumentation 1.2 / confrontation 1.5 / concluding 0.6`, so adversarial weight is dialed up during confrontation and down during concluding. Conceptually this is the modest, adaptive tit-for-tat MAD endorses, expressed as a schedule.

There is an honest limit on how far their optimum transfers. MAD measures it on tasks with a ground-truth answer (MT, arithmetic), where too much tit-for-tat is bad because it blocks convergence to the correct answer. Our tasks in AI policy frequently have no single correct answer, and irreducible disagreement is a legitimate terminal state rather than a failure. So their specific optimum does not carry over as a target value. Only the shape of the result carries over. Intensity has an interior optimum, and adaptivity beats fixed round counts. That is why I am not recommending a threshold change on the strength of this paper.

**Recommendation (provenance, not parameter change):** the phase multipliers (`1.5 / 1.2 / 0.6`) and the `concludingExitThreshold` floor (`0.30`) are currently stipulated in the metric-provenance register. This paper is external conceptual support for the *existence* of an interior optimum. It is not a derivation of our *values*, because the task class differs. Add a note to `metric-provenance-register.md` recording that these values remain stipulated and that Liang et al. supports the shape but not the numbers, so a future reader does not over-claim them as literature-derived. This becomes a CL follow-up ticket (LOW).

---

## AC#3: Does the LLM-judge-bias caution apply to our AI-computed calibration metrics?

**Assessment: the caution applies to a condition we can be in, but our architecture carries two structural defenses the paper's judge lacks, and the heterogeneous-debater precondition is off by default. Residual risk is real but bounded. Risk Assessor has since ruled it LOW (borderline low-medium) and recommended the sensitivity probe (t/1835) over pinning alone. Not a blocker.**

### Why the condition can arise here

MAD's caveat names a specific setup. Heterogeneous agent models plus an LLM judge yields unfair judging. Both halves can hold in our system.

- Heterogeneous agents: cross-vendor model mixing per persona is *supported* via `stage_model_overrides`, but the committed default is `stage_model_overrides.enabled: false` (`calibration-config.json:84-89`). So the heterogeneous-debater half of MAD's precondition is opt-in and currently off in standard runs (a point RA added, t/1832#1).
- An AI evaluator: `runNeutralEvaluation` (`neutralEvaluator.ts:260`) calls a single `model` (`:251`). Its calibration-feeding outputs are `crux_addressed_ratio`, `situation_crux_alignment`, `crux_resolution_divergence_rate`, and the `engaging_real_disagreement` boolean. (It does *not* score the per-turn quality axes; see the residual-risk correction below.)

So the structural precondition MAD flags, one LLM scoring outputs from differently-modeled agents, can occur in our pipeline, but only when the opt-in overrides are enabled.

### Why the risk is materially lower than MAD's

We have no truth-judge. MAD's judge decides who is right and extracts the winning answer, which is where bias most distorts the outcome. Our evaluator never renders a verdict of correctness or a winner, so the load-bearing harm in MAD (picking the wrong winner because the judge shares a model with one agent) has no analogue in our terminal output. Note the important qualifier RA supplied: our evaluator metrics are not purely diagnostic either. `crux_addressed_ratio` and `situation_crux_alignment` feed `computeQualityScore` (`qualityScore.ts:31,33`), the optimizer's objective, and `calibrationOptimizer.recalibrateParameters` can write `calibration-config.json` (`calibrationOptimizer.ts:231`). So a biased evaluator score does not crown a debater, but it can nudge a bounded auto-tuner. The bounds are real (explicit `--apply`, a 5-debates-since-adjustment gate, value bounds, and the t/1668 replication gate), which caps blast radius without neutralizing systematic bias.

The evaluator is also persona-free and identity-randomized. `neutralEvaluator.ts:5-7` is explicitly a "Persona-Free Evaluator" that reads the transcript "with persona labels stripped (Speaker A/B/C), no POV taxonomy, no persona descriptions," and `buildSpeakerMapping` (`:75,84-93`) assigns those labels by a Fisher-Yates shuffle randomized per debate to prevent positional bias. MAD's judge sees which agent is which; ours structurally cannot. It cannot preferentially favor a same-family agent it is unable to identify, and it cannot exhibit a positional (Speaker-A-wins) bias.

### Residual risk (do not assume anonymization is sufficient)

Anonymization removes labels, not fingerprints. A single evaluator model may still rate text whose style resembles its own family's output more favorably. **Correction (RA, t/1832#1):** the original draft located this leak on the per-turn quality axes (`engagement/novelty/consistency/grounding/move_quality/crux_relevance`). That was wrong. Those axes are `PROCESS_REWARD_WEIGHTS` (`convergenceSignals.ts:392-399`), computed from convergence signals plus turn validation, and the LLM evaluator never touches them. The real stylistic-affinity surface is narrower: the evaluator's crux-status judgments and the `engaging_real_disagreement` boolean, which flow into `crux_addressed_ratio`, `situation_crux_alignment`, and `crux_resolution_divergence_rate`. The last is sharpest, because it treats the evaluator's crux status as the *reference* the engine's own crux tracker is scored against (`calibrationLogger.ts:587-596`), so a biased evaluator mis-measures the engine, not only itself.

Two facts sharpen this into a real if bounded risk.

- The evaluator model is CL-owned config, not pinned disjoint from the debater backends, nor rotated or ensembled. If it shares a family with one persona's backend, a systematic tilt on the crux/engaging judgments is possible, and it would be quiet, because those metrics feed the bounded optimizer rather than an alarm.
- We have no measurement of evaluator-model sensitivity. We have never re-scored one transcript under two evaluator models to see whether the metrics move. Averaging over the optimizer's 5-debate window dilutes *random* evaluator noise but preserves *systematic* same-family bias, which is the mechanism in question (RA, t/1832#1). Without the measurement, "anonymization is sufficient" is a stipulation rather than a finding, the same trap t/1669 fell into with `crux_undecided_rate`.

**Disposition (resolved):** the scoped consult ran as t/1832. RA verified the code independently and ruled the risk **LOW, borderline low-medium**, materially below MAD's, and recommended guard (b), the sensitivity probe, over pinning alone. Pinning mitigates only the same-family case, measures nothing, and adds a coupling constraint to re-validate on every debater-backend change, for a risk that is latent while overrides are off. The probe is the measurement that would move "anonymization suffices" from stipulated to derived: re-score N archived transcripts under a disjoint-family second evaluator, preregister a delta band on the four calibration-feeding metrics, and escalate to a pin or ensemble only if deltas exceed the band. Filed as **t/1835** (CL.Investigate1). RA also suggested a near-zero-cost defense-in-depth: a config-time warning when `stage_model_overrides` is enabled with a family overlapping the evaluator model.

This becomes a Risk-Assessor consult ticket (MEDIUM).

---

## AC#4: Citation disposition + follow-ups

| # | Finding | Disposition | Owner | Priority |
|---|---|---|---|---|
| 1 | DoT motivates our multi-persona / collapse-detection design | citation-only, paper draft (t/1606) | PM (CL drafts claim) | MEDIUM |
| 2 | Adaptive-break + interior-optimum tit-for-tat supports our adaptive termination; values stay stipulated (different task class) | provenance note only | CL | LOW |
| 3 | Judge-bias caution applies to the single-model evaluator condition; mitigated by no-truth-judge + persona-free randomized eval; residual stylistic-affinity risk is unmeasured | scoped consult + candidate guards | Risk Assessor (CL supports) | MEDIUM |

**Follow-up tickets to create before close (per CL review-recommendation-tracking):**

- PM integration ticket for Finding 1: draft claim into `docs/academic-paper-draft.md` (t/1606 motivation).
- CL ticket (LOW) for Finding 2: provenance note for the phase multipliers and the concludingExitThreshold floor.
- Risk-Assessor consult ticket (MEDIUM) for Finding 3: evaluator stylistic-affinity bias question plus the two candidate guards.

## Provenance

This document adds or modifies no metric, threshold, weight, or lexicon. It is an evaluation. Finding 2 *recommends* a provenance-register annotation clarifying that existing stipulated values (phase multipliers, concluding floor) gain external conceptual support but not derivation from this paper, and that annotation lands with the Finding-2 ticket. No provenance class changes here.
