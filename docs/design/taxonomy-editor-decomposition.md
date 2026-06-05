# Taxonomy Editor Decomposition Plan

**Ticket:** t/415  
**Author:** Technical Lead  
**Date:** 2026-06-05  
**Status:** Proposed

## Executive Summary

The taxonomy-editor renderer has 6 monolithic files totaling ~25K lines. Three files account for 80% of the complexity: `DiagnosticsWindow.tsx` (8,286), `useDebateStore.ts` (7,376), and `DebateWorkspace.tsx` (4,007). This plan decomposes them into ~48 bounded modules averaging 300–800 lines each, organized into feature-scoped directories with barrel exports. The migration is sequenced into 6 phases, each independently shippable.

---

## 0. Target Directory Structure

Each major feature area gets its own directory. The public interface is the barrel `index.ts`; internals are private to the folder. Existing imports keep working because directory `index.ts` re-exports everything the old single file exported.

```
renderer/
├── components/
│   ├── debate-workspace/
│   │   ├── index.ts                    # exports DebateWorkspace
│   │   ├── DebateWorkspace.tsx          # shell (~500 lines)
│   │   ├── StatementCard.tsx
│   │   ├── ClarificationPanel.tsx
│   │   ├── OpeningPanel.tsx
│   │   ├── DebateActionBar.tsx
│   │   ├── ClaimsView.tsx
│   │   ├── VocabularyPanel.tsx
│   │   ├── TaxonomyRefs.tsx
│   │   ├── TopicCritique/
│   │   │   ├── index.ts
│   │   │   ├── TopicCritiqueCard.tsx
│   │   │   ├── CritiqueColumn.tsx
│   │   │   └── RadarChart.tsx
│   │   └── utils.ts                    # speaker helpers, markdown, find-in-page
│   │
│   ├── debate-diagnostics/
│   │   ├── index.ts                    # re-exports window, panel, chat barrels
│   │   ├── window/
│   │   │   ├── index.ts                # exports DiagnosticsWindow
│   │   │   ├── DiagnosticsWindow.tsx    # shell (~400 lines)
│   │   │   ├── useDiagnosticsState.ts   # 18 useState hooks + effects + keyboard nav
│   │   │   ├── OverviewTabRouter.tsx
│   │   │   ├── EntryDetailRouter.tsx
│   │   │   ├── overview-tabs/
│   │   │   │   ├── ArgumentNetworkTab.tsx
│   │   │   │   ├── AdaptiveStagingTab.tsx
│   │   │   │   ├── ReflectionsTab.tsx
│   │   │   │   └── UtilityTab.tsx
│   │   │   ├── entry-tabs/
│   │   │   │   ├── DraftTab.tsx
│   │   │   │   ├── ClaimsTab.tsx
│   │   │   │   ├── EvidenceTab.tsx
│   │   │   │   └── CitationsTab.tsx
│   │   │   └── shared/
│   │   │       ├── ScoreBreakdown.tsx
│   │   │       ├── TurnValidation.tsx
│   │   │       ├── EdgesUsed.tsx
│   │   │       ├── CommitmentsPanel.tsx
│   │   │       ├── INodeRow.tsx
│   │   │       ├── ModeratorTab.tsx
│   │   │       ├── HelpContent.tsx
│   │   │       └── constants.ts
│   │   ├── panel/
│   │   │   ├── index.ts                # exports DiagnosticsPanel
│   │   │   ├── DiagnosticsPanel.tsx     # shell (~200 lines)
│   │   │   ├── EntryView.tsx
│   │   │   ├── WhatIfSection.tsx
│   │   │   ├── DocumentCoverageSection.tsx
│   │   │   └── VerificationSection.tsx
│   │   └── chat/
│   │       ├── index.ts
│   │       └── DiagnosticsChatSidebar.tsx   # stays as-is (1,078 lines)
│   │
│   └── ... (existing standalone components stay as flat files)
│
├── hooks/
│   ├── useDebateStore/
│   │   ├── index.ts                    # exports useDebateStore + selectors
│   │   ├── store.ts                    # composition root (~150 lines)
│   │   ├── types.ts                    # DebateStore type (union of slices)
│   │   ├── helpers.ts                  # shared helpers, prompt builders
│   │   └── slices/
│   │       ├── sessionSlice.ts
│   │       ├── configSlice.ts
│   │       ├── topicCritiqueSlice.ts
│   │       ├── clarificationSlice.ts
│   │       ├── debateLoopSlice.ts
│   │       ├── synthesisSlice.ts
│   │       └── argumentNetworkSlice.ts
│   │
│   ├── useTaxonomyStore/
│   │   ├── index.ts                    # exports useTaxonomyStore + selectors
│   │   ├── store.ts
│   │   ├── types.ts
│   │   └── slices/
│   │       ├── taxonomyDataSlice.ts
│   │       ├── searchSlice.ts
│   │       ├── analysisSlice.ts
│   │       └── settingsSlice.ts
│   │
│   └── ... (other hooks stay as flat files)
```

