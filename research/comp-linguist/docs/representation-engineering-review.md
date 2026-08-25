# Representation Engineering (Zou et al., 2023): Applicability Review and Recommendations

**Paper:** Andy Zou, Long Phan, Sarah Chen, … Dan Hendrycks. *Representation Engineering: A Top-Down Approach to AI Transparency.* arXiv 2310.01405v4 (Center for AI Safety, CMU, UC Berkeley, Stanford, et al.). Code: github.com/andyzoujm/representation-engineering.
**Reviewer:** Computational Linguist
**Date:** 2026-08-25
**Provenance of this review:** read the full PDF (v4, ~179k chars extracted via pdfminer). Where I state a project implication it is my inference, marked as such. This paper pre-dates the assistant knowledge cutoff, so the summary is drawn from the document itself, not recollection.

## 1. What the paper is

Representation engineering (RepE) is a top-down transparency method. Instead of studying individual neurons or circuits (bottom-up mechanistic interpretability), it places high-level **concept representations** at the center. It locates the direction in a model's hidden-state space that encodes a concept (truthfulness, utility, probability, morality, emotion) or a function (lying, power-seeking), then reads or steers along that direction.

Two operations:

- **Representation Reading** via **Linear Artificial Tomography (LAT)**: a three-step scan modeled on neuroimaging. (1) Design a stimulus set of paired contrast tasks (for honesty, an explicit "be honest" experimental task against a "be dishonest" reference task, which increases the separability of the target activity). (2) Collect hidden-state activations. (3) Model them into a linear **reading vector** (PCA-style). Projecting new activations onto the reading vector monitors the concept in real time. The honesty reading vector reaches over 90% accuracy separating honest from dishonest held-out examples, and drives **lie and hallucination detection**.
- **Representation Control**: add or subtract the concept direction in the activations to steer behavior (increase or decrease honesty, suppress power-seeking, and so on).

