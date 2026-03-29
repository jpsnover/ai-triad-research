# Debate Diagnostics Mode — Proposal

**Date:** 2026-03-29
**Purpose:** Enable experts to understand WHY the debate tool produces its output by surfacing AIF elements, reasoning chains, and validation results at each step.

---

## The Problem

The debate tool generates rich intermediate data — argument networks, commitment stores, validation results, edge tensions, BDI context, dialectical move classifications — but almost none of it is visible to the user. An expert can see the final debate transcript and synthesis, but can't answer:

- Why did the moderator pick Sentinel to respond instead of Cassandra?
- What claims were extracted from this turn? Which were rejected and why?
- What taxonomy context was each debater given? Which vulnerabilities were highlighted?
- Are the debaters contradicting their own prior commitments?
- Which argument map relationships are supported by warrants vs. flat assertions?
- What edge tensions between taxonomy nodes informed the moderator's decisions?

---

## What Data Already Exists But Is Hidden

The audit found **12 categories of hidden diagnostic data** across the debate flow:

| Category | Where Stored | Currently Visible? |
|----------|-------------|-------------------|
| Dialectical moves (CONCEDE, DISTINGUISH, etc.) | `entry.metadata.move_types` | No |
| Disagreement type (EMPIRICAL/VALUES/DEFINITIONAL) | `entry.metadata.disagreement_type` | No |
| Key assumptions + counterfactuals | `entry.metadata.key_assumptions` | No |
| Argument network (claims + attacks + warrants) | `debate.argument_network` | No |
| Per-debater commitments (asserted/conceded/challenged) | `debate.commitments` | No |
| Full BDI taxonomy context sent to each debater | Generated per-turn, ephemeral | No |
| Edge tensions sent to moderator | Generated per cross-respond, ephemeral | No |
| Claim extraction validation (rejected claims, overlap %) | console.warn only | No |
| Full synthesis structured data (BDI layers, resolvability) | `entry.metadata.synthesis` | Partially (text only) |
| Probing question targeting (which POVer, which position) | `entry.metadata.probing_questions` | No |
| Commitment context injected into debater prompts | Generated per-turn, ephemeral | No |
| Full prompts sent to AI | Ephemeral, never stored | No |

---

## Proposed Solution: Diagnostics Panel

### UX Concept

A **toggleable diagnostics panel** that appears as a right-side pane (like the Inspector pane) when activated. Two modes:

**Mode 1: Per-Entry Diagnostics** — Click any transcript entry to see its internals in the diagnostics panel:
- For debater statements: move types, disagreement type, key assumptions, extracted claims (with validation results), taxonomy context injected, commitments at time of this turn
- For moderator actions: edge tensions considered, argument network state, which claims were unaddressed, why the selected debater was chosen
- For synthesis: full structured data with BDI layers, resolvability, warrants on support links, preference criteria, critical questions

**Mode 2: Debate Overview** — Shows aggregate diagnostic data for the whole debate:
- Argument network graph (nodes = claims, edges = support/attack with types)
- Commitment consistency report (contradictions highlighted)
- Taxonomy coverage heatmap (which nodes were referenced, which were ignored)
- Move type distribution per debater
- Disagreement type distribution
- Claim extraction success rate

### Activation

A toggle button in the debate workspace toolbar: **"Diagnostics"** (or a bug/microscope icon). When active:
- The diagnostics panel opens on the right
- Each transcript entry gets a small diagnostic indicator showing available data
- Clicking an entry populates the panel with that entry's diagnostic details

When inactive, the debate looks and works exactly as it does now — zero visual impact for non-expert users.

---

## Implementation Plan

### Phase D1: Capture and Store Diagnostic Data

**Goal:** Stop losing ephemeral data. Store everything needed for diagnostics alongside the debate session.

#### Step D1.1: Add diagnostic storage to DebateSession

**File:** `taxonomy-editor/src/renderer/types/debate.ts`

```typescript
interface DebateDiagnostics {
  /** Per-entry diagnostic data, keyed by transcript entry ID */
  entries: Record<string, EntryDiagnostics>;
  /** Debate-level aggregate data */
  overview: DebateOverviewDiagnostics;
}

interface EntryDiagnostics {
  /** Full prompt text sent to AI for this entry */
  prompt?: string;
  /** Raw AI response before parsing */
  raw_response?: string;
  /** AI model used */
  model: string;
  /** Response time in ms */
  response_time_ms?: number;
  /** For debater statements: taxonomy context injected */
  taxonomy_context?: string;
  /** For debater statements: commitment context injected */
  commitment_context?: string;
  /** For debater statements: claims extracted from this turn */
  extracted_claims?: {
    accepted: { text: string; id: string; overlap_pct: number }[];
    rejected: { text: string; reason: string; overlap_pct: number }[];
  };
  /** For moderator cross-respond: edge tensions considered */
  edge_tensions?: string;
  /** For moderator cross-respond: argument network state at time of decision */
  argument_network_context?: string;
  /** For moderator cross-respond: why this debater was selected */
  selection_reasoning?: string;
}

interface DebateOverviewDiagnostics {
  /** Total AI calls made */
  total_ai_calls: number;
  /** Total response time */
  total_response_time_ms: number;
  /** Claim extraction stats */
  claims_accepted: number;
  claims_rejected: number;
  /** Move type distribution across all entries */
  move_type_counts: Record<string, number>;
  /** Disagreement type distribution */
  disagreement_type_counts: Record<string, number>;
}
```

