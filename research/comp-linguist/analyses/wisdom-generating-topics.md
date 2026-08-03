# Identifying Debate Topics and Frames That Generate Wisdom

## The Question

Not all debates produce wisdom. Some generate heat -- recycled positions, talking past each other, premature consensus. Others generate light -- positions that genuinely narrow, cruxes that crystallize, taxonomy nodes that sharpen under adversarial pressure. What distinguishes the two? And can we identify, *before running a debate*, which topics and frames are most likely to produce wisdom?

This document proposes a framework for answering that question, grounded in the AI Rosetta Stone's existing calibration metrics, ontological structure, and empirical debate history.

---

## What "Wisdom" Means in This System

Wisdom is not information (accumulated facts) or knowledge (organized patterns). Wisdom is understanding which facts matter, why they matter differently to different perspectives, where the irreducible disagreements lie, and what would have to change for those disagreements to resolve. (See [epistemic-infrastructure-framing.md](./epistemic-infrastructure-framing.md) for the full argument.)

In operational terms, a debate generates wisdom when it produces one or more of:

1. **Crux crystallization** -- a previously diffuse disagreement resolves into a specific, testable question ("Can pre-deployment testing be made fast enough to not significantly delay release cycles?")
2. **Taxonomy refinement under pressure** -- nodes that entered the debate vague or overbroad exit sharper, with tighter genus-differentia descriptions and better-drawn Encompasses/Excludes boundaries
3. **Genuine convergence** -- perspectives independently arrive at overlapping positions, producing situation nodes with multi-POV interpretations (not sycophantic agreement, but structural overlap discovered through argument)
4. **Position narrowing** -- debaters make concessions on specific sub-claims while maintaining their core positions, revealing the *precise* boundary of disagreement
5. **Assumption surfacing** -- unstated premises (`assumes` fields) are exposed and attacked, making visible the hidden load-bearing structure of each position

A debate that produces none of these -- where positions recycle, cruxes go unaddressed, and the taxonomy emerges unchanged -- has generated activity but not wisdom.

---

## Observable Signals of Wisdom Generation

The calibration system already tracks metrics that serve as proxies for wisdom. The key insight is that these metrics are *outcome* measures -- they tell us after the fact whether wisdom was generated. The goal is to identify *input* properties (of topics and frames) that predict these outcomes.

### Primary wisdom indicators

| Metric | What it measures | Wisdom signal |
|---|---|---|
| `crux_addressed_ratio` | Were the real disagreements engaged? | High ratio = debaters found and engaged the structural fault line |
| `convergence_score` | Are positions narrowing? | Moderate score (0.4-0.7) = genuine narrowing without collapse |
| `engaging_real_disagreement` | Neutral evaluator: was this a real debate? | Binary gate -- debates that fail this produced no wisdom |
| `avg_utilization_rate` | Were injected taxonomy nodes actually referenced? | High utilization = the debate was grounded in structured knowledge, not free-association |
| `situation_crux_alignment` | Did injected situations shape debate substance? | High alignment = empirical context entered the reasoning |

### Counter-indicators (wisdom inhibitors)

| Metric | What it measures | Warning signal |
|---|---|---|
| `repetition_rate` | Are debaters circling the same arguments? | High = positions have calcified; no new ground being broken |
| `claims_forgotten_rate` | Are earlier claims being dropped? | High = arguments are not building on each other; debate is memoryless |
| Sycophancy warnings | Are debaters capitulating without genuine engagement? | Any = false consensus replacing genuine disagreement |
| Quality score < 0.6 across turns | Are turns substantive? | Persistent low scores = abstract rhetoric replacing concrete argument |

### The wisdom sweet spot

The strongest wisdom signal is **moderate convergence with low repetition and high crux engagement**. This combination means: positions are narrowing (convergence), through genuinely new arguments (low repetition), focused on the actual disagreement (crux engagement). When convergence is very high (> 0.8), it often indicates sycophantic collapse. When convergence is very low (< 0.2), debaters are talking past each other.

---

## Topic Properties That Predict Wisdom

### 1. Crux density: does the topic sit on a fault line?

The best wisdom-generating topics are ones where the three POVs have **genuinely different answers to the same concrete question**. This requires the topic to intersect multiple taxonomy nodes across POVs -- not just within one perspective.

