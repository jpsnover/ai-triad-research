# AGENTS.md

Guidance for agents working in this repository.

## Project Overview

AI Triad Research — multi-perspective research platform for AI policy/safety literature. Berkman Klein Center, 2026. Two sibling repos: this one (code) and `../ai-triad-data` (structured JSON data, ~410 MB).

## Build & Test Commands

Role-specific — see the owning subtree's `AGENTS.md` (auto-loads in scope):

- PowerShell module / Pester / manifest → `scripts/AGENTS.md`
- Taxonomy Editor / poviewer / summary-viewer (npm, vitest, tsc) → `taxonomy-editor/AGENTS.md`
- Debate engine (vitest) → `lib/debate/AGENTS.md`
- CI pipeline (`ci.yml`) → `operations/devops/AGENTS.md`

## Architecture

### Two-Repo Split

Code here; data in `../ai-triad-data`. `.aitriad.json` maps relative paths to data dirs. Override with `$env:AI_TRIAD_DATA_ROOT`. Priority: env var > `.aitriad.json` > monorepo fallback.

### Orca Overlay Repo

Orca config (`.orca.yaml`, nested `AGENTS.md`, `.orca/`) lives in a **separate overlay repo** at `.orca-git/`, keeping Orca infra private while the main repo stays public.

- `git` → main repo; `ogit` (alias for `git --git-dir=.orca-git --work-tree=.`) → overlay. Run `ogit` from repo root only.
- **Never `git add`/`commit`** overlay-tracked files: `.orca.yaml`, `.orca/`, `.orca-gitignore`, every **nested** `AGENTS.md`.
- Which repo owns an `AGENTS.md`? Don't guess — run `sh .githooks/agent-file-owner.sh --path <file>` → `main | overlay | NEITHER` (t/2080). Rule: main-repo-tracked **iff a public-repo consumer needs it without the overlay** — today exactly two files, this root `AGENTS.md` and `operations/devops/azure/AGENTS.md` (commit both with `git`). All other `AGENTS.md` are overlay-only. The sets are disjoint by construction (`.gitignore` allowlist vs `.orca-gitignore` re-exclusions); the pre-commit audit refuses any double-track or neither-tracked nested file.

