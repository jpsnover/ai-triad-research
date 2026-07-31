# Git, Verify & Session Workflow

> Extracted from the root `AGENTS.md` for token efficiency (t/1730). The root keeps the always-on essentials (Definition of Done, verify command, landing summary, startup query, ticket-state rule); this doc holds the full procedures and rationale.

## Git Commit Rule (Multi-Agent)

Never use `git commit --amend` on a shared branch — create a new commit instead. In a multi-agent environment, another agent may commit between your original commit and your amend, and the amend rewrites history, silently discarding their work. Applies to any branch where more than one agent may be committing (feature branches with multiple assignees, `main`, etc.). Same caution applies to `git rebase` on shared branches. (ADR-005)

**Flag ordering:** all git flags (`-m`, `-F`, etc.) must come BEFORE `--` — `git commit -m "msg" -- <paths>`, never `git commit -- <paths> -m "msg"`. Git treats everything after `--` as a pathspec, so `-m` becomes a literal filename.

**Data-repo commits** follow the same conventions with a few data-specific rules — see `../ai-triad-data/CONTRIBUTING.md` (t/1319). Highlights: self-describing subjects (15+ chars), `Ticket:`/`Run-Id:`/`Triggered-By:` trailers for tool-authored commits, no `git add -A` outside TL-authorized migration checkpoints. The `commit-hygiene` CI job flags anonymous subjects as warnings.

## Cross-Scope Dependency Verification

When your commit imports something from another agent's scope, verify the export exists in committed code (not just the working tree): `git show HEAD:<path>`. If the export is only in the working tree, coordinate with the owning agent to commit first. This prevents the pattern where local `tsc` passes but CI fails.

## Verify Before Pushing

**Run the verify gate after staging but before pushing** — not just before "reporting complete." Local `tsc` reads your working tree, but CI only sees committed code. If your change depends on a file another agent is responsible for (a shared type, a manifest entry, an export), verify that their change is also committed before you push yours.

