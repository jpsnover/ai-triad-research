# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Triad Research — multi-perspective research platform for AI policy/safety literature. Berkman Klein Center, 2026. Two sibling repos: this one (code) and `../ai-triad-data` (structured JSON data, ~410 MB).

## Build & Test Commands

Build and test commands are role-specific — see the owning subtree's `AGENTS.md` (they load automatically when you work in that scope):

- **PowerShell module / Pester / manifest** → `scripts/AGENTS.md`
- **Taxonomy Editor / poviewer / summary-viewer (npm, vitest, tsc)** → `taxonomy-editor/AGENTS.md`
- **Debate engine (vitest)** → `lib/debate/AGENTS.md`
- **CI pipeline (`ci.yml` jobs)** → `operations/devops/AGENTS.md`

## Architecture

### Two-Repo Split

Code lives here; data lives in `../ai-triad-data`. The file `.aitriad.json` maps relative paths to data directories. Override with `$env:AI_TRIAD_DATA_ROOT`. Priority: env var > `.aitriad.json` > monorepo fallback.

### Orca Overlay Repo

Orca config files (`.orca.yaml`, `AGENTS.md`, `.orca/` directory) live in a **separate overlay repo** stored at `.orca-git/`. This keeps Orca infrastructure private while the main project repo stays public.

- **`git` commands** operate on the main project repo
- **`ogit` commands** (alias for `git --git-dir=.orca-git --work-tree=.`) operate on the overlay
- **Never `git add` or `git commit`** files tracked by the overlay: `.orca.yaml`, `AGENTS.md`, `.orca/`, `.orca-gitignore`
- If you need to update AGENTS.md, edit it normally but commit via `ogit`, not `git`
- Run `ogit` from the repo root — `.orca-git` is not visible from subdirectories

### Shared-Checkout Commit Guard (git pre-commit hook)

The fleet shares one `main` checkout, so a commit made **directly on its `main` branch** strands work local-only and diverges `main` from `origin` (t/1926). A committed pre-commit hook (`.githooks/pre-commit`) **refuses** such commits. It also **refuses a commit on a detached HEAD inside a worktree** (t/2009, orphaned-commit guard) — so `/land-from-worktree` is now **branch-first** (`git worktree add -b <branch> ...`). Worktree commits on a **named branch**, non-`main` branches, and `--no-verify` are allowed, so landing is never blocked. Git does not auto-run committed hooks — **enable once per checkout**:

```
git config core.hooksPath .githooks
```

The hook is self-documenting (see its header comment). Owner / emergency override: `git commit --no-verify`.

### Subsystem Map

Detailed conventions and build/test commands live in each subtree's `AGENTS.md` (loaded when you work in that scope). This is the orientation map only.

- **PowerShell module** (`scripts/AITriad/`) — 40+ cmdlets (Public/Private split), AI prompt templates in `Prompts/`, companion `AIEnrich.psm1` (multi-backend AI abstraction) + `DocConverters.psm1` (doc→Markdown). → `scripts/AGENTS.md`
- **Electron apps** — 3 independent apps, each Vite + React 19 + Electron 35 + TypeScript: **taxonomy-editor/** (main editing UI; Zustand + Zod), **poviewer/** (POV analysis; pdfjs-dist), **summary-viewer/**. → `taxonomy-editor/AGENTS.md`
- **Debate engine** (`lib/debate/`) — three-agent BDI system (Accelerationist / Safetyist / Skeptic). Entry points: `Show-TriadDialogue` (PowerShell) or `npm run debate` (CLI). `aiAdapter.ts` abstracts multi-backend AI calls. → `lib/debate/AGENTS.md`

### Taxonomy Model

Four POV camps with BDI categories (Beliefs, Desires, Intentions). Node IDs: `{pov}-{category}-{NNN}` where pov is `acc`/`saf`/`skp`/`cc`. Policy actions use `pol-*` IDs in a shared registry (`policy_actions.json`). Embeddings: all-MiniLM-L6-v2, 384-dim in `embeddings.json`.

**Data File Convention:** Project JSON files use nested structures — never assume flat schemas. Always inspect a sample (`head` or `jq`) before coding against data files. Common patterns: enriched fields live under `node.graph_attributes.*` (not at node root), `embeddings.json` wraps entries under `data['nodes']` with metadata at top level, and field types vary per context (list vs dict). Check `type()` / `isinstance()` before calling type-specific methods.

### AI Backends

Configured in `ai-models.json` (single source of truth for PS and Electron). Backends: Google Gemini (free tier), Anthropic Claude, Groq (free tier). Keys via `Register-AIBackend` or env vars (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `AI_API_KEY` fallback).

**Before landing any `ai-models.json` edit, run `npm run verify:config`** — it runs all six registry-completeness gates (whose signal lives in other packages' suites) in one command and exits non-zero naming the failing gate; skipping it is how an incomplete edit went red in CI (t/1933). Adding a backend? Follow the `/add-ai-backend` playbook — it enumerates every coupling site.

## Shell Quoting Rule

When writing, editing, or executing code containing special shell characters (template literals, nested quotes, apostrophes, backticks, `$` variables, f-strings), **always use Edit/Write tools** instead of Bash `sed`, `awk`, or heredocs. When running Python/PowerShell scripts that contain quotes or f-strings, write the script to a temp file with the `Write` tool and execute it, rather than inlining in a heredoc or `bash -c`. Shell escaping is the #1 source of silent corruption bugs.

## Error Handling Convention

All unrecoverable errors must use `New-ActionableError` (PowerShell) or `ActionableError` (TypeScript) with four fields: **Goal**, **Problem**, **Location**, **Next Steps**. Never use bare `throw "message"`. Prefer recovery (retry, fallback, partial results) over failure. See `docs/error-handling.md`.

## Token Efficiency

- Batch ToolSearch: always fetch all needed schemas in one call (select:t1,t2,t3)
- Prefer ping over email for status updates and single-question exchanges
- Use verbose:false and include_ids:false on all MCP list/create calls unless IDs are needed
- Do not re-read AGENTS.md — it is already injected as claudeMd
- Keep ticket comments and email bodies concise; reference entities (t/KEY) instead of inlining content

## Incident Response

- **Live incident: claim follow-ups before filing.** Before `create_ticket` for a follow-up during an active incident, claim it on the incident anchor thread (or route through the incident coordinator) — prevents concurrent duplicate filings across roles (this bit twice: t/2053+t/2054, t/2061+t/2062).
- The Technical Lead coordinates incidents (runs `/tl-incident-response`); the anchor ticket is the source of truth for status and follow-up claims.
