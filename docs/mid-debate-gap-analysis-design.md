# Mid-Debate Gap Analysis, Cross-Cutting Node Promotion, and Taxonomy Gap Diagnostics

**Status:** Design document, 2026-04-27
**Motivation:** Address the "fixed roles narrow the argument space" critique by building three features that work with the identity-is-taxonomy design rather than against it.

## Problem Statement

The debate system's three agents (Prometheus, Sentinel, Cassandra) each argue from a fixed taxonomy — the taxonomy *is* the identity. This creates a real constraint: the argument space is bounded by the combined content of the three taxonomies. Arguments that cut across perspectives, compromise positions, or gaps in any taxonomy's coverage will never surface through the agents alone.

Existing mitigations:
- **Missing Arguments Pass** — post-debate, an unaligned LLM identifies 3-5 strong unmade arguments. But this runs *after* the debate is over.
- **Reflections** — each agent critiques its own taxonomy gaps, but only post-debate.
- **Situation nodes** — 133 shared concepts with per-POV interpretations, but these are manually curated and don't grow from debate findings.

This design introduces three features that close the remaining gaps.

## Feature 1: Mid-Debate Gap Injection ("Fourth Voice")

### Concept

After round 3 (configurable, default = round just past midpoint), run a lightweight missing-arguments check against the transcript *so far*. Surface 1-2 strong arguments as system entries. The moderator can then direct an existing agent to respond — the agent doesn't adopt the argument, it engages with it from its own perspective.

### Implementation

#### New prompt: `midDebateGapPrompt()`

**File:** `lib/debate/prompts.ts`

```typescript
export function midDebateGapPrompt(
  topic: string,
  transcriptSoFar: string,
  taxonomySummary: string,
  argumentsSoFar: string[],
): string
```

**Inputs:**
- `topic` — the refined debate topic
- `transcriptSoFar` — `formatRecentTranscript(transcript, 20)` (broader window than compression)
- `taxonomySummary` — compact node labels + BDI categories (same format as missing arguments pass)
- `argumentsSoFar` — list of AN node texts extracted so far

**Output schema:**
```typescript
interface GapArgument {
  argument: string;           // 1-2 sentence argument
  why_missing: string;        // Why no agent would make this (cross-cutting, compromise, blind spot)
  gap_type: 'cross_cutting' | 'compromise' | 'blind_spot' | 'unstated_assumption';
  relevant_povs: string[];    // Which POVs should engage with this
  bdi_layer: 'belief' | 'desire' | 'intention';
}
```

**Prompt design:** Fresh LLM with no persona. Receives the transcript and taxonomy summary but with explicit instruction: "Identify 1-2 strong arguments that NONE of the debaters have made and that their assigned perspectives would be unlikely to make. Focus on cross-cutting positions, compromise proposals, and unstated assumptions."

**Temperature:** 0.5 (same as missing arguments pass).

#### New type: `GapInjection`

**File:** `lib/debate/types.ts`

```typescript
export interface GapInjection {
  round: number;
  arguments: GapArgument[];
  transcript_entry_id: string;     // System entry ID
  responses: GapResponse[];        // Filled after agents respond
}

export interface GapResponse {
  pover: string;
  entry_id: string;
  engaged: boolean;               // Did the agent substantively address it?
  stance: 'compatible' | 'opposed' | 'partial' | 'reframed';
}
```

**Storage:** `DebateSession.gap_injections?: GapInjection[]`

#### Engine integration

**File:** `lib/debate/debateEngine.ts`

In the round loop, after completing a turn and before selecting the next responder:

```
if (round === gapInjectionRound && !gapInjectionDone) {
  1. Build transcript summary + taxonomy summary + current AN node texts
  2. Call midDebateGapPrompt() with temperature 0.5
  3. Parse response → GapArgument[]
  4. For each gap argument:
     a. Create a system transcript entry: "[Gap analysis] A strong argument not yet raised: ..."
     b. Record diagnostic (prompt, response, timing)
  5. Store GapInjection on session
  6. Set gapInjectionDone = true
  // The moderator's next cross-respond selection will naturally see these entries
  // and can direct agents to engage with them
}
```

**When to trigger:** Default: `Math.ceil(totalRounds / 2) + 1` (just past midpoint). Configurable via `DebateConfig.gapInjectionRound`. Set to `0` to disable.