**Verification:** None — type definition.

#### Step D1.2: Capture prompts and responses

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts`

At each AI call site (opening statements, responses, cross-respond, synthesis, probing, fact-check), capture:
1. The full prompt text (before sending)
2. The raw response text (before parsing)
3. The model used
4. The response time

Store in `debate.diagnostics.entries[entryId]`.

**Key design decision:** This doubles the storage per debate session. To mitigate:
- Only capture when diagnostics mode is ON (check a store flag)
- Truncate prompt text to 10K chars (enough to see the taxonomy context)
- Don't capture for routine operations (only for debater turns and moderator decisions)

**Verification — V-D1.2:** After capturing, verify the stored prompt contains the expected BDI sections and commitment context.

#### Step D1.3: Capture validation results from claim extraction

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` — `extractClaimsAndUpdateAN`

Currently, rejected claims are logged to `console.warn` and lost. Instead, store them in `debate.diagnostics.entries[entryId].extracted_claims.rejected`.

For accepted claims, store the overlap percentage alongside the claim text and AN node ID.

**Verification:** None — just routing existing data to storage instead of console.

#### Step D1.4: Capture edge tensions and AN context for moderator

**File:** `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` — cross-respond flow

Currently `formatEdgeContext` and `formatArgumentNetworkContext` produce text that's injected into the moderator prompt and discarded. Instead, also store it in diagnostics:

```typescript
// Before sending to moderator:
const edgeContext = formatEdgeContext(poverLabels);
const anContext = formatArgumentNetworkContext(...);
// Store in diagnostics
diagnostics.entries[moderatorEntryId] = {
  edge_tensions: edgeContext,
  argument_network_context: anContext,
};
```

**Verification:** None — just routing existing data to storage.

### Phase D2: Per-Entry Diagnostics Panel

**Goal:** Build the UI component that displays diagnostic data for a selected transcript entry.

#### Step D2.1: Create the DiagnosticsPanel component

**File:** `taxonomy-editor/src/renderer/components/DiagnosticsPanel.tsx` (new)

A panel that receives a transcript entry ID and displays its diagnostic data in expandable sections:

```
┌─ Diagnostics: Prometheus Opening Statement ──────────────┐
│                                                          │
│ ▶ Model & Timing                                         │
│   Model: gemini-2.5-flash | Response: 8.2s              │
│                                                          │
│ ▶ Dialectical Moves                                      │
│   DISTINGUISH, COUNTEREXAMPLE                            │
│   Disagreement type: EMPIRICAL                           │
│                                                          │
│ ▼ Key Assumptions                                        │
│   1. "Scaling laws continue to hold"                     │
│      If wrong: "Would need to acknowledge architectural  │
│      limits and revise timeline claims"                   │
│                                                          │
│ ▼ Extracted Claims (3 accepted, 1 rejected)              │
│   ✓ AN-4: "Scaling compute has produced..." (87% match)  │
│   ✓ AN-5: "Current AI already shows..." (72% match)      │
│   ✓ AN-6: "The cost of delay exceeds..." (65% match)     │
│   ✗ "Innovation requires freedom" (22% match — rejected) │
│                                                          │
│ ▶ Taxonomy Context (click to expand)                     │
│   === YOUR BELIEFS ===                                   │
│   [acc-data-001] More Power Equals More Smarts: ...      │
│   ...                                                    │
│                                                          │
│ ▶ Commitments at This Point                              │
│   Asserted: 3 claims                                     │
│   Conceded: 0                                            │
│   Challenged: 1 claim                                    │
│                                                          │
│ ▶ Full Prompt (click to expand)                          │
│   [expandable pre block with the full prompt text]       │
│                                                          │
│ ▶ Raw AI Response (click to expand)                      │
│   [expandable pre block with the raw response]           │
└──────────────────────────────────────────────────────────┘
```