**Diagnostic:** Before running a debate, compute the topic's embedding similarity against all taxonomy nodes. Count how many nodes above threshold (e.g., similarity > 0.35) exist per POV. The ideal distribution is roughly balanced -- each POV has 3-8 relevant nodes. If one POV has 15 relevant nodes and another has 1, the debate will be lopsided: one debater drowns in material while another has nothing to work with.

**Example -- high crux density:** "Should AI systems be required to pass pre-deployment safety evaluations before market release?" All three POVs have deep, structured positions: accelerationists see innovation bottlenecks, safetyists see essential gating, skeptics see capture risk in who controls the evaluation. The topic sits precisely on a three-way fault line.

**Example -- low crux density:** "Is AI good or bad?" Too abstract to engage any specific taxonomy node. No falsifiable claims can be made. Debaters resort to rhetoric because there is no concrete disagreement to resolve.

### 2. Empirical grounding: does the evidence index have material?

The S7 investigation revealed a key finding: when the `source_evidence_index.json` lacks entries for a turn's target nodes, debaters hallucinate citations. Wisdom requires grounded argument, not fabricated evidence.

**Diagnostic:** For a candidate topic, identify the taxonomy nodes it would activate (via embedding similarity). Check how many of those nodes have entries in the evidence index. Compute an **evidence coverage ratio**: nodes-with-evidence / total-activated-nodes. Topics with coverage below 0.5 will produce debates where at least half the claims are ungrounded.

**Corollary:** Topics where the evidence index has entries from *multiple source documents* per node produce richer debates than those with single-source coverage. Multi-source nodes enable debaters to cite different evidence for the same claim, producing genuine evidentiary disagreement rather than agree-on-facts-disagree-on-interpretation patterns.

### 3. BDI heterogeneity: does the topic engage all three layers?

Topics that engage only Beliefs ("Is X empirically true?") produce verification debates -- useful but narrow. Topics that engage only Desires ("Should we want X?") produce values debates -- important but irresolvable within a single debate. Topics that engage only Intentions ("How should we implement X?") produce strategy debates -- concrete but shallow if values and facts are not contested.

The highest-wisdom topics engage all three BDI layers simultaneously. They ask a question where the *facts* are disputed (Belief), the *values* are in tension (Desire), and the *strategies* diverge even conditional on agreement about facts and values (Intention).

**Diagnostic:** For a candidate topic, classify the activated taxonomy nodes by BDI category. The ideal distribution has at least 20% in each category. A topic that activates 90% Belief nodes and 5% each of Desire/Intention will produce an empirical slugfest without touching the deeper normative and strategic disagreements.

**Example -- full BDI engagement:** "How should liability be allocated when an autonomous AI agent causes financial harm?" Engages Beliefs (can current AI systems act autonomously?), Desires (should AI have legal personhood?), and Intentions (mandatory insurance, strict liability, safe harbor frameworks). Each POV disagrees at every layer.

### 4. Appropriate abstraction level: the Goldilocks zone

Topics can be too abstract or too concrete for wisdom generation.

**Too abstract:** "What is the future of AI governance?" -- activates hundreds of nodes with no focus, produces survey-style arguments that never narrow, cruxes cannot crystallize because the question is too diffuse.

**Too concrete:** "Should the CLEAR Act penalty be five thousand or ten thousand dollars per instance?" -- activates 2-3 nodes, debate exhausts available arguments in 2 rounds, no room for BDI heterogeneity or cross-POV engagement.

**Goldilocks zone:** Topics that are specific enough to produce falsifiable claims but broad enough to sustain 6-10 rounds of genuine argument. They typically name a concrete policy mechanism or empirical phenomenon and ask about its implications across perspectives.

**Diagnostic:** Count activated taxonomy nodes. Fewer than 5 per POV = too concrete. More than 30 per POV = too abstract. The sweet spot is 8-15 per POV -- enough for sustained argument, focused enough for crux crystallization.

### 5. Situation node relevance: does the topic connect to shared ground?

Situation nodes are the system's architectural representation of shared concepts with multi-POV interpretations. Topics that activate situation nodes produce debates where the shared conceptual ground is explicit from the start -- debaters argue about interpretations of the *same thing*, not about entirely different things.

**Diagnostic:** Check how many situation nodes (sit-*, cc-*) the topic activates. Topics with 2-5 relevant situation nodes tend to produce the richest convergence patterns, because debaters are forced to engage the same empirical phenomenon from their different frames.

---

## Frame Properties That Predict Wisdom

The same topic can be framed in ways that help or hinder wisdom generation. Frame is the *way the question is posed* -- the linguistic structure, implied audience, and rhetorical stance of the debate prompt.

