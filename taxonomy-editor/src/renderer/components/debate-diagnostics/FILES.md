# DebateDiagnostics — File Inventory

Directory map for `taxonomy-editor/src/renderer/components/debate-diagnostics/`. Reference only — behavioral norms live in `AGENTS.md`.

```
debate-diagnostics/
├── index.ts                    # Barrel re-exports from all subdirectories
├── window/                     # Detached diagnostics window
│   ├── DiagnosticsWindow.tsx   # Window shell, tab sidebar, header
│   ├── EntryDetailRouter.tsx   # Per-entry tab routing (details, claims, draft, etc.)
│   ├── OverviewTabRouter.tsx   # Overview tab routing (AN, transcript, convergence, etc.)
│   ├── useDiagnosticsState.ts  # Central state hook (IPC receive, taxonomy data, search)
│   ├── helpers.tsx             # Copy button, shared formatting
│   ├── types.ts                # OverviewTab, EntryTab, UtilitySnapshot types
│   ├── entry-tabs/             # Per-turn detail tabs (12 files)
│   │   ├── BriefTab.tsx        # Brief-stage diagnostics
│   │   ├── CitationsTab.tsx    # Source citation details
│   │   ├── CiteTab.tsx         # Cite-stage diagnostics
│   │   ├── ClaimsTab.tsx       # Extracted claims breakdown
│   │   ├── DetailsTab.tsx      # Turn metadata, suppressed interventions
│   │   ├── DraftTab.tsx        # Draft-stage diagnostics (largest: ~1100 lines)
│   │   ├── EvidenceTab.tsx     # Evidence and grounding
│   │   ├── ExclusionGuardTab.tsx # Exclusion guard decisions
│   │   ├── LookaheadTab.tsx    # Lookahead reasoning
│   │   ├── PlanTab.tsx         # Plan-stage diagnostics
│   │   └── TaxRefsTab.tsx      # Taxonomy reference detail
│   ├── overview-tabs/          # Debate-level overview tabs (4 files)
│   │   ├── AdaptiveStagingTab.tsx  # Phase progression, pacing
│   │   ├── ArgumentNetworkTab.tsx  # QBAF argument network view
│   │   ├── ReflectionsTab.tsx      # Agent reflection summaries
│   │   └── UtilityTab.tsx          # Per-turn utility scores
│   └── shared/                 # Reusable sub-components (9 files)
│       ├── CommitmentsPanel.tsx # Commitment tracking display
│       ├── constants.ts        # Speaker colors, layout constants
│       ├── DebateExchangeRich.tsx # Rich transcript entry rendering
│       ├── EdgesUsed.tsx       # Edge reference display
│       ├── INodeRow.tsx        # Argument network node row (~410 lines)
│       ├── ModeratorTab.tsx    # Moderator deliberation view
│       ├── ScoreBreakdown.tsx  # QBAF score visualization
│       ├── TensionsListDetail.tsx # Tension/disagreement detail
│       └── TurnValidation.tsx  # Turn validation trail display
├── panel/                      # Inline diagnostics panel
│   ├── DiagnosticsPanel.tsx    # Panel wrapper, resize, popout button
│   ├── EntryView.tsx           # Per-entry detail view (~1000 lines)
│   ├── OverviewView.tsx        # Overview sections (~1000 lines)
│   ├── DocumentCoverageSection.tsx
│   ├── VerificationSection.tsx
│   ├── WhatIfSection.tsx
│   └── helpers.tsx             # Copy button, speaker label helper
└── chat/                       # Chat sidebar for diagnostics queries
    └── DiagnosticsChatSidebar.tsx  # AI chat interface (~1080 lines)
```
