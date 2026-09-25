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

### Workflow Mode — `.orca/workflow-mode` (t/3632)

**Read the mode before assuming the rules below.** A single overlay-tracked file, `.orca/workflow-mode`, selects the fleet's branching discipline. Line 1 is the mode; everything from `#` is provenance (who set it, when, why). Check it with `sh .githooks/read-workflow-mode.sh`.

- **`worktree`** (strict) — feature work happens in a worktree off a branch; the shared checkout stays on `main`; `pre-commit` refuses commits on `main`.
- **`direct`** — worktrees and branches are not required; commits on `main` in the shared checkout are permitted.

**Fail-safe:** anything other than exactly `direct` on line 1 — missing file, empty, `Direct`, `direct foo` — resolves to `worktree`. A deleted or corrupt file tightens, never loosens. The canonical parse (trimmed line 1, case-sensitive `== "direct"`) lives in `.githooks/read-workflow-mode.sh`; the two feedback-rule scripts mirror it.

**Changing the mode is a deliberate act, not a preference.** `direct` removes a protection born from an incident (t/1926): the fleet shares one `main` checkout, so a commit there sits in every other agent's tree. That is low-cost when one person works alone and hazardous at high parallelism — **the dangerous transition is leaving `direct` on when the fleet spins back up.** Record set-by/set-at/reason in the file when you change it.

### Shared-Checkout Commit Guard (pre-commit hook)

**Applies in `worktree` mode.** `.githooks/pre-commit` refuses commits on `main` (t/1926); in `direct` mode it permits them. **Both modes** still refuse a commit on a detached HEAD inside a worktree (t/2009) — that guards a different failure and the switch does not govern it. `--no-verify` remains the emergency override. Enable once per checkout: `git config core.hooksPath .githooks`.

**In `worktree` mode, feature work is worktree-only and the shared checkout stays on `main`.** `/land-from-worktree` is branch-first (`git worktree add -b <branch>`). `.githooks/post-checkout` warns (advisory) when the shared tree leaves `main` (t/2209); silent in `direct`.

