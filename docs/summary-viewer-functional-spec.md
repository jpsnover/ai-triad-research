# Summary Viewer — Functional Specification

## Overview

Summary Viewer is a three-pane browser for exploring pre-computed AI-generated POV summaries. It displays key points grouped by perspective, supports semantic similarity search via embeddings, and includes an AI-driven enrichment pipeline for taxonomy node enhancement.

**Version:** 0.1.0
**Stack:** Electron, React 19, Vite, Zustand 5, react-markdown, TypeScript
**Dev server:** `http://localhost:5175`

## Architecture

### Three-Pane Layout

1. **Pane 1 (Left, collapsible)** — Source list with filters, sorting, taxonomy switcher
2. **Pane 2 (Center)** — Key points from selected source, grouped by POV
3. **Pane 3 (Right, dynamic)** — Switches between: Document snapshot, Similarity results, Potential edges, Settings

### Process Model

| Process | Entry | Role |
|---------|-------|------|
| Main | `src/main/main.ts` | Window (1400×900), IPC, file I/O, AI generation, embeddings |
| Renderer | `src/renderer/index.tsx` | React UI, store |
| Preload | `src/main/preload.ts` | IPC bridge |

## Key Features

### Summary Browsing

- Source list with metadata (title, authors, date, POV tags, topic tags)
- Filter and sort sources
- Select one or more sources to view summaries
- Collapsible left pane for more reading space

### Key Points Display (Pane 2)

Key points organized by POV camp (Accelerationist / Safetyist / Skeptic):
- **Stance indicators** — strongly_aligned through strongly_opposed
- **Taxonomy linking** — clickable node ID links
- **Category badges** — Beliefs / Desires / Intentions
- **Graph attributes** — epistemic type, rhetorical strategy, fallacies, etc.
- **Factual claims** — separate section with claim text and positions
- **Unmapped concepts** — concepts not yet in the taxonomy, with suggested labels and cross-POV interpretations

### Document Snapshot (Pane 3, default)

- Markdown rendering via react-markdown + remark-gfm
- Text search (raw/wildcard/regex, case-sensitive)
- Verbatim highlighting of passages matching selected key points
- Click-to-search from any claim or concept

### Semantic Similarity Search (Pane 3, triggered)

1. User clicks a concept or claim
2. Query embedding computed via IPC
3. Compared against cached node embeddings using cosine similarity
4. Results ranked by similarity score, filtered by adjustable threshold (default 60%)
5. Displayed in resizable columns (match%, id, label)
6. Click row to expand detail card with graph attributes and interpretations

### Potential Edge Discovery (Pane 3, triggered)

AI-generated graph edge suggestions for a selected node:
- Edge type, target, direction (inbound/outbound/bidirectional)
- Confidence score and rationale
- Sort by confidence, type, target
- Approve/reject for persistence

### Enrichment Pipeline

Four sequential steps for enhancing a taxonomy node:

| Step | Action |
|------|--------|
| Source Linking | Find which sources reference this node |
| Parent Placement | AI suggests parent node for hierarchy |
| Attribute Extraction | Extract graph attributes (epistemic type, rhetorical strategy, etc.) |
| Edge Discovery | Find related nodes and propose edges |

Progress shown with status badges. Each step is optional and can be skipped.

## Type System

### Core Types

```
SourceInfo      — id, title, sourceType, url, authors, dateIngested, povTags, topicTags, hasSummary
PipelineSummary — doc_id, taxonomy_version, generated_at, ai_model, pov_summaries, factual_claims, unmapped_concepts
KeyPoint        — taxonomy_node_id, category, point, verbatim, excerpt_context, stance
PotentialEdge   — type, target, inbound, bidirectional, confidence, rationale, strength
```

### Enrichment Types

```
EnrichmentStep       — source_linking | parent_placement | attribute_extraction | edge_discovery
EnrichmentStepStatus — pending | running | done | failed | skipped
EnrichmentState      — nodeId, steps[]
```

## State Management

Single Zustand store (`useStore`) managing:
- Sources, summaries, taxonomy, policy registry, snapshots
- Selection state (sources, key points)
- Similarity search (query, results, threshold, embedding cache)
- Potential edges (query, results)
- Enrichment pipeline state
- AI settings (backend, model)
- UI (theme, pane visibility)

## Multi-Backend AI

| Backend | Default Model | Env Variable |
|---------|---------------|--------------|
| Gemini | gemini-2.5-flash | GEMINI_API_KEY |
| Claude | claude-sonnet-4-5 | ANTHROPIC_API_KEY |
| Groq | groq-llama-4-scout | GROQ_API_KEY |

Settings dialog allows backend/model selection and per-backend API key storage.

## IPC Channels

- `discover-sources` / `load-summary` / `load-snapshot` — data loading
- `load-taxonomy` / `load-policy-registry` — taxonomy management
- `load-embeddings` / `compute-embeddings` / `compute-query-embedding` — similarity
- `generate-content` — AI generation for enrichment and edge discovery
- `add-taxonomy-node` / `update-node-fields` / `persist-edges` — taxonomy updates
- `set-api-key` / `has-api-key` / `load-ai-models` — AI configuration

## Prompts

Four prompt generators in `src/renderer/prompts/`:
- `attributeExtraction.ts` — extract graph attributes for a node
- `edgeDiscovery.ts` — full edge analysis
- `hierarchyPlacement.ts` — suggest parent nodes
- `potentialEdges.ts` — discover edges from/to a node

## Theming

4 themes: Light, Dark, BKC, System. Applied via `data-theme` attribute.

## Component Count

9 React components — focused, minimal UI for browsing and discovery.
