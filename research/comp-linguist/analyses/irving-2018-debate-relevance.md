# Relevance Assessment: "AI Safety via Debate" (Irving, Christiano, Amodei 2018)

**Ticket:** t/1609 (positions against t/1606 literature map, §1.5)
**Author:** Computational Linguist
**Date:** 2026-07-17
**Paper:** Irving, G., Christiano, P. & Amodei, D. (2018). AI safety via debate. arXiv:1805.00899 (OpenAI).
**Status:** Draft for PM integration (paper prose is PM-owned; see handoff ticket)

This assessment answers one question. Is Irving et al. 2018 prior art we build on, prior art we depart from, or a frame we borrow rhetorically while doing something different? The literature map already logs it as a **departs** relation at §1.5. This document does the deeper positioning the map compresses into one line, so the paper's Related Work section can state the relationship in full instead of gesturing at "debate research."

The short version is that we share the word "debate" and almost nothing else. Irving's debate is a *training and alignment mechanism* whose product is a verdict; ours is an *analysis instrument* whose product is a map of where three camps disagree. Treating the two as the same lineage would misdescribe both. Citing Irving earns its place through the contrast, and that contrast is load-bearing for our novelty claims.

---

## Part 1: What Irving et al. actually propose

The paper frames alignment as a game. Two agents receive a question and take turns making statements. A human judge, who cannot resolve the question directly, reads the transcript and declares a winner. Both agents are trained by self-play to maximize the chance the judge picks them. The wager is that in the equilibrium of this zero-sum game, the winning strategy is to tell the truth, because a lie gives the opponent an opening the judge can verify at the point of contention even when the judge cannot verify the whole claim.

Three structural commitments define the method:

1. **A single-winner judge.** The game terminates in a verdict. The judge is the reward signal.
2. **Zero-sum self-play training.** Each agent's gain is the other's loss, and both are optimized against the judge over many games. Debate here is a training loop, not a one-shot conversation.
3. **A complexity argument.** The paper's theoretical claim is that debate with a polynomial-time judge lets that judge correctly decide any question in PSPACE, whereas a judge acting alone (answering directly) reaches only the questions it can decide in polynomial time. Debate amplifies a bounded verifier by letting two unbounded provers direct its attention to a decidable crux. The MNIST experiment is a toy instantiation. A sparse-pixel classifier acting as the bounded judge reaches 59.4% on 6 revealed pixels and 48.2% on 4 when pixels are chosen adversarially, but 88.9% and 85.2% respectively when two agents argue over which pixels to reveal. Debate roughly doubles the weak judge's accuracy on the harder setting.

Every one of these three commitments is a design choice we did not make, and in two cases actively rejected.

---

## Part 2: Alignment versus divergence

### Where our design borrows the frame

Two agents (or three, for us) exchange structured arguments so that a reader can see the shape of a contested question. That top-level picture is shared, and it is fair to say the multi-agent-debate literature, Irving included, established the intuition that adversarial exchange surfaces signal a single generator would smooth over. Liang et al. (§1.5 of the map) make the same intuition explicit as degeneration-of-thought, and we cite both for it. Our situation-injection design also shares Irving's premise that a debate's *substance* is steerable by what the agents are made to engage. Irving steers via the judge's questions and the self-play reward; we steer via ontology-grounded situation nodes fed as context. Both are bets that debate content is a controllable variable, not an emergent given.

### Where our design departs

The departures are not incidental. They follow from a different purpose.

| Dimension | Irving et al. 2018 | AI Triad debate engine |
|---|---|---|
| Purpose | Alignment / training signal | Analysis instrument for disagreement structure |
| Terminal state | Single-winner verdict from a judge | No verdict; run ends on convergence-or-exhaustion, positions preserved |
| Reward | Zero-sum, judge-assigned | None; agents are not optimized during a run |
| Training | Self-play over many games | No training loop; fixed personas, frozen backend per run |
| Agents | Two symmetric competitors | Three fixed-persona camps (accelerationist, safetyist, skeptic) |
| Truth model | One answer is correct; debate finds it | Contested policy questions with no ground truth; the goal is to map the disagreement, not settle it |
| Outcome measure | Judge accuracy / win rate | Process metrics: crux engagement, repetition, claim retention, convergence trajectory, situation uptake |

The single most important departure is the truth model. Irving's game only makes sense when one answer is correct and the difficulty is *verification*, not *legitimacy of disagreement*. The MNIST digit is a 7 or it is not. Our questions are of the form "should frontier training runs above a compute threshold require licensing," where reasonable, informed camps disagree on values, not just facts, and where declaring a winner would be a category error. We are not building a better verifier. We are building a map of a standing disagreement, and a map that picked a winner would have erased the thing it was drawn to show.