**Moderator awareness:** The gap entries are system entries in the transcript, so the moderator's cross-respond selection prompt already sees them. Add a hint to the moderator prompt when gap entries exist: "System has surfaced gap arguments that no debater has addressed. Consider directing a debater to engage with one."

#### UI store integration

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts`

Mirror the engine logic. After the turn pipeline completes for the gap injection round:
1. Call `api.generateText(midDebateGapPrompt(...), model, 30_000)` 
2. Parse the response
3. Add system entries to transcript
4. Store `gap_injections` on `activeDebate`
5. Record diagnostics

#### Diagnostics

- New entry tab data: gap injection prompts/responses visible in the diagnostics window per entry (reuse existing prompt/response tabs — the system entry carries its own diagnostic)
- Overview: gap arguments listed with engagement tracking (which agents responded, what stance they took)

### Cost

1 additional LLM call per debate (mid-debate). ~30 second latency. Negligible vs the 40+ calls in a 5-round debate.

---

## Feature 2: Cross-Cutting Node Promotion

### Concept

When synthesis identifies areas of agreement across all three POVs, automatically detect whether the agreed-upon position maps to an existing situation node. If not, propose a new situation node with the agreement as a shared interpretation.

### Implementation

#### New prompt: `crossCuttingNodePrompt()`

**File:** `lib/debate/prompts.ts`

```typescript
export function crossCuttingNodePrompt(
  agreements: { point: string; povers: string[] }[],
  existingSituationLabels: string[],
  topic: string,
): string
```

**Inputs:**
- `agreements` — from synthesis phase 1 (`areas_of_agreement`)
- `existingSituationLabels` — labels of all existing situation nodes (to avoid duplicates)
- `topic` — debate topic for context

**Output schema:**
```typescript
interface CrossCuttingProposal {
  agreement_text: string;          // The original agreement point
  proposed_label: string;          // Short label for the situation node
  proposed_description: string;    // Genus-differentia format
  interpretations: {
    accelerationist: { belief: string; desire: string; intention: string; summary: string };
    safetyist: { belief: string; desire: string; intention: string; summary: string };
    skeptic: { belief: string; desire: string; intention: string; summary: string };
  };
  linked_nodes: string[];          // POV node IDs from the debate that supported this agreement
  rationale: string;               // Why this deserves a situation node
  maps_to_existing?: string;       // If it maps to an existing situation node (null = new)
}
```

**Prompt design:** "For each area of agreement, determine: (1) Does this agreement already map to an existing situation node? If so, output `maps_to_existing` with the label. (2) If not, propose a new situation node with BDI-decomposed interpretations per POV. Even areas of agreement will have nuanced per-POV interpretations — the agreement is on the surface, but the reasons WHY each POV agrees may differ."

#### Engine integration

**File:** `lib/debate/debateEngine.ts`

After synthesis phase 1 (which produces `areas_of_agreement`), run:

```
const allPovAgree = synthesisData.areas_of_agreement
  .filter(a => a.povers.length >= 3);  // All three POVs agree

if (allPovAgree.length > 0) {
  const sitLabels = taxonomy.situations.nodes.map(n => n.label);
  const prompt = crossCuttingNodePrompt(allPovAgree, sitLabels, topic);
  const { text } = await adapter.generateText(prompt, model, { temperature: 0.3 });
  const proposals = parseAIJson<{ proposals: CrossCuttingProposal[] }>(text);
  session.cross_cutting_proposals = proposals?.proposals ?? [];
}
```

**Storage:** `DebateSession.cross_cutting_proposals?: CrossCuttingProposal[]`

#### Harvest dialog integration

Cross-cutting proposals should appear in the harvest dialog alongside taxonomy refinement suggestions and concession harvests. Each proposal has two actions:
- **Create Situation Node** — creates the node in `situations.json` with the proposed interpretations
- **Map to Existing** — links the agreement to an existing situation node (adds a debate reference)
- **Dismiss** — skip

#### Diagnostics

The proposals appear in the post-debate diagnostics alongside taxonomy suggestions. Show: agreement text, proposed label, whether it maps to existing, per-POV interpretations.

### Cost

1 additional LLM call per debate (post-synthesis). Only fires when 3-way agreements exist.

---

## Feature 3: Taxonomy Gap Diagnostics

### Concept

After each debate, compute a comprehensive taxonomy coverage analysis that answers: "Where are the holes in each POV's taxonomy?" This goes beyond the existing context injection instrumentation (which tracks what was injected and referenced) to identify structural gaps — BDI categories with weak coverage, arguments made that don't map to any node, and cross-POV engagement patterns.

### Implementation

#### New function: `computeTaxonomyGapAnalysis()`

**File:** `lib/debate/taxonomyGapAnalysis.ts` (new file)

```typescript
export interface TaxonomyGapAnalysis {
  // Per-POV coverage
  pov_coverage: Record<string, PovCoverage>;
  
