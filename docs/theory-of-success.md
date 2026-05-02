# Theory of Success: AI Triad Debate Tool

## 1. What Success Looks Like

A successful debate produces five measurable outcomes:

1. **Crux discovery.** The debate surfaces the 2-5 empirical questions, value tensions, or definitional disagreements on which the three perspectives actually diverge — not the surface-level talking points each side leads with. These are the points where resolving one factual question would shift a position.

2. **Argument grounding.** Every claim in the final argument network traces back to a taxonomy node (BDI-classified, with provenance) or is flagged as novel/unmapped. No claim floats without a warrant; no taxonomy node is cited without the argument that motivated it.

3. **Position movement.** At least one debater makes a genuine concession, narrows a claim, or introduces a conditional — and the commitment store records it with the evidence that triggered it. A debate where all three agents end exactly where they started is a failure of the system, not a failure to agree.

4. **Coverage.** The debate engages the relevant parts of the taxonomy. Taxonomy gap analysis shows >60% utilization of injected nodes and identifies any important nodes that were never offered to debaters. For document-grounded debates, the coverage tracker shows the source's key claims were addressed.

5. **Explainability.** A human reader can reconstruct *why* the debate reached its conclusions by following the dialectic trace — a deterministic BFS traversal of the argument network — without re-querying any LLM. The neutral evaluator's persona-free assessment diverges from the persona-grounded synthesis in identifiable, documented ways.

A debate that achieves all five is a contribution to the taxonomy. One that achieves only 1-2 is still useful as a diagnostic (it reveals where the system or the taxonomy is weak).

---

## 2. The Success Path: Step by Step

### Phase 0: Configuration and Context Assembly

**What happens:** The user selects a topic (free text, document, URL, or situation node), chooses debaters (Prometheus/Sentinel/Cassandra), sets audience and pacing, and optionally enables adaptive staging.

**How the system does it:**

- `NewDebateDialog` collects configuration: topic source, active POVs, protocol, model, temperature, audience, pacing preset, adaptive staging toggle.
- `useDebateStore.createDebate()` initializes a `DebateSession` with empty transcript, argument network, commitment stores, and convergence tracker.
- The session is persisted to disk as JSON immediately — the source of truth is always the file, not in-memory state.

**Why this matters for success:** The audience setting shapes every prompt downstream. A debate targeting policymakers gets different language, evidence standards, and moderator behavior than one targeting technical researchers. Getting this wrong makes the whole debate speak to the wrong reader.

### Phase 1: Topic Clarification (Optional)

**What happens:** The system generates 3-5 structured clarifying questions with multiple-choice options. The user answers, and the topic is refined into a more precise debate question.

**How the system does it:**

- For topic-based debates: `clarificationPrompt()` generates questions that narrow scope, identify stakeholders, and surface implicit assumptions.
- For document-based: `documentClarificationPrompt()` generates questions grounded in the source material's claims.
- For situation-based: `situationClarificationPrompt()` generates questions drawing on the node's BDI interpretations and linked conflicts.
- `synthesisPrompt()` combines user answers into a refined topic.

**Why this matters for success:** Vague topics produce vague debates. "Is AI dangerous?" generates platitudes. "Should the EU AI Act's high-risk classification be extended to foundation models, given the empirical evidence on dual-use capabilities?" generates cruxes. Clarification is the highest-leverage intervention in the whole pipeline.

### Phase 2: Document Pre-Analysis (Document/URL debates only)

**What happens:** The system extracts information nodes (i-nodes) from the source document, identifies tensions between claims, maps them to taxonomy nodes, and produces a neutral claims summary.

**How the system does it:**

- `documentAnalysisPrompt()` processes the source (capped at 50K chars, with truncation metrics tracked).
- Extracts i-nodes classified as empirical/normative/definitional/assumption/evidence.
- Maps each to POV taxonomy nodes and policy items via embedding similarity.
- Identifies cross-POV tension points.
- User can review and edit extracted claims in the `edit-claims` phase before the debate begins.

**Why this matters for success:** Without pre-analysis, document debates devolve into agents talking past the source. The i-node extraction ensures the debate engages the document's actual argument, not the agents' priors about the topic.

### Phase 3: Opening Statements

**What happens:** Each debater states their initial position, grounded in their assigned POV taxonomy. The order is randomized to prevent position bias.

**How the system does it:**

