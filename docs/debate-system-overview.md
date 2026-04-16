# Debate System Overview

**Status:** Current as of 2026-04-11. For review.

**Source of truth:** `lib/debate/` (28 TypeScript files). Taxonomy Editor re-exports via `@lib/debate/*`. Entry points: `DebateEngine.run()` (programmatic), `lib/debate/cli.ts` (CLI via `npx tsx`), `Invoke-AITDebate` (PowerShell cmdlet).

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
  │       2. Agent responds with structured output (claim, evidence, warrant, moves)
  │       3. Claim extraction → argument network update → QBAF propagation
  │       4. Commitment store update (asserted/conceded/challenged)
  │       5. Context compression if transcript > 12 entries
  │       6. Stall detection → metaphor reframe if triggered
  │     │
  │     └── NEUTRAL EVALUATOR: Midpoint checkpoint (round 3 or midpoint)
  │
  ├── Phase 4: Synthesis (3-phase) + Final Neutral Evaluation (parallel)
  │     Synthesis:
  │       Phase 1: Extract agreements, disagreements, unresolved questions
  │       Phase 2: Build AIF argument map with scheme classification
  │       Phase 3: Evaluate preferences + policy implications
  │     │
  │     └── NEUTRAL EVALUATOR: Final checkpoint (runs in parallel with synthesis)
  │
  ├── Phase 5: Post-Synthesis Passes (sequential)
  │     1. Missing Arguments — fresh LLM flags strong unsaid arguments
  │     2. Taxonomy Refinement — suggest narrow/broaden/clarify/split/qualify/retire/new_node
  │     3. Dialectic Traces — BFS graph traversal from synthesis preferences (no AI)
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

**Core moves (8)** — always available; debaters select 1–3 per turn via the `move_types` array:

1. **DISTINGUISH** — accept opponent's evidence but show it doesn't apply here
2. **COUNTEREXAMPLE** — specific case challenging a general claim
3. **CONCEDE-AND-PIVOT** — acknowledge a valid point, then redirect to what it misses (genuine concession, no "but" reversal)
4. **REFRAME** — shift framing to reveal what the current frame hides
5. **EMPIRICAL CHALLENGE** — dispute the factual basis with specific counter-evidence
6. **EXTEND** — build on another debater's point to strengthen or expand it
7. **UNDERCUT** — attack the warrant (reasoning link) rather than evidence or conclusion
8. **SPECIFY** — demand operationalization; force falsifiable predictions ("what specific outcome would make you abandon this position?")

**Constructive moves (4)** — injected only in `exploration` and `synthesis` phases:

- **INTEGRATE** — propose a position incorporating valid elements from multiple perspectives
- **CONDITIONAL-AGREE** — accept a position contingent on specified conditions
- **NARROW** — reduce a broad disagreement to its precise crux
- **STEEL-BUILD** — build on an opponent's strongest argument to reach a conclusion they haven't drawn

**Move diversity enforcement:** model sees its last N `move_types` with instruction to vary. Sentence-opening variety enforced via five alternative opening templates.

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

### Dialectic Traces
Synchronous BFS graph traversal — no AI calls. `generateDialecticTraces()` walks the argument network from each synthesis preference backward through the attack/support edges to produce a human-readable trace: "Claim X prevailed because it survived attacks A, B; A was undercut by C; …". Stored as `DialecticTrace[]` on `DebateSession.dialectic_traces`. Gives a deterministic explanation layer over the QBAF numerical scores.

### Missing Arguments Pass
(See "LLM Failure Mode Interventions" §5 below.)

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
| Neutral evaluation | 0.2 | Consistent analytical assessment |
| Summary/compression | 0.3 | Faithful representation |
| Chat: decide mode | 0.3 | Analytical precision |
| Chat: inform mode | 0.4 | Balanced accuracy + readability |
| Debate agents | 0.5 | Deliberative reasoning with variety |
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
  diagnostics: DebateDiagnostics
  qbaf_timeline: QbafTimelineEntry[]
  claim_coverage: ClaimCoverageEntry[]     // document-source coverage map
  neutral_evaluations: NeutralEvaluation[]
  neutral_speaker_mapping: SpeakerMapping
  unanswered_claims_ledger?: UnansweredClaimEntry[]
  position_drift?: DriftSnapshot[]
  missing_arguments?: MissingArgument[]
  taxonomy_suggestions?: TaxonomySuggestion[]
  dialectic_traces?: DialecticTrace[]
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
