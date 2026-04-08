# Taxonomy Editor — Functional Specification

## Overview

The Taxonomy Editor is the primary desktop application for the AI Triad Research platform. Built with Electron + React + Vite, it provides a comprehensive interface for managing the multi-perspective taxonomy, running multi-agent debates, conducting 1-on-1 POVer chats, browsing conflicts, and editing graph relationships.

**Version:** 0.1.0
**Stack:** Electron, React 19, Vite, Zustand 5, Zod, TypeScript
**Dev server:** `http://localhost:5173`

## Architecture

### Build Targets

- **Electron** — standard desktop app (default)
- **Web/Container** — Node.js Express server + browser client (`VITE_TARGET=web`)

Both targets share the same renderer code via the **bridge pattern**: `@bridge` alias resolves to `electron-bridge.ts` (Electron IPC) or `web-bridge.ts` (REST + WebSocket) depending on build target.

### Process Model

| Process | Entry | Role |
|---------|-------|------|
| Main | `src/main/main.ts` | Window management, IPC handlers, file I/O, AI calls, terminal broker |
| Renderer | `src/renderer/index.tsx` | React UI, Zustand stores, prompt templates |
| Preload | `src/main/preload.ts` | Context-isolated IPC bridge |

### Key Files

| File | Size | Purpose |
|------|------|---------|
| `src/main/ipcHandlers.ts` | 21KB | 40+ IPC handler registrations |
| `src/main/fileIO.ts` | 16KB | Taxonomy/conflict/edge file I/O |
| `src/main/embeddings.ts` | 27KB | Voyage embeddings API, batch processing |
| `src/renderer/hooks/useTaxonomyStore.ts` | 64KB | Core taxonomy + UI state |
| `src/renderer/hooks/useDebateStore.ts` | 102KB | Debate sessions + AI generation |
| `src/renderer/hooks/useChatStore.ts` | 13KB | Chat sessions + messages |
| `src/renderer/components/DebateWorkspace.tsx` | 63KB | Full debate UI |

## Features by Tab

The app has **7 main tabs**: three POV tabs (Accelerationist, Safetyist, Skeptic), Situations, Conflicts, Debate, and Chat.

### POV Tabs (Accelerationist / Safetyist / Skeptic)

**Layout:** 4-pane — Node list | Node detail | Toolbar panel | Pinned panel stack

**Node Operations:**
- Create nodes (choose BDI category: Beliefs/Desires/Intentions)
- Edit label, description, category in-place
- Delete with confirmation
- Move across POVs or between categories
- Sort by ID, Label, Category, or Similarity (triggers k-means clustering)

**Node Detail** has 4 tabs:
- **Content** — id, category, label, description, parent relationships
- **Related** — conflict_ids, situation_refs, linked_nodes
- **Attributes** — graph_attributes (epistemic_type, rhetorical_strategy, fallacies, node_scope, etc.)
- **Research** — external research notes

**Search** (persistent FindBar):
- Modes: Raw, Wildcard, Regex, Semantic (Voyage embeddings + cosine similarity)
- POV/Aspect scope chips
- Cluster view with misfits detection

**Toolbar Panels** (right-side, switchable):
- Search results, Edge Browser, Attribute Filter, Attribute Info, Intellectual Lineage, Prompt Catalog, Terminal (embedded bash), Fallacy Database, Policy Alignment, Policy Dashboard

### Situations Tab

- List and detail view for cross-cutting situation nodes
- BDI interpretations per POV (how each perspective interprets the situation)
- Disagreement type classification: definitional / interpretive / structural
- Link to POV nodes and conflicts

### Conflicts Tab

- Browse auto-detected factual conflicts across POVs
- **ConflictDetail** tabs: Overview, Instances (evidence from sources), Notes (human annotations), QBAF (argument graph visualization)
- Status tracking: open / resolved / wont-fix

### Debate Tab

Multi-agent debate system with three POV agents and a moderator.

**Phases:**
1. **Clarification** — moderator refines the topic
2. **Opening Statements** — each POVer presents initial position
3. **Cross-Respond** — agents respond to each other (1-5 rounds)
4. **Closing** — final statements
5. **Synthesis** — moderator analyzes agreements, disagreements, resolution preferences

**Advanced Features:**
- Document attachment and evidence extraction
- Incremental argument network (claims + relationships extracted per turn)
- Per-debater commitment tracking (asserted/conceded/challenged)
- Convergence scoring (agreement trends per round)
- Fact-checking via Google Search API
- Debate-specific AI model override
- **Harvest** — promote findings into taxonomy (conflicts, steelman refinements, debate refs, verdicts, new concepts)

**Export:** JSON, Markdown, Plain Text, PDF

### Chat Tab

1-on-1 conversation with a single POV agent.

**Modes** (switchable mid-chat):
- **Brainstorm** — exploratory, high creativity (temperature 0.9)
- **Inform** — pedagogical, grounded (temperature 0.6)
- **Decide** — analytical, Socratic (temperature 0.3)

Sessions persist in `chats/chat-<id>.json`. Same BDI taxonomy grounding as debates.

## State Management

Three Zustand stores manage application state:

| Store | Size | Scope |
|-------|------|-------|
| `useTaxonomyStore` | 64KB | Taxonomy data, selection, search, edges, settings |
| `useDebateStore` | 102KB | Debate sessions, transcript, argument network, AI generation |
| `useChatStore` | 13KB | Chat sessions, messages, mode |

Settings (theme, model, zoom) persist to `localStorage`.

## IPC Channels (40+)

**Categories:**
- Taxonomy CRUD — load/save POV files, conflict files, edges
- Data Management — data availability, clone, pull updates
- AI Models & Keys — load registry, store/check API keys
- AI Generation — `generate-text` (with progress events), `generate-text-with-search`
- Embeddings — compute/cache node and query embeddings
- Debate Sessions — list/load/save/delete/export
- Chat Sessions — list/load/save/delete
- Harvest — create conflicts, add debate refs, update steelmans, add verdicts
- Terminal — spawn/write/resize/kill PTY
- Diagnostics — open/close diagnostics window

## Theming

4 themes: Light, Dark, BKC (high-contrast), System (OS preference).

Applied via `data-theme` CSS attribute. POV-specific colors: `--color-acc`, `--color-saf`, `--color-skp`.

## Data Loading

On startup:
1. Check data availability → FirstRunDialog if missing
2. `loadAll()` — load all POV taxonomies, situations, conflicts, edges, policy registry
3. Validate with Zod schemas
4. Check for data repo updates (git pull if behind)
5. Load AI model registry from `ai-models.json`

**Data paths** resolved via IPC → `resolveDataPath()` (env var > `.aitriad.json` > monorepo fallback).

## Component Count

~62 TSX components including tab views, panels, dialogs, and specialized visualizations (ArgumentGraph, QbafOverlay, ConvergenceRadar, TimelineScrubber).
