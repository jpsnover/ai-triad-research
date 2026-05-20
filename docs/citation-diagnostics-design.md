# Design: Citation Diagnostics in Debate Diagnostics Window

**Status:** Draft
**Author:** Technical Lead
**Date:** 2026-05-20
**Depends on:** `docs/citation-resolution-design.md` (Hybrid Citation Resolution)

## Purpose

The hybrid citation resolution system (Path A: bank + scrub, Path B: tool-calling) generates rich intermediate data that is invisible to the user. When citations are scrubbed, tool calls made, or bank lookups fail, the user sees only the final statement — they can't tell which citations were fabricated and removed, which were resolved via tool calls, or why the bank had no match. This document specifies how to surface that data in the Debate Diagnostics window.

## Data Produced by the Citation Resolution Pipeline

Every draft turn with citation resolution active produces these data artifacts:

### From Both Paths

| Data | Type | When Generated |
|------|------|----------------|
| Citation bank | `CitationBankEntry[]` | Before draft stage — available sources for this turn |
| Extracted citations | `{ text: string; pattern: string; location: number }[]` | Post-draft — regex-extracted citation-like patterns from the draft |
| Bank matches | `{ citation: string; match: CitationBankEntry; similarity: number }[]` | Post-draft — citations successfully matched to the bank |
| Bank misses | `{ citation: string; pattern: string; action: 'removed' \| 'hedged' }[]` | Post-draft — fabricated citations not in the bank |
| Validation warnings | `CitationWarning[]` | Post-draft — final validation output |
| Resolution path | `'tool-calling' \| 'bank-scrub'` | At draft setup — which path was selected |
| Resolution time | `number` (ms) | Total time for citation resolution |

### Path B Only (Tool-Calling)

| Data | Type | When Generated |
|------|------|----------------|
| Tool calls | `ToolCall[]` | During draft generation — LLM's lookup requests |
| Tool results | `ToolResult[]` | During draft generation — evidence index responses |
| Tool call count | `number` | Total tool calls made (cap: 5) |
| Empty lookups | `{ query: string; source_type: string }[]` | Tool calls that returned no matches |

### Path A Only (Bank + Scrub)

| Data | Type | When Generated |
|------|------|----------------|
| Scrub result | `{ cleanedDraft: string; removed: string[]; warnings: string[] }` | Post-draft — what the scrubber changed |
| Original vs cleaned diff | Line-level diff | Comparing pre-scrub and post-scrub draft text |

## Stage Diagnostics Storage

Add a `citation_resolution` field to the draft `StageDiagnostics` entry:

```typescript
interface CitationResolutionDiagnostics {
  // Common
  path: 'tool-calling' | 'bank-scrub';
  bank_size: number;                    // entries in the citation bank
  bank_sources: string[];               // doc_ids available (for display)
  citations_extracted: number;           // total citation-like patterns found in draft
  citations_matched: number;             // matched to bank
  citations_fabricated: number;          // not in bank
  resolution_time_ms: number;

  // Matched citations
  matches: {
    citation_text: string;              // as it appears in the draft
    doc_id: string;                     // matched bank entry
    title: string;                      // bank entry title
    similarity: number;                 // match confidence (0-1)
    match_type: 'exact' | 'fuzzy_title' | 'url' | 'arxiv_id';
  }[];

  // Fabricated citations (removed or hedged)
  fabrications: {
    citation_text: string;              // as LLM wrote it
    pattern: string;                    // regex pattern that caught it ('arxiv' | 'url' | 'title' | 'legislation')
    action: 'removed' | 'hedged';      // what the scrubber did
    replacement?: string;              // hedged phrasing if applicable
  }[];

  // Path B: tool calls
  tool_calls?: {
    query: string;
    source_type?: string;
    results_count: number;
    top_result?: { doc_id: string; title: string; relevance: number };
    time_ms: number;
    empty: boolean;                     // true if no results
  }[];

  // Path A: scrub diff
  scrub_diff?: {
    lines_removed: number;
    lines_modified: number;
    original_length: number;
    cleaned_length: number;
  };

  // Validation warnings
  warnings: string[];
}
```

