# Debate System Overview

**Status:** Current as of 2026-04-24.

**Source of truth:** `lib/debate/` (32 TypeScript files). Taxonomy Editor re-exports via `@lib/debate/*`. Entry points: `DebateEngine.run()` (programmatic), `lib/debate/cli.ts` (CLI via `npx tsx`), `Invoke-AITDebate` (PowerShell cmdlet).

## Purpose

The debate system stages structured multi-agent debates between three AI agents representing distinct AI policy perspectives (accelerationist, safetyist, skeptic). Each agent receives ontology-grounded context organized by BDI category. A moderator steers the debate using argument network analysis. A persona-free evaluator provides an independent neutral reading at three checkpoints. Debate findings feed back into the taxonomy through concession harvesting.

## Computational Dialectics and Argumentation Theory

This system draws on three intersecting fields:

**Computational dialectics** studies how structured disagreement can be modeled, evaluated, and resolved by formal systems. Rather than treating argument as rhetoric aimed at persuasion, computational dialectics treats it as a reasoning process with explicit commitments, burdens of proof, and dialogue rules. Our debate engine implements a commitment-based dialogue game where agents assert, challenge, and concede claims under consistency constraints.

**Computational linguistics** provides the NLP infrastructure: embedding-based relevance scoring (all-MiniLM-L6-v2) for taxonomy node selection, NLI cross-encoders for steelman validation, and LLM-driven claim extraction with argumentation scheme classification. These techniques bridge the gap between the formal argumentation structures and the natural-language debate transcripts.

### Core Frameworks

**BDI (Belief–Desire–Intention)** is an agent architecture from Bratman (1987) and Rao & Georgeff (1995). Beliefs represent the agent's empirical model of the world; Desires represent its normative commitments (what it argues should happen); Intentions represent its reasoning strategies for connecting beliefs to desires. We use BDI to structure both the taxonomy (every node is categorized as B, D, or I) and the debate agents' context injection, ensuring agents argue from a coherent epistemic stance rather than a bag of talking points.

**QBAF (Quantitative Bipolar Argumentation Framework)** extends Dung's abstract argumentation with weighted support and attack relations. We use the DF-QuAD gradual semantics (Rago et al., 2016) to propagate strength scores through the argument network: each claim receives a base score (BDI-aware rubric), and attacks (rebut, undercut, undermine) reduce the effective strength of targeted claims. QBAF provides a principled way to answer "which arguments are actually winning?" at any point in the debate.

**AIF (Argument Interchange Format)** is a W3C-adjacent standard for representing argument structures as directed graphs of information nodes (I-nodes: claims and premises) connected by scheme nodes (S-nodes: inference, conflict, preference). Our synthesis phase produces an AIF-compatible argument map with Walton-derived scheme classification. AIF provides the interoperability layer — debate findings can be exported, visualized, and compared across sessions.

## Neural-Symbolic Design

The debate engine is a hybrid system. Neural components (LLMs) generate natural-language arguments, make soft judgments, and evaluate nuance. Symbolic components — QBAF strength propagation, BFS graph traversal, convergence metrics, deterministic validation rules, and move-edge classification — provide structure, verification, and explanation. Every LLM output passes through deterministic validation before entering the debate record. Every outcome can be explained through graph traversal without invoking an LLM.

This dual architecture delivers both creativity and auditability:

| Layer | Neural (LLM) | Symbolic (Deterministic) |
|-------|-------------|--------------------------|
| Turn generation | BRIEF, PLAN, DRAFT, CITE stages produce content | Structured JSON schema chains stages together |
| Validation | Stage B: LLM judge evaluates novelty and taxonomy fitness | Stage A: 9 symbolic rules check move validity, taxonomy grounding, paragraph count, novelty, claim specificity |
| Argument network | Claim extraction classifies schemes | QBAF propagation computes strengths; move-edge map classifies every move as support/attack/neutral |
| Convergence tracking | None | 7 per-turn signals, all computed from graph structure and text overlap |
| Outcome explanation | None | Dialectic traces: BFS traversal produces narrative chains explaining why positions prevailed |
| Reflections | LLM generates taxonomy edit proposals with confidence levels | Human review required before any edit takes effect |

The key differentiator from other multi-agent debate systems: the neural components are never trusted in isolation. Structure constrains generation, deterministic rules gate acceptance, and graph traversal explains outcomes. An analyst can trace any debate result back through the argument network to the specific claims, attacks, and concessions that produced it — without re-querying an LLM.

## Architecture

```
User clicks "Start Debate"
  │
  ├── Phase 1: Clarification
  │     Moderator poses scoping questions → user answers → refined topic
  │
  ├── Phase 1.5: Document Pre-Analysis (if source document)
  │     Extract i-nodes, tension points, summary from source
  │
  ├── Phase 2: Opening Statements
  │     Each agent receives BDI-structured taxonomy context + ★-tiered relevance
  │     │
  │     └── NEUTRAL EVALUATOR: Baseline checkpoint
  │           Stripped transcript (Speaker A/B/C), no POV labels
  │
  ├── Phase 3: Cross-Respond Rounds (configurable, default 5)
  │     For each round:
  │       1. Moderator selects responder + focus point (argument network analysis)
  │       2. Turn Pipeline: BRIEF → PLAN → DRAFT → CITE (4 sequential AI calls)
  │       3. Turn Validation: Stage A (9 symbolic rules) → Stage B (LLM judge)
  │          └── Repair loop (0–2 retries, hints injected into DRAFT)
  │       4. Claim extraction → argument network update → QBAF propagation
  │       5. Commitment store update (asserted/conceded/challenged)
  │       6. Convergence signals computed (7 deterministic metrics)
  │       7. Context compression if transcript > 12 entries
  │       8. Stall detection → metaphor reframe if triggered
  │     │
  │     └── NEUTRAL EVALUATOR: Midpoint checkpoint (round 3 or midpoint)
  │
  ├── Phase 3.5: Mid-Debate Gap Injection (after midpoint round)
  │     Unaligned LLM (no persona) surfaces 1-2 strong unmade arguments
  │     Gap types: cross_cutting, compromise, blind_spot, unstated_assumption
  │     Moderator directs agents to engage from their own perspectives
  │
  ├── Phase 4: Synthesis (3-phase) + Final Neutral Evaluation (parallel)
  │     Synthesis:
  │       Phase 1: Extract agreements, disagreements, unresolved questions
  │       Phase 1.5: Cross-Cutting Node Promotion (if 3-way agreements exist)
  │               Auto-propose situation nodes from shared understanding
  │       Phase 2: Build AIF argument map with scheme classification
  │       Phase 3: Evaluate preferences + policy implications
  │     │
  │     └── NEUTRAL EVALUATOR: Final checkpoint (runs in parallel with synthesis)
  │
  ├── Phase 5: Post-Synthesis Passes (sequential)
  │     1. Missing Arguments — fresh LLM flags strong unsaid arguments
  │     2. Taxonomy Refinement — suggest narrow/broaden/clarify/split/qualify/retire/new_node
  │     3. Dialectic Traces — BFS graph traversal from synthesis preferences (no AI)
  │     4. Taxonomy Gap Diagnostics — deterministic coverage analysis per POV
  │           Per-POV utilization, BDI balance, unmapped arguments, cross-POV gaps
  │
  ├── Phase 6: Reflections
  │     Each debater reflects using argument network + commitments + convergence signals
  │     Proposes taxonomy edits (revise/add/qualify/deprecate) with confidence levels
  │     Human review required before any edit takes effect
  │
  └── Post-Debate
        Harvest dialog: promote conflicts, steelman refinements, debate refs, verdicts, concepts
        Divergence view: compare neutral evaluation vs persona synthesis
        Export: JSON / Markdown / Text / PDF / ZIP package
```

