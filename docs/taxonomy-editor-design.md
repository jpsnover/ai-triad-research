# Taxonomy Editor — High-Level Design

**Status:** Living document  
**Last updated:** 2026-05-01  
**Author:** Jeffrey Snover  
**Audience:** Engineers and contributors who need to understand the Taxonomy Editor's architecture, deployment model, and component interactions.

---

## 1. Problem Statement

The AI Triad taxonomy is a graph of ~320 interconnected claims. PowerShell cmdlets can query and modify individual nodes, but understanding how arguments relate requires visual exploration — seeing which claims support, contradict, and assume each other. Running debates requires real-time UI for monitoring turn-by-turn progress. Reviewing conflicts requires comparing source documents side-by-side with extracted claims.

The Taxonomy Editor provides an integrated visual workspace for these tasks: editing nodes, running debates, viewing argument graphs, managing conflicts, and orchestrating research workflows — all in a single application that works both as a desktop app and as a cloud-hosted web app.

## 2. Goals and Non-Goals

### Goals

- **G1:** Visual editing of taxonomy nodes, edges, and hierarchies
- **G2:** Integrated debate workspace with real-time turn-by-turn display
- **G3:** Argument graph visualization (QBAF networks from debates)
- **G4:** Run as both a native desktop app (Electron) and a containerized web app (Azure)
- **G5:** Support all research workflows that the PowerShell module supports, with a visual interface
- **G6:** Work with multiple AI backends configured through the UI

### Non-Goals

- **NG1:** Mobile support — desktop and web only
- **NG2:** Collaborative editing — single-operator model (same as the PowerShell module)
- **NG3:** Replacing the PowerShell module — the CLI remains the primary automation interface
- **NG4:** Offline-first — the app requires network access for AI operations

## 3. System Context

```
┌──────────────────────────────────────────────────────────────┐
│                        User                                   │
│                          │                                    │
│              ┌───────────┴───────────┐                       │
│              │    Taxonomy Editor    │                        │
│              │    (React 19 UI)      │                        │
│              └───────────┬───────────┘                        │
│                          │                                    │
│         ┌────────────────┼────────────────┐                  │
│         │                │                │                   │
│    ┌────┴─────┐    ┌────┴─────┐    ┌────┴─────┐            │
│    │ Electron │    │ Express  │    │ Shared   │             │
│    │ Main     │    │ Server   │    │ Libs     │             │
│    │ Process  │    │ (container│    │ (debate, │             │
│    │ (IPC)    │    │  mode)   │    │  dict,   │             │
│    │          │    │          │    │  types)  │             │
│    └────┬─────┘    └────┬─────┘    └──────────┘             │
│         │               │                                    │
│    ┌────┴───────────────┴────┐                              │
│    │   File System / Data    │                              │
│    │   (taxonomy, sources,   │                              │
│    │    debates, summaries)  │                              │
│    └─────────────────────────┘                              │
└──────────────────────────────────────────────────────────────┘
         │
         ▼ HTTP
    ┌────────────┐
    │ AI Backends│
    └────────────┘
```

## 4. Dual Deployment Architecture

The editor runs in two modes that share the same React UI but differ in how they access data and system resources:

### 4.1 Desktop Mode (Electron)

```
┌──────────────────────────────┐
│ Renderer Process (Chromium)  │
│ ┌──────────────────────────┐ │
│ │ React 19 + Zustand       │ │
│ │ (all UI components)      │ │
│ └────────────┬─────────────┘ │
│              │ IPC (invoke)   │
│ ┌────────────┴─────────────┐ │
│ │ Preload Script           │ │
│ │ (contextBridge)          │ │
│ └────────────┬─────────────┘ │
└──────────────┼───────────────┘
               │ ipcMain.handle()
┌──────────────┼───────────────┐
│ Main Process (Node.js)       │
│ ┌────────────┴─────────────┐ │
│ │ 100+ IPC Handlers        │ │
│ │ (file I/O, AI calls,     │ │
│ │  data queries, system)   │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

The renderer calls `window.api.methodName()` which the preload script bridges to `ipcRenderer.invoke('method-name')`, handled by `ipcMain.handle('method-name')` in the main process.

### 4.2 Container Mode (Web)

```
┌──────────────────────────────┐
│ Browser                      │
│ ┌──────────────────────────┐ │
│ │ React 19 + Zustand       │ │
│ │ (same UI components)     │ │
│ └────────────┬─────────────┘ │
│              │ HTTP/WS        │
└──────────────┼───────────────┘
               │