Store on the draft stage diagnostics entry:
```typescript
stageDiags.push({
  stage: 'draft',
  prompt: draftPromptText,
  raw_response: draftRaw,
  // ... existing fields ...
  citation_resolution: citationDiagnostics,  // NEW
});
```

## Diagnostics Window: Citation Tab

### Tab Position and Label

Add a **"Citations"** tab after "Evidence" in the per-turn tab bar. Label shows count: `Citations (N)` where N = total citations extracted from the draft.

Only visible when the turn has `citation_resolution` data on its draft stage diagnostics. Hidden for old debates and turns without citation resolution.

### Layout (Top to Bottom)

```
┌─────────────────────────────────────────────────────────────┐
│ Citations (7)                                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│ │ Path     │ │ Bank     │ │ Matched  │ │ Fabricated       ││
│ │ Tool-Call│ │ 24 srcs  │ │ 5/7      │ │ 2 removed        ││
│ └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
│                                                              │
│ ▼ Matched Citations (5)                                      │
│   ┌─ ✓ MATCHED ──────────────────────────────────────────┐  │
│   │ "Credal Set Regulation Framework (2603.05175v1)"     │  │
│   │ Bank: "2603.05175v1" — 0.94 similarity (arxiv_id)   │  │
│   │ Title: "Credal Sets and Regulation Mechanisms"       │  │
│   │ URL: https://arxiv.org/abs/2603.05175v1              │  │
│   └──────────────────────────────────────────────────────┘  │
│   ┌─ ✓ MATCHED ──────────────────────────────────────────┐  │
│   │ "ISACA autonomous red/blue teaming report (2026)"    │  │
│   │ Bank: "autonomous-red-vs-blue-teaming..." — 0.87     │  │
│   │       (fuzzy_title)                                   │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│ ▼ Fabricated Citations (2)                                   │
│   ┌─ ✗ FABRICATED ───────────────────────────────────────┐  │
│   │ "The 2024 Stanford AI Index Report"                  │  │
│   │ Pattern: title — Not in citation bank                │  │
│   │ Action: removed (attribution clause stripped)         │  │
│   └──────────────────────────────────────────────────────┘  │
│   ┌─ ✗ FABRICATED ───────────────────────────────────────┐  │
│   │ "EU AI Act Article 52 transparency provisions"       │  │
│   │ Pattern: legislation — Not in citation bank          │  │
│   │ Action: hedged → "Regulatory frameworks such as      │  │
│   │         the EU AI Act include transparency..."       │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│ ▼ Citation Bank (24 available sources)                       │
│   • "2603.05175v1" — Credal Sets and Regulation...          │
│   • "autonomous-red-vs-blue-teaming-2026" — ISACA...        │
│   • "the-pentagon-went-to-war-2025" — The Pentagon...       │
│   • ... (collapsed, show first 5 + "19 more")               │
│                                                              │
│ ▼ Tool Calls (3)  [Path B only]                             │
│   ┌─ LOOKUP #1 ── 8ms ──────────────────────────────────┐  │
│   │ Query: "evidence that alignment training reduces      │  │
│   │         covert AI actions"                            │  │
│   │ Type: academic                                        │  │
│   │ Results: 3 — top: "2603.05175v1" (0.82)              │  │
│   └──────────────────────────────────────────────────────┘  │
│   ┌─ LOOKUP #2 ── 5ms ──────────────────────────────────┐  │
│   │ Query: "autonomous red team blue team cybersecurity"  │  │
│   │ Results: 2 — top: "autonomous-red-vs-blue..." (0.91) │  │
│   └──────────────────────────────────────────────────────┘  │
│   ┌─ LOOKUP #3 ── 4ms ── ⚠ EMPTY ───────────────────────┐  │
│   │ Query: "Stanford AI Index 2024 governance metrics"    │  │
│   │ Results: 0 — no verified sources found                │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│ ▼ Scrub Diff (Path A only)                                   │
│   2 lines removed, 1 line modified                          │
│   ▸ Show diff (opens inline line-level diff)                │
│                                                              │
│ ▼ Warnings                                                   │
│   • Citation "Stanford AI Index" was removed — no match     │
│     in citation bank. Claim retained as analytical position. │
│   • Legislation "EU AI Act Article 52" hedged — specific    │
│     article number unverifiable from available sources.      │
│                                                              │
│ Resolution time: 23ms │ Path: tool-calling │ Bank: 24 srcs  │
└─────────────────────────────────────────────────────────────┘
```