A conceptually important distinction the paper draws (Section 4.2): **truthfulness** (outputs match the world) versus **honesty** (outputs match the model's own internal beliefs). RepE shows a model can hold a consistent internal concept of truth while emitting falsehoods, so an output-only signal cannot see the gap between internal belief and utterance.

## 2. Applicability verdict, and the hard constraint

**Verdict: conceptually high-value, directly-deployable only under a condition we do not currently meet.**

RepE operates on hidden states. Our production debate and extraction backends are API models (Gemini free tier, Anthropic Claude, Groq per `ai-models.json`), which expose tokens and logprobs at best, not layer activations. **LAT reading and control cannot run on a black-box API model.** Any claim that we could monitor a debater's internal honesty or affect via RepE on the current stack would be false, and I flag that plainly so it does not get overstated in a proposal or the paper draft.

What *is* usable splits into three tiers below: lessons that transfer to our black-box setting now, a research path that unlocks the full method only if we host an open-weights model locally, and guardrails.

## 3. Recommendations

### Tier A. Transferable to our current black-box stack (no model internals needed)

1. **Adopt the truthfulness-vs-honesty distinction as a stated limit on our calibration metrics.** Every honesty-adjacent signal we compute (`crux_addressed_rate`, claim-verification verdicts, the op-ed grounding and fabrication guards) is a **behavioral** measurement of the utterance. RepE gives a crisp, citable statement that behavioral honesty is not internal consistency. Recommendation: add a short "what this cannot see" note to the honesty/verification entries in `metric-provenance-register.md`, and treat any "the debater was honest/dishonest" phrasing in reports as a claim about outputs only. This composes with the instrument-effects review (2607.14399): both papers say our output-only instruments are partial by construction.

2. **Borrow the contrast-stimulus design principle for our probe and prompt construction.** RepE's separability gain comes from *paired* stimuli (experimental task vs reference task) rather than single prompts. We already frame contrasts in the polarity gate (`"The {pov} position is: {text}"`) and the deBERTa NLI stage. Recommendation: audit whether our concept probes and judge prompts use explicit paired-contrast framing where separability matters, and standardize it where it is currently one-sided. Low cost, plausibly improves the black-box proxies we keep.

3. **Use RepE's concept inventory as a coverage check on our affect and stance signals.** RepE reads utility, probability, morality, emotion, and power-seeking as first-class concepts. Our affect layer (`affectSignals.ts`, the fear/hope/urgency/outrage/empathy lexicons) covers emotion only, via lexicons, and is currently stipulated-to-derived at best. The paper is evidence that emotion, and also power-seeking and utility, are coherent readable concepts. Recommendation (paper-facing): note the gap that we measure affect lexically and do not measure power-seeking or utility at all, as a candidate future axis.

### Tier B. Conditional on hosting a local open-weights debater (research direction, not near-term production)

If the project ever runs an open-weights model locally (we already run all-MiniLM locally for embeddings, so the infrastructure premise is not exotic), RepE becomes directly applicable and would address several standing weaknesses:

4. **White-box hallucination and lie detection on the local model's debate turns.** A per-turn honesty reading vector would give a representation-level fabrication signal that our behavioral fabrication guards (op-ed fabrication guard, the empty-voice failure work) approximate from the outside. This is the most valuable single application for us and the natural collaboration with Risk Assessor on hallucination risk.

5. **Representation-grounded affect, replacing or validating the lexicon.** An emotion reading vector would let us *validate* the currently-stipulated affect baselines against an internal signal, converting a lexicon heuristic into a measured one. This directly advances the affect-provenance work (the `AFFECT_PHASE_BASELINES` derivation, t/2680/t/2714).

6. **Power-seeking and utility monitors as new debate-quality axes**, read rather than prompted, which sidesteps the criterion-disclosure Goodhart risk flagged in the instrument-effects review.

Each Tier-B item is gated on the local-model decision, which is an infrastructure and RAG-strategy call outside CL scope (Technical Lead / DevOps). CL owns only the metric semantics if it happens.

### Tier C. Guardrails

7. **Do not represent RepE-style internal monitoring as available on API backends.** Keep the white-box constraint explicit in any downstream proposal or the academic-paper draft.
8. **Representation *control* (steering activations) is out of scope for a research-integrity tool.** Reading is a measurement; control edits the model's cognition and would compromise the neutrality of the debate substrate. Recommend we consider only the reading half, never the control half, and record that boundary if Tier B is ever pursued.

## 4. Relationship to the instrument-effects review (2607.14399)

These two papers are complementary and point the same direction. The instrument-effects paper shows our **behavioral** measurements are sensitive to the measuring apparatus (verdict grammar, criterion disclosure, run stochasticity). RepE shows there is a **representational** layer our behavioral measurements cannot observe at all. Together they argue that our calibration story is currently single-channel (output-only) and would be stronger with an internal channel, available only under Tier B. The honest near-term move is to state the limit, not to claim the internal channel we do not have.

## 5. Tracking

Per the CL review-recommendation rule, MEDIUM/HIGH implementation items need tickets and paper-only items route to PM.

| # | Item | Class | Owner | Track as |
|---|---|---|---|---|
| 1 | Truthfulness-vs-honesty limit note in the provenance register | LOW-code | CL | small CL edit, fold into next register PR |
| 2 | Paired-contrast audit of probe/judge prompts | MEDIUM | CL | CL ticket |
| 3 | Concept-coverage gap note (power-seeking, utility) | citation | PM | paper-draft note |
| 4–6 | White-box RepE monitoring on a local model | RESEARCH | TL/DevOps decide; CL semantics | consult ticket, gated on local-model decision |
| 7–8 | White-box / no-control guardrails | guardrail | CL | fold into item 1 note |

Recommendation: file item 2 as a CL ticket now, fold items 1/7/8 into the next register edit, route item 3 to PM, and open a single consult ticket for 4–6 marked blocked-on the local-model infrastructure decision rather than pretending it is actionable today.

## 6. Caveats

- The near-term value is honest scoping and one prompt-design audit, not a new production capability. The large value (items 4–6) is real but gated on an infrastructure decision that is not CL's to make.
- I read the full text but did not re-run any of the paper's experiments; the >90% honesty-classification and lie/hallucination-detection figures are the authors' reported results, cited as such.