**Confirm you're in a worktree before your FIRST edit (t/3207) — in `worktree` mode.** Editing tracked files on the shared `main` tree leaks uncommitted WIP and risks a `git add -A` sweep spraying 0-byte junk. The PreToolUse Edit/Write hook warns, but the discipline is: worktree first, then edit. **Known gap:** the two feedback rules do not yet honour `direct` and will warn regardless — noise, not obstruction (t/3632).

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
- **Co-merge / joint-GV PRs carry the `joint-gv` label; never `--auto` them.** When two+ PRs must land together (a locked cross-role contract) or a PR is gated on a joint TL Gate-Verification, label it `joint-gv`. Auto-merge fires the moment checks go green and merges the PR ALONE on whatever head is current — jumping the group and stranding reviewed work (t/3307: #1947 auto-merged without its ElectronMain pair, briefly breaking main). Merge these manually with `--match-head-commit` after the GV. The DevOps `auto-merge-jointgv-guard` (extends the t/3270 merge-guard: `operations/devops/merge-guard-predicate.mjs`) blocks `gh pr merge --auto` on a `joint-gv`-labeled PR; a normal `--match-head-commit` self-merge is unaffected (t/3318).

### Claim Before Implement (q/42)

Before implementing an assigned ticket, claim it (assign to your instance or comment you're starting). Multi-instance roles: check for a peer's claim, in-flight PR, or recent landed commit **before** choosing an approach (parallel impls of t/2514 burned two CI cycles).

### Epic Branches (multi-role features on one shared PR)

A large feature spanning multiple roles uses an **epic integration branch** (`epic/<name>`) with a single shared PR (epic → `main`) as the sole integration point. Rules for everyone working an epic (t/3618):

- **Child PRs target the epic base, NEVER `main`.** A child that lands on `main` while the epic is live is the duplicate-parallel-land bug below. Epic-base PRs now get **full CI** (t/3642, #2403 — `push`/`pull_request` triggers include `epic/**`), so the old "open against `main` first, then retarget" workaround (t/3623#5) is **RETIRED** — that workaround was itself the duplicate-parallel-land vector.
- **Claim before implementing** an epic child (per above), and check whether the ticket already has a PR **on any base** — an epic child and a direct-to-`main` PR for the same ticket is exactly the failure.
- **One shared PR** (epic → `main`) is the integration point; don't open a second PR for the same ticket against a different base.
- **Review each child at merge-into-epic time**, not deferred to the final epic PR. A multi-role diff reviewed only at the end is effectively unreviewable; per-child review at integration is what keeps the shared PR landable.

**Duplicate parallel land** (t/3655, from t/3621 landing on both `main` #2385 and the epic branch): one ticket implemented twice, onto two non-ancestor bases, whose copies then co-evolve. Two variants:
- **LOUD** — the copies touch the same files → merge conflict blocks the epic→`main` PR. Self-announcing; you'll see it (this is how t/3621 surfaced). No gate needed; this section is the prevention.
- **QUIET** — one copy is a subset of, or disjoint from, the other → the epic PR **auto-merges clean and nobody notices** the duplicated work. "No conflict" does **not** mean "no duplicate land." This variant has no signal — the only defense is claiming + targeting the epic base up front.

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

### Dependency Security Bumps

Resolving a Dependabot/security alert on an npm dep? Follow the mechanics in **`docs/security/dependency-policy.md`**, section "Executing a Dependency Security Bump." The load-bearing gotcha is that overrides live in **`pnpm-workspace.yaml`** (the SSOT for both lockfiles), while `package.json` `overrides` are **inert** and `pnpm update` bumps only the direct edge, so transitive copies stay vulnerable. One atomic PR does all of: the `pnpm-workspace.yaml` override (capped), regen the root lockfile, `sync-standalone-lockfile.mjs`, `npm run licenses`, then verify grep-clean on both lockfiles. **Never remove an override without checking which advisory it closes** (a `>=X` pin is often the fix for a `<X` alert; t/3442).

## Shell Quoting Rule

For code with special shell chars (template literals, nested quotes, apostrophes, backticks, `$` vars, f-strings), **use Edit/Write, not Bash `sed`/`awk`/heredocs**. Run Python/PowerShell scripts from a temp file (Write then execute), never inline heredocs. Shell escaping is the #1 silent-corruption source.

**Junk-file hygiene (t/2112).** Mis-quoted Bash commands word-split into 0-byte files named after the fragment (`0)`, `30s`, `{,+`). Before any `git add`, scan `git status --short` for bare-fragment filenames and `rm --` them. Prefer explicit paths over `git add -A`/`-u`.

**Staged-index inheritance on the shared checkout (t/3670).** The fleet shares one index, so **another agent's `git add` stages files into *your* commit.** A bare `git commit` commits the **whole index**, not the path you added — `git add <file> && git commit` is not scoped, and the explicit pathspec on the `add` reads like a safeguard while providing none.

- **Commit with a pathspec: `git commit -m "…" -- <paths>`.** This is the fix; it commits only those paths whatever else is staged.
- **Scan `git status --short` UNSCOPED before committing.** A path-scoped status (`git status --short -- <your file>`) cannot show inherited staged files — it reports clean while the index is dirty outside your filter.

Origin (t/3666/t/3637): a bare commit swept three of another agent's staged files into an unrelated docs PR under one author's message. It was **silent** — the commit succeeded, `git log -1` showed the expected message, and it surfaced only because the other agent read `git show --stat` on a PR that wasn't theirs. **Verify with `git show --stat HEAD` after committing on a shared checkout**; the file list is the only thing that distinguishes the two outcomes.

## Git Forensics on the Bash Tool

On some Windows agents, MSYS path conversion mangles the `<path>` half of a git colon-revspec (`git show <ref>:<path>`, `cat-file`, `rev-parse`), so a **valid** ref reports a spurious `unknown revision or path`. Discriminator: valid ref + `unknown revision` = suspect MSYS, not a real absence (confirmed on ≥2 agents). Fix: prefix `MSYS_NO_PATHCONV=1` or run via PowerShell.

## Verify Against the Authoritative Source

Before asserting what a system *is* doing, read the system — not the artifact that describes it. Config, docs, and local state are **descriptions**. They drift, and a description that has drifted reads exactly like one that hasn't.

Same rule, four surfaces:

- **Merged state** → read `origin/main` (`gh api …/contents?ref=main`, `MSYS_NO_PATHCONV=1 git show origin/main:<path>`), never the shared checkout, which lags behind merges (t/3332).
- **Infrastructure state** → query the registry or cloud API, not the workflow YAML that populates it. A `:latest` tag reasoned about from `metadata-action` config turned out to exist, be stale, and be the production deploy default (t/3522).
- **Baselines** → validate against design intent, not recent observation (t/3085).
- **Gate behaviour** → run the failing arm. A green build proves only the passing one, and silence never discriminates *enforcing* from *inert* (t/3396).

**Discriminator:** if you are about to write "X does Y" and your evidence is a file that *configures* Y, you have not verified it. One query usually settles it.

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

### Closing a prevention: name a surviving vector (t/3666)

**Before closing any ticket that claims to prevent a failure class, name one concrete way that class could still occur through ordinary use of the system, without anyone bypassing or removing the mechanism you just built. If you can name one, you closed a *vector*, not the class — say so in the closing note, and file the remainder where it's worth tracking.**

The bound is load-bearing. "Name any way it could still fail" is satisfiable by *a future author deletes the test* — true, useless, and it fires on every close, which trains a reflex sentence and destroys the signal. Restricting it to **ordinary use, mechanism intact** makes it discriminating: it fires on real remainders and stays silent on adversarial or self-inflicted ones.

Why this needs saying at all: *vector* and *class* are indistinguishable at the moment you finish the work. You have just proven the fix, every arm is green, and "this class is closed" is the honest-feeling description. It only becomes visibly wrong when someone finds the next vector. So this is a structural blind spot, not a discipline lapse — which is why the check has to be answerable in the moment rather than a reminder to be careful.

It catches **scope** gaps as well as logic gaps, and scope is the harder case: a mechanism that works correctly everywhere it looks feels closed precisely because nothing fails. The model-literal lint (t/3557) went blocking with both implementations agreeing and zero offenders — and scanned only `.ps1` and `.ts`, so a retired model id in a `.json` config passes untouched (t/3664, found by applying this rule to that ticket's own close-out).

**Enforcement is TL Gate Verification, not a hook.** Gate-touching prevention tickets already route to Main (TL) per the rule above; the surviving-vector question belongs in that review. A Done-transition prompt was considered and rejected — feedback rules cannot filter on ticket type or label, so it would fire on every close including typo fixes and dep bumps, which is the decay this bound exists to avoid.

## Ticket Lifecycle

- Starting work → `transition_ticket` to **In Progress** immediately.
- Done (PR merged or no-code task complete) → **Done**.
- Never leave a ticket Unstarted while actively working it.

## Second Opinion

Any Main instance may consult `main.engineering-second-opinion@ai-triad-research.orca.local` when any one holds: **irreversibility** (>1 sprint to undo, prod data, shared infra), **cost/risk asymmetry**, **novel territory** (no precedent), **conflicting signals** (no tie-breaker), **security/compliance surface**, or **post-incident gate design**.

**MANDATORY (not discretionary) consultation — two classes (t/3361, audit G3):** a Second Opinion MUST be obtained **before** the commit/flip for (1) **blocking-gate promotions** — any gate, guard, or CI check moving from advisory/warn-only to blocking, or a new blocking gate/required check; and (2) **schema/data-model changes** — validation schemas, data-file shapes, shared type contracts. These are the two highest-stakes classes and otherwise ship on the designer's own judgment alone. The requesting role sends the evidence package (proposal + gate-verification evidence + alternatives) and the flip/merge waits for the Recommendation. An erroring or unreachable Second Opinion backend is an infra issue (route to Orca Support and retry) — it neither blocks the evidence nor waives the consult.

**Surface the hold where the merge happens (t/3680).** A consult is conducted in email and tickets; the action it gates happens on GitHub. A hold can therefore be recorded perfectly and still be **invisible at the merge button** — which is how #2441 landed with conditions outstanding (t/3664#11). Draft was set and working; the owner lifted it and merged, acting on exactly what the PR showed: rebased, green, no marker, no stated conditions.

So when a mandatory consult gates a PR, **post the hold on the PR itself** — a comment naming the outstanding conditions and who can clear them, updated as each clears — *and* keep the PR draft. The two do different jobs and neither substitutes for the other: **draft blocks; the comment tells someone why before they lift it.** The enforceable form (a `consult-hold` label the merge guard refuses, surviving un-draft) is t/3680; the comment works today and costs nothing.

**Non-triggers:** playbook-covered routine work, easily-reversed single-role decisions, clarifying questions (use QnA/human). Consult via email with proposal, alternatives, what's at stake, time constraint. Response is Recommendation / Key risks / Conditions / Dissent.