  // Cross-POV gaps
  cross_pov_gaps: CrossPovGap[];
  
  // BDI balance
  bdi_balance: Record<string, BdiBalance>;
  
  // Unmapped arguments
  unmapped_arguments: UnmappedArgument[];
  
  // Summary statistics
  summary: GapSummary;
}

interface PovCoverage {
  total_nodes: number;
  injected_nodes: number;        // Nodes that appeared in context injection
  referenced_nodes: number;       // Nodes actually cited in responses
  utilization_rate: number;       // referenced / injected
  unreferenced_relevant: string[];  // Injected as primary (★) but never cited
  never_injected: string[];       // Relevant to topic but below threshold
  category_breakdown: Record<string, { injected: number; referenced: number }>;
}

interface BdiBalance {
  beliefs: { node_count: number; cited_count: number; argument_count: number };
  desires: { node_count: number; cited_count: number; argument_count: number };
  intentions: { node_count: number; cited_count: number; argument_count: number };
  weakest_category: string;       // Which BDI layer has lowest coverage
  recommendation: string;         // "Consider adding X-type nodes"
}

interface CrossPovGap {
  description: string;           // "No accelerationist node addresses governance compromise"
  evidence_entries: string[];    // Debate entry IDs where the gap was visible
  suggested_bdi: string;
  suggested_pov: string;
}

interface UnmappedArgument {
  an_node_id: string;            // Argument network node
  text: string;                  // The argument text
  speaker: string;
  closest_taxonomy_node?: string; // Nearest node by embedding, if available
  similarity?: number;           // Cosine similarity to closest
  gap_type: 'novel_argument' | 'cross_cutting' | 'refinement_needed';
}

interface GapSummary {
  overall_coverage_pct: number;    // % of injected nodes that were referenced
  most_underserved_pov: string;
  most_underserved_bdi: string;
  unmapped_argument_count: number;
  cross_pov_gap_count: number;
  recommendation: string;          // Top-level recommendation
}
```

#### Computation (deterministic + one optional LLM call)

**Phase 1 (deterministic):** Analyze context injection manifests and transcript references.
- For each turn's manifest: which nodes were injected, which were cited
- Aggregate across turns: per-node citation count, per-POV utilization, per-BDI utilization
- Identify primary (★) nodes that were never cited despite being injected
- Identify AN nodes that don't match any taxonomy node (embedding similarity < 0.4)

**Phase 2 (deterministic):** BDI balance analysis.
- Count taxonomy nodes per POV per BDI category
- Count debate citations per POV per BDI category
- Count AN nodes per speaker per BDI category
- Identify the weakest category for each POV

**Phase 3 (optional LLM):** Cross-POV gap identification.
- Send the synthesis disagreements + the BDI balance data to an LLM
- Ask: "Given these disagreements and this taxonomy coverage pattern, what gaps in the taxonomy prevented deeper engagement?"
- This is the only neural component — it can be skipped if you want pure deterministic analysis

#### Engine integration

**File:** `lib/debate/debateEngine.ts`

After all post-synthesis passes complete:

```
const gapAnalysis = computeTaxonomyGapAnalysis(
  session,
  taxonomy,
  contextManifests,  // Collected during the debate
);
session.taxonomy_gap_analysis = gapAnalysis;
```

**Storage:** `DebateSession.taxonomy_gap_analysis?: TaxonomyGapAnalysis`

#### UI store integration

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts`

Compute after synthesis completes in the store, using the manifests collected during the debate.

---

## Diagnostics UI Requirements

### New Overview Tab: "Gaps"

**File:** `taxonomy-editor/src/renderer/components/DiagnosticsWindow.tsx`

Add `'gaps'` to the `OverviewTab` type union and render a new `TaxonomyGapPanel` component.

#### TaxonomyGapPanel Layout

**File:** `taxonomy-editor/src/renderer/components/TaxonomyGapPanel.tsx` (new)

**Section 1: Summary Banner**
- Overall coverage percentage (color-coded: green >70%, yellow 40-70%, red <40%)
- Most underserved POV + BDI category
- Unmapped argument count
- Cross-POV gap count
- Top recommendation text