- `runOpeningStatements()` iterates through a randomized speaker order.
- Each opening goes through the **4-stage turn pipeline**:
  1. **BRIEF** (temp=0.15): Identifies key points, crux candidates, potential impact. Low temperature for analytical precision.
  2. **PLAN** (temp=0.40): Selects argument structure, evidence outline, move types. Medium-low for strategic coherence.
  3. **DRAFT** (temp=0.70): Generates the full natural-language statement with inline claim sketches. Higher temperature for rhetorical creativity.
  4. **CITE** (temp=0.15): Maps claims to taxonomy nodes, annotates moves. Low temperature for referential accuracy.
- Each subsequent opener sees all prior opening statements, ensuring they engage rather than monologue.
- Claims are immediately extracted and classified into the argument network.

**Why this matters for success:** The 4-stage pipeline is the core mechanism for generating high-quality turns. The temperature gradient is deliberate: analytical thinking needs precision (0.15), strategic planning needs some creativity (0.40), argumentation needs rhetorical range (0.70), and citation needs accuracy (0.15). A single-shot prompt at any temperature would sacrifice at least two of these qualities.

**After openings, the system runs a baseline neutral evaluation** — stripping speaker labels and POV context, then evaluating the argument quality with a randomized Speaker A/B/C mapping. This establishes the starting assessment before debate dynamics take effect.

### Phase 4: Cross-Respond Rounds (The Main Debate Loop)

**What happens:** Debaters take turns responding to each other, with a moderator selecting who speaks next and what they should focus on. Claims are extracted, the argument network grows, convergence is tracked, and the moderator intervenes when the debate's health degrades.

**How the system does it — the round-level loop:**

1. **Moderator selection.** The moderator prompt receives:
   - Recent transcript (last 3-5 turns)
   - Unanswered claims ledger (which claims have no responses)
   - Convergence signals (move disposition, engagement depth, recycling rate)
   - Argument network context (nodes, edges, strengths)
   - Gap injection candidates (if mid-debate gap round reached)
   
   The moderator recommends: next speaker, focus point (which claim/crux to address), and optional intervention move.

2. **Intervention validation.** If the moderator recommends an intervention (e.g., CHALLENGE, PIN, PROBE), the deterministic engine validates it:
   - Does the moderator have budget remaining? (Initial budget = `ceil(explorationRounds / 2.5)`; refills with escalating cooldown when exhausted)
   - Has the cooldown period elapsed since last intervention? (Gap increases with each refill epoch)
   - Would this violate the per-debater burden cap? (Prevents over-targeting one agent)
   - Does the prerequisite graph allow this move? (e.g., CLARIFY before CHALLENGE when semantic divergence is high)
   - High-value moves (PIN, PROBE, CHALLENGE, etc.) cost ⅓ budget point; routine moves cost 1.0; COMMIT is free.
   
   If valid, the intervention text is generated and the target is forced as the next responder.