### Section Details

#### 1. Summary Cards (Top Row)

Four horizontal cards, same style as Evidence tab and analytics dashboard:

| Card | Value | Color Logic |
|------|-------|-------------|
| **Path** | "Tool-Call" or "Bank+Scrub" | Blue for tool-call, amber for bank+scrub |
| **Bank** | "N srcs" (citation bank size) | Muted (informational) |
| **Matched** | "N/M" (matched / total extracted) | Green if all matched, amber if some fabricated, red if >50% fabricated |
| **Fabricated** | "N removed" or "N hedged" or "0 — clean" | Red if any, green if zero |

**Empty state:** When no citation resolution data exists (old debates, openings), show muted banner: "Citation resolution was not active for this turn."

#### 2. Matched Citations

Expandable list (default open), sorted by match confidence descending. Each card shows:
- The citation text as it appears in the draft (monospace, highlighted green like search matches)
- Bank match: doc_id, similarity score, match type badge (`EXACT` / `FUZZY` / `URL` / `ARXIV`)
- Title and URL from the bank entry (URL is clickable)
- Left border: green (3px, same pattern as evidence support cards)

#### 3. Fabricated Citations

Expandable list (default open), sorted by pattern type. Each card shows:
- The citation text as the LLM wrote it (monospace, highlighted red)
- Pattern type badge: `TITLE` / `ARXIV` / `URL` / `LEGISLATION`
- Action taken: "removed" (red badge) or "hedged" (amber badge)
- If hedged: show the replacement text in muted italic
- Left border: red (3px, same pattern as evidence contradict cards)

#### 4. Citation Bank

Collapsible (default collapsed), shows the available sources for this turn:
- First 5 entries expanded: doc_id + title + year
- Remaining collapsed: "N more" expander
- Each entry's doc_id is clickable → navigates to source in SummariesTab (if available)
- Purpose: lets the user see what the LLM *could have* cited, to evaluate whether fabrications were avoidable

#### 5. Tool Calls (Path B Only)

Only rendered when `path === 'tool-calling'`. Expandable list showing each `lookup_citation` call:
- Query text (what the LLM searched for)
- Source type filter (if specified)
- Results count + top result (doc_id, title, relevance score)
- Response time (ms)
- **Empty lookups** highlighted with ⚠ badge — these are where the LLM couldn't find a source and should have hedged instead of fabricating

This section is critical for debugging: it shows the LLM's *intent* (what evidence it wanted) vs the bank's *coverage* (what was available). Empty lookups reveal corpus gaps.

#### 6. Scrub Diff (Path A Only)

Only rendered when `path === 'bank-scrub'`. Shows what the deterministic scrubber changed:
- Lines removed / lines modified counts
- Expandable inline diff (reuse `lineDiff.ts` from the Prompt Diff Viewer) showing the pre-scrub and post-scrub draft side by side
- Removed text highlighted in red, replacement text in yellow — same diff colors as Prompt Diff Viewer

#### 7. Warnings

List of `CitationWarning` entries from the final validation pass. Each as a bullet with descriptive text. These are the same warnings that feed into the stage validation hints, but shown here with full context about which citation triggered them.

#### 8. Status Bar (Bottom)

