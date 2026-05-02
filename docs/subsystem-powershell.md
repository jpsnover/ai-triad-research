# PowerShell Module (AITriad)

## Overview

The AITriad PowerShell module is the command-line backbone of the platform. It provides 75 public cmdlets for taxonomy management, document ingestion, AI-powered summarization, conflict detection, graph analysis, debate orchestration, and visualization. The module requires PowerShell 7.0+ and runs cross-platform (Windows, macOS, Linux).

**Version:** 0.8.0  
**Author:** Jeffrey Snover  
**License:** MIT

## Module Structure

```
scripts/AITriad/
├── AITriad.psd1              # Module manifest
├── AITriad.psm1              # Entry point — classes, initialization, exports
├── Public/                   # 75 exported cmdlets
├── Private/                  # 33 internal helpers
├── Prompts/                  # 29 prompt template files
└── Taxonomy.Format.ps1xml    # Output formatting

scripts/
├── AIEnrich.psm1             # AI backend abstraction (companion)
├── DocConverters.psm1        # Document format conversion (companion)
├── PdfOptimizer.psm1         # PDF text post-processing
└── Build-Module.ps1          # Build script for distribution
```

## Cmdlet Categories

### Taxonomy Query & Management (5 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Get-Tax` | Query taxonomy nodes by POV, ID, label, description, or semantic similarity |
| `Get-RelevantTaxonomyNodes` | Semantic search via embeddings |
| `Update-TaxEmbeddings` | Regenerate embeddings.json |
| `Set-TaxonomyHierarchy` | Assign parent-child relationships |
| `Compare-Taxonomy` | Diff between taxonomy versions |

`Get-Tax` is the core query interface. Key parameters: `-POV`, `-Id`, `-Label`, `-Similar` (semantic search with embedding cosine similarity), `-Overlaps` (find merge candidates), `-CrossPOV`.

### Document Ingestion (5 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Import-AITriadDocument` | Ingest from URL, file, or inbox batch |
| `Get-AITSource` | Browse/filter ingested sources |
| `Save-AITSource` | Update source metadata |
| `Find-AITSource` | Reverse lookup — which documents reference a node? |
| `Save-WaybackUrl` | Archive URL via Internet Archive |

`Import-AITriadDocument` handles the complete pipeline: slug generation, raw file storage, Markdown conversion, metadata creation, optional Wayback Machine archival, and summary queue marking.

### POV Summarization (3 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Invoke-POVSummary` | Process single document through AI extraction pipeline |
| `Invoke-BatchSummary` | Queue-based batch summarization with parallelism |
| `Get-Summary` | Browse generated summaries |

The summarization pipeline is the most complex subsystem, involving 7 stages:

1. **CHESS** — Pre-classify document POV affinity
2. **RAG** — Select relevant taxonomy nodes via embedding similarity
3. **AutoFire Stage 1** — Sniff-test whether iterative extraction is worthwhile
4. **Prompt Construction** — Assemble system instruction + taxonomy context + schema
5. **AI Extraction** — FIRE iterative extraction (confidence-gated) or single-shot
6. **AutoFire Stage 2** — Post-extraction density check
7. **Unmapped Resolution** — Reconcile unrecognized concepts with existing nodes

### Graph Operations (5 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Get-GraphNode` | Retrieve node with edges and graph attributes |
| `Get-Edge` | Browse/filter edges |
| `Set-Edge` | Create or update edges |
| `Approve-Edge` | Workflow approval for proposed edges |
| `Find-GraphPath` | Shortest path between nodes |

### AI-Powered Discovery (3 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Invoke-EdgeDiscovery` | AI-inferred typed relationships between nodes |
| `Invoke-EdgeWeightEvaluation` | AI-driven edge weight assessment |
| `Invoke-AttributeExtraction` | Generate rich graph attributes (epistemic type, fallacies, policy actions, etc.) |

### Conflict & Debate Analysis (6 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Find-Conflict` | Legacy conflict detection (deprecated) |
| `Invoke-QbafConflictAnalysis` | QBAF-based conflict analysis with argumentation strength |
| `Get-ConflictEvolution` | Track conflict genealogy over time |
| `Invoke-AITDebate` | Run structured three-agent debate |
| `Invoke-DebateAB` | A/B comparison across model versions |
| `Show-TriadDialogue` | Interactive debate simulation |

### Taxonomy Health & Proposals (6 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Get-TaxonomyHealth` | Diagnostic report on coverage and usage |
| `Measure-TaxonomyBaseline` | Snapshot taxonomy state for tracking |
| `Test-TaxonomyIntegrity` | Validate data integrity |
| `Test-OntologyCompliance` | Check DOLCE/BDI/AIF compliance |
| `Invoke-TaxonomyProposal` | AI-generated improvement suggestions |
| `Approve-TaxonomyProposal` | Review and apply proposals |
| `Invoke-HierarchyProposal` | Auto-propose parent-child hierarchies |

### Policy Analysis (4 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Find-PolicyAction` | Extract policy recommendations from nodes |
| `Get-Policy` | Browse policy registry |
| `Update-PolicyRegistry` | Rebuild and validate registry |
| `Invoke-PolicyRefinement` | Consolidate policy framings via AI |

### Visualization & Apps (8 cmdlets)

