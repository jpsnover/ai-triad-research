# RAG Migration Plan — Architecture Document

**Author:** Technical Lead
**Ticket:** t/88 (PP-5)
**Status:** Architecture document only — no implementation until validated

---

## Why RAG Is Needed

The taxonomy has **518 nodes** (99 accelerationist, 157 safetyist, 145 skeptic, 117 situations) as of TAXONOMY_VERSION 3.0.0. The original design assumed ~100-200 nodes with full-taxonomy injection into every prompt. At current scale:

| Pipeline | Current Token Cost | Full Taxonomy Share |
|----------|-------------------|-------------------|
| POV Summary (PowerShell) | 27,500-37,500 tokens | ~15,000-25,000 (full JSON, no filtering) |
| Debate turn (Electron) | 5,000-8,000 tokens | ~1,875 (50 nodes, pre-filtered by RE) |
| Document analysis | 15,000-20,000 tokens | ~1,250 (compact listing, 40/POV cap) |

**The PowerShell pipeline is the bottleneck.** It injects all 518 nodes as raw JSON — no relevance filtering, no tiering, no branch selection. This wastes 15,000+ tokens on nodes irrelevant to the document being summarized.

The Electron debate pipeline already has partial RAG via Relevance Engineering (RE-1 through RE-8): cosine similarity scoring, tiered node selection, and configurable caps. But the PowerShell pipeline lacks this entirely.

---

## Breaking Point Analysis

| Node Count | Full JSON Tokens | Impact |
|-----------|-----------------|--------|
| 200 (original design) | ~6,000 | Fits comfortably in 32K context |
| 400 | ~12,000 | Tight in 32K, attention dilution begins |
| **518 (current)** | **~15,000-25,000** | **Exceeds 50% of 32K context; severe attention dilution** |
| 800 (projected growth) | ~24,000-40,000 | Unsustainable — taxonomy exceeds most context windows |
| 1,200 | ~36,000-60,000 | Requires 128K context or RAG |

**We are past the breaking point.** The Comp Linguist's prompt review (PS-3, t/124) flagged context attention dilution as HIGH severity. CHESS (t/118) addresses this for debates; this plan addresses it for the pipeline.

---

## Current Relevance Infrastructure (What Exists)

| Component | Location | What It Does | Used By |
|-----------|----------|-------------|---------|
| `scoreNodeRelevance()` | `lib/debate/taxonomyRelevance.ts` | Cosine similarity: query vector vs. node embeddings | Debate engine |
| `selectRelevantNodes()` | Same | Threshold + min-per-BDI + max cap selection | Debate engine |
| `formatTaxonomyContext()` | `lib/debate/taxonomyContext.ts` | Formats selected nodes into BDI-structured text | Debate engine |
| `buildTaxonomySample()` | `lib/debate/documentAnalysis.ts` | Compact `ID: LABEL` listing (40/POV cap) | Document analysis |
| Embedding vectors | `embeddings.json` | 768-dim vectors per node (Gemini text-embedding-004) | All similarity ops |
| `computeQueryEmbedding()` | `taxonomy-editor/src/main/embeddings.ts` | Generates embedding for a text query | Debate engine |

**Gap:** None of this is accessible from PowerShell. The pipeline has no embedding-based relevance filtering.

---

## Proposed API: `Get-RelevantTaxonomyNodes`

### Design

```powershell
Get-RelevantTaxonomyNodes
    -Query <string>           # Text to find relevant nodes for (e.g., document excerpt)
    -Threshold <double>       # Cosine similarity threshold (default: 0.3)
    -MaxTotal <int>           # Maximum nodes to return (default: 50)
    -MinPerCategory <int>     # Minimum per BDI category (default: 3)
    [-Pov <string[]>]         # Filter to specific POVs (default: all)
    [-IncludeSituations]      # Include situation nodes (default: false)
    [-Format <string>]        # Output format: 'objects' | 'json' | 'context' (default: 'objects')
```

### Implementation Options

#### Option A: Node.js Bridge (Recommended)

Reuse the existing `computeQueryEmbedding()` and `selectRelevantNodes()` from Shared Lib via a thin Node.js bridge script:

```
PowerShell → node scripts/relevance-bridge.mjs → lib/debate/taxonomyRelevance.ts → results
```

**Pros:** Single source of truth for relevance logic. Already proven pattern (`qbaf-bridge.mjs` for QBAF, Python bridge for NLI).
**Cons:** Requires Node.js runtime. Adds ~2s startup latency per call.

#### Option B: Pure PowerShell Implementation

Reimplement cosine similarity and node selection in PowerShell, reading `embeddings.json` directly.

**Pros:** No external runtime dependency. Faster for batch operations (no bridge startup per call).
**Cons:** Duplicates logic. Must stay in sync with Shared Lib changes. PowerShell numeric performance is slower than JS.

