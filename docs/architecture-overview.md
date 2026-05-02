# AI Triad Research — System Architecture

## Purpose

AI Triad Research is a multi-perspective research platform for AI policy and safety literature. It organizes scholarly arguments into a structured taxonomy, detects conflicts between perspectives, and simulates structured debates between three AI-driven characters representing distinct viewpoints. The platform is developed at the Berkman Klein Center (2026).

The system serves researchers, policy analysts, and scholars who need to understand the landscape of AI governance arguments — not just what people are saying, but how those arguments relate to, support, and contradict each other.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interfaces                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Taxonomy     │  │  POV         │  │  Summary         │  │
│  │  Editor       │  │  Viewer      │  │  Viewer          │  │
│  │  (Electron)   │  │  (Electron)  │  │  (Electron)      │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                  │                    │            │
│  ┌──────┴──────────────────┴────────────────────┴─────────┐ │
│  │              Shared TypeScript Libraries                │ │
│  │  lib/debate/  ·  lib/dictionary/  ·  lib/translation/  │ │
│  └──────────────────────────┬─────────────────────────────┘ │
└─────────────────────────────┼───────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────┐
│              PowerShell Module (AITriad)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ 75 Public│ │33 Private│ │29 Prompt │ │  Companion    │   │
│  │ Cmdlets  │ │ Helpers  │ │Templates │ │  Modules      │   │
│  │          │ │          │ │          │ │ AIEnrich.psm1 │   │
│  │          │ │          │ │          │ │ DocConvert.psm│   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
└─────────────────────────────┼───────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────┐
│                  AI Backends                                 │
│  ┌──────────┐  ┌───────────┐  ┌──────┐  ┌──────────────┐   │
│  │  Gemini  │  │  Claude   │  │ Groq │  │  OpenAI      │   │
│  │  (free)  │  │           │  │(free)│  │  (future)    │   │
│  └──────────┘  └───────────┘  └──────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────┐
│                   Data Layer                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              ai-triad-data (sibling repo, ~410 MB)    │  │
│  │  taxonomy/  sources/  summaries/  conflicts/  debates/│  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Two-Repository Split

Code and data live in separate repositories:

| Repository | Contents | Size |
|---|---|---|
| `ai-triad-research` (this repo) | All source code, scripts, Electron apps, CI/CD | ~50 MB |
| `ai-triad-data` (sibling) | Taxonomy JSON, source documents, summaries, debates | ~410 MB |

The file `.aitriad.json` in the code repo maps relative paths to data directories. Data paths resolve in priority order: `$env:AI_TRIAD_DATA_ROOT` > `.aitriad.json` > platform-specific default (`%LOCALAPPDATA%\AITriad\data` on Windows, `~/Library/Application Support/AITriad/data` on macOS, `$XDG_DATA_HOME/aitriad/data` on Linux).

## Major Subsystems

### 1. Taxonomy Model

The core data structure — a graph of ~320 nodes representing arguments about AI policy, organized by perspective and argument type. Four POV camps (Accelerationist, Safetyist, Skeptic, Situations) each decomposed into Belief-Desire-Intention categories. Nodes link to each other via typed edges (SUPPORTS, CONTRADICTS, ASSUMES, etc.) and reference shared policy actions from a centralized registry of ~1,100 policies.

**See:** [Taxonomy & Data Model](./subsystem-taxonomy.md)

### 2. PowerShell Module

75 public cmdlets for taxonomy queries, document ingestion, AI-powered summarization, conflict detection, graph analysis, and debate orchestration. Companion modules handle multi-backend AI abstraction (AIEnrich) and document format conversion (DocConverters).

**See:** [PowerShell Module](./subsystem-powershell.md)

### 3. Debate Engine

A three-agent BDI debate system in TypeScript. Characters (Prometheus, Sentinel, Cassandra) argue grounded in the taxonomy, with a moderator agent managing interventions, convergence detection, and phase transitions. Produces structured transcripts with QBAF (Quantitative Bipolar Argumentation Framework) networks.

**See:** [Debate Engine](./subsystem-debate-engine.md)

### 4. Taxonomy Editor

The primary user interface — an Electron + React application for editing taxonomy nodes, running debates, viewing argument graphs, and managing the research workflow. Deploys both as a desktop app and as a containerized web app on Azure.

**See:** [Taxonomy Editor](./subsystem-taxonomy-editor.md)

### 5. Supporting Applications

