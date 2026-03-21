# AI Triad Research Repository

**Status:** Private
**Fellowship:** Berkman Klein Center, 2026

## Purpose

Multi-perspective research platform for AI policy and safety literature. Organizes sources through a four-POV taxonomy (accelerationist, safetyist, skeptic, cross-cutting), ingests documents, generates AI-powered summaries, and detects factual conflicts across viewpoints.

## Directory Layout

```
taxonomy/           Conceptual taxonomy (one file per POV camp + embeddings + edges)
sources/            Ingested source documents (raw + Markdown snapshot + metadata)
summaries/          AI-generated POV summaries (keyed by doc-id)
conflicts/          Living log of disputed factual claims (keyed by claim-id)
debates/            Multi-agent debate transcripts (JSON)
scripts/            PowerShell module + Python embeddings + AI enrichment
taxonomy-editor/    Electron + React desktop app — taxonomy editing + debates
poviewer/           Electron + React — POV analysis viewer
summary-viewer/     Electron + React — summary browser
edge-viewer/        Electron + React — graph edge browser
docs/               Documentation and proposals
.github/workflows/  GitHub Actions (batch reprocess on taxonomy version bump)
```

## Quick Start

### Prerequisites

- **PowerShell 7+** — [Install](https://aka.ms/powershell)
- **Node.js 20+** — [Install](https://nodejs.org/)
- **At least one AI API key** — Gemini (free tier), Claude, or Groq

### Setup

```powershell
# 1. Clone the repo
git clone https://github.com/jpsnover/ai-triad-research.git
cd ai-triad-research

# 2. Load the module
Import-Module ./scripts/AITriad/AITriad.psm1

# 3. Check dependencies (installs missing ones with -Fix)
Install-Dependencies -Fix

# 4. Configure your AI API key (opens a browser-based UI)
Register-AIBackend

# 5. Verify everything works
Test-Dependencies
```

### Optional Setup

```powershell
# Python embeddings (for semantic search)
pip install -r scripts/requirements.txt
Update-TaxEmbeddings

# Neo4j graph database (requires Docker)
Install-GraphDatabase

# Install Electron app dependencies
cd taxonomy-editor && npm install && cd ..
cd poviewer && npm install && cd ..
cd summary-viewer && npm install && cd ..
cd edge-viewer && npm install && cd ..
```

### Desktop Apps

```powershell
Show-TaxonomyEditor    # or: TaxonomyEditor
Show-POViewer          # or: POViewer
Show-SummaryViewer     # or: SummaryViewer
Show-EdgeViewer        # or: EdgeViewer
```

### Core Workflow

```powershell
# Ingest a document
Import-AITriadDocument -Path paper.pdf -Title "Paper Title" -PovTags accelerationist

# Generate POV summaries
Invoke-POVSummary -DocId paper-title-2026

# Detect conflicts across summaries
Find-Conflict -DocId paper-title-2026

# View taxonomy health
Get-TaxonomyHealth -GraphMode

# Run a three-agent debate
Show-TriadDialogue "Should AI be regulated like a public utility?"

# Get full help
Show-AITriadHelp
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes (primary) | Google Gemini API key |
| `ANTHROPIC_API_KEY` | No | Anthropic Claude API key |
| `GROQ_API_KEY` | No | Groq API key |
| `AI_API_KEY` | No | Universal fallback key |
| `AI_MODEL` | No | Default model override |
| `NEO4J_PASSWORD` | No | Neo4j password (default: aitriad2026) |

Use `Register-AIBackend` to configure keys via a GUI, or set them manually.
Settings are persisted to `~/.aitriad-env` — add `. ~/.aitriad-env` to your shell profile.

## Taxonomy Version

Current version is tracked in `TAXONOMY_VERSION`. Bumping it triggers CI batch re-summarization.