**Import convention**: Always import from the barrel (`index.ts`), never from internals. Existing imports like `import { useTaxonomyStore } from '../hooks/useTaxonomyStore'` resolve to the directory's `index.ts` automatically — zero breaking changes.

---

## 1. Component Inventory & Current State

### File Size Summary

| File | Lines | Internal Components | Concern |
|------|------:|--------------------:|---------|
| `DiagnosticsWindow.tsx` | 8,286 | 22 + 6,155-line main | 14 overview tabs, 11 entry tabs, search, AN viz |
| `useDebateStore.ts` | 7,376 | 0 (1 store) | Debate CRUD, streaming, 8 debate phases, AN management |
| `DebateWorkspace.tsx` | 4,007 | 35 | Debate UI shell, statement cards, phase action bars |
| `DiagnosticsPanel.tsx` | 2,262 | 12 | Entry-level diagnostics, QBAF, what-if, coverage, verification |
| `useTaxonomyStore.ts` | 2,226 | 0 (1 store) | Taxonomy CRUD, search, AI analysis, settings |
| `DiagnosticsChatSidebar.tsx` | 1,078 | 15 | Chat-with-diagnostics, slash commands, session persistence |

### Dependency Map (High-Level)

```
DebateWorkspace ──reads──▶ useDebateStore ──reads──▶ useTaxonomyStore
       │                        │
       │ opens                  │ saves via
       ▼                        ▼
DiagnosticsWindow          api (bridge)
       │
       │ embeds
       ▼
DiagnosticsPanel
DiagnosticsChatSidebar
```

### Key Coupling Points

1. **useDebateStore ↔ useTaxonomyStore**: Reflections phase mutates taxonomy nodes via cross-store calls
2. **DebateWorkspace ↔ useDebateStore**: 35 components read from 1 store; phase routing depends on `activeDebate.phase`
3. **DiagnosticsWindow ↔ useDebateStore**: Reads `activeDebate` via IPC broadcast, not direct store access
4. **DiagnosticsPanel ↔ useDebateStore**: Direct store subscription for real-time AN/QBAF updates

---

## 2. Proposed Component Boundaries

### 2.1 DiagnosticsWindow.tsx → 12 modules (→ `debate-diagnostics/window/`)

The main component (6,155 lines) is almost entirely inline conditional JSX — no internal component definitions. It renders 14 overview tabs and 11 entry detail tabs. Each tab is self-contained.

| Proposed Module | Source Lines | Target Size | Responsibility |
|----------------|------------:|------------:|----------------|
| `window/DiagnosticsWindow.tsx` (shell) | — | ~400 | Layout, tab routing, search context, IPC |
| `window/useDiagnosticsState.ts` | 2133–2530 | ~400 | 18 useState hooks + effects + keyboard nav |
| `window/OverviewTabRouter.tsx` | 2573–3900 | ~200 | Switch on `effectiveOverviewTab`, delegates to tab components |
| `window/overview-tabs/ArgumentNetworkTab.tsx` | 3278–3536 | ~300 | AN visualization, QBAF, node filtering, moderator trace interleave |
| `window/overview-tabs/AdaptiveStagingTab.tsx` | 3007–3161 | ~200 | Phase transition timeline, signal history |
| `window/overview-tabs/ReflectionsTab.tsx` | 3161–3278 | ~150 | Post-debate reflection display |
| `window/overview-tabs/UtilityTab.tsx` | 3759–3900 | ~200 | Per-turn agent utility scores |
| `window/EntryDetailRouter.tsx` | 3902–4300 | ~200 | Tab header + switch on `activeTab` |
| `window/entry-tabs/DraftTab.tsx` | 5583–6608 | ~1,000 | Draft pipeline stages, hints, intervention tracking |
| `window/entry-tabs/ClaimsTab.tsx` | 7274–7570 | ~300 | Extracted claims with AN nodes, expand/collapse |
| `window/entry-tabs/EvidenceTab.tsx` | 7569–7978 | ~400 | Evidence items, QBAF edges, web search results |
| `window/entry-tabs/CitationsTab.tsx` | 7978–8220 | ~250 | Citation resolution, fabrication detection, scrub diff |

