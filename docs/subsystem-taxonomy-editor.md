# Taxonomy Editor

## Overview

The Taxonomy Editor is the primary user interface — an Electron + React application for editing taxonomy nodes, running debates, viewing argument graphs, managing conflicts, and orchestrating research workflows. It runs both as a native desktop app (via Electron 35) and as a containerized web app (deployed to Azure Container Apps).

**Stack:** Electron 35, React 19, Vite, TypeScript, Zustand (state), Zod (validation)

## Deployment Modes

### Desktop (Electron)

Standard Electron app with main process (Node.js) and renderer process (Chromium). The main process handles file I/O, data loading, and IPC. Launch via `Show-TaxonomyEditor` (PowerShell) or `npm run dev` (development).

### Web / Container

Runs without Electron — a Node.js Express server serves the Vite-bundled React app. Data access goes through server-side API routes instead of Electron IPC. Built via `npm run build:container`, deployed as a Docker container.

- Port: 7862
- Health check: `GET /health`
- Data volume: `/data` (mapped to `AI_TRIAD_DATA_ROOT`)
- User: `aitriad` (non-root)

## Application Structure

```
taxonomy-editor/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry, window management
│   │   └── ipc/                 # IPC handlers (100+ methods)
│   ├── renderer/                # React UI
│   │   ├── App.tsx              # Root layout
│   │   ├── components/          # UI components
│   │   │   ├── DebateWorkspace.tsx
│   │   │   ├── ArgumentGraph.tsx
│   │   │   ├── ChatWorkspace.tsx
│   │   │   ├── DebateTab.tsx
│   │   │   ├── ConflictsTab.tsx
│   │   │   ├── AnalysisPanel.tsx
│   │   │   └── ...
│   │   ├── hooks/               # Zustand stores
│   │   │   ├── useDebateStore.ts
│   │   │   ├── useTaxonomyStore.ts
│   │   │   └── ...
│   │   ├── utils/               # Shared utilities
│   │   └── styles.css           # Global styles
│   ├── server/                  # Express server (container mode)
│   └── preload/                 # Electron preload scripts
├── specs/                       # Test fixtures
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.main.json           # Main process TS config
├── tsconfig.server.json         # Server TS config
├── Dockerfile
└── electron-builder.yml         # Build/packaging config
```

## Key Components

### DebateWorkspace

The debate interface. Manages the full debate lifecycle:
- Topic input with optional URL/document source
- Document analysis and claim extraction display
- Claims editor (edit/delete extracted claims before opening statements)
- Turn-by-turn debate transcript with character avatars and color coding
- Moderator intervention display
- Synthesis output and QBAF visualization
- Phase-aware action bar (different controls per debate phase)

### ArgumentGraph

Visualizes the QBAF network from a debate session. Nodes are claims colored by POV, edges show support/attack relationships with strength indicators.

### ChatWorkspace

Multi-turn chat interface with debate context awareness. Supports conversations grounded in the taxonomy and current debate state.

### DebateTab / ConflictsTab / AnalysisPanel

Browsing interfaces for debate history, detected conflicts, and analytical outputs.

## State Management

The app uses Zustand stores for state management:

### useDebateStore

The most complex store — manages the entire debate lifecycle within the Electron app. This is a separate implementation from the CLI engine (`debateEngine.ts`), adapted for the reactive UI paradigm.

Key state: session, phase, transcript, moderator state, argument network, document analysis.

Key actions:
- `beginDebate` — Initialize session, analyze document, transition to edit-claims or opening
- `updateClaim` / `deleteClaim` — Edit extracted claims before opening statements
- `proceedToOpening` — Transition from edit-claims to opening phase
- `submitTurn` — Process a debate turn (character response, moderator check, network update)

### Other Stores

- `useTaxonomyStore` — Taxonomy node CRUD, hierarchy management
- Additional stores for conflicts, settings, UI state

## IPC Layer

100+ IPC methods bridge the main and renderer processes:

- **File operations** — Read/write taxonomy JSON, source documents, summaries
- **Data queries** — Taxonomy search, conflict lookup, debate history
- **AI operations** — Forwarded to AI backends via the main process
- **System operations** — Window management, external browser, diagnostics

In container mode, IPC calls are replaced by HTTP API routes to the Express server.

## Development

```bash
npm run dev          # Vite dev server + Electron (port 5173)
npm run dev:web      # Web mode only (no Electron, --host 0.0.0.0)
npm run dev:server   # Node.js server mode (for container testing)
npm test             # Vitest suite
npm run build        # Production Electron build
npm run build:container  # Container build (server + renderer)
npx tsc --noEmit -p tsconfig.main.json  # Type check main process
```

## Dependencies

- **React 19**, React DOM, React Markdown, Remark GFM
- **Zustand** — State management
- **Zod** — Runtime validation
- **xterm.js** + **node-pty** — Embedded terminal emulation
- **ws** — WebSocket for real-time communication
- **@azure/keyvault-secrets**, **@azure/identity** — Cloud key management
- **electron-builder** — Cross-platform packaging

## Claims Editor

When debating a document, the engine extracts I-nodes (individual claims) during document analysis. The claims editor lets users review these before opening statements:

- Claim list with color-coded type badges (empirical, normative, definitional, assumption, evidence)
- Inline editing via textarea
- Delete individual claims
- Tension points display
- "Proceed to Opening Statements" button

Changes propagate to both the `document_analysis.i_nodes` array and the `argument_network.nodes` map.
