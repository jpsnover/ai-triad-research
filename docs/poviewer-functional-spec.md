# POViewer — Functional Specification

## Overview

POViewer is a three-pane source annotation tool for analyzing documents through the AI Triad's multi-perspective lens. It runs a two-stage AI analysis pipeline that extracts noteworthy points from documents, maps them to taxonomy nodes, and assesses alignment and strength.

**Version:** 0.1.0
**Stack:** Electron, React 19, Vite, Zustand 5, pdfjs-dist, TypeScript
**Dev server:** `http://localhost:5174`

## Architecture

### Three-Pane Layout

1. **Pane 1 (Left)** — Source list, notebook switcher, taxonomy manager, API key dialog
2. **Pane 2 (Center)** — Document viewer (Markdown or PDF) with highlighting and analysis controls
3. **Pane 3 (Right)** — POV analysis panel with three view modes

### Process Model

| Process | Entry | Role |
|---------|-------|------|
| Main | `src/main/main.ts` | Window (1400×900), IPC, file I/O, AI engine |
| Renderer | `src/renderer/index.tsx` | React UI, stores |
| Preload | `src/main/preload.ts` | IPC bridge |

## Key Features

### Two-Stage Analysis Pipeline

**Stage 1 — Point Extraction:**
- AI reads the document snapshot
- Identifies noteworthy passages (claims, arguments, positions, evidence)
- Returns points with text and character offsets for highlighting
- Zero-cost sniffing for quality validation

**Stage 2 — Taxonomy Mapping:**
- For each extracted point, finds best-matching taxonomy nodes
- Determines alignment: `agrees` or `contradicts`
- Assesses strength: `strong`, `moderate`, or `weak`
- Generates explanation of the mapping rationale

### Source Management

- Import from files (PDF, DOCX, Markdown) or URLs
- Multi-notebook support — organize sources into research projects
- Enable/disable sources for filtering analysis views
- Status tracking: pending → analyzing → analyzed / error

### Three Analysis Views (Pane 3)

| View | Purpose |
|------|---------|
| **Points** | Detail card for selected point with all mappings, alignment, strength, collision alerts |
| **Nodes** | Aggregation view — which nodes were referenced across enabled sources, with counts |
| **Gaps** | Coverage analysis — unanalyzed sources, unmapped categories |

### Annotation System

Users can refine AI-generated mappings:
- Change alignment (agrees ↔ contradicts)
- Change strength (strong / moderate / weak)
- Dismiss points or individual mappings
- Add free-text notes
- Collision alerts when a point maps to multiple conflicting nodes

### Search

- Full-text search across document content
- Modes: Raw, Wildcard, Regex
- Case-sensitive option
- Results highlighted in document viewer

### PDF Support

- Native PDF rendering via pdfjs-dist
- Text highlighting overlays for extracted points
- Character offset mapping between PDF text and analysis results

## Type System

### Core Types

```
Source        — id, title, url, sourceType, status, snapshotText, points[], filePath
Point         — id, sourceId, startOffset, endOffset, text, verbatim, mappings[], isCollision
Mapping       — camp (PovCamp), nodeId, nodeLabel, category, alignment, strength, explanation
Notebook      — id, name, sources[], taxonomyFiles[]
Annotation    — id, pointId, action, value, mappingIndex
```

### Analysis Types

```
AnalysisStatus — idle | queued | reading | stage1_running | stage1_complete | stage2_running | complete | error
AnalysisResult — sourceId, points (RawPoint[]), mappings (RawMapping[]), completedAt, model
```

## State Management

Two Zustand stores:

| Store | Purpose |
|-------|---------|
| `useAppStore` | Notebooks, sources, selections, POV filters, search, theme, taxonomy |
| `useAnalysisStore` | Per-source analysis state, progress tracking, API key status |

## Data Loading

- **Pipeline discovery** — scans `sources/` and `summaries/` directories for existing data
- **Taxonomy loading** — reads POV JSON files from active taxonomy directory
- **Snapshot loading** — reads `snapshot.md` on demand for document display
- **Hardcoded fallback** — sample data available when Electron IPC unavailable

## IPC Channels

- `discover-sources` — scan pipeline for sources
- `load-taxonomy-file` / `get-taxonomy-dirs` / `set-taxonomy-dir` — taxonomy management
- `load-snapshot` — load document markdown
- `run-analysis` / `cancel-analysis` — trigger/stop AI pipeline
- `store-api-key` / `get-api-key` / `validate-api-key` — API key management
- `save-annotations` / `load-annotations` — persist user edits
- `open-source-file-dialog` — file picker

## Theming

4 themes: Light, Dark, BKC, System. Stored in localStorage, applied via `data-theme` attribute.

## Component Count

~35 React components including source management, document viewing, analysis visualization, dialogs, and utility components.