For **moderator entries** (cross-respond selection), show instead:
- Edge tensions considered (the full tension list with confidence scores)
- Argument network state (claims, attacks, unaddressed items)
- Why this debater was selected (the moderator's reasoning from the parsed response)

For **synthesis entries**, show:
- Full structured data with BDI layers, resolvability, warrants
- Claim-attack graph in text form
- Preference criteria breakdown
- Critical questions (addressed vs. not)

#### Step D2.2: Add diagnostic indicators to transcript entries

**File:** `taxonomy-editor/src/renderer/components/DebateWorkspace.tsx`

When diagnostics mode is active, each transcript entry gets a small indicator showing what diagnostic data is available:

```
[Prometheus] [opening] [moves: DISTINGUISH, COUNTEREXAMPLE] [3 claims]
```

Clicking the indicator (or the entry itself) selects it and populates the diagnostics panel.

#### Step D2.3: Wire up diagnostics toggle and panel layout

**File:** `taxonomy-editor/src/renderer/components/DebateTab.tsx`

Add a diagnostics pane (similar to the inspector pane) that appears when toggled:
- Toggle button in the debate workspace header
- Panel appears as a right-side pane with resize handle
- Persists across entry selections (stays open until toggled off)

### Phase D3: Debate Overview Diagnostics

**Goal:** Aggregate diagnostic data across the whole debate.

#### Step D3.1: Argument network visualization

When no specific entry is selected, the diagnostics panel shows the overview. The centerpiece is the **argument network graph** rendered as a text-based tree or a simple SVG:

```
AN-1 (Prometheus): "Scaling compute is sufficient for AGI"
  ← AN-3 (Sentinel) attacks [undercut via DISTINGUISH]
     Warrant: "Historical precedent shows paradigm shifts..."
  ← AN-5 (Cassandra) attacks [rebut via COUNTEREXAMPLE]
     Warrant: "Current AI failures demonstrate fundamental limits..."

AN-2 (Prometheus): "The cost of delay exceeds the cost of mistakes"
  [unaddressed — no attacks or responses]

AN-4 (Sentinel): "Alignment must precede deployment"
  → supports AN-3
  ← AN-6 (Prometheus) attacks [rebut via REDUCE]
```

This is the AIF argument network made visible — I-nodes (claims), RA-nodes (supports with warrants), CA-nodes (attacks with types and schemes).

#### Step D3.2: Commitment consistency report

Show per-debater commitment stores with contradiction detection:

```
Prometheus:
  Asserted (5): "Scaling is sufficient", "Cost of delay", ...
  Conceded (1): "Current AI has jagged capabilities"
  Challenged (2): "Alignment must precede", "Present harms matter more"
  ⚠ Potential contradiction: Asserted "scaling is sufficient" but
    conceded "current AI has jagged capabilities" — tension between
    scaling optimism and capability acknowledgment.

Sentinel:
  Asserted (4): ...
  Conceded (0):
  Challenged (3): ...
  ✓ No contradictions detected.
```

#### Step D3.3: Taxonomy coverage and move distribution

```
Taxonomy Coverage:
  Beliefs:    ████████░░ 8/16 nodes referenced
  Values:     ██████░░░░ 6/13 nodes referenced
  Reasoning:  ████░░░░░░ 4/16 nodes referenced
  Cross-cut:  ██████████ 10/10 nodes referenced (!)

Move Distribution:
  Prometheus:  DISTINGUISH(3) COUNTEREXAMPLE(2) ESCALATE(1)
  Sentinel:    CONCEDE(2) DISTINGUISH(2) REDUCE(1)
  Cassandra:   REFRAME(3) COUNTEREXAMPLE(1) CONCEDE(1)

Disagreement Types:
  EMPIRICAL: 4 | VALUES: 2 | DEFINITIONAL: 1
```

### Phase D4: Prompt Transparency

**Goal:** Let experts inspect the exact prompts sent to the AI.

#### Step D4.1: Store prompts optionally

Only when diagnostics mode is ON, store the full prompt text before each AI call. This is the most storage-intensive diagnostic data — a single debate with 5 turns per debater could generate 50KB+ of prompt text.

**Mitigation:** Compress repeated elements. The taxonomy context is the same for all turns by the same debater — store it once and reference it. Only store the variable parts (transcript history, commitments, focus point) per-entry.

#### Step D4.2: Prompt diff view

For consecutive turns by the same debater, show what CHANGED in the prompt:
- New transcript entries added since last turn
- Commitment updates
- Argument network growth

This is more useful than the full prompt — it shows what new information the debater had access to.

---

## What NOT to Build

1. **Real-time streaming diagnostics** — updating the panel as the AI generates tokens. Too complex, marginal value.
2. **Automatic quality scoring** — assigning numeric scores to debate quality. Too opinionated, better left to human judgment.
3. **Prompt editing/replay** — letting users modify a prompt and re-run. Too risky (could corrupt debate state).

---

## Dependencies

```
Phase D1 (Capture) → can start immediately
  ↓
Phase D2 (Per-Entry Panel) → needs D1 data
  ↓
Phase D3 (Overview) → needs D2 infrastructure
  ↓
Phase D4 (Prompt Transparency) → needs D1 storage, independent of D2-D3
```

D1 and D4 are the foundation. D2 is the core user-facing feature. D3 is the most valuable for AIF analysis but depends on D2.

---

## Summary

| Phase | What | Effort | Value |
|-------|------|--------|-------|
| D1 | Capture diagnostic data at each AI call | Medium | Foundation — no visible change |
| D2 | Per-entry diagnostics panel | Medium | Primary UX — see WHY each turn happened |
| D3 | Debate overview (AN graph, commitments, coverage) | Medium | AIF analysis — see the debate structure |
| D4 | Prompt transparency | Low | Expert deep-dive — see exactly what the AI was told |