### Round Phase Mapping

`getDebatePhase(round, totalRounds)` assigns each round to one of three phases, each with its own instruction block injected into debater prompts:

| Phase | When | Instruction Focus |
|-------|------|-------------------|
| `thesis-antithesis` | Rounds 1–2 | Stake out position; challenge opposing premises; no common-ground seeking yet |
| `exploration` | Middle rounds | Probe deeper, force falsifiable predictions, stress-test edge cases |
| `synthesis` | Final 2 rounds | Converge where possible, narrow disagreements, require `position_update` field in output |

## Turn Pipeline

Each debate turn is decomposed into four sequential AI calls. Structured JSON passes between stages, so each stage builds on the previous one's output. The pipeline separates analytical reasoning (low temperature) from creative generation (higher temperature).

| Stage | Temperature | Input | Output | Purpose |
|-------|-------------|-------|--------|---------|
| **BRIEF** | 0.15 | Taxonomy context, transcript, focus point | `BriefWorkProduct` — dialectical situation summary | Summarize what has been argued, what is contested, what is unaddressed |
| **PLAN** | 0.40 | Brief output + context | `PlanWorkProduct` — selected moves, argument outline, strategy | Decide which dialectical moves to use and what claims to make |
| **DRAFT** | 0.70 | Brief + Plan outputs + context | `DraftWorkProduct` — statement text, claim sketches, assumptions | Generate the natural-language argument with structured metadata |
| **CITE** | 0.15 | Brief + Plan + Draft outputs + context | `CiteWorkProduct` — taxonomy refs, policy refs, move annotations | Map claims to taxonomy nodes and classify moves |

The low-temperature bookend stages (BRIEF and CITE) ensure deterministic structure, while the higher-temperature DRAFT stage allows creative argumentation. Stage temperatures are configurable per debate via `TurnStageConfig`. Repair hints from the validation loop (see below) are injected into the DRAFT stage prompt on retry.

Implementation: `lib/debate/turnPipeline.ts`. Prompt templates: `briefStagePrompt`, `planStagePrompt`, `draftStagePrompt`, `citeStagePrompt` in `lib/debate/prompts.ts`.

## Turn Validation

Every turn passes through a two-stage validation gate before entering the debate record.

### Stage A: Deterministic Rules

Nine symbolic rules run without any LLM call. Failures at this stage produce concrete repair hints.

| Rule | Check | Severity |
|------|-------|----------|
| 1. Move presence | `move_types` is non-empty | Error |
| 2. Move validity | All move names exist in the canonical catalog | Warning |
| 3. Disagreement type | Enum is EMPIRICAL, VALUES, or DEFINITIONAL | Error |
| 4. Taxonomy grounding | Every `node_id` in `taxonomy_refs` exists in the loaded taxonomy | Error |
| 5. Policy grounding | Every `policy_ref` exists in the policy registry | Warning |
| 6. Relevance quality | Each `taxonomy_refs[i].relevance` is substantive (40+ chars, no filler openers) | Error |
| 7. Paragraph count | Statement has 3-5 paragraphs (single paragraph is error) | Error/Warning |
| 8. Novelty | At least one new taxonomy ref beyond the last two turns | Warning |
| 9. Claim specificity | After round 3, claims must include numbers, timelines, or named entities | Warning/Error |

### Stage B: LLM Judge

When Stage A passes, an LLM judge (sampled at a configurable rate per phase) evaluates:
- **Advancement** — does this turn do something the previous turns did not?
- **Taxonomy clarification** — does it imply a taxonomy edit (narrow, broaden, split, merge, qualify, retire, new_node)?
- **Weaknesses** — up to 3 concrete fixes the debater could apply on retry

### Repair Loop

If validation fails (Stage A errors or Stage B recommends retry), the turn re-enters the pipeline at the DRAFT stage with repair hints injected into the prompt. Maximum 2 retries. If all retries are exhausted, the turn is accepted with a flag for human review.

Validation score: weighted composite of schema (0.4), grounding (0.3), advancement (0.2), and clarification (0.1) dimensions.

Implementation: `lib/debate/turnValidator.ts`.

## Context Injection

### What Each Agent Receives

| Component | Max | Source | Purpose |
|-----------|-----|--------|---------|
| POV taxonomy nodes | 35 | `selectRelevantNodes` (per-turn cosine similarity, threshold 0.45, recency diversified) | BDI-structured worldview |
| Situation nodes | 15 | `selectRelevantSituationNodes` (per-turn cosine similarity) | Cross-POV contested concepts |
| Steelman vulnerabilities | varies | relevant nodes' `steelman_vulnerability` | Self-aware argumentation |
| Commitment store | full | `formatCommitments()` | Consistency enforcement |
| Argument network context | full | `formatEstablishedPoints()` with Tier 1/2/3 | Respond to existing claims |
| Recent transcript | 8 entries | `formatRecentTranscript()` + compression summary | Debate context |
| Edge tensions | varies | taxonomy edge browser | Structural relationships |

### BDI Grouping

Nodes are organized into three sections:
- **YOUR EMPIRICAL GROUNDING (Beliefs):** factual claims taken as true
- **YOUR NORMATIVE COMMITMENTS (Desires):** what you argue should happen
- **YOUR REASONING APPROACH (Intentions):** how you construct arguments

Top-5 nodes per BDI category marked as primary (★). Minimum 3 per category regardless of score.

### Vocabulary Enforcement

When vocabulary data is available (loaded from `dictionary/standardized/` and `dictionary/colloquial/`), a `=== VOCABULARY CONSTRAINTS ===` block is appended to each agent's taxonomy context. This block contains:

- **Camp-specific terms:** the agent's own standardized vocabulary with display forms and definitions
- **Cross-camp terms:** standardized terms from other camps, labeled by origin
- **Bare term ban list:** colloquial terms marked `do_not_use_bare` that the agent must not use without qualification

