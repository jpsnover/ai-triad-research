# Relevance Assessment: "Improving Factuality and Reasoning through Multiagent Debate" (Du et al. 2023)

**Ticket:** t/1610 (positions against t/1606 literature map, §1.5; sibling to t/1609 on Irving et al.)
**Author:** Computational Linguist
**Date:** 2026-07-17
**Paper:** Du, Y., Li, S., Torralba, A., Tenenbaum, J. B. & Mordatch, I. (2023/2024). Improving factuality and reasoning in language models through multiagent debate. arXiv:2305.14325 (ICML 2024).
**Status:** Draft for PM integration (paper prose is PM-owned) plus one CL follow-up (see disposition)

This assessment answers one question. Du et al. is the closest published analog to our runtime debate loop, so the interesting question is not whether we share a lineage (we clearly do) but which mechanics we inherited, which we inverted, and whether their evaluation design gives us a usable ablation template. The literature map already logs the paper as a **departs** relation at §1.5. This document does the mechanism-level mapping the map compresses into one line.

The short version is that Du et al. and our engine run structurally similar loops toward opposite goals. Their loop drives homogeneous agents to a *common answer* and grades that answer against ground truth. Our loop drives heterogeneous personas to *surface where they disagree* and grades the process, not any answer. Because the loops look alike, the contrast is more instructive than Irving's, and one piece of their evaluation design does transfer.

---

## Part 1: What Du et al. actually build

Multiple instances of a single language model each answer a question independently. Then, over several rounds, every instance is shown the other instances' responses and asked to revise its own answer in light of them. After a fixed number of rounds the answers have usually converged, and the final answer is read off by majority or by taking the converged response. The wager is that exposing each agent to peers' reasoning corrects individual errors and suppresses hallucination, so the consensus answer beats any single agent's first attempt.

Four properties define the method:

1. **Homogeneous agents.** Every debater is the same model with the same prompt. There are no fixed roles or opposing stances; differences between agents come only from sampling, not from design.
2. **Consensus as the objective.** The loop is engineered to converge. Convergence to a common answer is the deliverable, and the final answer is what gets graded.
3. **Ground-truth grading.** Results are reported as accuracy on tasks with correct answers: arithmetic, GSM8K grade-school math, chess move validity, MMLU, and factual biography generation. The headline is that debate raises accuracy and lowers hallucination relative to single-agent and self-consistency baselines.
4. **Round-count and agent-count as knobs.** The paper sweeps both the number of debate rounds and the number of agents, and reports monotone-with-diminishing-returns gains in accuracy on both axes. It also studies a context-management trick: summarizing other agents' prior responses so the running transcript fits the context window.

Cross-visibility of prior responses and round-based refinement are things we already do. The other three properties are choices we did not make, and property 2 is one we deliberately inverted.

---

## Part 2: Mechanism mapping

### Where the loops line up

Both systems run a multi-round loop in which each participant sees the others' prior contributions and produces a revised contribution. Our phase-transition structure is their round structure by another name, and our shared-context formatting gives each debater the cross-visibility their method depends on. If you squinted at a single round of either system you would see the same thing: several agents, a shared transcript, a step of mutual revision. This is the real reason Du et al. is the sharpest analog to our runtime loop, sharper than Irving's untrained theoretical game.

### Where they diverge

The divergence is in what the loop is *for*, and it propagates into every measurement.

| Dimension | Du et al. 2023 | AI Triad debate engine |
|---|---|---|
| Agents | Homogeneous instances of one model | Heterogeneous fixed personas (accelerationist, safetyist, skeptic) |
| Source of difference | Sampling variance only | Designed-in stance and value commitments |
| Loop objective | Converge to a common answer | Surface where the camps disagree; preserve it |
| Convergence | The deliverable, maximized | A diagnostic signal, not a target |
| Task | Questions with a correct answer | Contested policy questions with no ground truth |
| Outcome measure | Answer accuracy / factuality | Process metrics: crux engagement, repetition, claim retention, convergence trajectory, situation uptake |

The load-bearing conflict is the status of convergence. For Du et al., convergence is the whole point, and a run that fails to converge is a failed run. For us, convergence is a measured trajectory whose *desirable* value is not "as high as possible." A three-camp debate that collapses to a single shared answer has usually failed at its job, which is to show a reader the structure of a genuine disagreement. Premature consensus is a failure mode we built `convergence_score` partly to *detect*, not a success we built it to maximize. Their aggregation step, where peer answers pull each agent toward the majority, is the pressure our heterogeneous fixed personas exist to resist. We keep the acc/saf/skp stances from dissolving into each other on purpose.