**Already-extracted components** (stay as-is): `ExtractionTimelinePanel`, `ConvergenceSignalsPanel`, `TaxonomyRefDetail`, `TaxonomyGapPanel`, `GroundingPanel`, `PovProgressionView`, `PromptDiffContent`.

**Pre-main helpers** (lines 55–2131): Already well-structured as 22 small components. Extract into `debate-diagnostics/window/shared/`:
- `window/shared/ScoreBreakdown.tsx` — validation scoring (lines 113–207)
- `window/shared/TurnValidation.tsx` — validation trail (lines 223–441)
- `window/shared/EdgesUsed.tsx` — taxonomy edge groups (lines 507–698)
- `window/shared/CommitmentsPanel.tsx` — commitment visualization (lines 699–903)
- `window/shared/INodeRow.tsx` — AN node row (lines 1822–2125)
- `window/shared/ModeratorTab.tsx` — moderator trace (lines 1478–1736)
- `window/shared/constants.ts` — color maps, tooltips, dimension weights
- `window/shared/HelpContent.tsx` — built-in help (lines 904–1111)

### 2.2 useDebateStore.ts → 8 slices

The store has natural phase boundaries. The proposed slicing uses Zustand's `StateCreator` pattern where each slice is a function that returns its own state + actions, composed via `create((...a) => ({ ...sliceA(...a), ...sliceB(...a) }))`.

| Proposed Slice | Source Lines | Target Size | Responsibility |
|---------------|------------:|------------:|----------------|
| `useDebateStore.ts` (composition root) | — | ~150 | Imports slices, composes store, subscriptions |
| `slices/sessionSlice.ts` | 2631–3235 | ~600 | Session CRUD, load/save, debate creation, deletion |
| `slices/configSlice.ts` | 2639–2740 | ~200 | responseLength, audience, temperature, model, diagnostics toggles |
| `slices/topicCritiqueSlice.ts` | 3236–3507 | ~300 | Structural scoring, lineage analysis, topic rewriting |
| `slices/clarificationSlice.ts` | 3509–4512 | ~500 | Clarification prompts, claim seeding, opening statements |
| `slices/debateLoopSlice.ts` | 4513–5720 | ~1,200 | askQuestion, crossRespond, moderator selection, adaptive staging |
| `slices/synthesisSlice.ts` | 5721–6650 | ~500 | Synthesis, probing, reflections, consensus, context compression |
| `slices/argumentNetworkSlice.ts` | 494–1673 | ~1,200 | Claim extraction, AN commit, invariant checks, QBAF scoring |
| `slices/helpers.ts` | 187–492, 1674–2512 | ~800 | Phase-safe helpers, prompt builders, taxonomy context, node lookup |