The vocabulary context is injected at two points:
1. **Opening statements** — appended to the taxonomy block alongside commitments, established points, and edge context
2. **Cross-respond pipeline** — appended to the taxonomy block that flows through all four pipeline stages (BRIEF → PLAN → DRAFT → CITE)

The CLI headless runner loads vocabulary via `loadVocabulary()` in `taxonomyLoader.ts` and passes it through `DebateConfig.vocabulary`. The Electron UI loads vocabulary via the `loadDictionary` IPC handler at debate start and stores it in the debate store.

See `lib/debate/vocabularyContext.ts` for the formatting function and `docs/taxonomy-vocabulary-system-spec.md` for the full vocabulary system specification.

### Context Injection Instrumentation

After each agent response, a `ContextInjectionManifest` records:
- All injected nodes (POV, BDI category, relevance score, tier)
- Referenced nodes (detected via ID/label matching against response)
- Utilization rate by POV, BDI category, and tier

Displayed in Diagnostics → "Context Usage Analysis". Enables data-driven cap and threshold tuning.

### Situation Interpretations

All 133 situation nodes carry BDI-decomposed interpretations per POV:
```json
{
  "accelerationist": {
    "belief": "One-sentence empirical claim",
    "desire": "One-sentence normative commitment",
    "intention": "One-sentence strategic reasoning",
    "summary": "Headline summary"
  }
}
```

Primary situation nodes show full BDI breakdown in context; supporting nodes show summary only.

## Evidence Evaluation

The evidence rubric is split by claim type (as of 2026-04-07):

### Empirical Claims (Beliefs)
- **Strong:** peer-reviewed studies, large-scale empirical data, replicated findings
- **Moderate:** expert consensus, case studies, institutional reports with methodology
- **Weak:** anecdotes, predictions without methodology, unsourced statistics

### Normative Claims (Desires)
- **Strong:** coherent with stated principles, consistent with analogous cases the advocate accepts, acknowledges tradeoffs
- **Moderate:** grounded in articulated values, cites precedent or institutional practice
- **Weak:** appeals to emotion without principled grounding, ignores tradeoffs, fails the generalization test

### Definitional Claims
- **Strong:** precise inclusion/exclusion criteria, accounts for contested cases
- **Moderate:** cites established usage, explains why the framing matters
- **Weak:** stipulative definitions presented as obvious, definitions that conveniently suit the argument

Agents are instructed to match evidence to claim type. Attacking evidence should target type mismatches (e.g., empirical claim supported only by normative reasoning).

## Dialectical Moves

**Core moves (15)** — always available; debaters select 1–3 per turn via the `move_types` array:

| # | Move | Effect | Use When |
|---|------|--------|----------|
| 1 | **DISTINGUISH** | Accept opponent's evidence but show it doesn't apply here | Evidence is real but context, scope, or conditions differ |
| 2 | **COUNTEREXAMPLE** | Specific case challenging a general claim | Opponent makes a general claim and you can identify a concrete exception |
| 3 | **CONCEDE-AND-PIVOT** | Acknowledge a valid point, then redirect to what it misses | Evidence supports their claim but the broader conclusion doesn't follow |
| 4 | **REFRAME** | Shift framing to reveal what the current frame hides | Opponent's framing excludes important considerations |
| 5 | **EMPIRICAL CHALLENGE** | Dispute the factual basis with specific counter-evidence | Opponent cites data, studies, or precedent you can directly contest |
| 6 | **EXTEND** | Build on another debater's point to strengthen or expand it | An ally or opponent made a point that supports your position if taken further |
| 7 | **UNDERCUT** | Attack the warrant (reasoning link) rather than evidence or conclusion | Evidence is real and conclusion may be right, but the reasoning is flawed |
| 8 | **SPECIFY** | Demand operationalization; force falsifiable predictions | Opponent makes a strong claim but has never stated what would count as evidence against it |
| 9 | **GROUND-CHECK** | Verify shared factual basis before engaging with reasoning | Opponent's conclusion rests on a framing of facts you haven't agreed to |
| 10 | **CONDITIONAL-AGREE** | Accept a claim under specific conditions while rejecting it in general | Opponent's claim holds in some contexts but not others |
| 11 | **IDENTIFY-CRUX** | Name the single question whose answer would resolve the disagreement | Debate is circling without progress |
| 12 | **INTEGRATE** | Combine insights from multiple positions into a novel synthesis | Both sides have valid points that can be reconciled |
| 13 | **STEEL-BUILD** | Strengthen the opponent's argument, then engage with that stronger version | Opponent's argument has a stronger form they haven't articulated |
| 14 | **EXPOSE-ASSUMPTION** | Surface a hidden premise the opponent's argument depends on | Argument only works if an unstated assumption is true |
| 15 | **BURDEN-SHIFT** | Challenge who bears the burden of proof | Opponent asserts a conclusion and demands you disprove it |

**Constructive moves (4)** — injected only in `exploration` and `synthesis` phases: INTEGRATE, CONDITIONAL-AGREE, NARROW, STEEL-BUILD. These steer the debate toward convergence when the phase calls for it.

**Expanded catalog (23 additional moves)** — legitimate dialectical moves LLMs frequently reach for. Accepted by the validator alongside the core 15: OPERATIONALIZE, CITE-AUTHORITY, ANALOGY, PROPOSE-TEST, REDUCTIO, SYNTHESIZE, CLARIFY, APPEAL-TO-EVIDENCE, ACKNOWLEDGE-PROGRESS, PROPOSE-STANDARD, RESOLVE-TENSION, FALSIFY, PRECEDENT, RETRACT, CHALLENGE, PROPOSE, and legacy variants (CONCEDE, REDUCE, ESCALATE, ASSERT). An alias map resolves near-synonyms (e.g., STEELMAN maps to STEEL-BUILD, SURFACE ASSUMPTION maps to EXPOSE-ASSUMPTION).

### Move-Edge Classification (MOVE_EDGE_MAP)

Every move is classified as **support**, **attack**, or **neutral** via a deterministic lookup table. This classification drives automatic edge creation in the argument network — no LLM judgment needed.

| Classification | Moves | Effect on Argument Network |
|----------------|-------|---------------------------|
| **Support** | CONCEDE, CONCEDE-AND-PIVOT, CONDITIONAL-AGREE, INTEGRATE, STEEL-BUILD, EXTEND, ACKNOWLEDGE-PROGRESS | Creates "supports" edges (RA-nodes in AIF) |
| **Attack** | COUNTEREXAMPLE, DISTINGUISH, UNDERCUT, EMPIRICAL CHALLENGE, EXPOSE-ASSUMPTION, BURDEN-SHIFT, REFRAME, REDUCTIO, FALSIFY, CHALLENGE | Creates "attacks" edges (CA-nodes) with typed attack (rebut/undercut/undermine) |
| **Neutral** | IDENTIFY-CRUX, SPECIFY, GROUND-CHECK, ASSERT, CLARIFY, OPERATIONALIZE, PROPOSE-TEST, ANALOGY, PRECEDENT, SYNTHESIZE, others | Produces standalone claims, no directed edge |