### 1. Conditional frames outperform binary frames

**Binary:** "Should we regulate AI?" -- invites yes/no positions that calcify immediately.

**Conditional:** "Under what conditions would pre-deployment AI safety testing produce net benefits across innovation speed, public safety, and institutional accountability?" -- forces each debater to specify their conditions, creating surface area for crux identification. The debaters cannot simply disagree; they must articulate *what would have to be true* for their position to hold.

Conditional frames directly target the system's crux identification machinery. A crux is, by definition, a condition whose resolution would change positions. Frames that ask for conditions are pre-adapted for crux extraction.

### 2. Mechanism frames outperform outcome frames

**Outcome:** "Will AI cause mass unemployment?" -- debaters argue about predictions, which are unfalsifiable within the debate. The disagreement reduces to competing intuitions about the future.

**Mechanism:** "Through what mechanisms does AI-driven automation interact with labor market adjustment -- and where do those mechanisms differ from prior waves of automation?" -- forces debaters to specify causal pathways, which can be attacked, supported, or narrowed. Each mechanism claim is individually testable.

Mechanism frames generate more argument network edges (SUPPORTS, CONTRADICTS, ASSUMES) because each mechanism step is an independent claim. More edges = richer QBAF computation = better-grounded relevance rankings.

### 3. Multi-stakeholder frames outperform single-perspective frames

**Single-perspective:** "How should AI developers ensure safety?" -- implicitly privileges the safetyist frame by pre-selecting their preferred actor (developers) and their preferred outcome (safety). The accelerationist and skeptic must fight the frame before engaging the topic.

**Multi-stakeholder:** "How should responsibility for AI system harms be distributed among developers, deployers, regulators, and affected communities?" -- distributes agency across stakeholders, giving each POV natural entry points. The accelerationist argues from the developer lens, the safetyist from the regulator lens, the skeptic from the community lens -- but all are speaking to the same question.

### 4. Tension-acknowledging frames outperform neutral frames

**Neutral:** "Discuss AI governance approaches." -- too bland to generate genuine disagreement. Debaters produce parallel essays rather than adversarial arguments.

**Tension-acknowledging:** "Pre-deployment AI safety evaluation creates a tension between innovation speed and risk mitigation. How should this tension be resolved -- and is 'tension' even the right framing?" -- names the specific conflict and then invites meta-level engagement with the frame itself. This produces the richest debates because debaters can either engage the tension directly or challenge whether the tension exists, producing argument about both the object level and the frame level.

### 5. Scope-bounded frames outperform open-ended frames

**Open-ended:** "What should AI policy look like?" -- the debaters have no shared starting point, no common evidence base, and no natural narrowing trajectory.

**Scope-bounded:** "Given the EU AI Act's tiered risk classification and the US preference for sector-specific regulation, how should jurisdictions coordinate on frontier AI systems that operate across borders?" -- provides concrete policy artifacts as shared reference points, a specific tension (EU vs. US approaches), and a bounded scope (frontier AI, cross-border operation). Debaters can immediately cite specific provisions, challenge specific mechanisms, and propose specific alternatives.

---

## A Scoring Rubric for Topic/Frame Selection

Before running a debate, score the candidate topic on these dimensions:

| Dimension | Score 0 | Score 1 | Score 2 |
|---|---|---|---|
| **Crux density** | One POV dominates (>60% of activated nodes) | Two POVs well-represented | All three POVs balanced (20-40% each) |
| **Evidence coverage** | < 30% of activated nodes have evidence | 30-60% coverage | > 60% coverage, multi-source |
| **BDI heterogeneity** | One BDI layer dominates (>70%) | Two layers represented (>20% each) | All three layers active (>20% each) |
| **Abstraction level** | < 5 or > 30 activated nodes per POV | 5-8 or 15-30 per POV | 8-15 per POV (sweet spot) |
| **Situation node activation** | 0 situation nodes | 1 situation node | 2-5 situation nodes |
| **Frame: conditionality** | Binary (yes/no) | Partial ("should we X given Y?") | Fully conditional ("under what conditions...") |
| **Frame: mechanism focus** | Outcome-only ("will X happen?") | Mixed outcome + mechanism | Mechanism-first ("through what pathways...") |
| **Frame: stakeholder breadth** | Single actor implied | Two actors named | Multiple stakeholders distributed |
| **Frame: tension acknowledgment** | Neutral/bland | Tension implied | Tension named + meta-invitation |
| **Frame: scope boundedness** | Open-ended | Partially bounded | Concrete artifacts + specific tension |

