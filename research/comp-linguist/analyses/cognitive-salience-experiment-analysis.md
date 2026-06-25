# Cognitive Salience Prompts: Opportunity Analysis & Experiment Design

**Source:** Daily briefing session (2026-06-08) — Gemini conversation on cognitive salience prompts and metaphorical frameworks

## What the Briefing Proposes

The briefing introduces a prompt architecture that replaces flat instructional prompts with **structured cognitive landscapes** built on three pillars:

1. **Counter-Weights** — explicitly naming opposing viewpoints in the Belief block to force the model to compute distance between worldviews before committing to a reasoning path
2. **Salience Beacons** — inline conditional interrupts that monitor a named variable during generation and force a structural pivot when a threshold is crossed
3. **Kinetic Metaphors** — replacing descriptive role-play ("be an expert") with spatial/relational metaphors ("map a topology") that shift output from *what things are* to *how things interact, scale, and fail*

The architecture maps onto BDI:
- **Belief Environment** = context, constraints, counter-weights
- **Desire Engine** = objective function defined through the metaphor
- **Intention Vector** = phased execution plan

The briefing demonstrates this with a "Distributed Systems Ledger" metaphor where claims are uncommitted transactions, reasoning is the consensus mechanism, and output is the immutable committed block.

## Why This Matters for AI Triad Research

The alignment with our existing architecture is striking — and the gaps it could fill are real.

### Direct Overlaps

| Briefing Concept | Our Existing Implementation | Gap |
|---|---|---|
| BDI-structured prompts | Taxonomy uses BDI categories; debate prompts teach the category test | Our prompts *describe* BDI; they don't *enforce* it as a cognitive operating environment |
| Counter-Weights (opposing views) | Three-debater system with cross-POV tension | Counter-weights are structural (separate agents), not embedded in individual prompts |
| Salience Beacons | Exclusion guard, lookahead gate, convergence signals | These are *post-hoc* validators, not inline generation-time interrupts |
| Kinetic Metaphors | Genus-differentia descriptions, AIF edge vocabulary | Our metaphors are classificatory, not generative — they describe the taxonomy, not the reasoning process |
| Transaction Mempool → Validation → Commit | Claim extraction → lookahead gate → AN commit | Similar pipeline shape, but ours wasn't designed with the ledger metaphor's rigor around speculative vs. committed state |

### Three Specific Opportunities

**1. Debate prompt salience enforcement.** Our debate prompts instruct agents to "argue from the perspective of [POV]" with taxonomy context injected as flat lists. The briefing suggests restructuring this as a cognitive landscape where the POV's beliefs are *immutables*, the opposing POVs' beliefs are *byzantine faults*, and the debate goal is *consensus protocol*. This could reduce the drift we see in dialectical engagement (0.62 in the latest debate) by giving agents structural reasons to engage opposing arguments rather than just being told to.

**2. Inline salience beacons for scope drift.** Our exclusion guard runs *after* a draft is generated — it's a post-hoc filter. The briefing's Salience Beacon concept suggests embedding scope-awareness *into* the generation prompt itself: "CRITICAL ATTENTION NODE: Monitor your argument's distance from [excluded topics]. If you find yourself reasoning about [exclusion text], halt and redirect through [core scope]." This is cheaper than regeneration and could reduce the need for the regen pipeline.

**3. Kinetic metaphors for situation injection.** Our situations are injected as descriptive context blocks. The briefing argues descriptive prompts yield static summaries. If situations were framed as *state transitions* or *force vectors* ("this situation creates tension between X and Y that your argument must navigate"), debaters might produce more structurally engaged responses — potentially improving the AN density metric (currently 0.80, below the 1.0 target).

## Risks and Concerns

**Over-engineering prompt complexity.** The template is verbose. Each BDI block, beacon, and metaphor costs tokens. In a system that already injects taxonomy context, situation context, debate history, and AN state, adding another structural layer could push us past effective context utilization. Lost-in-the-Middle effects are already a concern — more structure in the middle of the prompt may worsen this.

**Metaphor lock-in.** The "Distributed Systems Ledger" is compelling for the Is-vs-Ish analysis, but debates on AI governance, safety, and policy may not map naturally to ledger semantics. Forcing every topic through one kinetic metaphor could produce awkward reasoning. We'd need metaphor selection logic — which is its own prompt-engineering problem.

**Measurement difficulty.** "Cognitive salience" is hard to measure. We can measure downstream effects (AN density, dialectical engagement, exclusion violations, process reward) but attributing changes to the prompt architecture vs. topic variance vs. model stochasticity requires careful experimental design.

**Confirmation bias in evaluation.** The briefing is self-validating — it demonstrates the framework by using the framework. We need to test it against our existing prompts on our actual task (multi-POV debate) to see if the theoretical benefits materialize.

## Experiment Design: Test Before Committing

### Experiment 1: Salience Beacon for Scope Drift (Low Cost, High Signal)

> **Design Concern (2026-06-08):** The original design injected node-level exclusion texts as a generation-time topic filter. This is a **category error**. Exclusion texts are node-level disambiguation — "node A excludes topic B" means *this specific node* isn't about B, not that the POV shouldn't discuss B. A POV can have node A (excludes B) and node B (excludes A) as siblings. Injecting A's exclusion text as a salience beacon would suppress a topic that node B explicitly covers. Exclusion embeddings are a *classification* tool (which node owns this claim?), not a *generation* tool (what should the debater avoid?).

**Revised approach:** Instead of exclusion texts, the salience beacon should anchor on the **debate topic scope** — the one thing that genuinely constrains all debaters. The topic scope defines the domain, example ceiling, and boundaries that apply POV-wide.

