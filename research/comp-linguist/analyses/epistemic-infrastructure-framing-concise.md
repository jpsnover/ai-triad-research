# The AI Rosetta Stone as Epistemic Infrastructure

## The Argument

Epistemic infrastructure shapes how communities produce, test, and transmit knowledge. Writing systems, the scientific method, peer review: none contain knowledge. They create the conditions under which knowledge becomes wisdom.

The AI Rosetta Stone provides epistemic infrastructure for multi-perspective policy analysis. Its purpose is not to store information or generate arguments. Its purpose is to engineer relevance and salience: the structural conditions under which the wisdom embedded in AI policy discourse becomes accessible, testable, and actionable.

---

## The Terms, Declared

**Relevance** and **salience** are used here as folk glosses. Relevance means what matters; salience means what stands out. The system computes four distinct things under the name relevance:

- **dialectical**: post-propagation argument strength under QBAF semantics. What survived scrutiny.
- **topical**: embedding similarity between a text and a query. What is about the same thing.
- **marginal**: utility delta a candidate move would add to the argument network. What is worth saying next.
- **counterfactual**: change in outcome when an argument is removed. What the result depends on.

**Wisdom** is digested experience. Each debate is an experience. Three perspectives commit to positions, defend them under pressure, and reflect on what they learned. That reflection proposes updates to beliefs, desires, and intentions; a human reviews every proposal before it takes hold. The wisdom this system can claim is **structural, not veridical**: it shows where disagreement lives and what would resolve it, not whether surviving claims are true.

---

## Survival Is Not Truth But It Ain't Nothing

A claim can dominate the argument graph and be false. QBAF propagation computes coherence within a constructed network; nothing in the loop touches the world. The system's authority is bounded in two ways. First, loop writes are human-gated: harvested proposals do not change the taxonomy until a person reviews and accepts them. Second, the system's most important product points beyond itself. A crux marks where exogenous evidence and real institutional experience must be consulted. The loop clarifies the crux; it does not resolve it.

The same discipline applies to the numbers. Affect dimensions, utility signals, and graph attributes are calibration signals: internally consistent and auditable, useful for comparing debates run under the same instrument, not validated measurements of rhetorical reality. Self-tuning improves how well the machine runs; it never upgrades a number's epistemic status.

The system's products are **tested coherence** and **legible disagreement structure**.

---

## How the System Engineers Relevance and Salience

### BDI Decomposition

BDI classification asks what kind of claim this is. Beliefs are empirical assertions; Desires, normative commitments; Intentions, strategic proposals. Different kinds are contestable in different ways: evidence can refute a Belief but not a Desire; feasibility can challenge an Intention but not its values. The decomposition prevents the commonest failure of policy discourse, which is arguing about evidence when the disagreement is about values.

### Three Perspectives, One Situation

Each perspective (accelerationist, safetyist, skeptic) is a complete BDI worldview. The same phenomenon is salient to each for different reasons: "AI governance" is an innovation bottleneck to the accelerationist, essential gating to the safetyist, a capture risk to the skeptic. Situation nodes hold all three interpretations simultaneously. The system does not resolve which is correct; it makes visible what each foregrounds and backgrounds.

### Controlled Vocabulary

The deepest form of talking past each other is using the same word for different questions. A controlled vocabulary forces ambiguity into the open. Every ambiguous term fans out into standardized senses: "accountability" becomes *accountability (market)*, *(institutional)*, and *(algorithmic)*, each carrying its camp of origin, definition, and characteristic phrases. When a disagreement turns out to be definitional rather than empirical, the system classifies it as such. Readers always see the disambiguated form; bare terms are blocklisted.

### Register Alignment

Taxonomy nodes are written in precise genus-differentia form. Debate claims arrive in colloquial argumentative prose. Embedding models separate texts by register as well as by content, so a claim and the very node it instantiates can sit far apart in embedding space while saying the same thing. The system corrects this with synthetic paraphrasing: each extracted claim is rewritten into the taxonomy's register, and matching runs on the paraphrase rather than the raw utterance. Content similarity then dominates register similarity.

### QBAF: Dialectical Relevance

Every claim enters the argument network with a base strength. Attacks reduce it, supports increase it, and strength propagates. The result is a computed ranking showing which claims survived scrutiny, which were undermined, and which were never engaged. Node selection uses the same logic: every active debate claim is scored against every taxonomy node, so nodes relevant to live arguments surface even when irrelevant to the original topic query.

### Adversarial Debate

Three agents with structurally different worldviews engage under formal rules. Commitment tracking prevents silent self-contradiction. Convergence diagnostics detect recycled arguments and force phase transitions. A moderator holds no position on substance and issues directives the next turn must visibly address. Its authority is entirely procedural, which is what makes it infrastructure rather than a fourth debater.

### Staged Turn Pipeline

A debater's turn is a pipeline of narrow stages, each holding only the context needed for one action: Brief (claims on the table), Plan (litigation strategy), Draft (the statement plus key assumptions), quality gates (lookahead, draft-quality, off-scope), Cite (taxonomy references validated against a citation bank), and Micro-fix (surgical repair). Each stage boundary is a validation boundary. Each stage can run on a different model.