**Tightly coupled pairs** (don't separate):
- `debateLoopSlice` ↔ `argumentNetworkSlice` (crossRespond triggers claim extraction)
- `synthesisSlice` ↔ `useTaxonomyStore` (reflections mutate taxonomy)

**Communication pattern**: Slices access shared state via `get()` (Zustand's getter). No events or callbacks needed — Zustand's `create` composition gives all slices access to the full state tree. This is the standard pattern for Zustand slice decomposition.

### 2.3 DebateWorkspace.tsx → 10 modules

The file contains 35 internal components. Most are self-contained with clear boundaries.

| Proposed Module | Source Lines | Target Size | Responsibility |
|----------------|------------:|------------:|----------------|
| `DebateWorkspace.tsx` (shell) | 3447–4008 | ~500 | Root layout, phase routing, auto-save, keyboard handlers |
| `StatementCard.tsx` | 1336–1624 | ~300 | Main debate statement with tier system, reasoning, BDI |
| `TopicCritique/` (folder) | 2117–2486 | ~400 | RadarChart, CritiqueColumn, TopicCritiqueCard |
| `ClarificationPanel.tsx` | 2489–2798 | ~300 | Q&A phase, structured questions, topic refinement |
| `OpeningPanel.tsx` | 2801–2894 | ~100 | Opening statement input, POVer status |
| `DebateActionBar.tsx` | 2897–3237 | ~350 | Main debate input, @mentions, cross-respond, synthesis triggers |
| `ClaimsView.tsx` | 287–606 | ~300 | AN node rows per statement, argument visualization |
| `VocabularyPanel.tsx` | 384–557 | ~200 | Lineage terms, vocabulary resolution |
| `TaxonomyRefs.tsx` | 611–1000 | ~400 | TaxonomyPill, CoverageBadge, TaxonomyRefsSection |
| `debate-utils.ts` | 152–285, 1123–1297 | ~250 | Speaker helpers, find-in-page, markdown utils |

### 2.4 DiagnosticsPanel.tsx → 5 modules (→ `debate-diagnostics/panel/`)

Already reasonably structured internally; 12 components in 2,262 lines.

| Proposed Module | Source Lines | Target Size | Responsibility |
|----------------|------------:|------------:|----------------|
| `panel/DiagnosticsPanel.tsx` (shell) | 2167–2262 | ~200 | Layout, entry/overview routing |
| `panel/EntryView.tsx` | 174–965 | ~800 | Per-entry diagnostics detail (largest section) |
| `panel/WhatIfSection.tsx` | 1097–1240 | ~150 | Counterfactual QBAF propagation |
| `panel/DocumentCoverageSection.tsx` | 1242–1319 | ~100 | Per-claim coverage status |
| `panel/VerificationSection.tsx` | 1975–2167 | ~200 | Fact-check results grouped by verdict |

### 2.5 useTaxonomyStore.ts → 4 slices

| Proposed Slice | Target Size | Responsibility |
|---------------|------------:|----------------|
| `useTaxonomyStore.ts` (composition root) | ~100 | Compose slices |
| `slices/taxonomyDataSlice.ts` | ~600 | loadAll, CRUD for POV nodes, situations, conflicts, edges |
| `slices/searchSlice.ts` | ~500 | Text search, semantic search, similar search, attribute filter |
| `slices/analysisSlice.ts` | ~400 | AI analysis, critique, cluster view, conflict clusters |
| `slices/settingsSlice.ts` | ~300 | Theme, AI backend, model, pane spacing, QBAF toggle |

### 2.6 DiagnosticsChatSidebar.tsx — No Split Needed (→ `debate-diagnostics/chat/`)

At 1,078 lines with 15 well-defined internal functions, this file is already at a reasonable size and well-isolated. Moves into `debate-diagnostics/chat/` for role alignment but no internal decomposition needed.

---

## 3. Interface Contracts

### 3.1 DiagnosticsWindow Tab Interface

Every tab component follows the same contract:

```typescript
interface OverviewTabProps {
  debate: DebateSession;
  searchQuery: string;
  onSelectEntry: (entryId: string) => void;
}

interface EntryDetailTabProps {
  entry: TranscriptEntry;
  diag: EntryDiagnostics | undefined;
  meta: Record<string, unknown>;
  debate: DebateSession;
  searchQuery: string;
}
```

### 3.2 Zustand Slice Interface (useDebateStore)

Each slice exports a `StateCreator` function:

```typescript
// Example: slices/configSlice.ts
import type { StateCreator } from 'zustand';
import type { DebateStore } from '../types';

export interface ConfigSlice {
  responseLength: ResponseLength;
  audience: DebateAudience;
  debateModel: string | null;
  debateTemperature: number | null;
  setResponseLength: (rl: ResponseLength) => void;
  setAudience: (a: DebateAudience) => void;
  // ...
}

export const createConfigSlice: StateCreator<DebateStore, [], [], ConfigSlice> = (set, get) => ({
  responseLength: 'brief',
  audience: 'policymakers',
  // ...actions...
});
```

Composition root:

```typescript
// useDebateStore.ts
export const useDebateStore = create<DebateStore>()((...a) => ({
  ...createSessionSlice(...a),
  ...createConfigSlice(...a),
  ...createDebateLoopSlice(...a),
  // ...
}));
```

### 3.3 DebateWorkspace Phase Action Bars

Each phase panel follows:

```typescript
interface PhaseActionProps {
  debate: DebateSession;
  generating: SpeakerId | null;
  disabled: boolean;
}

// ClarificationPanel, OpeningPanel, DebateActionBar all implement this pattern
```

### 3.4 StatementCard Interface

```typescript
interface StatementCardProps {
  entry: TranscriptEntry;
  debate: DebateSession;
  searchQuery: string;
  responseLength: ResponseLength;
  onContextMenu: (e: React.MouseEvent, entryId: string) => void;
  onSelectDiag: (entryId: string) => void;
}
```

---

## 4. Migration Sequence

Each phase is independently shippable. Tests must pass at every step.

### Test Discipline

Every extracted module gets a co-located unit test file. The test directory structure mirrors the source:

```
renderer/
├── components/
│   ├── debate-workspace/
│   │   ├── __tests__/
│   │   │   ├── StatementCard.test.tsx
│   │   │   ├── ClarificationPanel.test.tsx
│   │   │   ├── ClaimsView.test.tsx
│   │   │   ├── VocabularyPanel.test.tsx
│   │   │   ├── TaxonomyRefs.test.tsx
│   │   │   └── utils.test.ts
│   │   └── TopicCritique/__tests__/TopicCritiqueCard.test.tsx
│   ├── debate-diagnostics/
│   │   ├── window/__tests__/
│   │   │   ├── useDiagnosticsState.test.ts
│   │   │   ├── OverviewTabRouter.test.tsx
│   │   │   └── EntryDetailRouter.test.tsx
│   │   ├── window/overview-tabs/__tests__/
│   │   ├── window/entry-tabs/__tests__/
│   │   ├── window/shared/__tests__/
│   │   ├── panel/__tests__/
│   │   │   ├── EntryView.test.tsx
│   │   │   ├── WhatIfSection.test.tsx
│   │   │   └── VerificationSection.test.tsx
│   │   └── chat/__tests__/DiagnosticsChatSidebar.test.tsx
├── hooks/
│   ├── useDebateStore/__tests__/
│   │   ├── sessionSlice.test.ts
│   │   ├── configSlice.test.ts
│   │   ├── topicCritiqueSlice.test.ts
│   │   ├── clarificationSlice.test.ts
│   │   ├── debateLoopSlice.test.ts
│   │   ├── synthesisSlice.test.ts
│   │   ├── argumentNetworkSlice.test.ts
│   │   └── helpers.test.ts
│   └── useTaxonomyStore/__tests__/
│       ├── taxonomyDataSlice.test.ts
│       ├── searchSlice.test.ts
│       ├── analysisSlice.test.ts
│       └── settingsSlice.test.ts
```

**Rule**: No module extraction is considered done until its unit test file exists and passes. Tests cover: props contract (renders with expected props), key interactions (click/change handlers), conditional rendering branches, and error states.

**GUI regression gate**: After each phase, run the smoke test + module-specific GUI tests from `docs/design/taxonomy-editor-test-strategy.md` using the Electron MCP server via CDP. Visual baselines are compared with < 1% diff threshold.

### Phase 1: Create Directory Scaffolding + Low-Risk Extractions
**Risk: Low | Merge conflict risk: Low | Estimated size: ~15 files**

1. Create directory scaffolding with barrel `index.ts` files:
   - `components/debate-workspace/` — re-exports `DebateWorkspace`
   - `components/debate-diagnostics/` — top-level barrel re-exporting `window/`, `panel/`, `chat/`
   - `components/debate-diagnostics/window/` — re-exports `DiagnosticsWindow`
   - `components/debate-diagnostics/panel/` — re-exports `DiagnosticsPanel`
   - `components/debate-diagnostics/chat/` — re-exports `DiagnosticsChatSidebar`
   - Move existing monolith files into their directories, update barrel exports
   - Verify all existing imports resolve (directory `index.ts` is transparent to importers)

2. Extract `debate-workspace/` self-contained components:
   - `debate-workspace/TopicCritique/` folder (RadarChart, CritiqueColumn, TopicCritiqueCard)
   - `debate-workspace/ClaimsView.tsx` (ClaimNodeRow + ClaimsView)
   - `debate-workspace/VocabularyPanel.tsx` (LineageTermsView, VocabTermCard, VocabTermsView)
   - `debate-workspace/utils.ts` (speaker helpers, markdown utils, find-in-page)

3. Extract `debate-diagnostics/window/shared/` components:
   - `window/shared/ScoreBreakdown.tsx`
   - `window/shared/TurnValidation.tsx`
   - `window/shared/EdgesUsed.tsx`
   - `window/shared/CommitmentsPanel.tsx`
   - `window/shared/INodeRow.tsx`
   - `window/shared/constants.ts`

4. Extract `debate-diagnostics/panel/` self-contained sections:
   - `panel/WhatIfSection.tsx`
   - `panel/DocumentCoverageSection.tsx`
   - `panel/VerificationSection.tsx`

**Unit tests to create**:
- `debate-workspace/__tests__/ClaimsView.test.tsx` — renders claim nodes, expand/collapse
- `debate-workspace/__tests__/VocabularyPanel.test.tsx` — renders lineage terms
- `debate-workspace/__tests__/utils.test.ts` — speaker helpers, markdown utils
- `debate-workspace/TopicCritique/__tests__/TopicCritiqueCard.test.tsx` — radar chart renders, critique columns
- `debate-diagnostics/window/shared/__tests__/ScoreBreakdown.test.tsx` — score rendering with various inputs
- `debate-diagnostics/window/shared/__tests__/CommitmentsPanel.test.tsx` — commitment visualization
- `debate-diagnostics/panel/__tests__/WhatIfSection.test.tsx` — counterfactual toggle
- `debate-diagnostics/panel/__tests__/VerificationSection.test.tsx` — verdict grouping

**Validation**: Run `npm test` + `npx tsc --noEmit`. All new unit tests pass. GUI smoke tests S1-S10 pass. No behavioral changes — pure file moves + imports.

### Phase 2: DiagnosticsWindow Tab Extraction
**Risk: Low-Medium | Merge conflict risk: Medium (large file changes)**

5. Create `debate-diagnostics/window/useDiagnosticsState.ts` custom hook (extract 18 useState + effects)
6. Create `debate-diagnostics/window/OverviewTabRouter.tsx` + extract to `window/overview-tabs/`:
   - `window/overview-tabs/ArgumentNetworkTab.tsx` (largest, most complex)
   - `window/overview-tabs/AdaptiveStagingTab.tsx`
   - `window/overview-tabs/ReflectionsTab.tsx`
   - `window/overview-tabs/UtilityTab.tsx`
7. Create `debate-diagnostics/window/EntryDetailRouter.tsx` + extract to `window/entry-tabs/`:
   - `window/entry-tabs/DraftTab.tsx`
   - `window/entry-tabs/ClaimsTab.tsx`
   - `window/entry-tabs/EvidenceTab.tsx`
   - `window/entry-tabs/CitationsTab.tsx`

**Unit tests to create**:
- `debate-diagnostics/window/__tests__/useDiagnosticsState.test.ts` — hook state initialization, keyboard nav
- `debate-diagnostics/window/__tests__/OverviewTabRouter.test.tsx` — routes to correct tab component
- `debate-diagnostics/window/__tests__/EntryDetailRouter.test.tsx` — routes to correct detail tab
- `debate-diagnostics/window/overview-tabs/__tests__/ArgumentNetworkTab.test.tsx` — AN visualization, node filtering
- `debate-diagnostics/window/overview-tabs/__tests__/AdaptiveStagingTab.test.tsx` — timeline renders
- `debate-diagnostics/window/entry-tabs/__tests__/DraftTab.test.tsx` — pipeline stages render
- `debate-diagnostics/window/entry-tabs/__tests__/ClaimsTab.test.tsx` — claims expand/collapse
- `debate-diagnostics/window/entry-tabs/__tests__/EvidenceTab.test.tsx` — evidence items + QBAF
- `debate-diagnostics/window/entry-tabs/__tests__/CitationsTab.test.tsx` — citation resolution display

**Validation**: All new unit tests pass. GUI tests DDW1-DDW13 pass. Open diagnostics window, verify all 14 overview tabs + 11 entry tabs render correctly. Run full test suite.

### Phase 3: DebateWorkspace Action Bar Extraction
**Risk: Medium | Merge conflict risk: Medium**

8. Extract into `debate-workspace/`:
   - `StatementCard.tsx`
   - `ClarificationPanel.tsx`
   - `OpeningPanel.tsx`
   - `DebateActionBar.tsx`
   - `TaxonomyRefs.tsx` (TaxonomyPill + CoverageBadge + TaxonomyRefsSection)

**Unit tests to create**:
- `debate-workspace/__tests__/StatementCard.test.tsx` — renders speaker, content, model badge, tier system
- `debate-workspace/__tests__/ClarificationPanel.test.tsx` — question rendering, answer submission
- `debate-workspace/__tests__/OpeningPanel.test.tsx` — POV opener display
- `debate-workspace/__tests__/DebateActionBar.test.tsx` — @mention autocomplete, submit handlers
- `debate-workspace/__tests__/TaxonomyRefs.test.tsx` — pill rendering, coverage badge, POV colors

**Validation**: All new unit tests pass. GUI tests DW1-DW10 pass. Run a full debate cycle (clarification → opening → debate → synthesis). Verify all phase transitions, @mentions, cross-respond work.

### Phase 4: useTaxonomyStore Slicing
**Risk: Medium | Merge conflict risk: Low (isolated store)**

9. Create `hooks/useTaxonomyStore/` directory:
   - `types.ts` — define `TaxonomyStore` type (union of all slice types)
   - `slices/settingsSlice.ts` (simplest, most isolated)
   - `slices/searchSlice.ts`
   - `slices/analysisSlice.ts`
   - `slices/taxonomyDataSlice.ts`
   - `store.ts` — compose slices
   - `index.ts` — barrel re-export (preserves existing import paths)

**Unit tests to create**:
- `useTaxonomyStore/__tests__/settingsSlice.test.ts` — theme, backend, model, pane spacing get/set
- `useTaxonomyStore/__tests__/searchSlice.test.ts` — text search, semantic search, attribute filter
- `useTaxonomyStore/__tests__/analysisSlice.test.ts` — AI analysis trigger, cluster view
- `useTaxonomyStore/__tests__/taxonomyDataSlice.test.ts` — loadAll, CRUD for POV nodes, edges

**Validation**: All new unit tests pass. GUI tests TS1-TS4 pass. Full app test — taxonomy CRUD, search, AI analysis, settings persistence. Verify no selector breakage.

### Phase 5: useDebateStore Slicing (Highest Risk)
**Risk: High | Merge conflict risk: High (most-edited file)**

10. Create `hooks/useDebateStore/` directory:
   - `types.ts` — define `DebateStore` type (union of all slice types)
   - `slices/configSlice.ts` (simplest)
   - `slices/sessionSlice.ts`
   - `slices/topicCritiqueSlice.ts`
   - `slices/clarificationSlice.ts`
   - `slices/argumentNetworkSlice.ts`
   - `slices/synthesisSlice.ts`
   - `slices/debateLoopSlice.ts` (last — largest, most coupled)
   - `helpers.ts` — shared prompt builders, taxonomy context, node lookup
   - `store.ts` — compose slices
   - `index.ts` — barrel re-export (preserves existing import paths)

**Unit tests to create**:
- `useDebateStore/__tests__/configSlice.test.ts` — responseLength, audience, temperature, model
- `useDebateStore/__tests__/sessionSlice.test.ts` — create, load, save, delete debates
- `useDebateStore/__tests__/topicCritiqueSlice.test.ts` — structural scoring, lineage analysis
- `useDebateStore/__tests__/clarificationSlice.test.ts` — prompts, claim seeding, opening statements
- `useDebateStore/__tests__/debateLoopSlice.test.ts` — askQuestion, crossRespond, moderator selection
- `useDebateStore/__tests__/synthesisSlice.test.ts` — synthesis, probing, reflections, consensus
- `useDebateStore/__tests__/argumentNetworkSlice.test.ts` — claim extraction, AN commit, QBAF scoring
- `useDebateStore/__tests__/helpers.test.ts` — prompt builders, taxonomy context, node lookup

**Validation**: All new unit tests pass. GUI tests DS1-DS7 pass. Full regression test. Run a complete debate end-to-end. Verify: debate creation, clarification, opening, cross-respond with adaptive staging, gap injection, synthesis, reflections, consensus. Check flight recorder for errors.

### Phase 6: DiagnosticsPanel EntryView Extraction
**Risk: Low | Merge conflict risk: Low**

11. Extract `debate-diagnostics/panel/EntryView.tsx` (~800 lines — the last large inline component)

**Unit tests to create**:
- `debate-diagnostics/panel/__tests__/EntryView.test.tsx` — per-entry diagnostics rendering, all sub-sections

**Validation**: All new unit tests pass. GUI tests DDP1-DDP5 pass. Open diagnostics, select entries, verify all entry-level diagnostics render.

---

## 5. Risk Assessment

### Safe Extractions (Pure UI Splits)
- All Phase 1 items — moving self-contained render functions to their own files
- DiagnosticsWindow tab extractions (Phase 2) — each tab is a conditional block with no side effects
- DebateWorkspace component extractions (Phase 3) — components already have clear props boundaries

### Medium Risk
- `useTaxonomyStore` slicing (Phase 4) — the store is moderately coupled but slices are identifiable. Main risk is selector breakage if slice boundaries split state that a component reads atomically.
- `DebateWorkspace.StatementCard` extraction — used in a `map()` with closure over parent state; needs careful props definition.

### High Risk
- `useDebateStore` slicing (Phase 5) — this is the core state machine. Key risks:
  - `crossRespond` (1,200 lines) touches state across multiple proposed slices
  - Module-level caches (`_doctrinalAnchoringApplied`, `_signalHistory`, `_gapInjectionCount`, `_neutralMapping`) must stay accessible to the slices that use them
  - Fire-and-forget async operations (claim extraction, neutral evaluation) reference `get()` after awaits — must verify state consistency
  - `extractClaimsAndUpdateAN` is a 1,180-line helper called from multiple slices — extract to shared `helpers.ts` that all slices import

### Test Coverage Gaps to Fill Before Refactoring
- `DiagnosticsWindow` has **zero test coverage** — add snapshot tests for each tab before extracting
- `DebateWorkspace` has no direct tests (only through `useDebateStore.test.ts`) — add component render tests for phase routing
- `useTaxonomyStore` has no dedicated test file — add tests for search, CRUD, and settings before slicing

---

## 6. Validation Against Recent Features

### t/408 (Multi-Provider Debate Mode)
This feature touched 4 files: `NewDebateDialog.tsx`, `useDebateStore.ts`, `DebateWorkspace.tsx`, `DebateTab.tsx`.

**With proposed boundaries**: The changes would have been scoped to:
- `configSlice.ts` (new `speakerModels`/`modelTier` state)
- `sessionSlice.ts` (thread config through `createDebate`)
- `StatementCard.tsx` (model badge)
- No changes to `debateLoopSlice.ts` — `resolveModelForSpeaker()` is in the engine, not the store

**Verdict**: Cleaner. Developer modifying model config wouldn't need to understand the debate loop.

### t/385 (Claims Tab Auto-Expand + Raw Prompt/Response)
This touched `DiagnosticsWindow.tsx` — a single 8,286-line file where the agent got lost and cited wrong line numbers.

**With proposed boundaries**: The fix would target:
- `ClaimsTab.tsx` (~300 lines) — add `open` attribute to `<details>` elements
- `DraftTab.tsx` (~1,000 lines) — raw prompt/response section

**Verdict**: Dramatically simpler. Agent would have had a 300-line file instead of 8,286. The wrong-line-number problem (t/385#2) was directly caused by file size.

---

## 7. Target State Summary

| Current File | Lines | → | Target Directory | Files | Avg Lines/File |
|-------------|------:|---|-----------------|------:|--------------:|
| `DiagnosticsWindow.tsx` | 8,286 | → | `components/debate-diagnostics/window/` | 20 | ~415 |
| `useDebateStore.ts` | 7,376 | → | `hooks/useDebateStore/` | 10 | ~740 |
| `DebateWorkspace.tsx` | 4,007 | → | `components/debate-workspace/` | 13 | ~310 |
| `DiagnosticsPanel.tsx` | 2,262 | → | `components/debate-diagnostics/panel/` | 6 | ~375 |
| `useTaxonomyStore.ts` | 2,226 | → | `hooks/useTaxonomyStore/` | 7 | ~320 |
| `DiagnosticsChatSidebar.tsx` | 1,078 | → | `components/debate-diagnostics/chat/` | 2 | ~540 |
| **Total** | **25,235** | | **5 directories** (debate-diagnostics unified) | **~58 files** | **~435** |

No line is deleted — this is a reorganization, not a rewrite. Each module averages ~435 lines (range: 100–1,200). A developer working on any single feature touches 1–3 files within one directory instead of navigating a monolith.

**Import stability**: Every directory has an `index.ts` barrel that re-exports the same symbols the original file exported. Existing `import { X } from '../hooks/useTaxonomyStore'` resolves to the directory's `index.ts` — zero changes needed in consuming files.