| Cmdlet | Purpose |
|---|---|
| `Show-TaxonomyEditor` | Launch Taxonomy Editor (Electron) |
| `Show-POViewer` | Launch POV Viewer |
| `Show-SummaryViewer` | Launch Summary Viewer |
| `Show-AITriadHelp` | Generate HTML command reference |
| `Show-GraphOverview` | Structural overview of taxonomy graph |
| `Show-Markdown` | Render Markdown for viewing |
| `Show-DebateDiagnostics` | Analyze debate turn-by-turn |
| `Show-WorkflowRunner` | Launch batch workflow GUI |

### Remaining Cmdlets

Additional cmdlets cover: graph query and reasoning (`Invoke-GraphQuery`, `Invoke-CypherQuery`), Neo4j export (`Export-TaxonomyToGraph`, `Install-GraphDatabase`), data management (`Update-Snapshot`, `Normalize-Markdown`, `Invoke-SchemaMigration`), quality assurance (`Test-ExtractionQuality`, `Test-EdgeDirection`, `Test-AITJudgeModel`, `Invoke-PIIAudit`), topic analysis (`Get-TopicFrequency`, `Get-IngestionPriority`, `Find-SituationCandidates`, `Find-PossibleFallacy`), format conversion (`Convert-DebateToAudio`, `Convert-MD2PDF`), installation (`Install-AIDependencies`, `Install-AITriadData`, `Test-Dependencies`), backend configuration (`Register-AIBackend`), and SBOM generation (`Get-AITSBOM`).

## Companion Module: AIEnrich.psm1

Multi-backend AI API dispatcher. Provides:

- **`Invoke-AIApi`** — Central dispatcher with automatic backend routing, retry logic (exponential backoff on 429/503/529), JSON mode support, and usage tracking.
- **`Resolve-AIApiKey`** — Key resolution chain: explicit parameter > backend-specific env var > `$AI_API_KEY` fallback.
- **`Get-AIMetadata`** — Document metadata enrichment (title, authors, date, POV tags, topic tags).

Backend-specific request formatting is handled internally — callers only specify model ID and the module routes to the correct API endpoint with proper headers and response parsing.

## Companion Module: DocConverters.psm1

Document-to-Markdown conversion with tool fallback chains:

| Format | Tool Priority |
|---|---|
| HTML → Markdown | pandoc > built-in regex converter |
| PDF → Markdown | markitdown > pdftotext > mutool > placeholder |
| DOCX → Markdown | markitdown > pandoc > ZIP/XML extraction |
| Office (PPTX, XLSX) | markitdown |

## Prompt Templates

29 prompt files in `Prompts/` loaded via `Get-Prompt -Name '<name>'` with `{{KEY}}` placeholder substitution. Categories:

- **Summarization** (4) — POV summary extraction, chunk processing, schema
- **Metadata** (1) — Document metadata enrichment
- **Attributes** (2) — Node attribute generation
- **Edge Discovery** (2) — Relationship inference
- **Hierarchy** (3) — Parent-child proposal and placement
- **Policy** (2) — Policy action extraction
- **Fallacy** (2) — Logical fallacy identification
- **Conflict/Graph** (4) — Graph query, QBAF, direction check
- **Debate** (4) — Three-agent debate system, turn, synthesis
- **Topic/Priority** (3) — Topic frequency, ingestion priority, situation candidates

## Type System

Four PowerShell classes defined in `AITriad.psm1`:

- **`TaxonomyNode`** — Strongly typed POV node with edges, attributes, and similarity score
- **`AITSource`** — Source document with summary statistics and model info
- **`AITModelInfo`** — Extraction parameters (model, temperature, FIRE stats, chunking info)
- **`ClaimsByPov`** — Per-POV claim counts

## Module Initialization Sequence

1. Detect dev install vs. PSGallery install
2. Define classes
3. Load `ai-models.json` model registry
4. Dot-source all Private/ and Public/ functions
5. Import companion modules (AIEnrich, DocConverters)
6. Load taxonomy data into `$script:TaxonomyData`
7. Load policy registry
8. Register `-Model` argument completers for 17 cmdlets
9. Create convenience aliases

## Key Algorithms

### FIRE (Iterative Extraction)
Confidence-gated multi-turn extraction. Each claim gets a confidence score; low-confidence claims trigger targeted follow-up queries. Guardrails: max 5 iterations per claim, max 20 per document, max 5 minutes wall-clock.

### RAG Context Selection
Embed the document's first 500 words + title, compute cosine similarity against all taxonomy embeddings, select top-N most relevant nodes to inject into the summarization prompt. Bypass with `-FullTaxonomy`.

### CHESS Pre-Classification
Before RAG, classify which POVs are relevant to the document via text similarity against each camp's corpus. Narrows the search space for RAG.

### Document Chunking
Split large documents at Markdown headings, pack sections into token-budgeted chunks (default 15K tokens, estimated at 4 chars/token), merge runts into previous chunks to avoid fragmented processing.

## Error Handling

All cmdlets use `New-ActionableError` with Goal, Problem, Location, and Next Steps. Console output uses themed helpers: `Write-Step` (cyan), `Write-OK` (green), `Write-Warn` (yellow), `Write-Fail` (red), `Write-Info` (gray).
