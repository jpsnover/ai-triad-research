# Process Reward Models: Relevance to AI Triad Research

## What Are Process Reward Models?

Process Reward Models (PRMs) evaluate the correctness of each **intermediate step** in a multi-step reasoning chain, rather than only scoring the final output. They contrast with Outcome Reward Models (ORMs) which provide a single reward signal for the end result.

The core insight: in complex reasoning, a correct final answer can be reached through flawed intermediate steps (lucky reasoning), and a wrong final answer can result from mostly-sound reasoning with one mistake. PRMs identify *where* reasoning goes right or wrong, enabling better credit assignment and targeted correction.

**Origin:** Lightman et al. (2023) introduced PRM800K, demonstrating that step-level supervision outperforms outcome-level supervision for mathematical reasoning. Since then, PRMs have been extended to code verification, clinical note generation, financial reasoning, and agentic task completion.

---

## How PRMs Work

```
Traditional (ORM):  Reasoning chain → Final answer → Score (correct/incorrect)

Process (PRM):      Step 1 → Score₁ → Step 2 → Score₂ → Step 3 → Score₃ → ... → Final
                    Each step evaluated independently for correctness
```

**Training approaches:**
- **Discriminative PRMs** — Binary classifiers trained on step-level annotations (correct/incorrect per step). Requires expensive human annotation or compute-intensive Monte Carlo rollouts.
- **Generative PRMs (ThinkPRM, 2025)** — Generate a verification chain-of-thought per step. Require 100× fewer process labels than discriminative PRMs while outperforming LLM-as-Judge baselines.
- **InversePRM (AgentPRM, 2025)** — Learn process rewards directly from demonstrations without explicit outcome supervision. Small 3B models trained this way outperform GPT-4o baselines.

---

## Relevance to AI Triad Research

### High Relevance: Our System Already Implements PRM-Like Patterns

Our debate system performs step-level evaluation at multiple points — we just don't call it "process reward modeling." The conceptual mapping is direct:

| PRM Concept | Our Implementation |
|---|---|
| **Step-level scoring** | Each debate claim gets independent `base_strength` via BDI sub-score composite (t/396) |
| **Intermediate verification** | Turn validation: 9 symbolic rules + neural quality check per turn |
| **Process vs outcome** | Convergence diagnostics (process) vs synthesis preferences (outcome) |
| **Credit assignment** | Edge attribution: `computeEdgeAttribution()` identifies which attack/support changed a claim's strength (t/395) |
| **Trajectory evaluation** | QBAF strength timeline tracks per-node strength across debate turns |
| **Step-level feedback** | Moderator interventions (PIN, PROBE, CHALLENGE) provide targeted per-turn feedback |

### The Key Parallel: Debate as Reasoning Chain

A multi-turn debate IS a reasoning chain. Each turn is a "step" that can be evaluated for:
- **Correctness** — Does the claim follow from evidence? (our `base_strength` scoring)
- **Relevance** — Does the turn engage the actual disagreement? (our `engagement_depth` diagnostic)
- **Novelty** — Does the turn advance the debate? (our `recycling_rate` diagnostic)
- **Consistency** — Does the turn contradict prior commitments? (our commitment tracking)

Our system evaluates these at every turn — that's process reward in practice.

### Where PRMs Could ADD Value (Beyond What We Do)

**1. Formalize the Turn Validation Score as a Process Reward**

Currently our turn validation produces a binary (accept/retry) with optional quality flags. A PRM-style approach would produce a **continuous process reward** per turn:

```
turn_reward = w₁ × engagement_score + w₂ × novelty_score + w₃ × consistency_score + w₄ × specificity_score
```

This continuous signal could:
- Drive adaptive temperature per turn (high-reward turns → maintain temperature; low-reward → increase for exploration)
- Weight claim outcomes in the calibration system (claims from high-reward turns are more informative)
- Inform phase transition timing (accumulating low turn rewards → debate exhaustion)

**Current gap:** Our turn validation is binary + flags. We don't compute a continuous quality score per turn that could serve as a process reward signal.

**2. Train a Lightweight Verifier for Argument Quality**

ThinkPRM (2025) shows that generative verifiers (LLMs that generate step-by-step verification reasoning) outperform discriminative classifiers on reasoning tasks, using 100× fewer labels. We could train a verifier that:

- Takes a debate turn + argument network context
- Generates a verification chain: "This claim cites acc-beliefs-012 as evidence. The node describes empirical validation of decentralized development. The claim argues that open-source outpaces proprietary — this is consistent with the cited node. However, the claim doesn't address the counter-evidence in saf-beliefs-019. Process score: 0.65."
- Produces a per-turn process score used by the moderator and phase transition system

**Feasibility concern:** This requires a trained verifier model or fine-tuned LLM. Our current approach (symbolic validation + neural quality assessment) achieves a similar result without training data, but a dedicated PRM could be more precise.

**3. Self-Debate Reinforcement Learning (SDRL)**

SDRL (2026) trains a single model to be both a strong reasoner and a strong critic by exposing it to debate scenarios during training. Their key finding: "improving agents' private critique can improve overall multi-agent debate performance."

**Relevance:** Our debate agents are general-purpose LLMs with character prompts — they aren't specifically trained for debate. SDRL suggests that if we could fine-tune a model on our 93+ debate transcripts, the resulting model would be better at both generating arguments AND evaluating opponent arguments. This is a future research direction, not an immediate adoption — it requires training infrastructure we don't have.

**4. Process Rewards for the Extraction Pipeline (FIRE)**