That difference cascades. No correct answer means no meaningful judge, which means no reward, which means no self-play, which means no training loop. Remove the judge from Irving's design and the method collapses, because the judge *is* the reward. Remove the (absent) judge from ours and nothing changes, because our outcome measures were never verdicts. The two systems fail in opposite places, which is the cleanest evidence that they are different artifacts wearing the same name.

---

## Part 3: What, if anything, to adopt

### A judge / verdict layer

**Recommendation: do not adopt.** A verdict layer is antithetical to the project thesis. Our stated purpose is to surface disagreement, not resolve it. A component that reads a three-camp exchange and declares a winner would convert an analysis instrument into an opinion generator, and it would do so on the one class of question (contested values, no ground truth) where a verdict is least defensible. The one place a judge-like component already exists in our stack is LLM-as-judge scoring of the calibration metrics (Zheng et al., §1.5 of the map), and that judge scores *process quality* (did the debaters engage the crux) rather than *who was right*. That is the correct and only role for a judge here. Extending it to substantive verdicts would import Irving's central mechanism into a system whose reason for existing is to not have one.

There is a narrow, honest caveat. Irving's insight that a bounded judge can be *amplified* to adjudicate questions it could not decide alone is genuinely interesting, and if the project ever added a task with ground truth (a factual-claim-verification mode, say, rather than the policy-disagreement mode), the debate-amplifies-a-weak-verifier pattern would become relevant and worth revisiting. It is out of scope for the current instrument. I flag it as a boundary condition, not a recommendation.

### The PSPACE / complexity argument

**Recommendation: cite for contrast, do not build on.** The complexity result is a claim about what a *trained* debate game can compute when a poly-time judge adjudicates optimal play. It has three load-bearing preconditions we do not meet: optimal play (reached via training), a judge whose verdict is the object of the theorem, and a well-defined decision problem with a correct answer. We do not train agents, we have no adjudicating judge, and our questions are not decision problems with correct answers. The theorem therefore does not bear on our situation-injection or crux-alignment claims. Those claims are empirical (does injecting ontology-grounded situations measurably shift debate substance), not complexity-theoretic (what class of problems can this game decide). Importing the PSPACE framing to dress up an empirical injection result would be a borrowed-authority move our honesty constraints prohibit. The right use of the complexity argument in our paper is to state plainly that it is the theoretical backbone of *training-based* debate and does not transfer to an *analysis-based* one, which sharpens why our evaluation is process-metric-driven rather than accuracy-driven.

### The MNIST toy result

**Recommendation: cite as illustration of the frame we depart from, not as a method to replicate.** The sparse-pixel experiment (6px 59.4% to 88.9%, 4px 48.2% to 85.2%) is a clean demonstration of debate amplifying a *weak judge on a ground-truth task*. It is the purest statement of the paradigm we are not in, with a correct label, a bounded verifier, and a win condition. Reproducing anything like it would require inventing a ground-truth task we deliberately do not have. Its value to us is expository. It lets the paper show a reader, in one concrete example, what training-based debate optimizes for, so the contrast with our no-verdict process instrument lands with a picture rather than an assertion.

---

## Part 4: Citation disposition

**Disposition: citation-only, routed to PM.**

Nothing in Irving et al. motivates a change to the debate engine. The three candidate adoptions (judge layer, complexity argument, MNIST-style task) are all recommended *against* on thesis grounds, so there is no implementation ticket to spin. What the paper does is anchor the Related Work contrast that makes our novelty claims legible: C2 (situation injection as a treatment on a *process* outcome) and C3 (process-level calibration telemetry) both read as "debate research, but the metric is not accuracy," and Irving is the sharpest available reference point for what "not accuracy" is departing from.

The citation is already present in the map at §1.5. This assessment supplies the paragraph-length positioning the paper needs beyond the one-line relation:

- Debate-as-training versus debate-as-analysis, and why removing the judge breaks one design and not the other.
- Why a verdict layer is rejected on thesis grounds (surface disagreement, do not resolve it).
- Why the PSPACE result does not transfer (no training, no judge, no ground truth) and should be cited only as the backbone of the paradigm we depart from.

This content belongs in the paper's Related Work / positioning section, owned by the PM per the CL/PM split. A PM-scoped integration ticket accompanies this document. No CL or Shared-Lib implementation ticket is created, because the assessment's conclusion is to adopt none of Irving's mechanisms.

---

## Handoff and process notes

- Paper-bound content routes to the Project Manager for integration into `docs/academic-paper-draft.md`; the CL does not commit that file. A PM integration ticket accompanies this document (pattern: t/1605, t/1607).
- No production metric, threshold, weight, or lexicon is defined or changed here, so no `metric-provenance-register.md` entry is triggered.
- No design change is proposed, so no implementation ticket is spun. The single boundary condition worth remembering (Irving's amplification pattern becomes relevant only if a ground-truth debate mode is ever added) is recorded here rather than ticketed, since it is contingent on a mode that does not exist.