### Cruxes: Counterfactual Relevance

A crux answers one question. If you could resolve just one point, which would change the most minds? The system locates it by intervention: remove each pivotal argument, recompute what survives, and the argument whose removal most changes the outcome is the crux. Recurring cruxes mark the structural fault lines of the discourse and are the system's handoff to reality, the places where the world's own testimony must be brought in.

### Strategic Evaluation

Each agent carries a per-turn utility triple: position strength, attack effectiveness, and crux engagement. The ratios reveal posture. High attack effectiveness with low crux engagement is scoring rhetorical points without advancing understanding. Concessions are excluded from the utility score so the system never makes honest concession costly. A separate asymmetry signal surfaces strategic concession (giving away weak nodes to extract valuable ones) without penalizing the genuine article.

### The Three Weights

Three scalar weights answer what BDI classification does not: **confidence** (how well-supported is this Belief?), **priority** (how important is this Desire?), **operationality** (how actionable is this Intention?). The most consequential piece is **doctrinal anchoring**: a Belief instantiating an identity-constituting commitment receives a confidence floor. Both the evidential and the effective confidence are displayed, faithfully modeling how real policy actors hold under-evidenced but load-bearing positions. The weights compose: a priority-5 Desire served only by operationality-2 Intentions reveals a structural gap visible only when all three are present.

### Situations as Topic Generators

A calibrated debate engine running on a poorly chosen topic produces activity, not insight. Every situation carries a `disagreement_type` naming why the perspectives diverge: definitional, interpretive, or structural. That type selects the debate strategy. A divergence score ranks every situation by expected productivity, closing the loop into topic selection. Situations point to productive disagreements, debates test them, and results feed back into the scoring.

### Reliability

The system's working assumption is that any LLM output may be hallucinated, malformed, or incomplete. Five principles govern: constrain before generating (structured output modes, citation banks); validate at every boundary (schema validators, entailment checks, node-reference sanitization); repair before regenerating (micro-fixes, targeted hints on failure); stage then merge (bulk writes go through schema-validated staging before production data is touched); and record everything (flight recorder, per-stage provenance). A bad output is a diagnosable event, not a mystery.

### Wisdom Harvesting

Documents are extracted into structured knowledge, debates test that knowledge under adversarial pressure, reflection converts outcomes into proposals, and the updated taxonomy grounds the next debate. The reflect step never writes directly. Proposals land in a review queue where a human approves or rejects each before anything changes. The machine proposes; the human disposes. A bad node poisons every future debate that injects it, so the gate is quality control as well as epistemic honesty.

---

## Why "Rosetta Stone"

The original Rosetta Stone enabled translation between three scripts encoding the same decree. This system enables translation between three intellectual traditions engaging the same phenomena. The controlled vocabulary makes the analogy literal: the same words carry different senses across camps, and the system is the translation table. It does not resolve which language is correct. It makes all three legible simultaneously, showing where they converge, where they genuinely diverge, and what would resolve the divergence.

---

## The Lineage, as Aspiration

| Infrastructure | What It Engineers | What It Harvests |
|---|---|---|
| **Socratic dialectic** | Assumption visibility | Examined beliefs |
| **Scientific method** | Falsifiability | Reliable empirical knowledge |
| **Double-entry bookkeeping** | Financial transparency | Accurate accounts |
| **Common law** | Precedent-tested interpretation | Legal wisdom |
| **Peer review** | Adversarial scrutiny | Validated findings |
| **AI Rosetta Stone** *(aspirant)* | Multi-perspectival relevance and salience | Structured, tested disagreement |

Membership is not conferred by structural resemblance. Every prior entry became infrastructure through adoption by a community of practice over generations; adoption is constitutive, not incidental. By that standard the AI Rosetta Stone is a research prototype serving a single researcher. Its row is an aspiration whose entry fee is validated instruments, crux correspondence with real discourse, and a community that finds its structures worth adopting.

---

## The Claim

The AI Rosetta Stone is epistemic infrastructure that:

1. **Engineers relevance** by decomposing claims into epistemic kinds (BDI), computing relevance (dialectical) through formal argumentation, and distilling discourse into relevance (counterfactual) at the cruxes.

2. **Engineers salience** by maintaining three structurally different worldviews simultaneously, translating between them through shared situation nodes and a controlled vocabulary, and aligning registers so that content determines what is matched.

3. **Harvests candidate wisdom** by subjecting its own knowledge to adversarial scrutiny, routing what survives through a human gate, and iterating, with the cruxes marking where the loop must hand its questions to the world.

The result is a living, adversarially refined account of where AI policy discourse agrees, disagrees, and pivots, together with the specific questions whose answers would move it. Within the boundary drawn at the start, the wisdom on offer is structural rather than veridical, corpus-bound rather than world-anchored, and valuable because it identifies where the world's own testimony must be brought in.
