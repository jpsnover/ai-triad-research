# Taxonomy Editor — File Inventory

Reference inventory for the Taxonomy Editor role: the directory map and the feature
catalog this role owns. Relocated from `AGENTS.md` (t/1737, Phase 2 of the
role-instruction audit t/1731) so the always-on instructions stay lean — behavioral
norms remain in `AGENTS.md`. This map is **descriptive, not a routing gate**:
`resolve_owner` is authoritative for ownership/routing.

## Key Directories

```
taxonomy-editor/
├── src/main/                           # Owned by ElectronMain child role
│   ├── main.ts, ipcHandlers.ts        # Electron main process
│   ├── preload.cts                    # Preload script
│   └── ...                            # fileIO, embeddings, modelDiscovery, etc.
├── src/server/                         # Owned by Server child role (~27 files)
│   ├── server.ts                      # Express app, routes, middleware
│   ├── sessionBranchManager.ts        # Per-user git branch management
│   └── ...                            # GitHub API, storage, auth, rate limiting
├── src/renderer/
│   ├── components/
│   │   ├── analysis/                  # Owned by Analysis child role (~17 files)
│   │   ├── edge-browser/              # Owned by EdgeBrowser child role (~8 files)
│   │   ├── debate-workspace/          # Owned by DebateWorkspace child role
│   │   ├── debate-diagnostics/        # Owned by DebateDiagnostics child role
│   │   ├── chat/                      # Owned by Chat child role (~13 files)
│   │   ├── debate/                    # Owned by DebateUI child role (~8 files)
│   │   ├── conflict/                  # Owned by Conflict child role (~4 files)
│   │   ├── taxonomy/                  # Node/tree/graph views
│   │   ├── policy/                    # Policy sources and phrases
│   │   ├── sync/                      # Owned by Sync child role (~5 files)
│   │   ├── settings/                  # Owned by Settings child role (~12 files)
│   │   ├── community/                 # Community sharing
│   │   ├── shared/                    # Reusable UI primitives and layout
│   │   └── PovProgression/            # POV progression views
│   ├── hooks/
│   │   ├── useDebateStore/            # Owned by DebateWorkspace child role
│   │   ├── useTaxonomyStore/          # Taxonomy state management
│   │   └── ...                        # Other hooks
│   ├── prompts/       # AI prompt template functions (NEVER inline prompts in components)
│   ├── types/         # TypeScript type definitions
│   ├── utils/         # Utility functions (taxonomyContext, formatters)
│   └── data/          # Static data
```

The child-role roster and routing note (which child owns what) live in `AGENTS.md`
alongside the routing behavior.

## Features You Own

- Taxonomy tree browsing and editing
- Edge Browser (AIF-aligned edge types)
- Multi-agent Debate (clarification → rounds → synthesis → harvest)
- POVer Chat (brainstorm / inform / decide modes)
- Node detail views (POV nodes + cross-cutting nodes)
- Fact-checking with web search (Gemini google_search tool)
- Description toggle (formal/plain vernacular descriptions)
- Runtime config admin panel (sections, tiers, dirty tracking)
- Feature flags (useFlag() hook, admin panel, server-driven flags)
- Health probe (baseline latency tracking, warm-up, grace period)
- Client network resilience (circuit breaker, adaptive throttle, retry)
- Admin review panel (paid key management, usage stats)