**Maximum score: 20.** Topics scoring 14+ are strong wisdom candidates. Topics scoring below 8 should be reframed before running.

---

## Operationalizing: A Pre-Debate Checklist

Given a candidate topic:

1. **Embed the topic** against all taxonomy nodes. Record activated nodes per POV and per BDI category.
2. **Check evidence coverage** for activated nodes against `source_evidence_index.json`.
3. **Count situation nodes** in the activated set.
4. **Score the frame** on the five linguistic dimensions (conditionality, mechanism, stakeholder, tension, scope).
5. **Compute composite score** from the rubric.
6. **If score < 14**, reframe:
   - Low crux density: broaden the topic to engage underrepresented POVs
   - Low evidence coverage: narrow to nodes with richer evidence, or run evidence index enrichment first
   - Low BDI heterogeneity: reframe to engage the missing layer ("how should..." adds Intentions, "is it true that..." adds Beliefs, "what should we prioritize..." adds Desires)
   - Bad frame properties: apply the conditional/mechanism/multi-stakeholder/tension/bounded templates

This checklist can be automated. Steps 1-3 are deterministic computations over existing data structures. Step 4 could be an LLM classification pass (or a simple keyword heuristic). Step 5 is arithmetic. Step 6 is a reframing prompt -- the system already has prompt templates for topic refinement.

---

## From Metrics to Methodology: Closing the Loop

The rubric above is a hypothesis. It predicts that topics scoring higher on these dimensions will produce debates with higher `crux_addressed_ratio`, lower `repetition_rate`, more taxonomy refinements, and more situation node generation. This prediction is testable.

**Validation approach:**

1. Score all past debates retroactively on the topic/frame dimensions
2. Correlate topic scores with calibration metrics (crux engagement, repetition, convergence, taxonomy edit count)
3. Identify which dimensions are most predictive -- the rubric weights may need adjustment
4. Run prospective A/B tests: for the same underlying policy question, generate two frames (one optimized by the rubric, one baseline) and compare debate quality metrics

The calibration infrastructure already logs the outcome metrics. What is missing is the *input* scoring -- systematic annotation of topics and frames along these dimensions. Adding a `topic_score` field to the `CalibrationDataPoint` schema would close the loop, enabling the optimizer to learn which topic properties predict wisdom generation, just as it currently learns which parameter values predict debate quality.

---

---

## Situation-Driven Topic Discovery: Mining the Taxonomy for Wisdom

The framework above treats topics as inputs that arrive from outside the system -- a researcher proposes a question and we score it. But the taxonomy itself contains a rich, underexploited source of debate topics: **situations and conflicts**. These are not external proposals; they are structurally embedded disagreements already identified by the extraction pipeline, each carrying precisely the properties that predict wisdom generation.

### The Situation Data Model as a Topic Generator

Every situation node carries three POV-specific interpretations (accelerationist, safetyist, skeptic), a `disagreement_type` classification (definitional, interpretive, or structural), and links to both taxonomy nodes (`linked_nodes`) and conflict files (`conflict_ids`). This is, in effect, a pre-scored debate topic with built-in multi-perspective grounding.

Consider what each field tells us about wisdom potential:

| Situation field | Wisdom signal |
|---|---|
| Three POV interpretations | Guaranteed crux density -- each perspective has a pre-articulated position |
| `disagreement_type` | Tells us *what kind* of debate to expect (see below) |
| `linked_nodes` | Pre-computed BDI engagement -- we can immediately check heterogeneity |
| `conflict_ids` | Direct links to conflicts with QBAF scores and dialectic traces from prior debates |
| `debate_refs` | History of prior debates on this situation -- enables gap identification |

A situation node is, structurally, a pre-scored rubric entry. The scoring rubric from Section 6 asks us to compute crux density, BDI heterogeneity, and situation node activation. For a situation-sourced topic, all three are given by construction.

### Disagreement Type as a Debate Strategy Selector

The `disagreement_type` field classifies *why* the perspectives disagree, which directly predicts what kind of debate will generate wisdom:

**Definitional disagreements** -- perspectives disagree on what a term or concept *means*. Example: "What counts as an autonomous AI system?" The accelerationist defines autonomy narrowly (self-modifying goal-pursuit), the safetyist defines it broadly (any system operating without real-time human oversight), the skeptic questions whether "autonomy" is a coherent category for software.