Single line: `Resolution time: Nms | Path: tool-calling/bank-scrub | Bank: N srcs`

## Diff Viewer Integration

The Diff Viewer surfaces citation resolution data in three ways: tool call sub-nodes in the tree, pre-scrub toggle for Path A, and citation summaries in the validation panel.

### Tool Call Sub-Nodes in the Tree (Path B)

When a draft turn used Path B (tool-calling), the Diff Viewer tree shows tool calls as sub-nodes under the DRAFT stage:

```
▼ S5 Safetyist (statement) 2 runs
    BRIEF
      Run 1  gemini-lite, 0.15, 1.9s
    PLAN
      Run 1  gemini-lite, 0.4, 2.9s
    DRAFT
      Run 1  gemini-lite, 0.7, 4.4s  ✓
      Run 2  gemini-lite, 0.7, 3.8s  ✓
      ▼ Tool Calls (3)
        Tool Call 1  lookup_citation  8ms
        Tool Call 2  lookup_citation  5ms
        Tool Call 3  lookup_citation  4ms  ⚠ empty
    CITE
      Run 1  gemini-lite, 0.15, 1.9s
```

**Tree node behavior:**
- Tool Call nodes are clickable — clicking loads the tool call data into a pane, same as clicking a stage node
- **Prompts mode:** pane shows the tool call query + source_type (what the LLM asked the evidence index for)
- **Responses mode:** pane shows the tool result JSON (matched citations returned by the evidence index)
- Empty lookups (⚠) show the query in Prompts mode and "No verified sources found" message in Responses mode
- Tool Call nodes inherit the orchestration run index of their parent DRAFT entry

**Diffing tool calls across retries:**
If the LLM searched for "Stanford AI Index 2024" on Run 1 (empty) and changed to "AI governance metrics" on Run 2 (matched), loading both into side-by-side panes shows the query evolution with word-level diff highlighting. This reveals how the LLM adapted its search strategy after a failed lookup.

**Data source:** `citation_resolution.tool_calls[]` on the draft `StageDiagnostics` entry:
```typescript
// Prompts mode text for a tool call:
`lookup_citation\n\nQuery: ${toolCall.query}\nSource type: ${toolCall.source_type ?? 'any'}`

// Responses mode text for a tool call:
JSON.stringify(toolCall.results, null, 2)
// Or for empty lookups:
`No verified sources found for this query.\n\nThe citation bank (${bankSize} sources) had no match above the similarity threshold.`
```

### Scrub Sub-Node in the Tree (Path A)

When a draft turn used Path A (bank+scrub), the tree shows a single "Scrub" sub-node under the DRAFT stage:

```
▼ DRAFT
    Run 1  gemini-lite, 0.7, 4.4s  ✓
    ▼ Citation Scrub
      Scrub  2 removed, 1 hedged  23ms
```

**Pane content:**
- **Prompts mode:** shows the pre-scrub draft text (the raw LLM output before citations were cleaned)
- **Responses mode:** shows the post-scrub draft text (the cleaned version)

Loading both the Run 1 (raw response) and Scrub (post-scrub) into side-by-side panes shows exactly what the scrubber removed or hedged, with word-level diff highlighting on the changed lines.

**Data source:**
```typescript
// Prompts mode: pre-scrub text
citation_resolution.scrub_original ?? draftStageDiag.raw_response

// Responses mode: post-scrub text
draftStageDiag.work_product.statement
```

### Validation Panel: Citation Summary

The validation panel below each pane (added in the earlier Diff Viewer enhancement) gains a **Citation Resolution** section when `citation_resolution` data exists:

```
▼ Per-Stage Validation ✓
  • DRAFT  my_claims are all abstract...

▼ Citation Resolution
  Path: Tool-Call │ Bank: 24 srcs
  Matched: 5/7 (71%)  │  Fabricated: 2 (1 removed, 1 hedged)
  Tool calls: 3 (1 empty)  │  Resolution: 23ms
```

