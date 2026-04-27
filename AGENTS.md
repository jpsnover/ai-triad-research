# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Triad Research — multi-perspective research platform for AI policy/safety literature. Berkman Klein Center, 2026. Two sibling repos: this one (code) and `../ai-triad-data` (structured JSON data, ~410 MB).

## Build & Test Commands

```powershell
# Load the PowerShell module (required before using any cmdlet)
Import-Module ./scripts/AITriad/AITriad.psm1

# Run all Pester tests
Invoke-Pester ./tests/

# Run a single Pester test by name
Invoke-Pester ./tests/ -Filter @{ FullName = '*test name pattern*' }

# Build distributable module
./scripts/Build-Module.ps1 -Clean

# Validate built manifest
Test-ModuleManifest -Path ./build/AITriad/AITriad.psd1
```

```bash
# Taxonomy Editor (Electron + React)
cd taxonomy-editor && npm ci && npm test        # run vitest suite
cd taxonomy-editor && npm run test:watch         # watch mode
cd taxonomy-editor && npm run dev                # dev server (port 5173)
cd taxonomy-editor && npx tsc --noEmit -p tsconfig.main.json  # type check

# POViewer / Summary Viewer (no test suites yet)
cd poviewer && npm ci && npm run dev             # port 5174
cd summary-viewer && npm ci && npm run dev       # port 5175
```

## Architecture

### Two-Repo Split

Code lives here; data lives in `../ai-triad-data`. The file `.aitriad.json` maps relative paths to data directories. Override with `$env:AI_TRIAD_DATA_ROOT`. Priority: env var > `.aitriad.json` > monorepo fallback.

### PowerShell Module (`scripts/AITriad/`)

40+ cmdlets in `Public/`, internal helpers in `Private/`, AI prompt templates in `Prompts/`. Module manifest: `AITriad.psd1` (v0.7.4). Companion modules loaded alongside: `AIEnrich.psm1` (multi-backend AI abstraction with streaming, retry, token tracking) and `DocConverters.psm1` (PDF/DOCX/HTML to Markdown via pandoc/gs).

### Electron Apps (3 independent apps, each Vite + React 19 + Electron 35 + TypeScript)

- **taxonomy-editor/** — Main editing UI for the taxonomy graph. Includes integrated Edge Browser. Uses Zustand for state, Zod for validation.
- **poviewer/** — POV analysis viewer. Uses pdfjs-dist and Google GenAI SDK.
- **summary-viewer/** — Summary browser.

### Debate Engine (`lib/debate/`, 22 TypeScript files)

Three-agent BDI debate system. Characters: Prometheus (accelerationist), Sentinel (safetyist), Cassandra (skeptic). Entry points: `Show-TriadDialogue` (PowerShell) or `npm run debate` (CLI via tsx). `aiAdapter.ts` abstracts multi-backend AI calls; `prompts.ts` has 27+ prompt templates.

### Taxonomy Model

Four POV camps with BDI categories (Beliefs, Desires, Intentions). Node IDs: `{pov}-{category}-{NNN}` where pov is `acc`/`saf`/`skp`/`cc`. Policy actions use `pol-*` IDs in a shared registry (`policy_actions.json`). Embeddings: all-MiniLM-L6-v2, 384-dim in `embeddings.json`.

### AI Backends

Configured in `ai-models.json` (single source of truth for PS and Electron). Backends: Google Gemini (free tier), Anthropic Claude, Groq (free tier). Keys via `Register-AIBackend` or env vars (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `AI_API_KEY` fallback).

## Error Handling Convention

All unrecoverable errors must use `New-ActionableError` (PowerShell) or `ActionableError` (TypeScript) with four fields: **Goal**, **Problem**, **Location**, **Next Steps**. Never use bare `throw "message"`. Prefer recovery (retry, fallback, partial results) over failure. See `docs/error-handling.md`.

## Version Update Checklist

When bumping the module version, verify that **all** of the following files are updated consistently:

1. `scripts/AITriad/AITriad.psd1` — source manifest (`ModuleVersion`)
2. `build/AITriad/AITriad.psd1` — built manifest (rebuilt via `Build-Module.ps1 -Clean`)
3. `CLAUDE.md` — the version mentioned in the Architecture / PowerShell Module section

After updating, run `Test-ModuleManifest -Path ./build/AITriad/AITriad.psd1` to confirm the build is coherent. Never publish to PSGallery without rebuilding first — the build manifest must match the source manifest.

## CI Pipeline (`.github/workflows/ci.yml`)

Two jobs on push/PR to main:
1. **test-powershell** — Pester tests, module build, manifest validation
2. **test-electron** — `npm ci`, TypeScript check, build (taxonomy-editor only)