Implementation: `MOVE_EDGE_MAP` in `lib/debate/helpers.ts`.

**Move diversity enforcement:** model sees its last N `move_types` with instruction to vary. Sentence-opening variety enforced via five alternative opening templates.

### Counter-Tactics

Each debater is trained to recognize and counter six rhetorical patterns: Burden Shift, Fact Reframing, Premise Stacking, Conclusion as Finding, Point Flooding, and Unverified Authority. When a pattern is detected, the debater names the tactic in their statement before countering — making the rhetorical move visible to the audience.

## Argumentation Scheme Classification

13 Walton-derived schemes, each with 4 critical questions:

| Family | Schemes |
|--------|---------|
| Evidence-Based | ARGUMENT_FROM_EVIDENCE, ARGUMENT_FROM_EXPERT_OPINION, ARGUMENT_FROM_PRECEDENT |
| Reasoning | ARGUMENT_FROM_CONSEQUENCES, ARGUMENT_FROM_ANALOGY, PRACTICAL_REASONING, ARGUMENT_FROM_DEFINITION |
| Value | ARGUMENT_FROM_VALUES, ARGUMENT_FROM_FAIRNESS |
| Meta-Argumentative | ARGUMENT_FROM_IGNORANCE, SLIPPERY_SLOPE, ARGUMENT_FROM_RISK, ARGUMENT_FROM_METAPHOR |

Used at three stages:
1. **Extraction:** claim extraction classifies scheme on each relationship
2. **Moderator steering:** receives most recent scheme + critical questions to direct challenges
3. **Synthesis:** argument map includes scheme + which CQ was addressed per attack

## Metaphor Reframing

When stall detection triggers (round ≥ 4, repeated CONCEDE+DISTINGUISH or agreement detected), the moderator can inject a curated metaphor:

| Metaphor | What it highlights |
|----------|--------------------|
| AI as Infrastructure | Governance parallels with utilities |
| AI as Ecosystem | Emergence, adaptation, unintended consequences |
| AI as Mirror | Encoded biases, invisible assumptions |
| AI as Apprentice | Human responsibility, graduated trust |
| AI as Weapon | Arms race dynamics, proliferation |
| AI as Language | Literacy requirements, cultural impact |
| AI as Territory | Sovereignty, colonization, displacement |
| AI as Experiment | Informed consent, reversibility |

Arguments from metaphors are classified under ARGUMENT_FROM_METAPHOR with 4 critical questions. Metaphor selection is deterministic (round-indexed from unused metaphors).

## QBAF Integration

### DF-QuAD Gradual Semantics
- Base scores assigned per claim (BDI-aware rubric for Desires/Intentions, human-assigned for Beliefs)
- Attack weights: rebut (1.0), undercut (1.1), undermine (1.2)
- Convergence threshold: 0.001
- Computed strengths propagated through argument network

### Hybrid Scoring
- **Desires:** AI rubric (r=0.65 calibration)
- **Intentions:** AI rubric (r=0.71 calibration)
- **Beliefs:** human-assigned (AI scoring failed: r=-0.12 to 0.2 across 4 iterations)

QBAF is enabled by default. Scores displayed in diagnostics and convergence panels.

## Convergence Diagnostics

Seven per-turn signals track how the debate is evolving. All seven are **purely symbolic/deterministic** — no LLM calls. They run after every cross-respond turn and are stored on `ConvergenceSignals[]`.

| # | Signal | What It Measures | How It's Computed |
|---|--------|-----------------|-------------------|
| 1 | **Move Disposition** | Confrontational vs. collaborative ratio | Classifies each move via `MOVE_EDGE_MAP` as attack or support; reports `collaborative / total` |
| 2 | **Engagement Depth** | Fraction of turn's claims that connect to prior claims | Counts argument-network nodes from this turn that have edges to external nodes |
| 3 | **Recycling Rate** | Word overlap with prior same-speaker turns | Computes average and max word overlap (words >3 chars) between current turn and all prior turns by the same speaker |
| 4 | **Strongest Opposing Argument** | QBAF strength of the strongest attack against this speaker | Finds the highest-strength attacker node targeting any of the speaker's claims |
| 5 | **Concession Opportunity** | Strong attacks faced vs. concession moves used | Counts attacks with QBAF strength >= 0.6 targeting the speaker; checks whether a concession move was used. Outcome: `taken`, `missed`, or `none` |
| 6 | **Position Delta** | Word overlap drift from opening statement | Compares current turn's text to the speaker's opening statement; tracks drift over time |
| 7 | **Crux Rate** | IDENTIFY-CRUX usage and follow-through | Tracks whether the speaker used IDENTIFY-CRUX this turn, cumulative crux count, and whether cruxes were followed by collaborative moves |

These signals serve three purposes:
1. **Moderator steering** — the moderator uses concession opportunities and engagement depth to select focus points
2. **Stall detection** — high recycling rates and low engagement depth indicate the debate is cycling
3. **Post-debate analysis** — convergence trajectories show whether the debate produced genuine engagement or parallel monologues

Implementation: `lib/debate/convergenceSignals.ts`.

## Commitment Tracking

Per-debater stores tracking:
- **Asserted:** claims the debater has made
- **Conceded:** claims the debater has conceded to opponents
- **Challenged:** claims the debater has attacked

Injected via `formatCommitments()` with two rules:
1. **REPETITION RULE:** Don't restate prior points; add new evidence
2. **CONSISTENCY RULE:** Don't contradict prior assertions without acknowledging the change

### Concession Classification
- **Full** (weight 1.0): unconditional acceptance
- **Conditional** (weight 0.5): acceptance contingent on a condition
- **Tactical** (weight 0.0): arguendo — not a real concession

Accumulated across debates. Threshold (default 3.0 across 2+ debates) triggers harvest candidate.

## Persona-Free Evaluator

### Design
An independent evaluator reads the debate with persona labels stripped (Speaker A/B/C, randomized assignment). It receives no POV taxonomy, no personality descriptions, no reference to Prometheus/Sentinel/Cassandra.

### Checkpoints
| Checkpoint | When | Purpose |
|------------|------|---------|
| Baseline | After opening statements | Establish neutral reading of initial positions |
| Midpoint | After round 3 or midpoint | Detect if debate is engaging cruxes or drifting |
| Final | Parallel with synthesis | Definitive neutral verdict |

Each checkpoint is independent — no memory of prior checkpoints.