3. **Turn generation.** The selected debater's turn goes through the 4-stage pipeline (BRIEF → PLAN → DRAFT → CITE) with full context:
   - Their POV taxonomy (10-20 most relevant nodes selected via embedding similarity)
   - Established points (opponent claims prioritized: Tier 1 = responses to my claims, Tier 2 = unaddressed attacks, Tier 3 = recent)
   - Commitment history (what they've asserted, conceded, challenged)
   - Concession candidates (QBAF-ranked strong opposing claims not yet addressed)
   - Phase context (if adaptive staging: current phase, transition proximity, rationale)

4. **Turn validation and repair.** The generated turn is validated:
   - **Stage A (deterministic):** JSON schema valid? Claims cite specific evidence? New information present (not just repetition)?
   - **Stage B (LLM judge, optional):** Independent assessment of turn quality.
   - If validation fails: repair hints are injected into the draft prompt and the turn is regenerated (up to 2 retries).

5. **Claim extraction.** The validated turn's claims are extracted into the argument network:
   - **Hybrid extraction:** If the debater provided inline claim sketches (from the DRAFT stage), uses the lighter `classifyClaimsPrompt`; otherwise uses full `extractClaimsPrompt`.
   - Each claim gets: BDI category, base strength, specificity, argumentation scheme (one of 14: EVIDENCE, EXPERT_OPINION, CONSEQUENCES, ANALOGY, etc.), and relationship edges (supports/attacks with attack type: rebut/undercut/undermine).
   - Duplicate filtering: claims with >30% text overlap with existing nodes are rejected.

6. **QBAF propagation.** After new nodes and edges are added, the DF-QuAD gradual semantics algorithm recomputes all `computed_strength` values:
   ```
   strength(v) = base_strength(v) x (1 - attackAggregation) x (1 + supportAggregation)
   ```
   Attack type multipliers: rebut (1.0), undercut (1.1), undermine (1.2). Iterates until convergence (delta < 0.001 or 100 iterations).

7. **Convergence signal computation.** Seven deterministic signals are computed per turn:
   - Move disposition (confrontational vs. collaborative ratio)
   - Engagement depth (fraction of new claims with edges to prior claims)
   - Recycling rate (word overlap with same speaker's prior turns)
   - Strongest opposing argument (QBAF strength of top attack against speaker)
   - Concession opportunity (strong attacks faced vs. concession moves used)
   - Position delta (drift from opening statement — sycophancy detection)
   - Crux rate (IDENTIFY-CRUX usage and follow-through)

8. **Phase transition evaluation (adaptive staging only).** Two composite scores are computed:
   - **Saturation score** (are we repeating ourselves?): weighted sum of recycling pressure, crux maturity, concession plateau, engagement fatigue, pragmatic convergence, scheme stagnation.
   - **Convergence score** (are we reaching agreement?): weighted sum of QBAF agreement density, position stability, irreducible disagreement ratio, synthesis pragmatic signal.
   
   The predicate evaluator decides: stay, transition, force_transition, regress (back to exploration if synthesis started too early, max 2 regressions), or terminate (health collapse).

9. **Mid-round hooks.** Between speakers within a round:
   - **Gap injection** (responsive): An unaligned LLM surfaces 1-2 strong arguments no debater has made. Primary injection at the midpoint round; supplemental injections every 3-4 rounds when unengaged high-relevance taxonomy nodes are detected. All debaters must respond.
   - **Neutral evaluation** (midpoint checkpoint): Persona-free assessment of argument quality.
   - **Probing questions** (if enabled): Identifies unreferenced taxonomy nodes and generates targeted questions.
   - **Context compression** (when transcript exceeds 8 entries): Summarizes older entries, preserves unanswered claims ledger across the compression window.

10. **Network garbage collection (all modes).** When the argument network exceeds 175 nodes:
    - Three-tier pruning: low-strength orphans first, then low-engagement old nodes, then weakest overall.
    - Prunes to 150 nodes; hard cap at 200.

**Why this matters for success:** This is where cruxes are discovered, positions move, and the argument network becomes the debate's intellectual contribution. The moderator prevents the debate from degenerating into parallel monologues (PIN forces engagement with specific unaddressed claims), repetition loops (PROBE and CHALLENGE break stagnation), or lopsided targeting (burden tracking ensures fairness). The 4-stage pipeline ensures each turn has analytical structure (BRIEF), strategic intent (PLAN), rhetorical force (DRAFT), and taxonomy grounding (CITE). The QBAF propagation means argument strength is not a matter of LLM opinion but of graph structure: a claim attacked by a strong, uncontested argument has its strength reduced mechanically.

### Phase 5: Synthesis

**What happens:** The system produces a structured synthesis covering areas of agreement, areas of disagreement (classified as empirical/values/definitional), cruxes, and an argument map.

**How the system does it:**

- `debateSynthesisPrompt()` generates the synthesis from the full transcript with taxonomy context.
- The output is structured: agreements (with speaker alignment), disagreements (tagged by type and BDI layer), cruxes (with status: addressed/partially/unaddressed), and resolution analysis (QBAF-based strength comparisons).
- A **final neutral evaluation** runs: persona-free assessment of the same argument landscape. Divergences between the persona synthesis and neutral reading are flagged.
- Salvage logic handles truncated responses (extracts partial arrays from incomplete JSON).

**Why this matters for success:** The synthesis is the debate's deliverable. A synthesis that only says "they disagree" is worthless. A synthesis that says "the disagreement about foundation model risk reduces to an empirical question about the frequency of capability jumps, where Prometheus cites scaling law continuity (AN-23, strength 0.72) and Sentinel cites the GPT-4 capability surprise (AN-31, strength 0.68), with neither claim refuted" — that is a contribution to knowledge.

### Phase 6: Post-Synthesis Passes

**What happens:** The system runs several diagnostic and feedback passes:

1. **Missing arguments.** Identifies 3-5 strong arguments per side that no debater made. These are taxonomy-grounded positions that were available but unused — evidence of coverage gaps.

2. **Taxonomy refinement.** Each debater reviews the debate outcome and proposes edits to taxonomy nodes: REVISE (update description/label), ADD (new node), QUALIFY (narrow scope), DEPRECATE (mark obsolete). Each proposal has confidence level and evidence links.

3. **Dialectic traces.** Deterministic BFS traversal of the argument network produces per-claim provenance chains: who argued what, what attacked it, what survived. These are the explainability backbone — they allow outcome reconstruction without any LLM.

4. **Cross-cutting node promotion.** Where all three debaters agree, the system proposes new situation nodes with BDI-decomposed interpretations.

5. **Taxonomy gap analysis.** Per-POV coverage metrics: total nodes vs. injected vs. referenced, utilization rate, unreferenced relevant nodes, category breakdown by BDI.

6. **Concession harvesting.** Concessions are weighted by type (full=1.0, conditional=0.5, tactical=0.0) and accumulated across debates. When cumulative weight crosses a threshold (default 3.0), the concession becomes a harvest candidate — a signal that the taxonomy should be updated.

**Why this matters for success:** The debate is not the end product; the taxonomy is. These passes close the loop: debate insights flow back as proposed taxonomy edits, coverage gaps inform future debates, and concession harvesting creates a longitudinal signal across multiple debates.

---

## 3. The Mechanisms That Produce Success

### 3.1 Neural-Symbolic Architecture

The system's core design principle: **LLMs generate; deterministic systems validate and explain.** Every LLM output passes through symbolic validation before entering the debate record. Every outcome is explainable through graph traversal without re-querying an LLM.

| Layer | Neural (LLM) | Symbolic (Deterministic) |
|-------|-------------|--------------------------|
| Turn generation | 4-stage pipeline produces content | JSON schema chains stages; temperature gradient controls quality |
| Validation | Stage B: LLM judge assesses fitness | Stage A: deterministic rules check grounding, novelty, structure |
| Argument network | Claim extraction classifies schemes | QBAF propagation computes strengths from graph topology |
| Convergence | — | 7 per-turn signals, all derived from graph structure |
| Outcome explanation | — | Dialectic traces: BFS traversal produces provenance chains |

This separation matters because it makes the debate **auditable**. A reader can challenge a QBAF strength score by pointing to the edges that produced it, not by asking "why did the LLM think this was strong?"

### 3.2 BDI Decomposition

Every claim is classified into Belief (empirical), Desire (normative), or Intention (strategic). This is not just labeling — it determines validation standards:

- **Beliefs** must cite evidence and are candidates for fact-checking via web search.
- **Desires** must ground in values and acknowledge tradeoffs.
- **Intentions** must specify mechanisms and address failure modes.

Through calibration, the system discovered that LLMs reliably score Desires (r=0.65) and Intentions (r=0.71) but fail to score Beliefs (r=-0.12 to 0.2). Empirical claims require external verification that self-contained reasoning cannot provide. This is a known limitation with a known boundary.

### 3.3 The Moderator as Quality Controller

The moderator is not a neutral party — it is a quality controller with explicit goals:

- **Prevent parallel monologues:** PIN forces engagement with specific unaddressed claims.
- **Break repetition:** PROBE and CHALLENGE inject novelty when recycling rate spikes.
- **Ensure fairness:** Burden tracking prevents any debater from being targeted more than 40% of interventions.
- **Manage pacing:** Budget system (≈1 intervention per 2.5 rounds) prevents over-intervention while preserving high-impact moves.

The moderator's health score (5-component weighted average: engagement, novelty, responsiveness, coverage, balance) provides a continuous quantitative read on debate quality. SLI breaches (health below floor for 2+ consecutive turns) trigger mandatory procedural intervention.

### 3.4 Convergence as a Measurable Signal

Success is not "the agents agreed." Success is "the system tracked convergence on identifiable issues and can show whether positions moved, held, or diverged." The convergence tracker maintains up to 6 active issues (taxonomy-ref-grouped claim clusters) with per-turn scores:

- 40% cross-speaker support ratio
- 35% concession rate
- 25% stance alignment

This means convergence is a structural property of the argument network, not an LLM judgment.

---

## 4. Weaknesses and Potential Improvements

### 4.1 Prompt Dependence

**Weakness:** The entire system's quality depends on prompt engineering. Signal weights in `provisional-weights.json` are hardcoded heuristics, not learned parameters. The 4-stage temperature gradient (0.15/0.40/0.70/0.15) was chosen by intuition, not optimization.

**Improvement:** Establish a calibration corpus — 20-30 human-evaluated debates with ground-truth crux labels — and optimize weights against it. Even a simple grid search over temperature and signal weight combinations would replace intuition with data. The system already produces the diagnostic data needed for this; it just hasn't been used for optimization.

### 4.2 Recycling Detection is Lexical, Not Semantic — RESOLVED

**Original weakness:** Saturation detection relied heavily on word overlap to identify argument recycling. A debater could paraphrase the same argument indefinitely and the recycling signal wouldn't fire.

**Implementation (2026-05-01):** Embedding-based cosine similarity between same-speaker turns now supplements lexical word-overlap. Turns with similarity ≥ 0.85 are flagged as semantically recycled. The signal feeds into `recycling_pressure` for phase transitions and into the "debate is dead" force-transition check. Turn embeddings are cached on the session for incremental computation.

### 4.3 Crux Resolution Detection is Absent — RESOLVED

**Original weakness:** The system tracked crux *identification* and *follow-through* but had no mechanism to detect crux *resolution* — no signal that says "this empirical disagreement was settled by evidence presented in Round 7."

**Implementation (2026-05-01):** Deterministic crux resolution state machine (`cruxResolution.ts`) with transitions: identified → engaged → one_side_conceded → resolved | irreducible. Runs after each turn's claim extraction with no LLM calls — state transitions are driven by QBAF edge polarity and concession events. Integrated into phase transition signals (crux maturity feeds saturation score) and synthesis prompts (precise per-crux status). 366-line test suite covers all state transitions.

### 4.4 Belief Scoring Asymmetry — RESOLVED

**Original weakness:** LLM base-strength assignments for Beliefs had negative to near-zero correlation with human judgments, creating an asymmetry where Desires and Intentions were scored automatically but Beliefs were not.

**Implementation (2026-05-01):** Precise Belief claims (`bdi_category: 'belief'`, `specificity: 'precise'`) are now auto-scored by the fact-check pipeline. Verdict+confidence maps to base_strength: verified/high → 0.85, verified/medium → 0.70, disputed/high → 0.15, disputed/medium → 0.30, unverifiable → 0.50. A new `scoring_method: 'fact_check'` replaces `'default_pending'` after verification completes. General and abstract Beliefs still use LLM-assigned scores (acknowledged limitation).

### 4.5 Context Compression is Truncation, Not Summarization — RESOLVED

**Original weakness:** Context compression used a single LLM call to compress older turns into one paragraph, losing nuances, conditional agreements, and weak signals.

**Implementation (2026-05-01):** Three-tier compression (`tieredCompression.ts`): recent (full text, last 8 entries), medium (structural claims + commitments extracted from the argument network — fully deterministic, no LLM call), distant (LLM summary enriched with structural overlay from the argument network). The medium tier preserves structural fidelity without API cost; the distant tier supplements the LLM summary with deterministic data the LLM might omit. 194-line test suite.

### 4.6 No Learning Across Debates

**Weakness:** Each debate starts from scratch. The system doesn't learn which moderator moves actually improved debate health, which prompt formulations produced better turns, or which taxonomy nodes consistently generate the most productive engagement. Concession harvesting accumulates cross-debate signals, but nothing else does.

**Improvement:** Implement a debate retrospective that runs after each debate and records:
- Which moderator moves preceded health score increases (positive signal for that move type)
- Which taxonomy nodes were cited in the highest-strength claims (positive signal for node quality)
- Which pacing presets produced the highest convergence scores for similar topic types
- Which turn validation repair hints successfully fixed turns (positive signal for that repair pattern)

Store these as a lightweight statistics file and use them to adjust moderator persona priors and signal weights in future debates. This is not full reinforcement learning — it's actuarial adjustment based on outcome data the system already produces.

### 4.7 Moderator Budget Scaling is Static — RESOLVED

**Original weakness:** The moderator's total budget was `ceil(explorationRounds / 2.5)` with a hard cutoff. Once spent, the moderator went permanently silent, even if the debate degraded badly.

**Implementation (2026-04-30):** Budget refill with escalating cooldown. When budget exhausts, the moderator receives a smaller refill (budget / (epoch + 1)) with a longer required gap between interventions (gap = 1 + epoch). High-value moves (PIN, PROBE, CHALLENGE, REDIRECT, CLARIFY, CHECK, META-REFLECT) cost ⅓ budget point; routine moves cost 1.0; COMMIT is free. The moderator is never permanently silenced but intervenes at decreasing frequency. See debate-engine-design.md §7.2 for full details.

### 4.8 Evaluation Neutrality is Approximate

**Weakness:** The neutral evaluator strips speaker labels and POV context, but the LLM may still exhibit style-based bias (e.g., preferring Sentinel's methodical tone over Prometheus's assertive tone). Speaker randomization helps but doesn't fully control for stylistic preferences.

**Improvement:** Run neutral evaluation twice with different randomized speaker mappings and compare. If the evaluations diverge significantly (different claims marked "well_supported" vs. "contested"), flag the evaluation as potentially biased and present both to the user. The cost is one additional API call per checkpoint — marginal relative to the debate's total API usage.

### 4.9 Argument Network Growth Is Unbounded in Fixed Mode — RESOLVED

**Original weakness:** In fixed-round mode (non-adaptive), there was no argument network garbage collection. Long debates could produce 90-180 nodes, degrading both QBAF computation and prompt quality.

**Implementation (2026-05-01):** The topology-aware GC mechanism (`networkGc.ts`) is now wired into both the CLI engine's `runFixedCrossRespond` loop and the Electron store's post-extraction pipeline. Same thresholds as adaptive mode: trigger at 175 nodes, prune to 150, hard cap 200. Cross-POV edges and high-strength nodes are preserved.

### 4.10 Gap Injection is a Single Shot — RESOLVED

**Original weakness:** Gap injection ran once at a fixed round. If the debate changed direction afterward, the injected arguments might no longer represent the most important missing perspectives.

**Implementation (2026-05-01):** Responsive gap injection replaces the single-shot model. A lightweight "missing perspective" check runs every 3-4 rounds, scanning for unengaged taxonomy nodes with high relevance scores (>0.7). When found, focused injections are triggered. Budgeted to 1-2 additional injections per debate to prevent disruption. The original midpoint injection is retained as the primary shot; responsive injections supplement it.

---

## 5. Success Metrics Summary

| Metric | Measurement | Target | Source |
|--------|-------------|--------|--------|
| Crux discovery | Number of cruxes with status "addressed" or "partially addressed" | >= 2 per debate | Neutral evaluator output |
| Argument grounding | % of AN nodes with >= 1 taxonomy ref | >= 70% | Taxonomy gap analysis |
| Position movement | Number of genuine concessions (full or conditional) | >= 1 per debate | Commitment store |
| Coverage utilization | Referenced nodes / injected nodes | >= 60% | Taxonomy gap analysis |
| Convergence trajectory | Average convergence score increase from Round 2 to final | Positive slope | Convergence tracker |
| Debate health | % of rounds with health score above SLI floor | >= 80% | Moderator state |
| Synthesis quality | Neutral evaluator agreement with synthesis claims | >= 70% alignment | Divergence view |
| Taxonomy feedback | Number of actionable taxonomy edits proposed | >= 3 per debate | Reflections output |
| Recycling rate | Average recycling rate across all speakers | <= 0.25 | Convergence signals |
| Novelty maintenance | Engagement depth across rounds | Non-declining trend | Convergence signals |

---

## 6. The Feedback Loop: Debates Improve the Taxonomy

The debate tool is not a standalone product. It exists to stress-test and improve the AI Triad taxonomy. The feedback loop works as follows:

```
Taxonomy → Context injection → Debate → Claim extraction → Argument network
    ^                                                            |
    |                                                            v
    +---- Reflections, concession harvesting, -------- Synthesis, gap analysis,
          cross-cutting node promotion                 missing arguments
```

Each debate produces:
- **Immediate outputs:** Synthesis, argument map, diagnostics
- **Taxonomy candidates:** Revised node descriptions, new nodes, deprecated nodes, cross-cutting proposals
- **Longitudinal signals:** Concession weights that accumulate across debates toward harvest thresholds

A debate that produces no taxonomy feedback is a debate that found the taxonomy adequate for its topic — which is itself useful information (coverage confirmation). A debate that produces 5+ taxonomy edits found significant gaps — which is the higher-value outcome.

The theory of success, ultimately, is that the taxonomy becomes more complete, more precise, and more internally consistent with each debate. The debate tool is the mechanism by which three adversarial perspectives pressure-test every node, edge, and interpretation in the taxonomy — and the system ensures that the pressure test is rigorous, fair, grounded, and explainable.