**Hypothesis:** Adding an inline salience beacon anchored on the debate topic scope reduces off-topic drift and improves process reward without requiring post-hoc regeneration.

**Method:**
1. Select 5 recent debate topics that produced scope drift warnings or low process rewards
2. For each topic, run two debates:
   - **Control:** Current prompt architecture (scope enforcement via post-hoc exclusion guard)
   - **Treatment:** Add a salience beacon block to the draft generation prompt:
     ```
     [SALIENCE BEACON]
     CRITICAL ATTENTION NODE: Monitor your argument's structural fidelity
     to the debate scope.
     - Domain: {topic.scope.domain}
     - Boundary: {topic.scope.example_ceiling}
     - Your argument must resolve through THIS domain's institutions,
       mechanisms, and consequences — not adjacent domains.
     If your reasoning drifts beyond this boundary, halt and redirect
     through a concrete mechanism within the stated domain.
     ```
3. **Measure:** scope_drift_warnings count, process_reward delta, topic_aligned pass rate, qualitative review of argument specificity

**Why this first:** It's the smallest change (one prompt block addition), targets a measurable outcome, and tests the core salience beacon claim (inline scope enforcement > post-hoc correction) without misusing node-level exclusion data.

**What this does NOT test:** Node-level exclusion enforcement. That remains the domain of the post-hoc exclusion guard, which operates at the right abstraction level (claim → node attribution). The salience beacon and exclusion guard are complementary, not substitutes.

**Cost:** ~10 debate runs, no code changes needed beyond prompt text modification in `prompts.ts`.

### Experiment 2: Counter-Weight Injection in Belief Block (Medium Cost, Medium Signal)

**Hypothesis:** Explicitly naming opposing POV beliefs as "counter-weights" in each debater's system prompt improves dialectical engagement ratio.

**Method:**
1. Select 5 debate topics
2. For each topic, run two debates:
   - **Control:** Current system prompt with taxonomy context as flat node list
   - **Treatment:** Restructure the taxonomy injection block:
     ```
     [BELIEF ENVIRONMENT]
     - Core Beliefs (Your POV): {pov_nodes formatted as immutables}
     - Counter-Weights (Active Opposition): {opposing_pov_top3_nodes}
     - Blind Spots: {cross-cutting nodes that challenge your position}
     ```
3. **Measure:** dialectical_engagement_ratio, AN edge density (attacks specifically), process_reward

**Why second:** Requires modifying the taxonomy context formatting in `taxonomyContext.ts`, but no pipeline changes. Tests whether structuring context as a cognitive landscape (not a reference list) changes how agents engage.

**Cost:** ~10 debate runs, moderate code changes to context formatting.

### Experiment 3: Kinetic Metaphor for Situation Injection (Higher Cost, Exploratory)

**Hypothesis:** Framing injected situations as force vectors ("this situation creates structural tension between X and Y") rather than descriptive blocks improves situation_crux_alignment.

**Method:**
1. Select 5 debates with situation injection
2. Reformat situation injection from:
   ```
   Situation: {description}
   Interpretations: {acc}, {saf}, {skp}
   ```
   To:
   ```
   [STATE TRANSITION] {situation_title}
   This situation creates a force vector between {interp_a} and {interp_b}.
   Your argument must navigate this tension — not ignore it, not flatten it.
   ```
3. **Measure:** situation_crux_alignment, whether situations are referenced in debater output, AN edges connecting to situation-related claims

**Why third:** Most speculative. "Force vector" framing is a stylistic change that may or may not affect LLM behavior. Run only if Experiments 1-2 show positive signal.

**Cost:** ~10 debate runs, moderate changes to situation formatting in `taxonomyContext.ts`.

### Success Criteria for Committing

Adopt the approach (or specific elements of it) if:
- **Experiment 1:** Process reward increases by >0.02 (e.g., 0.740 → 0.760+) or scope drift warnings decrease by >30%, with no regression in topic_aligned pass rate
- **Experiment 2:** Dialectical engagement ratio increases by >0.10 (e.g., 0.62 → 0.72+)
- **Experiment 3:** Situation references in debater output increase by >50%

If only Experiment 1 succeeds: adopt topic-scope salience beacons (targeted, low-risk).
If Experiments 1+2 succeed: adopt the full BDI cognitive landscape restructuring.
If all three succeed: consider a full kinetic metaphor migration for prompt architecture.

## Key Design Constraint: Exclusion Embeddings Are Classification, Not Generation

Node-level exclusion texts must NOT be used as generation-time salience beacons. Exclusions are scoped to individual nodes as disambiguation signals ("this node is not about X — X belongs to a sibling node"). A POV can legitimately contain node A (excludes B) and node B (excludes A). Injecting exclusion texts into the generation prompt would suppress topics the POV actively covers through other nodes.

The exclusion guard system (ratio test, absolute test) operates correctly at the claim-attribution level — *after* generation, checking whether a specific claim was attributed to the right node. This is the right abstraction level for exclusion enforcement. Salience beacons should operate at the debate-scope level (domain, boundaries, example ceiling), which genuinely constrains all debaters.

## Recommended Next Step

Run Experiment 1 (topic-scope salience beacon). It requires no code changes — just a prompt text edit in `prompts.ts` for the draft generation template. We can A/B it against the last 5 debates manually using the existing eval script. If results are positive, proceed to Experiment 2.

Do not restructure the entire prompt architecture based on the briefing alone. The ideas are theoretically sound but unvalidated against our specific task and model backends.