FIRE already implements iterative verification (per-claim confidence → targeted refinement → re-assessment). This IS process-level supervision — each extraction step is evaluated before proceeding. A formal PRM could replace the hand-crafted evidence criteria heuristic with a learned verifier that scores extraction quality per claim.

**Current state:** FIRE's evidence criteria (specificity, has_warrant, internally_consistent) are hand-crafted features. A PRM would learn these features from data.

**5. AgentPRM for Moderator Decision Quality**

The AgentPRM framework (2025) evaluates intermediate agent decisions using Monte Carlo rollouts — "if the agent had made a different choice at this step, how would the trajectory change?" Applied to our moderator:

- After each moderator selection (who speaks next, about what), compute a counterfactual: "if the moderator had selected a different responder or focus point, how would the debate trajectory differ?"
- Over time, this trains the moderator to make higher-quality selections

**Feasibility concern:** Requires running multiple debate rollouts per moderator decision — expensive. But the principle (evaluating moderator choices by their downstream impact) is already implicit in our calibration system.

---

## What We Do That PRM Literature Doesn't Address

### 1. Multi-Perspective Process Evaluation

PRMs evaluate reasoning against a single ground truth (the math problem has one answer). Our system evaluates reasoning from **three perspectives simultaneously** — a claim's "correctness" depends on which POV is evaluating it. Standard PRM scoring (correct/incorrect per step) doesn't capture this perspectival dimension.

### 2. Argumentation-Theoretic Process Rewards

PRMs score steps as correct/incorrect. Our QBAF propagation computes **argument strength** — a continuous value reflecting not just whether a claim is valid but how well it withstands attack. This is a richer signal than binary step correctness.

### 3. Closed-Loop Taxonomy Evolution

PRMs improve a single model's reasoning. Our system improves a **knowledge base** through debate outcomes. The "reward" isn't better model weights — it's a more accurate, adversarially-tested taxonomy.

### 4. Symbolic Process Verification

Most PRM work uses neural verifiers (another LLM scoring each step). Our turn validation is primarily **symbolic** — 9 deterministic rules check structural correctness, with neural assessment only for soft qualities. This is more transparent and reproducible than neural-only verification.

---

## Recommendations

| Recommendation | Priority | Effort | Value |
|---|---|---|---|
| **Compute continuous turn quality score** as process reward signal | Medium | Small | Enriches calibration, informs phase transitions |
| **Log turn rewards alongside convergence signals** for correlation analysis | Low | Trivial | Data for future PRM training |
| **Explore ThinkPRM-style verification** for argument quality assessment | Low | Large | Could improve BDI scoring accuracy |
| **Frame our existing system as PRM-adjacent** in the academic paper | Medium | Trivial | Positions our work in the PRM literature |
| **Investigate SDRL for debate-trained models** | Research | Large | Future direction, requires training infra |

### The Most Actionable Item

**Compute a continuous turn quality score.** We already have all the components:
- Engagement depth (did the turn engage opponents?)
- Recycling rate (did it say something new?)
- Commitment consistency (did it contradict itself?)
- Taxonomy coverage (did it use relevant grounding?)
- Move diversity (did it use a non-repetitive move?)

Composing these into a single per-turn `process_reward` score and logging it alongside convergence signals would:
1. Make our system explicitly PRM-adjacent (publishable framing)
2. Provide a training signal if we ever fine-tune a debate model
3. Enable process-reward-weighted phase transitions (accumulating low turn rewards → move to synthesis)
4. Improve the calibration system (high-reward turns produce more reliable calibration data)

---

## Key Papers

- Lightman et al. (2023). *Let's Verify Step by Step.* [PRM800K — foundational PRM dataset]
- Wang et al. (2025). *Process Reward Models That Think (ThinkPRM).* arXiv:2504.16828 [Generative verification CoT, 100× fewer labels]
- Liao et al. (2025). *Process Reward Models for LLM Agents (AgentPRM).* arXiv:2502.10325 [Actor-critic for agents, InversePRM]
- R-PRM (2025). *Reasoning-Driven Process Reward Modeling.* EMNLP 2025 [Reasoning-aware rewards]
- SDRL (2026). *Prepare Reasoning Language Models for Multi-Agent Debate.* arXiv:2601.22297 [Self-debate RL, critic training]
- Qu et al. (2026). *Process Reward Agents for Steering Knowledge-Intensive Reasoning.* arXiv:2604.09482 [Process rewards for knowledge-grounded reasoning]
- Survey: *A Survey of Process Reward Models.* arXiv:2510.08049 [Comprehensive overview]

---

*Drafted: 2026-05-07 · Computational Linguist · AI Triad Research*

Sources:
- [Process Reward Models That Think (ThinkPRM)](https://arxiv.org/abs/2504.16828)
- [Process Reward Models for LLM Agents (AgentPRM)](https://arxiv.org/abs/2502.10325)
- [Self-Debate Reinforcement Learning](https://arxiv.org/html/2601.22297v1)
- [A Survey of Process Reward Models](https://arxiv.org/abs/2510.08049)
- [Reasoning-Driven Process Reward Modeling (R-PRM)](https://aclanthology.org/2025.emnlp-main.679.pdf)
- [Process Reward Agents for Knowledge-Intensive Reasoning](https://arxiv.org/html/2604.09482v1)
- [Process vs Outcome Reward for Agentic RAG](https://openreview.net/forum?id=h3LlJ6Bh4S)
- [Disagreements in Reasoning: Persuasion Duality](https://arxiv.org/html/2509.21054v1)
- [Awesome Process Reward Models (curated list)](https://github.com/RyanLiu112/Awesome-Process-Reward-Models)