- *Wisdom mechanism:* Forces genus-differentia sharpening. The debate output is refined node descriptions with tighter Encompasses/Excludes boundaries.
- *Best protocol:* Socratic dialogue with a single POV, then cross-examination. Definitional debates produce more wisdom when one perspective articulates its definition fully before others challenge it.
- *Frame template:* "What distinguishes [concept] from [near-neighbor concept], and does that distinction matter for [policy question]?"

**Interpretive disagreements** -- perspectives agree on what something *is* but disagree on what it *means* for policy. Example: all three POVs agree that AI systems can produce outputs their creators did not anticipate, but they interpret this differently (accelerationist: emergent capability; safetyist: loss of control; skeptic: stochastic artifact of scale).

- *Wisdom mechanism:* Surfaces hidden assumptions (`assumes` fields). The debate reveals the inferential bridge between agreed-upon facts and divergent conclusions.
- *Best protocol:* Structured three-way debate. Interpretive disagreements need all perspectives simultaneously because the disagreement is about the *inference* from shared facts, not the facts themselves.
- *Frame template:* "Given that [shared observation], through what mechanisms does this lead to [outcome], and where do those causal pathways diverge?"

**Structural disagreements** -- perspectives disagree about how the system itself should be organized -- who has authority, what institutions are needed, how oversight should work. These are the deepest disagreements because they involve competing values about governance architecture.

- *Wisdom mechanism:* Produces the richest convergence signals. Structural debates force debaters to propose specific mechanisms, creating surface area for partial agreement ("we disagree on who should regulate, but agree that regulation needs technical expertise").
- *Best protocol:* Deliberation mode, aimed at finding structural common ground.
- *Frame template:* "How should responsibility for [function] be distributed among [stakeholders], and what institutional design would each perspective accept?"

### Calculating Position Divergence to Prioritize Topics

Not all situations are equally ripe for wisdom-generating debate. The key question is: **how divergent are the positions, and in what way?**

We can compute a **situation divergence score** from existing data:

1. **Interpretation distance.** Embed each POV’s interpretation text. Compute pairwise cosine distances between the three embeddings. High average distance = the perspectives are saying genuinely different things. Low distance = they largely agree (low wisdom potential from debate).

2. **BDI layer distribution.** For each `linked_node`, classify by BDI category. Compute the entropy of the distribution. High entropy (spread across B, D, and I) = the situation engages all layers. Low entropy (clustered in one layer) = narrow debate.

3. **Conflict saturation.** Check `conflict_ids`. For each linked conflict, read the QBAF resolution. If most linked conflicts are already resolved with high-margin verdicts, the situation may be debated out. If conflicts are open or have low-margin verdicts (prevailing strength near 0.5), the situation is ripe for further debate.

4. **Debate coverage gap.** Check `debate_refs`. Situations with zero or few prior debates are unexplored territory. Situations with many debates but low convergence scores are *stuck* -- they may need reframing rather than another standard debate.

5. **Disagreement-protocol alignment.** Match the `disagreement_type` to the protocol that best serves it. A structural disagreement run through Socratic dialogue wastes its multi-perspective nature; a definitional disagreement run through deliberation may converge prematurely on a vague shared definition.

**Composite formula (proposed):**

```
situation_wisdom_potential =
    0.30 * interpretation_distance       (0-1, from embedding pairwise cosine)
    + 0.20 * bdi_entropy                 (0-1, normalized Shannon entropy)
    + 0.25 * conflict_openness           (0-1, fraction of linked conflicts unresolved or low-margin)
    + 0.15 * debate_gap                  (0-1, inverse of debate coverage, capped)
    + 0.10 * disagreement_protocol_match (0 or 1, whether proposed protocol matches type)
```

Situations scoring above 0.6 are strong candidates for wisdom-generating debates. Below 0.3, they are either too consensual or too exhausted to merit another debate round.

### Conflicts as Debate Topic Refiners

While situations identify *where* perspectives diverge, conflicts identify *what specific claims* are in tension. Each `ConflictFile` contains:

- A `claim_label` and `description` -- the contested proposition
- `linked_taxonomy_nodes` -- which POV nodes are involved
- `instances` -- document-level evidence with stance annotations (supports/disputes/qualifies)
- `qbaf` -- a QBAF argument graph with computed strengths and resolution verdict
- `verdict` -- dialectic trace explaining why a position prevailed (or did not)

This means conflicts carry *pre-computed argument structure*. A debate topic derived from a conflict does not start from scratch -- it starts with an existing argument network that can be deepened, challenged, or extended.