### Output Schema
```typescript
interface NeutralEvaluation {
  checkpoint: 'baseline' | 'midpoint' | 'final';
  cruxes: Crux[];           // Core disagreements with status tracking
  claims: EvaluatedClaim[];  // Per-claim neutral assessment
  overall_assessment: {
    strongest_unaddressed_claim_id: string | null;
    debate_is_engaging_real_disagreement: boolean;
    notes: string;
  };
}
```

Claim assessments: `well_supported`, `plausible_but_underdefended`, `contested_unresolved`, `refuted`, `off_topic`.

### Divergence View
The highest-value output: programmatic comparison of final neutral evaluation vs. persona synthesis. Flags:
- Claims the synthesis marked resolved that the evaluator marked contested
- Cruxes the evaluator flagged that the synthesis omitted
- Status mismatches where synthesis says "agreed" but evaluator says "unaddressed"

### Non-Goals
- Does NOT influence moderator selection or debater prompts
- Does NOT override or veto synthesis
- Output is NOT harvested into taxonomy (revisit after usage data)
- No attempt to reconcile into a single unified verdict

## Debate Protocols

Three declarative protocols in `lib/debate/protocols.ts` control UI affordances and default pacing. The underlying engine is shared — protocols shape available actions and phase labels.

| Protocol | Default Rounds | Debate-Phase Actions | Use Case |
|----------|----------------|----------------------|----------|
| `structured` | 3 | Ask, Cross-Respond, Synthesize, Probe, Harvest | Standard multi-perspective debate |
| `socratic` | 5 | Ask, Probe, Summarize, Harvest | Single-POV interrogation dialogue |
| `deliberation` | 4 | Propose, Respond, Consensus Check, Harvest | Consensus-seeking among participants |

Each phase (`clarification` / `opening` / `debate`) declares its `ProtocolAction[]` — the Debate Workspace renders these as toolbar buttons bound to store handlers.

## Moderator Steering

The moderator selects the next responder and focus point based on:
1. **Argument network analysis:** which claims have been attacked, which are unaddressed
2. **Tier prioritization:**
   - Tier 1: claims responding to the selected speaker's prior claims
   - Tier 2: UNADDRESSED claims targeting the speaker
   - Tier 3: recent claims by recency
3. **Scheme-aware steering:** most recent argument's scheme + critical questions guide the moderator toward specific vulnerabilities
4. **Edge tensions:** structural relationships between taxonomy nodes in the debate

## Synthesis

Three-phase process:
1. **Extract:** agreements, disagreements (with BDI layer + resolvability), unresolved questions
2. **Map:** AIF argument map with claims, typed relationships, argumentation schemes, critical questions addressed
3. **Evaluate:** preference resolution (which argument prevails, by what criterion, with rationale) + policy implications

### Preference Criteria
- `empirical_evidence`, `logical_validity`, `source_authority`, `specificity`, `scope`

### Disagreement Typing
| Type | BDI Layer | Resolution Strategy |
|------|-----------|-------------------|
| EMPIRICAL | Belief | Evidence gathering |
| VALUES | Desire | Tradeoff analysis |
| DEFINITIONAL | Concept | Term disambiguation |

## Post-Synthesis Passes

### Taxonomy Refinement Suggestions
`taxonomyRefinementPrompt` runs after synthesis over nodes referenced during the debate. Outputs `TaxonomySuggestion[]` with action types: `narrow`, `broaden`, `clarify`, `split`, `qualify`, `retire`, `new_node`. Each carries a rationale linking to specific debate turns. Stored on `DebateSession.taxonomy_suggestions` and surfaced in the harvest dialog.

### Dialectic Traces (Deterministic BFS)

Pure symbolic — zero AI calls. `generateDialecticTraces()` performs a BFS traversal of the argument network starting from each synthesis preference. For each verdict ("Position X prevailed over Position Y"), the algorithm:

1. Finds AN nodes referenced by the preference (via `claim_ids` or text-overlap matching)
2. Expands one hop via edges to include connected claims
3. BFS-walks from seed nodes through attack/support edges to build the argument chain
4. Sorts by turn order to produce a narrative sequence
5. Caps at 12 steps (first 4, last 4, and 4 most dramatic middle steps)

Each step records: claim ID, speaker, claim text, action (asserted/attacked/supported/conceded/unaddressed), argumentation scheme, attack type, QBAF strength, and turn number. The result is a human-readable trace: "Claim X prevailed because it survived attacks A, B; A was undercut by C; ..."

Dialectic traces provide the deterministic explanation layer over the QBAF numerical scores. An analyst can read the trace to understand *why* a position won — which attacks landed, which were deflected, which claims went unaddressed — without trusting an LLM's summary.

Stored as `DialecticTrace[]` on `DebateSession.dialectic_traces`. Implementation: `lib/debate/dialecticTrace.ts`.

### Missing Arguments Pass
(See "LLM Failure Mode Interventions" §5 below.)

## Reflections

After the debate concludes, each debater agent reflects on the debate using the full argument network, their commitment store, and convergence signals. The reflection prompt asks five questions:

1. **Arguments you could not adequately defend** — which taxonomy nodes had the lowest QBAF strength or were successfully attacked?
2. **Concessions you made** — does the taxonomy reflect what you conceded?
3. **Positions argued without taxonomy backing** — strong arguments made during the debate that have no corresponding BDI node
4. **Convergence patterns** — where is the speaker converging with opponents?
5. **Gaps between taxonomy and actual argumentation** — nodes never referenced because they were too vague, too broad, or wrong

Based on this reflection, each debater proposes specific taxonomy edits:

| Edit Type | Meaning |
|-----------|---------|
| **REVISE** | Update an existing node's label or description to match what the debate revealed |
| **ADD** | Create a new node for a position that emerged during debate |
| **QUALIFY** | Add caveats or nuance to an existing node based on valid counterarguments |
| **DEPRECATE** | Mark a node as weak/unsupported if the debate effectively refuted it |

Each proposed edit includes:
- The specific node being modified (or null for ADD)
- Current and proposed label/description
- A rationale citing specific debate turns as evidence
- A confidence level (high/medium/low)
- The evidence entries that support the change

All proposed edits require human review before taking effect. Descriptions must match the taxonomy's genus-differentia format with Encompasses/Excludes clauses. The edit limit is 3-5 per debater — quality over quantity.

Implementation: `reflectionPrompt` in `lib/debate/prompts.ts`.

## Argument Space Coverage

The debate system's three agents each argue from a fixed taxonomy — the taxonomy *is* the identity. This creates a real constraint: the argument space is bounded by the combined content of the three taxonomies. Arguments that cut across perspectives, compromise positions, or gaps in any taxonomy's coverage will not surface through the agents alone.

The system already contains partial mitigations: the Missing Arguments Pass identifies strong unmade arguments post-debate, Reflections give each agent a meta-cognitive pass over taxonomy gaps, and the 133 situation nodes capture shared concepts with per-POV interpretations. Three new features close the remaining gaps.