Two additional Electron apps: POViewer (three-pane document viewer with PDF rendering and AI summarization) and Summary Viewer (summary browser).

### 6. Infrastructure & Deployment

GitHub Actions CI/CD, Docker multi-platform builds, Azure Container Apps deployment via Bicep, and a BYOK (Bring Your Own Key) model for API key management.

**See:** [Infrastructure & Deployment](./subsystem-infrastructure.md)

## AI Backend Architecture

All AI calls route through a unified abstraction layer. The PowerShell side uses `Invoke-AIApi` (in AIEnrich.psm1); the TypeScript side uses `aiAdapter.ts`. Both read from `ai-models.json` — the single source of truth for model IDs, backend mappings, and API endpoints.

| Backend | API | Key Env Var | Default Model |
|---|---|---|---|
| Google Gemini | generativelanguage.googleapis.com | `GEMINI_API_KEY` | gemini-3.1-flash-lite-preview |
| Anthropic Claude | api.anthropic.com | `ANTHROPIC_API_KEY` | claude-sonnet-4-5 |
| Groq | api.groq.com | `GROQ_API_KEY` | groq-openai-gpt-oss-120b |
| OpenAI | api.openai.com | `OPENAI_API_KEY` | (future) |

Fallback key: `$AI_API_KEY` works for any backend if the specific env var is unset.

Retry strategy: exponential backoff on HTTP 429/503/529, with delays of 15/45/90/120 seconds across up to 5 attempts.

## Data Flow

### Document Ingestion Pipeline

```
URL or File
    │
    ▼
Import-AITriadDocument ── slug generation, raw storage, Markdown snapshot
    │
    ▼
Invoke-POVSummary ── CHESS classification → RAG → AI extraction (FIRE or single-shot)
    │
    ▼
Find-Conflict / Invoke-QbafConflictAnalysis ── cross-summary conflict detection
    │
    ▼
Taxonomy Updates ── new nodes, edges, policy mappings
```

### Debate Flow

```
Topic + optional source document
    │
    ▼
Document Analysis ── extract claims, tension points, I-nodes
    │
    ▼
Edit Claims (optional) ── user reviews/edits extracted claims
    │
    ▼
Opening Statements ── each character states position grounded in taxonomy
    │
    ▼
Debate Rounds ── moderated turn-taking with interventions
    │                  └── moderator: budget, cooldown, drift detection
    │
    ▼
Synthesis ── convergence detection, final statements
    │
    ▼
QBAF Network ── quantified argument strengths and relationships
```

## Error Handling

All unrecoverable errors use `New-ActionableError` (PowerShell) or `ActionableError` (TypeScript) with four fields: Goal, Problem, Location, Next Steps. The convention is documented in `docs/error-handling.md`. Recovery (retry, fallback, partial results) is always preferred over hard failure.

## Testing

| Layer | Framework | Location | Run Command |
|---|---|---|---|
| PowerShell module | Pester | `tests/` | `Invoke-Pester ./tests/` |
| Debate engine | Vitest | `lib/debate/*.test.ts` | `npm test` (from repo root) |
| Dictionary/Translation | Vitest | `lib/dictionary/__tests__/`, `lib/translation/__tests__/` | `npm test` |
| Taxonomy Editor | Vitest | `taxonomy-editor/` | `cd taxonomy-editor && npm test` |

## CI/CD

Two primary CI jobs run on every push/PR to main:
1. **test-powershell** — Pester tests, module build, manifest validation
2. **test-electron** — npm install, TypeScript check, Electron build

Additional workflows handle releases (triggered by `v*` tags), Azure deployment (manual), Docker builds, batch summarization, and conflict clustering.

## Related Documentation

| Document | Purpose |
|---|---|
| [Taxonomy & Data Model](./subsystem-taxonomy.md) | Node structure, POV camps, BDI categories, edges, policies, embeddings |
| [PowerShell Module](./subsystem-powershell.md) | 75 cmdlets, companion modules, prompt templates, data resolution |
| [Debate Engine](./subsystem-debate-engine.md) | Three-agent debates, moderator system, QBAF, phase transitions |
| [Taxonomy Editor](./subsystem-taxonomy-editor.md) | Electron app, React components, Zustand stores, IPC layer |
| [Infrastructure & Deployment](./subsystem-infrastructure.md) | CI/CD, Docker, Azure, BYOK key management |
| [Error Handling](./error-handling.md) | ActionableError convention and examples |
| [Debate System Overview](./debate-system-overview.md) | End-to-end debate flow (existing doc) |