**Three conflict-derived debate strategies:**

1. **Challenge the verdict.** For resolved conflicts with a dialectic trace, the debate topic is: "The prevailing position on [claim] was [X]. Was this resolution correct, and what evidence would overturn it?" This is adversarial stress-testing of prior conclusions.

2. **Resolve the stalemate.** For open conflicts where the QBAF shows near-balanced strengths (margin < 0.1), the debate topic is: "What new evidence, argument, or reframing would break the deadlock on [claim]?" This directly targets the system’s hardest problems.

3. **Deepen the analysis.** For conflicts with few instances (< 3 documents), the debate topic is: "What does [new document] reveal about [claim] that prior analysis missed?" This uses the conflict as a lens for close reading of new source material.

### Operationalizing: A Situation-to-Debate Pipeline

Combining the situation divergence score with conflict analysis produces a concrete pipeline:

1. **Rank all situations** by `situation_wisdom_potential` score.
2. **For the top-N situations**, examine linked conflicts:
   - Open conflicts with low-margin QBAF: prioritize for stalemate-breaking debates
   - Resolved conflicts with thin evidence: prioritize for deepening debates
   - Situations with no linked conflicts: prioritize for exploratory debates that may *generate* new conflicts
3. **Match protocol to disagreement type:** definitional to Socratic, interpretive to structured, structural to deliberation.
4. **Generate the debate frame** using the type-specific templates above, grounding the frame in the situation’s actual interpretation texts.
5. **After the debate**, update the situation’s `debate_refs`, recompute conflict QBAF scores, and re-rank for the next cycle.

This creates a **closed-loop wisdom-harvesting system**: situations identify where to look, conflicts identify what to argue about, debates produce new argument structure, and the results feed back into situation and conflict scoring for the next round.

### What This Adds to the Rubric

The original rubric (Section 6) scores topics on 10 dimensions. Situation-derived topics automatically score well on five of them:

| Dimension | Situation-derived score | Why |
|---|---|---|
| Crux density | 2 (balanced) | Three interpretations guarantee multi-POV engagement |
| BDI heterogeneity | 1-2 | Linked nodes span BDI categories by construction |
| Situation node activation | 2 | The topic *is* a situation node |
| Frame: tension acknowledgment | 2 | The `disagreement_type` names the tension explicitly |
| Frame: conditionality | 1-2 | Type-specific templates produce conditional frames |

This means situation-derived topics start at 7-10 on the 20-point rubric before any frame optimization. With proper frame construction (mechanism focus, stakeholder breadth, scope boundedness), they routinely reach the 14+ wisdom threshold.

The implication: **the taxonomy is not just a knowledge store -- it is a debate topic generator.** Every situation node with divergent interpretations is a candidate for wisdom extraction. The system can proactively surface its own most productive debate topics rather than waiting for a researcher to propose them.

---

## The Deeper Question: What Makes Disagreement Productive?

The framework above is mechanistic -- it identifies structural properties of topics and frames that correlate with good debate outcomes. But there is a deeper question: *why* do these properties matter?

The answer, grounded in the epistemic infrastructure framing, is that wisdom requires **productive disagreement** -- disagreement that is specific enough to be resolvable, grounded enough to be evidence-responsive, and multi-layered enough to reveal the structure of the dispute.

Productive disagreement requires three conditions:

1. **Shared referents** -- debaters must be arguing about the same thing. Situation nodes provide this. Without shared referents, debaters talk past each other (low convergence, low crux engagement).

2. **Asymmetric knowledge** -- each debater must know or value something the others do not. BDI heterogeneity provides this. Without asymmetry, the debate has nothing to discover (high convergence but vacuous -- agreement on what everyone already knew).

3. **Falsifiable stakes** -- the disagreement must be about something that could, in principle, be resolved by evidence or argument. Mechanism frames and empirical grounding provide this. Without falsifiable stakes, the debate is a values shouting match (low convergence, high repetition, no crux crystallization).

When all three conditions hold, the debate becomes a structured search for the boundary between agreement and disagreement -- which is precisely where wisdom lives.

---

*Drafted: 2026-05-21 | Computational Linguist | AI Triad Research*
*Related: [epistemic-infrastructure-framing.md](./epistemic-infrastructure-framing.md), [calibration-methodology.md](../docs/calibration-methodology.md), [consensus-detection-spec.md](../docs/consensus-detection-spec.md)*