Pattern that breaks CI:
1. Agent A adds `export type Foo` to `lib/types.ts` (uncommitted working tree change)
2. Agent B imports `Foo` in `server/config.ts`, commits and pushes
3. Local tsc passes (reads working tree with A's uncommitted export) → CI fails (committed code has no export)

Prevention: when your commit imports something from another scope, `git show HEAD:<path>` the dependency file to confirm the export exists in committed code, not just your working tree. If it doesn't, coordinate with the owning agent to commit first.

## Worktree Landing Procedure (owner-approved 2026-07-06)

Multi-file or multi-commit changes land from an **isolated git worktree**, never the shared working tree. Three shared-tree failure patterns forced this (Sage #51 landing race, #54 dirty-tree false witness): on a shared tree, your uncommitted state is every other agent's environment. Follow `/land-from-worktree` (playbook skill). The core rules:

1. `git fetch origin` immediately before creating the worktree; create it **branch-first** off `origin/main`: `git worktree add -b <type>/<slug>-t<ticket> ../wt-<ticket> origin/main` (a stale base sees phantom breakage). Branch-first because the pre-commit hook now **refuses a commit on a detached HEAD** inside a worktree (t/2009, orphaned-commit guard) — the named PR branch must exist before you commit, which also retires the old `push HEAD:refs/heads/<branch>` short-ref dance.
2. `npm ci` inside the worktree for every package your verify touches — fresh worktrees have no node_modules; verify against stale deps red-herrings.
3. Copy only your changed files in; `git add` by pathspec; **commit on the worktree's named branch and push INSIDE the worktree** — `git push origin <branch>` (not `HEAD:refs/heads/<branch>`; the branch already exists from step 1). The commit is born there. One SHA, nothing lingers on the shared ref. Never commit on the shared main and cherry-pick a copy.
4. Run the full verify gate inside the worktree before pushing (Definition of Done applies where the commit is born).
5. Sync the shared tree afterward with file-scoped `git checkout origin/main -- <files>` — never a reset, which can drop other agents' work.
6. Remove the worktree; confirm `git log origin/main..main` on the shared tree shows nothing of yours lingering.

Single-file trivial fixes may still commit from the shared tree by explicit pathspec. **Disputes about committed state are settled at the git object level** — `git show HEAD:<path>`, `git grep <pattern> <sha>`, `git cat-file -e <sha>:<path>` — never by building the shared working tree, whose uncommitted state masks committed breakage.

## Commit & Push Cadence (owner-approved 2026-07-04)

**Commit:** per ticket, at completion — required by Definition of Done. Never batch multiple tickets into one commit.

**Push (all three repos: code, data via its own remote, overlay via ogit):**
1. **Reviewed-batch boundary** — Technical Lead syncs whenever a review pass completes and approved commits exist locally. Approved work must not accumulate: ~10 unpushed commits is the ceiling before CI failures become hard to attribute.
2. **Never end a working day with approved commits unpushed.** Unpushed work is invisible to CI and rides on one machine's disk (the 2026-07-04 laptop-transport window is the standing example).
3. **Before the owner travels or sleeps the machine for an extended period** — TL runs a full three-repo sync sweep on request ("sync everything").
4. In-flight (unreviewed, uncommitted) work correctly stays local — this cadence governs *approved* commits only.

**Deploy is separate and always deliberate:** `deploy-azure.yml` is manual-dispatch, owned by DevOps — a push never deploys. Large data-repo pushes: prefer the SSH remote; stage pushes over ~200 MB (see docs/powershell-native-quoting-traps.md incident notes for the transport failure modes).

**Periodic cadence check (DevOps).** At each DevOps session start and before any sync sweep, check three-repo divergence to catch backlog early. For code, data (`../ai-triad-data`), and overlay (`git --git-dir=.orca-git`): `git rev-list --count origin/<branch>..<branch>` (ahead) + the reverse (behind). **Ahead-count is a trigger, not a verdict** — worktree-landing leaves the old local-main commit as a duplicate under a new origin SHA, so a high "ahead" is usually dupes; classify commit *content* (`git log origin/<branch>..<branch> --oneline`) as genuinely-new vs. already-landed-dupe vs. garbage (stray ADR-005 sweeps) before acting. Genuinely-new approved → push; dupe/garbage-laden or bidirectional divergence → flag TL for a **worktree-replay reconciliation (see t/1714) — NEVER `reset --hard`/force on the shared tree**; never a bulk push. Escalate when genuinely-new unpushed work exceeds the ~10-commit ceiling in any repo.

## Definition of Done

A ticket is **not Done** until all of the following are true:

1. **Code is committed** — `git commit -- <files>` with explicit pathspecs (ADR-005). Uncommitted working-tree changes are invisible to CI and other agents.
2. **Verify gate passes on committed code** — run verify *after* committing, not before. `tsc` reads the working tree, but CI only sees committed code (see "Verify Before Pushing").
3. **Commit SHA noted** — include the commit hash in your ticket completion comment so reviewers can trace the change.

**Anti-pattern (from t/1221 audit):** Agent writes code → tests pass locally → marks ticket Done → never commits. The ticket looks shipped but the code exists only in one agent's working tree. If you cannot commit (e.g., blocked on a cross-scope dependency), mark the ticket as **blocked**, not Done.

**CodeQL is a separate check — confirm it before self-merge (interim, t/2025):** `ci-gate` green + `gh pr checks` exit 0 does NOT mean CodeQL passed — `CodeQL Analysis` is a separate, currently-non-required check-run. Before self-merging, confirm the `CodeQL Analysis` check-run is green (not just `ci-gate`); for a **security-fix** PR, confirm the target alert is addressed AND the fix introduced no new high (a fix can add one and `gh pr checks --watch` still exits 0 — t/2023 #5460). This procedural stopgap is replaced by t/2025's structural required-differential CodeQL gate.

### Deviation Flagging Rule (owner-approved 2026-07-06)

When an implementation deviates from a TL-approved design or an explicit review condition — different boundaries, substituted evidence, skipped verification named in an AC — state the deviation in your completion comment: "asked X, did Y, because Z." Unflagged deviations are treated as review failures even when the change is an improvement: a reviewer who must *detect* deviations pays more than the deviation saved. For contested or multi-deviation tickets, close with a deviation-ledger table (the t/1300#10 format).

## Startup & Wake Behavior

On session start, after reading your AGENTS.md and confirming identity (`whoami`), **check your ticket queue** using `list_tickets(all: false, limit: 500, sort: "priority")` — `all: false` scopes to your own role and returns all your tickets without truncation. **Do not use `all: true, limit: 100`** (fleet-wide + cap causes truncation false-empties on busy boards) and **do not use the `status_category` filter** (returns false-empty results, confirmed broken fleet-wide 2026-07-04). Filter client-side for tickets that aren't Done/Cancelled. If you have unblocked work assigned to you, start on the highest-priority ticket immediately — do not wait for the user to tell you to begin. Update your status (`update_status`) to reflect what you're working on.

**Refresh stale deps (persistent-worktree model, t/2012).** A persistent worktree keeps `node_modules` across sessions, so a merged dependency bump leaves it silently stale — the failure CI structurally can't catch (CI runs a fresh `npm ci`; your local worktree does not). At session start, run the staleness trigger inside your worktree: `sh .githooks/install-if-stale.sh` (defaults to `.` + `taxonomy-editor`; pass your verify-relevant dirs, e.g. `sh .githooks/install-if-stale.sh . lib`). It hashes each lockfile against the last-installed hash (a per-worktree marker) and runs `npm ci` ONLY on change — cheap when nothing moved, correct when it did. The reinstall is deliberately not automatic: detecting the drift is the point.

**Before going idle after ANY prompt** — ping, email, or auto-prompt, not just session start — re-check your ticket queue and, if you have an unblocked ticket assigned, start it. Going idle with unblocked assigned work is a process violation; if you genuinely can't start it, set your status to say why. (Approved 2026-07-03 after a fleet audit found four agents idle on ping-wake with unblocked high-priority tickets — a ping about a ticket IS a work trigger, not just a message to acknowledge.)

**Hook counter caveat:** The `Tickets: N` value injected by the UserPromptSubmit hook only counts **in-progress** tickets — it does NOT include Todo/unstarted tickets assigned to you. Never treat `Tickets: (none)` as "no work to do." Always run the explicit `list_tickets` query above.

### Feedback-Rule Tooling Traps (Orca platform, t/1625)

Two observability gaps in the `*_feedback_rule` MCP tools. Both are Orca-platform bugs with no in-repo fix — you can only work around them, so know the workarounds before you build or diagnose a hook:

1. **A rule created or updated mid-session is inert until the next session.** MCP writes land in the Orca DB, but the hook runner loads compiled snapshots from `feedback-rules/manifests/*.json`, recompiled only on sync / session-start — never on the MCP write. Worse than "silent": `get_feedback_rule` / `list_feedback_rules` return the *new* matcher and description immediately, so the read API reports the change as live while the runtime is still on the old manifest — a misleading positive, not just an absent signal. **Verify liveness by grepping `feedback-rules/manifests/*.json` for the rule name, never by the returned `enabled`/matcher.** A hook you just created won't fire until a fresh session even after enablement — factor this into any same-session rollout.

2. **Audit counters read false for actively-firing rules.** `has_run`, `fire_count_24h`, `last_fired_at`, and `recent_executions` read false/0/null even for rules watched firing on nearly every prompt (`scope-guard`, `security-secrets-block`, ping-length, ticket-default guards, …). `has_run:false` is therefore **not** evidence a rule never fires — never diagnose a "dead" gate from it. To find a *genuinely* dead gate, reason about **matcher-versus-platform**: e.g. a `Bash`-only matcher never fires on this win32/PowerShell fleet — the exact failure that let 69 zero-byte fragment files accumulate under `shell-code-mangling-guard` while everyone believed it was enforcing (t/1768). The one field that would surface a never-firing rule is the one field you can't trust.

**Status text rule:** describe the work, never include `t/`, `p/`, `e/`, or `q/` entity references — the `update_status` API rejects them, and ticket keys are meaningless in the sidebar anyway.

If all your tickets are blocked, check whether the blocker is done (it may have been completed since the ticket was last updated). If the blocker is genuinely still open, update your status to describe what you're waiting on and go idle.

**Drain your queue until budget — chain up to 3 tickets per session (owner-approved 2026-07-21).** When you complete a ticket: (1) write `LAST_SESSION.md`, (2) mark the ticket Done, (3) **immediately re-check your queue**. **If an unblocked ticket is assigned to you AND you have completed fewer than 3 tickets this session AND you have ample context budget remaining, start the next one.** Only close the session when your queue has no unblocked tickets, you have hit the 3-ticket cap, or context budget is running low. The count resets each new session. This supersedes the earlier "one ticket per session" rule (2026-07-16), which made fleet throughput depend on a human re-waking every agent.

## Session Close & Summaries

**On completing a ticket:** write/refresh `LAST_SESSION.md` and mark the ticket Done, then re-check your queue (see chaining rule above). Always refresh `LAST_SESSION.md` before going idle at the end of any session so it reflects the *last* ticket you closed. Use this 5-line format in your scope directory:

```markdown
**Date:** 2026-06-29
**Working on:** brief description of what you were doing
**Status:** where you left off (complete, in progress, blocked)
**Key context:** one non-obvious fact a future session needs to know
**Next:** what to do first next session
```

On session start, read your `LAST_SESSION.md` (if it exists) to reduce re-discovery cost. Use absolute dates — never "yesterday" or "last session." Keep it to 5 lines max.

## Ticket State Discipline (owner-approved 2026-07-21)

A ticket's **status must always reflect its real disposition.** The most common way tickets "look stuck" is a decision made in a comment while the status is never moved — the work is done in spirit but the board still shows it open, so it resurfaces and needs manual babysitting. Two rules close this gap:

1. **A decision that ends your work carries a status transition in the same step.** If you defer, decline, or hand off a ticket, transition it — never leave it parked in a non-terminal status as a bookmark:
   - **Defer / won't-do now** → move to Backlog (or Cancelled if it will never be done). Do not leave it in **In Review** or **In Progress**. (t/1407 sat in "In Review" for 13 days after a clean defer decision — that is the anti-pattern.)
   - **Handed off to a follow-up ticket** → set this ticket **Blocked** on the new ticket (add the relation), or Done if this ticket's own deliverable is complete.
   - **"In Review" is not a parking lot** — it means *a specific reviewer owns the next transition.* If no one owns the review→terminal hop, the ticket is not really In Review; move it to its true state.

2. **Handoffs are atomic — file the follow-up before you close.** If your completion comment says "I'll file / route / open ticket X," **do it in the same session, before you mark this ticket Done or go idle** — then reference the new ticket's key. A promise to route work is not routing it. (t/1275's design was complete on Jul 1 but the "filing a follow-up ticket" line never fired; it sat 8 days.) If you cannot file the follow-up now, mark this ticket **Blocked** with the reason — never Done.