### Mid-Debate Gap Injection ("Fourth Voice")

**Problem:** The Missing Arguments Pass runs after the debate is over. By then, the transcript is final — unmade arguments cannot influence the exchange.

**Mechanism:** After the round just past midpoint (configurable; default: `ceil(totalRounds/2) + 1`), an unaligned LLM — no persona, no taxonomy, no POV assignment — analyzes the transcript so far and identifies 1-2 strong arguments that none of the debaters have made.

Each gap argument is classified:

| Gap Type | Description | Example |
|----------|-------------|---------|
| `cross_cutting` | Cuts across POV boundaries | "Both scaling and regulation assume centralized AI — what about distributed models?" |
| `compromise` | Partially satisfies multiple POVs | "Staged deployment with reversibility gates" |
| `blind_spot` | Within a POV's territory but missing from its taxonomy | "Safetyist taxonomy has no node for post-deployment monitoring" |
| `unstated_assumption` | Shared premise no debater has examined | "All three assume Western governance frameworks" |

The gap arguments enter the transcript as system entries. The moderator is steered to direct an existing agent to engage — the agent does not adopt the argument, it responds from its own perspective. Each response is classified as `compatible`, `opposed`, `partial`, or `reframed`.

**Cost:** 1 additional LLM call per debate at temperature 0.5 (~30 seconds). Set `gapInjectionRound: 0` to disable.

**Implementation:** `midDebateGapPrompt()` in `lib/debate/prompts.ts`. Types: `GapInjection`, `GapArgument`, `GapResponse` in `lib/debate/types.ts`. Engine integration in the round loop of `lib/debate/debateEngine.ts`.

### Cross-Cutting Node Promotion

**Problem:** The 133 situation nodes are manually curated and do not grow from debate findings. When all three POVs agree on something during a debate, that agreement is recorded in the synthesis but does not feed back into the taxonomy's shared concepts.

**Mechanism:** After synthesis phase 1 (which produces `areas_of_agreement`), the system filters for agreement points where all three POVs concur. For each three-way agreement, an LLM determines whether it maps to an existing situation node or warrants a new one. New proposals include BDI-decomposed interpretations per POV — even agreements have nuanced per-POV reasons.

| Field | Content |
|-------|---------|
| `proposed_label` | Short label for the situation node |
| `proposed_description` | Genus-differentia format description |
| `interpretations` | Per-POV BDI breakdown (belief, desire, intention, summary) |
| `linked_nodes` | POV node IDs from the debate that supported the agreement |
| `maps_to_existing` | Existing situation node label, if applicable (null = new) |

Proposals appear in the harvest dialog with three actions: **Create Situation Node**, **Map to Existing**, or **Dismiss**. All require human review.

**Cost:** 1 additional LLM call per debate at temperature 0.3. Only fires when three-way agreements exist.

**Implementation:** `crossCuttingNodePrompt()` in `lib/debate/prompts.ts`. Type: `CrossCuttingProposal` in `lib/debate/types.ts`. Engine integration after synthesis phase 1 in `lib/debate/debateEngine.ts`.

### Taxonomy Gap Diagnostics

**Problem:** Context injection instrumentation tracks per-turn node utilization, but does not aggregate into a structural coverage analysis. After a debate, there is no systematic answer to "where are the holes in each POV's taxonomy?"

**Mechanism:** After all post-synthesis passes complete, a deterministic analysis computes comprehensive taxonomy coverage per debate.

**Phase 1 — Per-POV Coverage (deterministic):**

| Metric | Source | Purpose |
|--------|--------|---------|
| Total nodes | Taxonomy | Baseline |
| Injected nodes | Context injection manifests | How many nodes were relevant |
| Referenced nodes | Response text matching | How many the agent actually used |
| Utilization rate | Referenced / Injected | Efficiency measure |
| Unreferenced relevant | Primary (starred) but never cited | The taxonomy thinks these matter, the agent disagrees |
| Category breakdown | Per BDI category | Reveals B/D/I imbalance |

**Phase 2 — BDI Balance and Unmapped Arguments (deterministic):**

For each POV, counts taxonomy nodes, debate citations, and argument network nodes per BDI category. Identifies the weakest category. Separately, argument network nodes with no taxonomy match (embedding similarity < 0.4) are flagged as unmapped arguments:

| Unmapped Type | Meaning |
|---------------|---------|
| `novel_argument` | Genuinely new position with no taxonomy counterpart |
| `cross_cutting` | Spans POV boundaries |
| `refinement_needed` | Close to an existing node but more specific |

**Phase 3 — Cross-POV Gaps (optional LLM):**

Sends synthesis disagreements + BDI balance data to an LLM to identify structural gaps preventing deeper cross-POV engagement. This is the only neural component — it can be skipped for purely deterministic analysis.

**Output:** Summary banner (overall coverage %, most underserved POV, most underserved BDI, unmapped argument count, cross-POV gap count, top recommendation) plus detailed per-POV breakdowns.

**Implementation:** `computeTaxonomyGapAnalysis()` in `lib/debate/taxonomyGapAnalysis.ts`. Types: `TaxonomyGapAnalysis`, `PovCoverage`, `BdiBalance`, `CrossPovGap`, `UnmappedArgument`, `GapSummary` in `lib/debate/taxonomyGapAnalysis.ts`. Diagnostics UI: `TaxonomyGapPanel` component in the Gaps tab of the diagnostics window.

## Audience Targeting

Debates can be tailored to five target audiences. The audience selection shapes three aspects of every prompt:

| Audience | Reading Level | Argument Structure | Moderator Bias |
|----------|--------------|-------------------|----------------|
| **Policymakers** (default) | Policy reporter — active voice, named actors, quotable sentences | CRAC: Conclusion, Rule/Standard, Application, Conclusion restatement | Implementation feasibility, enforcement mechanisms |
| **Technical Researchers** | Senior ML researcher — precise vocabulary, quantified claims | Evidence, benchmark/formal result, methodology sufficiency, strongest objection | Empirical disputes, methodology, reproducibility |
| **Industry Leaders** | Technology executive — business-relevant conclusions, operational risks | Business conclusion, market dynamic/precedent, risk quantification, concrete action | Cost-benefit, competitive dynamics, liability |
| **Academic Community** | Faculty seminar — theoretical grounding, intellectual honesty | Thesis, theoretical tradition, framework application with scope conditions, limitations | Conceptual precision, theoretical assumptions |
| **General Public** | Quality newspaper reader — no jargon, relatable examples | Why it matters, plain-language claim with example, uncertainty, what to watch for | Personal impact (jobs, privacy, safety), fairness |

The audience directive is injected into every debater prompt, moderator prompt, and synthesis prompt. It shapes the `statement` field only — structured metadata fields (`taxonomy_refs`, `move_types`) are not audience-facing.