**Creating a role/instance?** The generated nested `AGENTS.md` is tracked by neither repo until you overlay-track it — before your next commit:
1. `ogit add -f <new-role>/AGENTS.md` (whitelist alone won't stage a *new* file — t/1971).
2. `sh .githooks/agent-file-owner.sh --audit` → expect clean.
3. Commit normally. **Never `--no-verify` past the audit** (strands an unbacked orphan — Pattern #146). If the audit flags a `.worktrees/<name>/AGENTS.md`, that's a worktree checkout of a main-tracked file — do **not** ogit-add it (t/2205).

### Shared-Checkout Commit Guard (pre-commit hook)

The fleet shares one `main` checkout, so committing **directly on `main`** strands work local-only (t/1926). `.githooks/pre-commit` refuses commits on `main` and on a detached HEAD inside a worktree (t/2009). Commits on named/non-`main` branches and `--no-verify` are allowed, so landing is never blocked. Enable once per checkout: `git config core.hooksPath .githooks`. Emergency override: `git commit --no-verify`.

**Feature work is worktree-only; shared checkout stays on `main`.** `/land-from-worktree` is branch-first (`git worktree add -b <branch>`). A `.githooks/post-checkout` hook warns (advisory) when the shared tree leaves `main` (t/2209).

**Confirm you're in a worktree before your FIRST edit (t/3207).** Before editing any tracked file for feature work, confirm your cwd/target is under `.worktrees/<name>`, not the shared checkout. Editing tracked files on the shared `main` tree leaks uncommitted WIP (and risks a `git add -A` sweep spraying 0-byte junk) — the PreToolUse Edit/Write hook warns, but the discipline is: worktree first, then edit.

**Shell cwd resets to the shared checkout between tool calls (t/2222).** Creating a worktree isn't enough — always `cd` into it **in the same command**: `cd .worktrees/<name> && <cmd>`. A stray `cd`-reliant command combined with a mis-quote sprays 0-byte junk files across every scope. Prevention: same-command `cd`; never paste multi-line code into the shell (see Shell Quoting Rule).

### Pre-Self-Merge Verification

Before `gh pr merge`, confirm all four (prevents stranded/stale-head merges — #710, #701, #830/#831, t/2470):
0. **Base is `main`** — `gh pr view <N> --json baseRefName` (GitHub silently suggests the parent feature branch).
1. **Head matches your push — ENFORCE it with `--match-head-commit`.** Always self-merge as:
   `gh pr merge <N> --squash --match-head-commit $(gh pr view <N> --json headRefOid -q .headRefOid)`
   GitHub then refuses the merge *atomically* if the live head ≠ that SHA — race-free: a stale local view OR a newer push both abort instead of stranding the later commit (#1868). Never run a bare `gh pr merge` without this flag.
2. **CI ran on that exact OID** — `gh run list --commit <headRefOid>` is green, not a predecessor's.
3. **No open decision/hold** you haven't cleared.

The `pre-self-merge-verify` hook **blocks** a manual `gh pr merge` that omits `--match-head-commit` (t/3270; pure-predicate `operations/devops/merge-guard-predicate.mjs`, both arms proven). `--auto` is exempt — it can't carry the flag and is stale-head-safe by GitHub re-targeting; its gated-PR risk is the draft-discipline's job. **Emergency override** (broken tooling / P1 hotfix), same spirit as the commit-guard's `--no-verify`: `disable_feedback_rule pre-self-merge-verify`, merge, then re-enable.

### PR-Flow Practice Rules (q/40)

- **Batch sequential same-feature work** onto one branch / one PR unless the diff exceeds ~400 lines, mixes concerns, or a peer needs an intermediate step on `main`.
- **Merge promptly on green** — verify (above) and merge within ~15 min, or record the hold as a PR/ticket comment. An unmerged green PR with no recorded hold is drift.
- **Gated PRs stay draft; never enable auto-merge on a gated PR.** A comment/design/`blocks` hold gives visibility but does **not** gate GitHub; only draft enforces. Un-draft only when the gate is verifiably clear (t/2603/#997).

### Claim Before Implement (q/42)

Before implementing an assigned ticket, claim it (assign to your instance or comment you're starting). Multi-instance roles: check for a peer's claim, in-flight PR, or recent landed commit **before** choosing an approach (parallel impls of t/2514 burned two CI cycles).

### Subsystem Map

Detailed conventions live in each subtree's `AGENTS.md`. Orientation only:

- **PowerShell module** (`scripts/AITriad/`) — 40+ cmdlets (Public/Private), prompts in `Prompts/`, `AIEnrich.psm1` (multi-backend AI) + `DocConverters.psm1`. → `scripts/AGENTS.md`
- **Electron apps** — 3 independent Vite + React 19 + Electron 35 + TS apps: **taxonomy-editor/** (Zustand + Zod), **poviewer/** (pdfjs-dist), **summary-viewer/**. → `taxonomy-editor/AGENTS.md`
- **Debate engine** (`lib/debate/`) — three-agent BDI (Accelerationist / Safetyist / Skeptic). Entry: `Show-TriadDialogue` or `npm run debate`; `aiAdapter.ts` abstracts backends. → `lib/debate/AGENTS.md`

### Taxonomy Model

Four POV camps with BDI categories. Node IDs: `{pov}-{category}-{NNN}` (pov ∈ `acc`/`saf`/`skp`/`cc`). Policy actions use `pol-*` IDs in `policy_actions.json`. Embeddings: all-MiniLM-L6-v2, 384-dim in `embeddings.json`.

**Data File Convention:** JSON files use nested structures — never assume flat schemas; inspect a sample (`head`/`jq`) first. Enriched fields live under `node.graph_attributes.*`; `embeddings.json` wraps entries under `data['nodes']`; field types vary (list vs dict) — check `type()`/`isinstance()` before use.

### AI Backends

Configured in `ai-models.json` (single source of truth for PS + Electron): Gemini, Claude, Groq. Keys via `Register-AIBackend` or env vars (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `AI_API_KEY` fallback). **Before landing any edit, run `npm run verify:config`** (runs all six registry-completeness gates; t/1933). Adding a backend? Follow `/add-ai-backend`.

## Shell Quoting Rule

For code with special shell chars (template literals, nested quotes, apostrophes, backticks, `$` vars, f-strings), **use Edit/Write, not Bash `sed`/`awk`/heredocs**. Run Python/PowerShell scripts from a temp file (Write then execute), never inline heredocs. Shell escaping is the #1 silent-corruption source.

**Junk-file hygiene (t/2112).** Mis-quoted Bash commands word-split into 0-byte files named after the fragment (`0)`, `30s`, `{,+`). Before any `git add`, scan `git status --short` for bare-fragment filenames and `rm --` them. Prefer explicit paths over `git add -A`/`-u`.

## Git Forensics on the Bash Tool

On some Windows agents, MSYS path conversion mangles the `<path>` half of a git colon-revspec (`git show <ref>:<path>`, `cat-file`, `rev-parse`), so a **valid** ref reports a spurious `unknown revision or path`. Discriminator: valid ref + `unknown revision` = suspect MSYS, not a real absence (confirmed on ≥2 agents). Fix: prefix `MSYS_NO_PATHCONV=1` or run via PowerShell.

## Error Handling Convention

Unrecoverable errors use `New-ActionableError` (PS) / `ActionableError` (TS) with **Goal / Problem / Location / Next Steps**. Never bare `throw "message"`. Prefer recovery over failure. See `docs/error-handling.md`.

**Log every fallback path, and why.** Whenever code takes a fallback / degraded / alternate path instead of the primary one (cache miss → recompute, primary → secondary backend, retry-exhausted → default, ADR-001 graceful-empty, flag-off branch, any catch-and-continue), emit a `WARN` recording **that** the fallback was taken and **why** (the triggering condition + discriminating data). A silent fallback is invisible degradation — every layer reports local success while the aggregate is broken (t/3165). Full rule: **Fallback-Path Logging** in `docs/error-handling.md`.

**Assert against rendered labels, not param names (PS).** `New-ActionableError` renders `-Problem` as `Error:` and `-NextSteps` as `Resolve:` (labels: `Goal:`/`Error:`/`Location:`/`Resolve:`). Assertions on emitted text must match the rendered labels or they spuriously fail (t/2952).

## Token Efficiency

- Batch ToolSearch: fetch all schemas in one `select:t1,t2,t3` call.
- Prefer ping over email for status updates and single-question exchanges.
- Use `verbose:false` / `include_ids:false` on MCP list/create calls unless IDs are needed.
- Don't re-read AGENTS.md (already injected as claudeMd).
- Keep comments/emails concise; reference entities (t/KEY) instead of inlining.

## Incident Response

- **Claim follow-ups before filing.** During a live incident, claim a follow-up on the anchor thread before `create_ticket` — prevents duplicate filings (t/2053+t/2054, t/2061+t/2062).
- **Claim binds per-instance and to writes, not just filings (t/2945).** Claim per instance/background-job on the anchor **before any shared-tree write** *and* before any filing. The anchor is a visibility point, not a lock; where serialization is required, re-read the anchor after claiming before acting.
- The Technical Lead coordinates incidents (`/tl-incident-response`); the anchor ticket is the source of truth.

### Prevention-per-incident (t/2379)

Every diagnosis files **two** follow-ups: **Observability** (make it diagnosable next time) **and Prevention** (the gate/test/guard that stops recurrence). Map each incident to a failure class (`docs/CodeReview/failure-classes.md`) and file the prevention that closes that class's gap for this surface. Gate-touching prevention tickets route to **Main (TL)** for Gate Verification (both arms proven; no flaky blocking gates; config co-located).

### Second recurrence → baseline validation (t/3085)

When an incident maps to a failure class that has **already recurred**, the diagnosis MUST include a **baseline-validation pass**: state what load/latency/behavior you treat as "normal," then verify it against **design intent** (docs, precomputation assets, original PR/ticket) — not just recent observations. A recurring class whose fixes keep landing at the symptom layer signals the assumed baseline is itself the bug.

## Ticket Lifecycle

- Starting work → `transition_ticket` to **In Progress** immediately.
- Done (PR merged or no-code task complete) → **Done**.
- Never leave a ticket Unstarted while actively working it.

## Second Opinion

Any Main instance may consult `main.engineering-second-opinion@ai-triad-research.orca.local` when any one holds: **irreversibility** (>1 sprint to undo, prod data, shared infra), **cost/risk asymmetry**, **novel territory** (no precedent), **conflicting signals** (no tie-breaker), **security/compliance surface**, or **post-incident gate design**.

**Non-triggers:** playbook-covered routine work, easily-reversed single-role decisions, clarifying questions (use QnA/human). Consult via email with proposal, alternatives, what's at stake, time constraint. Response is Recommendation / Key risks / Conditions / Dissent.