For the fabricated count: green if 0, amber if 1-2, red if 3+. This gives an at-a-glance view of citation quality per retry attempt without expanding the full Citations tab.

### Pre-Scrub Toggle (Path A)

When viewing a draft response in the Diff Viewer (Responses mode), and the turn used Path A (bank+scrub), add a small toggle in the pane header: **"[Pre-scrub]"**. When enabled, the pane shows the original LLM response before scrubbing instead of the cleaned version. This uses `raw_response` (pre-scrub) vs `work_product.statement` (post-scrub).

The toggle only appears when:
1. View mode is Responses
2. The draft stage has `citation_resolution.path === 'bank-scrub'`
3. The scrub actually changed something (`citation_resolution.fabrications.length > 0`)

## Flight Recorder Events

| Event | Level | Data |
|-------|-------|------|
| `citation.bank.built` | info | `{ bank_size, topic, time_ms }` |
| `citation.tool_call` | debug | `{ query, source_type, results_count, top_relevance, time_ms }` |
| `citation.tool_call.empty` | warn | `{ query, source_type }` — LLM searched but found nothing |
| `citation.scrub` | info | `{ extracted, matched, fabricated, removed, hedged, time_ms }` |
| `citation.validation` | info | `{ warnings_count, fabricated_count }` |

## Data Flow

```
Evidence Stage (existing)
  ↓ sourceEvidenceIndex
Citation Bank Builder (new)
  ↓ CitationBankEntry[]
  ↓
  ├── Path B: Tool-Calling ──────────────────────────────────┐
  │   Draft generates with lookup_citation tool               │
  │   Tool calls recorded in diagnostics                      │
  │   LLM incorporates real citations                         │
  │                                                            │
  ├── Path A: Bank Injection + Scrub ────────────────────────┐│
  │   Bank formatted and injected into prompt                 ││
  │   Draft generates with citation rules                     ││
  │   Post-draft scrub removes fabrications                   ││
  │   Scrub diff recorded in diagnostics                      ││
  │                                                            ││
  ↓ (both paths merge)                                         ↓↓
Post-Draft Citation Validation
  ↓ CitationWarning[]
  ↓
Stage Diagnostics (citation_resolution field)
  ↓
Diagnostics Window: Citations Tab
Diff Viewer: Tool Call Sub-Nodes + Scrub Node + Validation Panel + Pre-Scrub Toggle
```

## Component Ownership

| Component | Owner | Files |
|-----------|-------|-------|
| `CitationResolutionDiagnostics` type | Shared Lib | `lib/debate/citationResolution.ts` |
| Diagnostics data population | Shared Lib | `lib/debate/turnPipeline.ts` |
| Flight recorder events | Shared Lib | `lib/flight-recorder/types.ts` |
| Citations tab UI | Taxonomy Editor | `DiagnosticsWindow.tsx` |
| Diff Viewer tool call tree nodes | Taxonomy Editor | `PromptDiffTree.tsx` |
| Diff Viewer scrub tree node | Taxonomy Editor | `PromptDiffTree.tsx` |
| Diff Viewer citation validation summary | Taxonomy Editor | `PromptDiffPane.tsx` (ValidationPanel) |
| Diff Viewer pre-scrub toggle | Taxonomy Editor | `PromptDiffPane.tsx` |

## Reusable Patterns

The Citations tab reuses existing UI patterns:
- **Summary cards** — same as Evidence tab and analytics dashboard
- **Expandable card lists** — same as Evidence tab's claim cards (left-border color, expandable details)
- **Category badges** — same `classifyHintTarget` + `HINT_TARGET_STYLE` pattern as validation hints
- **Inline diff** — reuses `lineDiff.ts` from the Prompt Diff Viewer
- **Collapsible sections** — `<details open>` pattern used throughout diagnostics
- **Clickable doc_ids** — same navigation pattern as SourcesPanel and PolicySourcesPanel

No new component patterns are introduced — this is a composition of existing diagnostics primitives applied to citation data.