Implementation: `AUDIENCE_DIRECTIVES` in `lib/debate/prompts.ts`. Type: `DebateAudience` in `lib/debate/types.ts`.

## Coverage Tracking

For document-sourced debates, `coverageTracker.ts` tracks which source-document claims were engaged during the debate:

- **`computeCoverage`** — embedding-based cosine match between pre-extracted document i-nodes and transcript entries.
- **`computeCoverageByTextOverlap`** — Jaccard-similarity fallback when embeddings are unavailable.
- **`computeCoverageMap`** — tri-state classification per claim: `covered` (Jaccard > 0.5), `partially_covered` (> 0.3), `uncovered`.

Coverage percentage: `(covered + 0.5 × partially) / total × 100`. Uncovered claims feed into the `probingQuestionsPrompt` as steering targets; click-to-steer in the UI lets users force the moderator to address a specific uncovered claim.

## Entry Summarization

After each debater turn, `entrySummarizationPrompt` produces a two-tier summary of the entry text:

- **Brief** (2–3 sentences) — used in context compression and the unanswered-claims ledger
- **Medium** (1–2 paragraphs) — used in the transcript UI collapsed view and Markdown export

Tiers are stored on `TranscriptEntry.summary_brief` and `summary_medium`. Resilient: failure of summarization never aborts the debate; the entry proceeds with `undefined` summary fields.

## Export Formats

`lib/debate/debateExport.ts` provides five output formats:

| Format | Content |
|--------|---------|
| `json` | Full `DebateSession` JSON (transcript, argument network, commitments, diagnostics) |
| `markdown` | Rendered Markdown with headers, taxonomy refs inline, synthesis sections |
| `text` | Plain text with `===` separators |
| `pdf` | HTML → PDF via platform callback (Electron `generatePdf`); falls back to HTML if unavailable |
| `package` | ZIP bundle via jszip: JSON + Markdown + PDF (or HTML fallback) + `-diagnostics.json` |

Platform-specific PDF generation is provided via a `generatePdf` callback injected into `debateToPackage(session, options)` — the library itself has no native PDF dependency.

## Temperature Calibration

| Task | Temperature | Rationale |
|------|-------------|-----------|
| Claim extraction | 0.1-0.2 | Precision, minimal hallucination |
| Turn pipeline: BRIEF | 0.15 | Analytical summary of dialectical situation |
| Turn pipeline: CITE | 0.15 | Precise taxonomy mapping |
| Neutral evaluation | 0.2 | Consistent analytical assessment |
| Summary/compression | 0.3 | Faithful representation |
| Chat: decide mode | 0.3 | Analytical precision |
| Turn pipeline: PLAN | 0.4 | Strategic move selection with some variety |
| Chat: inform mode | 0.4 | Balanced accuracy + readability |
| Debate agents (legacy) | 0.5 | Deliberative reasoning with variety |
| Turn pipeline: DRAFT | 0.7 | Creative argumentation |
| Chat: brainstorm | 0.7 | Creative exploration |

## Embedding Relevance

- Model: all-MiniLM-L6-v2 (384-dim)
- Threshold: 0.45 (empirically calibrated; original 0.3 admitted 93.3% of pairs)
- Minimum per BDI category: 3 nodes
- POV discrimination: intra-POV mean 0.58 vs cross-POV 0.47 (useful)
- BDI discrimination: 0.54 vs 0.49 (weak — must be enforced at prompt level)

### Per-Turn Query Construction

Relevance is recomputed **every turn**, not once per debate. `getRelevantTaxonomyContext(round, speaker, priorRefs)` in `debateEngine.ts`:

1. Builds a query string via `buildRelevanceQuery(topic, recentTranscript)` — topic + last few transcript entries, capped at 500 chars, so the retrieval tracks the actual direction the debate has taken.
2. Embeds the query via `adapter.computeQueryEmbedding(query)` (Extended adapter capability). Scores every node with `cosineSimilarity(queryVec, node.vector)` in `scoreNodeRelevance()`.
3. **Lexical fallback:** when no embedding adapter is available (e.g. CLI runs without an embedding backend), `scoreNodesLexical()` scores nodes by tokenized query ↔ label+description overlap normalized by the geometric mean of token-set sizes. This degrades gracefully instead of silently returning a static list.
4. **Recency diversification:** `priorRefs` (the IDs the current speaker cited across their last two turns) are multiplied by `0.55` in the score map before selection. Recently-cited nodes stay eligible but must outscore alternatives by ~45% to be reselected — breaking citation lock-in without banning continuity.
5. Top-K selected per BDI category (min 3, cap 35 POV + 15 situation).

### Edge Selection (Cross-POV Tensions)

Alongside node retrieval, each turn injects a curated slice of the taxonomy edge graph via `formatDebaterEdgeContext` (`debateEngine.ts`). Edges are filtered by:

1. **Type.** Debaters see `CONTRADICTS`, `TENSION_WITH`, `WEAKENS`; the moderator additionally sees `RESPONDS_TO`. Support edges are excluded — the debate context is structured around productive conflict, not agreement.
2. **Quality gate.** `status === 'approved'` OR `confidence ≥ 0.75`. Low-confidence unreviewed edges are suppressed to avoid steering debaters toward weak tensions.
3. **Directionality.** Only edges where one endpoint belongs to the speaker's POV prefix (`acc-` / `saf-` / `skp-`) and the other to a different POV. Same-POV edges are intra-camp refinements and don't belong in cross-POV exchanges.
4. **Top 15 by confidence, descending.** Hard cap to bound context cost.

### Commitment & Argument-Network Layering

Beyond nodes and edges, three additional per-turn layers are injected:

- **Commitments** — each debater's asserted / conceded / challenged claims, so agents can't silently abandon prior positions.
- **Established points** — recent opponent claims, surfaced so the speaker doesn't echo them as if new.
- **QBAF strongest unaddressed** — top 5 claims by QBAF strength that no one has attacked yet, injected into the moderator's cross-respond selection to prioritize productive engagements.

### Historical Note: Pre-2026-04 Retrieval Bug

Before this rewrite, `getRelevantTaxonomyContext` built the query string per turn but then scored nodes against `matchingVectors[0]` — the first vector in `Object.entries` iteration order — and discarded the query text. Selection was deterministic across the entire debate, which caused the novelty validator (turn rule 7: "No new taxonomy_refs beyond your last two turns") to trigger repeatedly. The intent was per-turn retrieval; the implementation was a static list in disguise. Fix: real query embedding via `adapter.computeQueryEmbedding` + diversification penalty + lexical fallback for unembedded paths.

## History Compression