┌──────────────┼───────────────┐
│ Express Server (Node.js)     │
│ ┌────────────┴─────────────┐ │
│ │ API Routes               │ │
│ │ (same logic as IPC       │ │
│ │  handlers, HTTP-wrapped) │ │
│ ├──────────────────────────┤ │
│ │ Static File Serving      │ │
│ │ (Vite-built React bundle)│ │
│ ├──────────────────────────┤ │
│ │ WebSocket Server         │ │
│ │ (terminal, real-time)    │ │
│ └──────────────────────────┘ │
│ Port 7862 · User: aitriad   │
└──────────────────────────────┘
```

The React components use an abstraction layer (`api`) that calls Electron IPC in desktop mode or HTTP endpoints in container mode. The same component code runs in both contexts.

## 5. Component Architecture

### 5.1 Key Components

| Component | Purpose | Complexity |
|---|---|---|
| **DebateWorkspace** | Full debate lifecycle — setup through synthesis | High — manages 6 debate phases, moderator display, claims editor |
| **ClaimsEditor** | Review/edit/delete extracted document claims | Medium — inline editing, type badges, tension points |
| **ArgumentGraph** | QBAF network visualization | Medium — node/edge rendering with strength indicators |
| **ChatWorkspace** | Multi-turn chat grounded in taxonomy and debate state | Medium |
| **ConflictsTab** | Browse and review detected conflicts | Low |
| **AnalysisPanel** | Analytical outputs and metrics | Low |
| **DiagnosticsPanel** | Model discovery, embeddings, terminal | Medium — xterm.js integration |

### 5.2 DebateWorkspace Phase Routing

The DebateWorkspace renders different action bars and content based on the current debate phase:

```
phase === 'setup' || 'clarification'
  └─► ClarificationActions
      (Refine Topic / Skip to Debate buttons,
       clarification Q&A interface)

phase === 'edit-claims'
  └─► ClaimsEditor
      (claim list with type badges, inline edit,
       delete, tension points, proceed button)

phase === 'opening'
  └─► OpeningActions
      (generate opening statements button)

phase === 'debate'
  └─► DebateActions
      (next turn, moderator controls,
       convergence panel toggle)

phase === 'closed'
  └─► (synthesis display, export options)