That difference cascades the same way Irving's did, in a different place. Homogeneous agents plus ground truth make "the consensus answer is more accurate" a coherent and testable claim. Heterogeneous personas plus contested values make the same sentence a category error. "Consensus improves factuality" cannot be our frame, because our questions have no factuality to improve and our design treats forced consensus as damage.

---

## Part 3: Metric overlap and ablation transfer

### Is their outcome frame adoptable?

No. Their outcome metric is task accuracy against a known answer, which presupposes the ground truth our problem domain lacks. "Does consensus improve factuality" is the right question for arithmetic and biographies and the wrong question for "should frontier training runs above a compute threshold require licensing." Importing accuracy-style scoring would require inventing a correct answer to a values disagreement, which is the move our whole design refuses. So none of their *outcome* measurement transfers.

### Does their evaluation *design* transfer?

Partly, and this is the one place Du et al. earns more than a citation. Their round-count and agent-count sweeps are a clean ablation template, and one of the two axes maps directly onto a parameter I own.

- **Round-count / max-iteration sweep.** This transfers cleanly. They vary the number of debate rounds and plot the effect. Our analog is the max-iteration cap (a CL-owned algorithmic parameter alongside temperature, convergence thresholds, and the situation cap). Sweeping the cap and reading its effect on our *process* metrics (does more iteration raise crux engagement, or just repetition) is a well-formed ablation and a natural addition to the t/1606 study design. It is worth its own ticket, because it is an experiment-design change, not paper prose.
- **Agent-count sweep.** This transfers only partly, and is confounded for us. Their agents are interchangeable, so adding one is a pure scaling knob. Ours are not; the three personas encode a fixed ontology (acc/saf/skp), and adding a fourth is an ontology change with its own justification burden, not a dial. I would not adopt an agent-count sweep as a scaling ablation. If persona *count* is ever varied it should be studied as a design change, not a knob turn.
- **Context-summarization trick.** This is relevant to one metric, not a headline. Their summarize-prior-responses technique to fit the context window bears on our `claims_forgotten` metric, since dropped context is what that metric detects. It is an engineering mitigation worth remembering if `claims_forgotten` regresses on long runs, not a contribution to adopt now.

### What they anticipate versus what is novel to us

Their work anticipates the value of multiple rounds and cross-visibility, both of which we already have. Novel to us, and not present in their design: persona heterogeneity as a fixed ontology, situation injection as a treatment on debate substance, BDI grounding of the positions, and process metrics as the outcome rather than accuracy. The t/1606 contribution claims C2 (situation injection) and C3 (process telemetry) sit exactly in that novel region, which is why Du et al. is the right paper to contrast them against.

---

## Part 4: Citation disposition

**Disposition: mixed. Citation-only positioning routes to PM; one ablation recommendation spins a CL ticket.**

The positioning content is citation-only and belongs in the paper's Related Work section, owned by the PM per the CL/PM split. Du et al. is already cited in the map at §1.5; this assessment supplies the paragraph-length contrast the paper needs beyond the one-line relation:

- Same loop shape (rounds, cross-visibility, mutual revision), opposite objective (their consensus-as-deliverable versus our disagreement-as-deliverable), and why forced consensus is damage in our setting.
- Why "consensus improves factuality" cannot be our frame (no ground truth; heterogeneous personas).
- Which of our contributions Du et al. throws into relief (C2, C3).

Separately, one recommendation motivates real work and therefore gets its own ticket rather than a paper paragraph: fold a **max-iteration-cap sweep** into the t/1606 ablation study, adapting Du et al.'s round-count ablation to our process metrics. Max iterations is a CL-owned parameter, so this is a CL-scoped design-and-experiment ticket, consistent with the ticket's scope note that design and experiment changes spin their own tickets. The agent-count sweep is explicitly recommended *against* as a scaling knob, for the confounding reason above.

---

## Handoff and process notes

- Paper-bound positioning routes to the Project Manager for integration into `docs/academic-paper-draft.md`; the CL does not commit that file. A PM integration ticket accompanies this document (pattern: t/1605, t/1607, t/1613).
- The max-iteration-cap ablation gets a CL-scoped ticket before this one closes (Work Completion Discipline: a recommendation is not a ticket).
- No production metric, threshold, weight, or lexicon is defined or changed here, so no `metric-provenance-register.md` entry is triggered. The eventual ablation ticket, if it recommends a new cap value, will carry its own provenance declaration at that time.