- Trigger: transcript ≥ 12 non-system entries
- Keep recent: 8 entries
- Minimum compressible: 4 entries
- Compression preserves: key arguments, speaker attribution, concessions, steelmans, dialectical moves, taxonomy refs, claim sketches
- Latest summary prepended to context as `[Earlier debate summary]`

## Data Persistence

Debates stored in `ai-triad-data/debates/debate-<id>.json`:
```
DebateSession {
  transcript: TranscriptEntry[]            // each with optional summary_brief / summary_medium
  context_summaries: ContextSummary[]
  argument_network: { nodes, edges }
  commitments: Record<PoverId, CommitmentStore>
  convergence_tracker: ConvergenceTracker
  convergence_signals: ConvergenceSignals[]  // 7 per-turn diagnostic signals
  diagnostics: DebateDiagnostics
  qbaf_timeline: QbafTimelineEntry[]
  claim_coverage: ClaimCoverageEntry[]     // document-source coverage map
  neutral_evaluations: NeutralEvaluation[]
  neutral_speaker_mapping: SpeakerMapping
  audience?: DebateAudience                // target audience for tone/language
  unanswered_claims_ledger?: UnansweredClaimEntry[]
  position_drift?: DriftSnapshot[]
  missing_arguments?: MissingArgument[]
  taxonomy_suggestions?: TaxonomySuggestion[]
  dialectic_traces?: DialecticTrace[]
  reflections?: ReflectionResult[]         // per-debater taxonomy edit proposals
  gap_injections?: GapInjection[]          // mid-debate gap arguments + agent responses
  cross_cutting_proposals?: CrossCuttingProposal[]  // proposed situation nodes from 3-way agreements
  taxonomy_gap_analysis?: TaxonomyGapAnalysis       // per-POV coverage, BDI balance, unmapped args
}
```

All post-intervention fields are optional for backward compatibility with pre-intervention debates.

## LLM Failure Mode Interventions

Five interventions address LLM-specific debate failure modes. All are non-blocking — failure in any intervention never aborts the debate. All new fields on `DebateSession` are optional for backward compatibility with pre-intervention debates.

### 1. Unanswered Claims Ledger

**Problem:** The 8-entry compression window is tactical — claims from early rounds disappear. The moderator can only prioritize what it can see.

**Solution:** `UnansweredClaimEntry[]` on `DebateSession` tracks all claims with `base_strength > 0.4`. After each claim extraction, `updateUnansweredLedger()` marks claims as addressed when edges target them. Every 3 rounds, `formatUnansweredClaimsHint()` surfaces the oldest unanswered claim in the moderator's context.

**Key functions:** `updateUnansweredLedger()`, `formatUnansweredClaimsHint()` in `argumentNetwork.ts`.

### 2. Inline Empirical Claim Verification

**Problem:** LLMs hallucinate evidence. Empirical claims go unchallenged when opponents lack relevant knowledge.

**Solution:** After claim extraction, Belief claims with `specificity: 'precise'` are auto-fact-checked via `generateTextWithSearch` (Gemini's `google_search` tool). Cap: 2 claims per turn. Results stored on `ArgumentNetworkNode` as `verification_status` ('verified'|'disputed'|'unverifiable'|'pending') and `verification_evidence`. Disputed claims inject a `[Fact-check]` system entry before the next turn.

**New AN node fields:** `specificity`, `verification_status`, `verification_evidence`.

**Graceful degradation:** CLI adapter lacks search — verification silently skips. UI path uses `api.generateTextWithSearch`.

### 3. Steelman Validation

**Problem:** LLMs fabricate opponent positions when steelmanning — presenting a plausible-sounding but inaccurate version of what the opponent actually said.

**Solution:** Claim extraction now outputs `steelman_of` (opponent name or null). When detected, NLI cross-encoder compares the steelman against the opponent's `commitments.asserted` (up to 10 most recent). If max entailment < 0.6, a `[Steelman check]` system entry surfaces the opponent's actual top-3 assertions.

**New AN node field:** `steelman_of`.

**Graceful degradation:** CLI adapter lacks NLI — validation silently skips. UI path uses `api.nliClassify`.

### 4. Position Drift Detection (Sycophancy Guard)

**Problem:** LLMs accommodate opponents without explicitly conceding — positions gradually converge through tone shifts rather than argued agreement.

**Solution:** After opening statements, each speaker's opening embedding is cached. After each cross-respond, the current response embedding is compared against the speaker's own opening (`self_similarity`) and each opponent's opening (`opponent_similarities`). Snapshots stored as `DriftSnapshot[]` on `DebateSession.position_drift`.

**Sycophancy trigger:** If `self_similarity` decreases monotonically for 3+ turns AND any `opponent_similarity` increases monotonically for 3+ turns AND no explicit concessions → system entry: `[Sycophancy guard]` with self-similarity trend.

**New type:** `DriftSnapshot { round, speaker, self_similarity, opponent_similarities }`.

**Graceful degradation:** CLI adapter lacks embeddings — drift tracking silently skips. UI path uses `api.computeQueryEmbedding`.

### 5. Missing Arguments Pass

**Problem:** No record of what was not said. A debate can converge on a subset of arguments while ignoring stronger ones.

**Solution:** Post-synthesis, a fresh LLM (no transcript context) receives only: topic, taxonomy node labels + BDI categories, and synthesis text. Identifies 3-5 strongest arguments on any side never raised. Stored as `MissingArgument[]` on `DebateSession.missing_arguments`.

**Prompt:** `missingArgumentsPrompt()` in `prompts.ts`. Temperature: 0.5. Taxonomy summary capped at 80 nodes.

**New type:** `MissingArgument { argument, side, why_strong, bdi_layer }`.

## Entry Points

- **Programmatic:** `new DebateEngine(adapter).run(config)` — the single orchestration entry (`lib/debate/debateEngine.ts:127`).
- **CLI:** `npx tsx lib/debate/cli.ts --config <file>` or `--stdin`. Emits JSON result with output file paths; exit code 1 on failure.
- **PowerShell:** `Invoke-AITDebate` cmdlet in the `AITriad` module. Parameter sets: `Topic` / `Document` / `Url` / `CrossCutting` (cross-cutting = situation node). Shells out to the CLI with a 10-minute timeout and parses the JSON result.
- **Electron UI:** `DebateWorkspace` component drives the debate via the Zustand store. The "Explain" button (per transcript entry) copies a contextualized prompt to the clipboard and opens `https://gemini.google.com/app` — a manual handoff, not an API call.
- **Repair:** `Repair-DebateOutput.ps1` → `lib/debate/repairTranscript.ts` for post-hoc transcript repair on failed/partial runs.

## Style Guide

All debate output follows the policy-reporter style: active voice, named actors, one idea per sentence, concrete examples and specific numbers over abstract categories. Every paragraph should contain at least one sentence a reporter could quote directly without rewriting. No nominalizations, no hedge stacking. Technical terms fine when load-bearing; defined on first use.