```

## 6. State Management

### 6.1 Zustand Stores

The app uses Zustand for state management — lightweight stores with no boilerplate:

| Store | Responsibility | Key State |
|---|---|---|
| **useDebateStore** | Debate lifecycle, turn generation, moderator, network | `activeDebate`, `sessions`, `debateGenerating`, `vocabularyTerms` |
| **useTaxonomyStore** | Taxonomy CRUD, hierarchy, search | `accelerationist`, `safetyist`, `skeptic`, `situations`, `edges`, `policyRegistry` |
| Additional stores | UI state, settings, conflicts | Various |

### 6.2 useDebateStore

This is the most complex store — it reimplements the debate engine's orchestration logic for the reactive UI paradigm:

**Key actions:**

| Action | Purpose |
|---|---|
| `createDebate` | Initialize a new debate session with topic, participants, source |
| `beginDebate` | Run document analysis, transition to edit-claims or opening |
| `updateClaim` / `deleteClaim` | Edit extracted claims (edit-claims phase) |
| `proceedToOpening` | Transition from edit-claims to opening phase |
| `runOpeningStatements` | Generate opening statements for all characters |
| `runNextTurn` | Generate one debate round (character + moderator) |
| `runSynthesis` | Generate synthesis statements |

Each action updates Zustand state, which triggers React re-renders. Long-running operations set `debateGenerating` to the current speaker's POV ID, enabling loading indicators.

## 7. IPC Layer

100+ IPC methods organized by domain:

| Domain | Example Methods | Count |
|---|---|---|
| **Taxonomy** | `load-taxonomy`, `save-node`, `search-nodes`, `update-hierarchy` | ~25 |
| **Sources** | `list-sources`, `import-document`, `get-source-metadata` | ~15 |
| **Summaries** | `list-summaries`, `generate-summary`, `get-summary` | ~10 |
| **Debates** | `list-debates`, `save-debate`, `load-debate`, `export-debate` | ~15 |
| **AI** | `generate-text`, `list-models`, `check-api-key` | ~10 |
| **Conflicts** | `list-conflicts`, `get-conflict-details` | ~5 |
| **System** | `open-external`, `get-app-version`, `show-dialog` | ~10 |
| **Auth** | `get-user`, `login`, `logout` (container mode) | ~5 |
| **Terminal** | `pty-create`, `pty-write`, `pty-resize` (xterm.js) | ~5 |

In container mode, each IPC method maps to an Express route (`POST /api/method-name`).

## 8. Debate Integration

The Taxonomy Editor's debate experience differs from the CLI in important ways:

| Aspect | CLI (debateEngine.ts) | Editor (useDebateStore.ts) |
|---|---|---|
| **Execution** | Batch — runs to completion | Incremental — one turn at a time |
| **State** | In-memory DebateSession object | Zustand store with React re-renders |
| **User interaction** | None during debate | User can edit claims, adjust settings between turns |
| **Moderator display** | Text transcript | Styled cards with intervention badges |
| **QBAF visualization** | JSON output | Interactive graph component |

The edit-claims phase is editor-only — the CLI doesn't pause for user review. This is the primary UX advantage of the editor: the user can shape the debate before it starts by removing irrelevant claims or refining claim text.

## 9. Build and Deployment

### 9.1 Development

```bash
npm run dev          # Vite + Electron (hot reload)
npm run dev:web      # Web mode (no Electron, --host 0.0.0.0)
npm run dev:server   # Express server only (container testing)
npm test             # Vitest
```

### 9.2 Production Builds

| Target | Command | Output |
|---|---|---|
| Desktop (Windows) | `npm run build` + electron-builder | `.exe` installer |
| Desktop (macOS) | `npm run build` + electron-builder | `.dmg` |
| Desktop (Linux) | `npm run build` + electron-builder | `.AppImage` |
| Container | `npm run build:container` | `dist/server/` + `dist/renderer/` |

### 9.3 Container Image

Two-stage Docker build:
1. **Builder:** node:22-bookworm-slim, install deps, compile TypeScript, bundle Vite
2. **Runtime:** ai-triad-base (Python 3.11, Node 22, pandoc, ffmpeg), copy built artifacts

Runtime: port 7862, non-root user, health check at `/health`, data volume at `/data`.

## 10. Design Decisions and Trade-offs

### D1: Electron Over Web-Only

**Chosen:** Electron for desktop, with web mode as a secondary deployment target.

**Why:** The primary users are researchers working locally with large taxonomy files, PDFs, and debate transcripts. Electron provides: direct filesystem access (no file upload/download), integrated terminal (node-pty + xterm.js), native OS dialogs, and the ability to launch companion tools. A web-only app would require a separate backend service even for local use.

**Trade-off accepted:** Electron bundles Chromium (~200 MB download), and maintaining two deployment paths (Electron + Express) doubles the integration surface. We accept this because the desktop experience is significantly better for the primary use case (local research), while the container path enables cloud sharing.

### D2: Zustand Over Redux

**Chosen:** Zustand for all state management.

**Why:** Zustand stores are simpler to create and use than Redux — no action types, no reducers, no dispatch boilerplate. For a 7-store application, Zustand's lightweight API reduces code volume by ~40% compared to equivalent Redux. The debate store (useDebateStore) is already the largest file in the renderer — Redux ceremony would make it larger without adding value.

**Trade-off accepted:** Zustand doesn't enforce unidirectional data flow as strictly as Redux. Complex interactions between stores (e.g., debate store reading from taxonomy store) require explicit `getState()` calls. In practice, cross-store reads are rare enough that this isn't a problem.

### D3: Reimplemented Debate Orchestration in the Store

**Chosen:** The Electron app reimplements the debate engine's orchestration loop in `useDebateStore.ts` rather than wrapping `debateEngine.ts`.

**Why:** The CLI engine runs debates as batch processes — it loops from start to finish without yielding control. The editor needs to pause after each turn for UI updates, allow user interaction between turns, and support the edit-claims phase (which doesn't exist in batch mode). Wrapping the batch engine would require converting it to an async generator with yield points, which would add complexity to the simpler CLI use case.

**Trade-off accepted:** Logic fixes must be ported between `debateEngine.ts` and `useDebateStore.ts`. This has caused bugs (e.g., moderator PIN not forcing responder in the editor but fixed in CLI). The mitigation is discipline and testing — not ideal, but the alternative (shared async engine) would hurt both hosts.

### D4: API Abstraction Layer for Dual Deployment

**Chosen:** Components call `api.methodName()` which resolves to Electron IPC or HTTP depending on runtime.

**Why:** The same React components must work in both desktop (Electron) and web (container) modes. The abstraction layer means components don't know or care which runtime they're in. Adding a new IPC method requires implementing it in both the Electron main process and the Express server, but the component code is written once.

**Trade-off accepted:** Some IPC methods don't have meaningful web equivalents (e.g., `pty-create` for terminal emulation, `open-external` for OS-level browser launch). These fail gracefully in container mode — the terminal panel is hidden, external links open in new tabs.

### D5: Phase-Aware Action Bar

**Chosen:** Single DebateWorkspace component with conditional rendering based on `activeDebate.phase`.

**Why:** The debate UI changes dramatically between phases — clarification shows Q&A, edit-claims shows an editor, debate shows turn controls. A single component with phase routing keeps all debate logic co-located. The alternative (separate page-level components per phase) would scatter debate state across multiple components and complicate phase transition logic.

**Trade-off accepted:** DebateWorkspace.tsx is large (~2300 lines) and contains sub-components (ClaimsEditor, ClarificationActions, OpeningActions, DebateActions) that could be separate files. We accept the size because splitting would require passing many props or creating a context provider — complexity for organizational rather than functional benefit.

## 11. Risks and Open Questions

| Risk | Impact | Mitigation |
|---|---|---|
| **Dual-host sync** | Debate logic divergence between CLI and editor | Manual porting; shared types enforce contract |
| **DebateWorkspace size** | File maintainability as features grow | Sub-components are internally organized; could extract if it exceeds 3000 lines |
| **Container auth surface** | Web deployment exposes data to network | BYOK model limits exposure; auth modes (disabled/optional/required) configurable |
| **Electron version churn** | Major Electron updates break native modules | Pinned at Electron 35; node-pty is the primary risk |
| **xterm.js in container** | Terminal emulation in web mode has security implications | Terminal disabled in container mode by default |

## 12. Glossary

| Term | Definition |
|---|---|
| **IPC** | Inter-Process Communication — Electron's mechanism for renderer↔main process communication |
| **Preload** | Electron preload script — bridges renderer (web) and main (Node.js) contexts via contextBridge |
| **Zustand** | Lightweight state management library for React |
| **Zod** | Runtime type validation library |
| **BYOK** | Bring Your Own Key — users supply their own AI API keys |
| **Action bar** | Bottom-fixed UI element that changes based on current debate phase |
