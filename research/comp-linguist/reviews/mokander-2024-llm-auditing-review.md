# Review: Mökander et al. (2024), "Auditing large language models: a three-layered approach"

**Reviewer:** Computational Linguist
**Date:** 2026-07-03
**Paper:** Mökander, J., Schuett, J., Kirk, H. R., & Floridi, L. (2024). *AI and Ethics*, 4(4), 1085–1115. DOI 10.1007/s43681-023-00289-2. Open preprint: arXiv:2302.08500.
**Question posed:** Is there anything here we should use?

## TL;DR
**Limited direct relevance, one genuinely useful adapt.** This is an LLM *governance-auditing* blueprint, not an argumentation/debate/ontology technique — so most of it is out of our core domain. But we *are* an LLM-heavy application with a nascent, ad-hoc self-validation apparatus (calibration metrics, flight recorder, validation rules, the ICC/α reliability work, hallucinated-ref detection). The paper's **model-audit characteristic taxonomy** is worth adopting as a *second audit lens* over our LLM pipeline — the reliability analogue of what we already did with Wachsmuth for argument quality (t/1118). It also **validates our continuous ex-post monitoring** discipline. **No core adoption; a modest framing/gap-audit exercise + a citable point for the paper.**

## What the paper proposes
A three-layered audit framework where each layer's outputs feed the others:

1. **Governance audits** — of the *organizations* building LLMs: org structures, audit trails (model cards, datasheets, system cards), roles/responsibilities. White-box access.
2. **Model audits** — of the *LLM itself*, pre-release, across four characteristics: **Performance** (GLUE/SuperGLUE/BIG-bench), **Robustness** (edge-case/adversarial prompts — ANLI, AdvGLUE, Dynabench), **Information Security** (training-data-extraction attacks, differential privacy), **Truthfulness** (TruthfulQA — "distinguish the real world from possible worlds"). Medium access.
3. **Application audits** — of *products built on LLMs*: functionality (is the use legal/ethical, aligned to documented limits?) + impact (ex-ante sandbox + ex-post continuous monitoring against tolerance spans). Black-box access.

Cross-cutting claims: characteristics should be *socially/ethically relevant × predictably transferable × meaningfully operationalizable*; models keep learning so **single pre-deployment snapshots are insufficient — continuous ex-post auditing is required**; and the honest limitation that auditing can't make a model "ethical in any universal sense," only "make implicit choices and tensions visible."

## Relevance to our system
We are not an LLM-auditing tool; we are a multi-perspective argumentation platform that *uses* LLMs. So the paper maps to us only where we function as an **LLM application auditing our own pipeline** — which we already do informally. Mapping their layers onto us:

| Their layer | Our analogue | Assessment |
|---|---|---|
| Governance audit (org accountability) | — | **Out of scope.** Institutional/policy, not our engineering concern. |
| **Model audit** characteristics | our LLM-reliability apparatus | **Useful lens (see below).** |
| Application audit (ex-post monitoring) | calibration-log rolling-window monitoring, flight recorder, drift detection | **Validates what we do.** |
| Documentation artifacts (model/system cards, audit trails) | flight recorder, calibration logs, `ai-usages.json` | **We have the substrate; could formalize a "system card."** |

### The one genuinely useful adapt — a reliability-audit lens (parallels the Wachsmuth mapping)
Just as t/1118 mapped our calibration metrics onto Wachsmuth's *argument-quality* taxonomy to find gaps, we could map our LLM-reliability apparatus onto Mökander's *model-audit characteristics* to find reliability gaps:
- **Truthfulness** — strongly covered: hallucinated-node-ref detection (t/1268 `hallucinated_ref_rate`), fact-check pass, the Belief-scoring asymmetry finding, grounding confidence. This is our best-covered Mökander dimension.
- **Robustness** — moderately covered: FaultHarness fault-injection tests, the 5-mechanism topic-alignment defense (adversarial/off-topic prompts), turn-validation repair loop.
- **Performance** — weakly covered: we have no standardized-benchmark performance harness for our LLM stages (we measure debate-quality outcomes, not stage-level task accuracy vs a baseline). A real gap if we ever want to compare backends rigorously (relevant to the flash-lite / model-tier decisions).
- **Information Security** — N/A: we don't train the base models (BYOK, no fine-tuning of the frontier models in the loop), so training-data-extraction/differential-privacy don't apply to our stack.

This is a bounded, CL-relevant framing exercise — a "Mökander mapping" doc analogous to the Wachsmuth one, useful mainly to (a) justify the reliability metrics we already have and (b) surface the Performance-benchmark gap.

### Validation of existing design
- Their **continuous ex-post auditing** claim (models keep learning; snapshots insufficient) directly endorses my role's discipline of *rolling-window calibration monitoring* (>5% regression over a 7-day window triggers a diagnostic) and the model-drift regression concern. Good corroboration, not a new technique.
- Their **characteristic-selection criteria** (relevant × transferable × operationalizable) is a clean rubric for our metric-portfolio decisions — the same judgment we apply when deciding which calibration metrics to build.

## What NOT to adopt
- The **governance-audit layer** (organizational accountability structures) — institutional/policy, not our engineering scope.
- It's a **blueprint/position paper**, not an algorithm — there is no technique, model, or data structure to lift.
- Their benchmark suites (GLUE, TruthfulQA, etc.) are general-LLM benchmarks; our concern is *stage-level reliability in the debate pipeline*, which those don't directly measure.

## Recommendation
**NOTE-FOR-LATER + one optional adapt.** Do not restructure anything around this paper. If we want the value:
1. **(Optional, low cost)** Produce a "Mökander model-audit mapping" doc — map our reliability apparatus onto Performance/Robustness/Info-Security/Truthfulness to surface gaps (the standout being a missing stage-level Performance-benchmark harness, relevant to backend/model-tier comparison).
2. **(Citable)** For the academic paper's §8.13 Ethical Considerations: note that our platform is itself an LLM application that already implements the "application audit" layer's continuous ex-post monitoring (calibration logs + flight recorder), and cite Mökander et al. as the governance framing.
3. **Do not** build governance-audit machinery.

**Net:** a well-argued governance paper, tangential to our argumentation core; its one durable gift is a reliability-audit vocabulary that complements our Wachsmuth argument-quality lens — worth a mapping doc if prioritized, not a build.