#### Option C: Hybrid — PowerShell Reads Embeddings, Shared Lib Computes

PowerShell loads `embeddings.json` (cached), computes cosine similarity natively (it's 10 lines of math), but delegates formatting to the Node.js bridge.

**Pros:** Fast batch operation (no bridge per call), Shared Lib owns formatting.
**Cons:** Cosine similarity duplicated (but it's trivial and unlikely to change).

**Recommendation: Option C.** Cosine similarity is a pure mathematical function that won't change. PowerShell can compute it efficiently with `[double[]]` arrays. The formatting and selection logic (threshold, min-per-category, max cap) is also simple enough to reimplement. This avoids the Node.js bridge latency for batch operations (150 documents × 2s startup = 5 minutes wasted).

---

## Migration Phases

### Phase 1: PowerShell Relevance Selection (Addresses the Bottleneck)

1. Implement `Get-RelevantTaxonomyNodes` in `scripts/AITriad/Public/`
2. Load `embeddings.json` once per session (cache in module scope)
3. Implement cosine similarity in PowerShell (10 lines)
4. Selection logic: threshold + min-per-BDI + max cap (mirrors `selectRelevantNodes`)
5. Update `Invoke-POVSummary` to use `Get-RelevantTaxonomyNodes` instead of full taxonomy injection

**Validation:** Compare summary quality on 10 documents: full-taxonomy vs. RAG-filtered (top 50 nodes). Measure: claim recall, mapping accuracy, token savings.

**Expected impact:** Reduce taxonomy injection from ~15,000-25,000 tokens to ~3,000-5,000 tokens (50 relevant nodes vs. 518).

### Phase 2: Query Construction

The quality of RAG depends on the query. For `Invoke-POVSummary`:

1. **Document-level query:** First 500 words of the document + title + abstract (if available)
2. **Chunk-level query:** The chunk text itself (for `pov-summary-chunk-system.prompt`)
3. **Topic-level query:** For debates, the debate topic + recent transcript

These queries are embedded via `computeQueryEmbedding()` (or a PowerShell equivalent using the Gemini embedding API directly).

### Phase 3: CHESS Integration

CHESS (t/118, already in progress) adds hierarchical branch selection. Once CHESS lands:

1. Pre-classify document → identify relevant POV branches
2. Use branch roots as seed nodes for `Get-RelevantTaxonomyNodes`
3. Expand within relevant branches, prune irrelevant branches entirely

This is additive — RAG (similarity-based) + CHESS (branch-based) combine for the best filtering.

### Phase 4: Prompt Inspector Visibility

The Prompt Inspector (t/34, Phase B) exposes RAG parameters to users:
- Threshold slider
- Max nodes cap
- Min-per-BDI guarantee
- Visual: "47 / 518 nodes selected (9.1%)" with branch breakdown

Users can tune and preview the RAG filter before running the pipeline.

---

## Interaction with Other Workstreams

| Workstream | Interaction |
|-----------|-------------|
| **CHESS (t/118)** | Complementary — CHESS prunes branches, RAG scores within branches |
| **QBAF (t/95)** | Independent — QBAF operates on claims, not taxonomy selection |
| **FIRE (t/130)** | Compatible — FIRE's iterative extraction benefits from focused context (fewer irrelevant nodes = better claim extraction) |
| **Pipeline Improvements (t/83)** | PP-1 (gold standard, t/84) validates RAG quality. PP-7 (token calibration, t/90) informs token budgets. |
| **Prompt Quality (t/121)** | PQ-3 (t/124, hierarchical context) is the prompt-side companion to RAG filtering |
| **Relevance Engineering (t/19)** | RE provides the algorithm; RAG applies it to the pipeline |

---

## Risks

| Risk | Level | Mitigation |
|------|-------|-----------|
| RAG misses relevant nodes → lower recall | MEDIUM | Min-per-BDI guarantee (≥3 per category). Safety margin: top-level nodes always included. |
| Embedding quality degrades for short documents | LOW | Fallback to full taxonomy if document < 200 words |
| Cosine threshold too aggressive | LOW | Start at 0.3 (proven in debate pipeline). Calibrate via PP-1 gold standard. |
| PowerShell cosine implementation diverges from Shared Lib | LOW | Cosine similarity is a mathematical identity — 10 lines, no variation possible |

---

## When to Implement

**Phase 1 should start now.** We're at 518 nodes — past the breaking point. Every new document summarized wastes 15,000+ tokens on irrelevant taxonomy context. The ROI is immediate: ~70% token reduction per pipeline call.

Phase 1 has no blockers:
- `embeddings.json` exists with all 518 node vectors
- `selectRelevantNodes` algorithm is proven in the debate pipeline
- Cosine similarity is trivial to implement
- `Invoke-POVSummary` is the only consumer to update

**Estimated effort:** 1-2 days for Phase 1 (cmdlet + integration + validation).
