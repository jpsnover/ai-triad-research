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
- **Never `git add` or `git commit`** files tracked by the overlay: `.orca.yaml`, `.orca/`, `.orca-gitignore`, and every **nested** `AGENTS.md`
- Run `ogit` from the repo root — `.orca-git` is not visible from subdirectories
- A **new** nested `AGENTS.md` needs `ogit add -f` — the overlay whitelist alone does not stage it

**Creating a role/instance?** After `create_role`/`create_instance`, the generated nested `AGENTS.md` is tracked by **neither** repo until you overlay-track it — do this **before** your next commit:

1. `ogit add -f <new-role>/AGENTS.md`  (the overlay whitelist alone does not stage a *new* nested file — t/1971)
2. `sh .githooks/agent-file-owner.sh --audit`  → expect **clean**
3. Commit normally. **Never** `--no-verify` past the audit — that strands the file with no backing repo (F3 orphan; Pattern #146). If the audit instead flags a `.worktrees/<name>/AGENTS.md`, that is a worktree checkout of a main-tracked file — do **not** ogit-add it (t/2205).

**Which repo owns an `AGENTS.md`? Don't recall it — ask (t/2080):**

```
sh .githooks/agent-file-owner.sh --path <file>    # → main | overlay | NEITHER
```

The rule is a predicate, not a list: a file is **main-repo-tracked iff a public-repo consumer needs it without the overlay**. Today that is exactly two files — this root `AGENTS.md` (commit it with **`git`**, not `ogit`) and `operations/devops/azure/AGENTS.md`. Every other `AGENTS.md` is overlay-only.

The two sets are **disjoint by construction**: the code repo's allowlist lives in `.gitignore`, the matching re-exclusions in `.orca-gitignore`. Both `AGENTS.md` above were previously tracked in *both* repos and had silently diverged. The pre-commit hook runs `agent-file-owner.sh --audit` on every commit and **refuses** one that re-creates a double-track — or that leaves a nested `AGENTS.md` tracked by **neither** repo, the state that left two role files with a single unbacked copy on one machine.

### Shared-Checkout Commit Guard (git pre-commit hook)

The fleet shares one `main` checkout, so a commit made **directly on its `main` branch** strands work local-only and diverges `main` from `origin` (t/1926). A committed pre-commit hook (`.githooks/pre-commit`) **refuses** such commits. It also **refuses a commit on a detached HEAD inside a worktree** (t/2009, orphaned-commit guard) — so `/land-from-worktree` is now **branch-first** (`git worktree add -b <branch> ...`). Worktree commits on a **named branch**, non-`main` branches, and `--no-verify` are allowed, so landing is never blocked. Git does not auto-run committed hooks — **enable once per checkout**:

```
git config core.hooksPath .githooks
```

The hook is self-documenting (see its header comment). Owner / emergency override: `git commit --no-verify`.

**Feature work is worktree-only; the shared checkout stays on `main`.** A companion `.githooks/post-checkout` hook **warns** (advisory, non-blocking) the moment the shared tree's HEAD leaves `main` for a feature branch — pointing you to `git worktree add -b <branch>` instead (t/2209). It is silent inside linked worktrees (the correct home for feature work) and on `main`. Don't do feature work on the shared tree: it strands unpushed commits and turns the next `git add -A` into a cross-role sweep.

**Your shell cwd resets to the shared checkout between tool calls (t/2222).** Creating a worktree is **not enough** — the Bash/PowerShell tool returns your shell to the shared tree after every command, so any command that relies on a *previous* `cd` actually runs against the shared `main`. Always `cd` into your worktree **in the same command**: `cd .worktrees/<name> && <cmd>`. Combined with a Shell Quoting Rule slip (below), a mis-quoted command run with the shared tree as cwd word-splits code fragments into **0-byte junk files** scattered across every role's scope — the t/2222 incident sprayed ~35 such files (`lib/debate/setTimeout(r`, `taxonomy-editor/.../r.node_id)`, a file literally named `'`). They are never committed, so no pre-commit guard catches them; they clutter `git status` and risk a `git add -A` sweep. Prevention is behavioral: same-command `cd`, and never paste multi-line JS/TS/PS into the shell — write it to a file and execute (see **Shell Quoting Rule**).

### Pre-Self-Merge Verification (confirm head + CI-on-that-head)

Before `gh pr merge`, confirm the merge lands the commit you intend, onto the base you intend, with checks that ran on **that** commit. Three incident classes: a stale PR-head squash-merged on a predecessor's green checks (#710 — the pushed fix never shipped), a merge that raced an unresolved decision (#701), and two PRs merged into a squash-dead feature branch instead of `main` (#830/#831 — content stranded off-main, t/2470).

Confirm all four first:

0. **Base is `main`.** `gh pr view <N> --json baseRefName` MUST be `main` (or a base the ticket explicitly names). GitHub silently suggests the parent feature branch as base when your branch was cut from one — and a "merged" PR against a branch that later squash-merges leaves your content off-main with no error anywhere.
1. **Head matches your push.** `gh pr view <N> --json headRefOid` MUST equal your latest pushed commit SHA. GitHub's PR-head ref can lag a fresh push by minutes — if it doesn't match, re-push (or `git push --force-with-lease`) and wait for the head to advance. Never merge against a stale head.
2. **CI ran on that exact OID.** `gh run list --commit <headRefOid>` is green — **not** a predecessor's run. A green check attached to an older commit does not vouch for the new one.
3. **No open decision/hold** on the PR you haven't cleared.

A squash-merge of a stale head ships the *old* content on the *old* commit's green — the fix you pushed never lands. Verify; don't assume the PR reflects your last push. The advisory `pre-self-merge-verify` Instant Feedback hook nudges this on every `gh pr merge`; this rule is the contract.

### PR-Flow Practice Rules (approved q/40, 2026-08-12)

- **Batch sequential same-feature work.** When one agent works sequentially on a feature and no other agent is blocked between steps, stage all steps on one branch and open a **single PR** — not a PR per step (the URL-context feature burned 6 CI cycles for one feature). Split anyway when the accumulated diff exceeds ~400 changed lines or mixes unrelated concerns; and revert to per-step PRs the moment a peer needs an intermediate step on `main`.
- **Merge promptly on green.** Once CI is green on your current head, complete the pre-self-merge verification (above) and merge within ~15 minutes — or record the hold (pending decision, blocked dependency, review condition) as a PR/ticket comment so the delay is visible. A green PR sitting unmerged with no recorded hold is drift: it invites stale-head merges and landing races. (Deliberate holds are fine — record them; PR #879's multi-hour hold for a manual visual check was correct *because* it was recorded.)

### Claim Before Implement (approved q/42, 2026-08-12)

Before implementing a ticket assigned to your role, **claim it** — assign it to your specific instance, or comment that you're starting. Multi-instance roles: check for a peer instance's claim, in-flight PR, or recent landed commit on the ticket **before** committing to an implementation approach. Two DebateTool instances implemented t/2514 in parallel (#898 constructor check vs #903 run-entry check); the semantic collision on the merge ref burned two CI cycles. Same failure shape as the incident duplicate-filing rule.

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

## Git Forensics on the Bash Tool

On some Windows agents, MSYS path conversion mangles the `<path>` half of a git colon-revspec (`git show <ref>:<path>`, `cat-file`, `rev-parse <ref>:<path>`) — a **valid** ref then reports a spurious `unknown revision or path`, masquerading as a missing commit/file. It is environment-dependent (varies by Git-for-Windows install; confirmed on ≥2 agents, not reproduced on others), so don't dismiss a peer's report as "just their config." Discriminator: valid ref + `unknown revision` = suspect MSYS, not a real absence. Fix: prefix `MSYS_NO_PATHCONV=1`, or run the git command via the PowerShell tool.

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

### Prevention-per-incident: every diagnosis files observability AND prevention (t/2379)

Every incident diagnosis produces **two** kinds of follow-up, not one:

1. **Observability** — make it *diagnosable* next time (the flight-recorder field / log line / metric the diagnosis wished it had had).
2. **Prevention** — make it *not recur*: the gate, test, or guard that would have caught it before prod.

**A diagnosis that files only observability tickets is incomplete.** Map each incident to a **failure class** (see `docs/CodeReview/failure-classes.md`) and file the prevention that closes that class's gap *for this surface*. Rationale: quality coverage is point-in-time — each gate was sufficient when written; without a prevention ticket per incident, coverage lags system growth and the next prod bug finds the gap, not a gate.

**Gate-touching prevention tickets** (a new/changed CI step, deploy gate, verify script, or config validation) route to **Main (TL)** for Gate Verification: proven with **both arms** (a deliberate failure fires the gate; the clean case passes with zero noise), reliable enough to block prod (a flaky blocking gate is the *next* incident), and config co-located at point of use. See the *Gate signal integrity* rules under **Code Review & Quality** (the tech-lead scope's `AGENTS.md`).