**Section 2: Per-POV Coverage Cards (3 columns)**
Each card shows:
- POV name + color
- Total nodes / injected / referenced with utilization bar
- BDI breakdown as 3 mini bars (Beliefs | Desires | Intentions)
- List of "primary but never cited" nodes (collapsible)
- Weakest BDI category highlighted

**Section 3: Unmapped Arguments Table**
| AN Node | Speaker | Text (truncated) | Closest Taxonomy Node | Similarity | Gap Type |
Sortable by gap type. Click to navigate to the entry in the transcript tab.

**Section 4: Cross-POV Gaps**
Cards for each identified gap with description, evidence entries (clickable), and suggested POV/BDI for new nodes.

**Section 5: Gap Injection Results** (if gap injection fired)
For each gap argument:
- The argument text
- `gap_type` badge
- Which agents were directed to engage
- Their stance (compatible/opposed/partial/reframed)
- Whether the gap was subsequently addressed in later rounds

**Section 6: Cross-Cutting Proposals** (if any)
For each proposal:
- Agreement text
- Proposed situation node label
- Per-POV BDI interpretations (collapsible)
- Maps to existing? badge
- Action buttons (Create / Map / Dismiss) — only in the main UI, not the diagnostics popout

### Updated Overview Tab List

```typescript
type OverviewTab = 'extraction' | 'argument-network' | 'commitments' | 
                   'transcript' | 'convergence' | 'reflections' | 'gaps';
```

The tab order places `gaps` last since it's a post-debate diagnostic.

### Entry-Level Diagnostics

Gap injection entries (system entries with type `gap_analysis`) should display in the entry detail pane with:
- The gap prompt sent to the LLM
- The raw response
- Parsing results
- Timing data

This follows the existing pattern for system entries — they already carry diagnostics when created via `addEntry()` with `recordDiagnostic()`.

---

## Data Model Changes

### DebateSession (lib/debate/types.ts)

Add three optional fields:

```typescript
// Feature 1: Mid-debate gap injection
gap_injections?: GapInjection[];

// Feature 2: Cross-cutting node promotion
cross_cutting_proposals?: CrossCuttingProposal[];

// Feature 3: Taxonomy gap diagnostics
taxonomy_gap_analysis?: TaxonomyGapAnalysis;
```

All optional for backward compatibility with existing debate sessions.

### DebateConfig (lib/debate/types.ts)

Add configuration:

```typescript
gapInjectionRound?: number;        // 0 = disabled, default = ceil(totalRounds/2)+1
enableTaxonomyGapAnalysis?: boolean; // default true
enableCrossCuttingProposals?: boolean; // default true
```

---

## Implementation Order

1. **Types first** — Add all new interfaces to `lib/debate/types.ts`
2. **Prompts** — Add `midDebateGapPrompt()` and `crossCuttingNodePrompt()` to `lib/debate/prompts.ts`
3. **Taxonomy gap analysis** — Create `lib/debate/taxonomyGapAnalysis.ts` with deterministic computation
4. **Engine integration** — Wire into `debateEngine.ts` round loop and post-synthesis
5. **UI store** — Wire into `useDebateStore.ts` 
6. **Diagnostics UI** — Create `TaxonomyGapPanel.tsx` and add `gaps` tab to `DiagnosticsWindow.tsx`
7. **Tests** — Add unit tests for `computeTaxonomyGapAnalysis()` and prompt parsing

---

## Testing Strategy

### Unit Tests

- `taxonomyGapAnalysis.test.ts`:
  - Correct coverage computation from mock manifests
  - BDI balance calculation
  - Unmapped argument detection
  - Edge cases: empty debate, no manifests, no AN nodes

- Prompt parsing tests:
  - `midDebateGapPrompt` response parsing with valid/invalid JSON
  - `crossCuttingNodePrompt` response parsing

### Integration Tests

- Run a short debate (2 rounds) and verify gap injection fires at the configured round
- Verify cross-cutting proposals appear when synthesis has 3-way agreements
- Verify taxonomy gap analysis produces non-empty results

### Manual Validation

- Run a full 5-round debate and review the Gaps tab in diagnostics
- Verify gap arguments are substantive (not restatements of existing arguments)
- Verify cross-cutting proposals are genuine agreements (not false positives)
- Verify coverage statistics match manual inspection of transcript
