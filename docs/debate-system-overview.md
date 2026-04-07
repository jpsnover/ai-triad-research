# Debate System Overview

**Status:** Current as of 2026-04-07. For review.

## Purpose

The debate system stages structured multi-agent debates between three AI agents representing distinct AI policy perspectives (accelerationist, safetyist, skeptic). Each agent receives ontology-grounded context organized by BDI category. A moderator steers the debate using argument network analysis. A persona-free evaluator provides an independent neutral reading at three checkpoints. Debate findings feed back into the taxonomy through concession harvesting.

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
  └── Post-Debate
        Harvest dialog: promote conflicts, steelman refinements, debate refs
        Divergence view: compare neutral evaluation vs persona synthesis
```

## Context Injection

### What Each Agent Receives

| Component | Max | Source | Purpose |
|-----------|-----|--------|---------|
| POV taxonomy nodes | 35 | `selectRelevantNodes` (cosine similarity, threshold 0.45) | BDI-structured worldview |
| Situation nodes | 15 | `selectRelevantSituationNodes` | Cross-POV contested concepts |
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

Six moves, ordered to counter primacy bias (COUNTEREXAMPLE first, CONCEDE last):

1. **COUNTEREXAMPLE** — specific case challenging a general claim
2. **DISTINGUISH** — accept evidence but show it doesn't apply here
3. **REFRAME** — shift framing to reveal what the current frame hides
4. **REDUCE** — show opponent's logic leads to an absurd conclusion
5. **ESCALATE** — connect specific disagreement to deeper principle
6. **CONCEDE** — acknowledge a valid point

Anti-repetition enforcement: model sees its last N move_types with instruction to vary. Five alternative phrasings provided for concessions to prevent "I concede" uniformity.

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

## Persona-Free Evaluator (NEW)

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

- Model: all-MiniLM-L6-v2
- Threshold: 0.45 (empirically calibrated; original 0.3 admitted 93.3% of pairs)
- Minimum per BDI category: 3 nodes
- POV discrimination: intra-POV mean 0.58 vs cross-POV 0.47 (useful)
- BDI discrimination: 0.54 vs 0.49 (weak — must be enforced at prompt level)

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
  transcript: TranscriptEntry[]
  context_summaries: ContextSummary[]
  argument_network: { nodes, edges }
  commitments: Record<PoverId, CommitmentStore>
  convergence_tracker: ConvergenceTracker
  diagnostics: DebateDiagnostics
  qbaf_timeline: QbafTimelineEntry[]
  claim_coverage: ClaimCoverageEntry[]
  neutral_evaluations: NeutralEvaluation[]        // NEW
  neutral_speaker_mapping: SpeakerMapping          // NEW
}
```

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

## Style Guide

All debate output follows the policy-reporter style: active voice, named actors, one idea per sentence, concrete examples and specific numbers over abstract categories. Every paragraph should contain at least one sentence a reporter could quote directly without rewriting. No nominalizations, no hedge stacking. Technical terms fine when load-bearing; defined on first use.

## Key Files

| Area | File |
|------|------|
| Engine | `lib/debate/debateEngine.ts` |
| Types | `lib/debate/types.ts` |
| Prompts | `lib/debate/prompts.ts` |
| Argument network | `lib/debate/argumentNetwork.ts` |
| Taxonomy context | `lib/debate/taxonomyContext.ts` |
| Taxonomy relevance | `lib/debate/taxonomyRelevance.ts` |
| QBAF engine | `lib/debate/qbaf.ts` |
| AI adapter | `lib/debate/aiAdapter.ts` |
| Neutral evaluator | `lib/debate/neutralEvaluator.ts` |
| Coverage tracker | `lib/debate/coverageTracker.ts` |
| Helpers | `lib/debate/helpers.ts` |
| UI: workspace | `taxonomy-editor/src/renderer/components/DebateWorkspace.tsx` |
| UI: diagnostics | `taxonomy-editor/src/renderer/components/DiagnosticsPanel.tsx` |
| UI: neutral eval | `taxonomy-editor/src/renderer/components/NeutralEvaluationPanel.tsx` |
| UI: convergence | `taxonomy-editor/src/renderer/components/ConvergenceRadar.tsx` |
| UI: harvest | `taxonomy-editor/src/renderer/components/HarvestDialog.tsx` |
| Store | `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` |
