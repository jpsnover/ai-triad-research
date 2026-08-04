# How the Orca Fleet Uses GitHub and Branching

**Last updated:** 2026-07-31 · **Owner:** Technical Lead

This document describes how the Orca agent fleet makes changes to the AI Triad codebase through Git, GitHub, and branch-based workflow. It covers the model as it stands after the retire-shared-checkout migration (t/2008, 2026-07-31), the benefits and costs of the approach, and where it should go next. The incidents cited are real; they are why the workflow looks the way it does.

## 1. The setting

The "developers" here are Orca roles: AI agents with persistent identities and bounded file-ownership scopes. ServerAuth owns `server/security/`, DebateTool owns `lib/debate/`, and so on. Many roles run at once. They coordinate through tickets, pings, and email, and they change code through Git. Three repositories are in play:

- **`ai-triad-research`** (public): the code, and the subject of the branching workflow below.
- **`ai-triad-data`** (SSH remote): ~410 MB of generated and structured JSON. Committed to directly; not part of the branch-PR flow.
- **`ai-triad-orca-config`** (private): the Orca overlay (`.orca.yaml`, role configs, feedback rules, skills, nested `AGENTS.md` files). It lives at `.orca-git/` and is driven by the `ogit` alias so it never mixes with the public repo.

The rest of this document is about the code repo.

## 2. The workflow

### 2.1 One hub, many worktrees

The fleet operates from a single machine with one clone of the code repo, the **hub**. The hub's working tree sits at `origin/main` and serves as a **fetch-hub**: a shared reference point, not a place to author changes. Each role does its work in its own **git worktree** cut from `origin/main`, so concurrent roles never contend over one working tree.

### 2.2 The change lifecycle (branch-first)

Every non-trivial change follows the same path, codified in the `/land-from-worktree` skill:

1. **Branch-first worktree.** `git fetch origin`, then `git worktree add -b <type>/<slug>-t<ticket> ../wt-<ticket> origin/main`. The branch exists from the moment the worktree is created, so the commit is *born* on a named branch off a fresh base.
2. **Install and build in the worktree.** `npm ci` in every package the verify gate touches. Worktrees start with no `node_modules`.
3. **Commit on the named branch.** Conventional message, ticket reference, and a `Co-Authored-By` trailer for every contributing role.
4. **Verify on the committed state.** `npm run verify` (and `Invoke-Pester ./tests/` for PowerShell). Definition of Done applies where the commit is born.
5. **Push the branch, open a PR.** `git push origin HEAD:<branch>`, then `gh pr create`.
6. **Merge on green.** When the required checks pass, self-merge with `gh pr merge --rebase --delete-branch`. One GitHub identity means no human reviewer is possible, so green checks *are* the merge gate. A role reviews another role's PR through the ticket and PR flow, not a GitHub approval.
7. **Sync the hub.** `git pull --ff-only` on the hub, so the next worktree branches from the current tip.

### 2.3 The commit guard

A committed pre-commit hook (`.githooks/pre-commit`, enabled per checkout with `git config core.hooksPath .githooks`) enforces the model structurally rather than by discipline:

- A commit **directly on the hub's `main`** is refused. It would strand work locally and diverge from origin.
- A commit **on a detached HEAD inside a worktree** is refused. It would be an orphan, lost on the next re-detach, which is the reason landing is branch-*first*.
- Commits on a named branch, on non-`main` branches, and with `--no-verify` (owner and emergency override) are allowed, so the guard never blocks legitimate landing.

The guard is fail-open. If any Git introspection errors out, it allows the commit, because a broken guard must never block real work.

### 2.4 Ownership routing

Changes are routed by file ownership, not grabbed. Before designing a change the TL runs `resolve_owner` / `resolve_owners_batch` on every file that will change; a feature touching three roles' files becomes three tickets, not one. Logic needed by two or more roles is extracted to a shared location such as `lib/` as a prerequisite ticket that blocks the consumers. The owner extracts the core and the consumers adopt it, a pattern used this session for both the entity resolver and the content-sanitizer core.

### 2.5 The merge gates

Branch protection on `main` is `{ strict: false, contexts: ["ci-gate", "CodeQL"] }`.

**`ci-gate`** is an always-runs aggregate job. Its `needs` transitively cover the real jobs (Pester, the Electron matrix, container smoke, lint, audit), and it reports green only when every gated job passed or legitimately skipped. Because it always runs, a docs-only or PowerShell-only PR whose code jobs correctly skip still gets a green required context and can self-merge. One required aggregate replaced six individual contexts that used to strand skip-eligible PRs.

**`CodeQL`** is a required *differential* check. It fails a PR that introduces a new security alert but does not block on the pre-existing backlog. This closes the gap where `ci-gate` could be green while a CodeQL run was red, which would otherwise let a security fix self-merge while minting a new vulnerability.

**`strict: false`** (not "require up-to-date") is deliberate. With fast-moving concurrent roles, requiring every PR to be rebased to the tip before merge created a livelock, because `main` advanced faster than CI ran and PRs went stale every cycle. The residual risk of a PR green against a slightly stale base is caught by post-merge CI on `main`, and the deploy gate never ships a red `main`.

Supporting gates run inside `ci-gate`: `verify:config` (six registry gates over `ai-models.json`, including a dangling-reference check), a dependency-audit gate with per-app baselines, and Dependabot for version and security updates (with an auto-merge workflow for green minor and patch bumps).

### 2.6 Review and design gates

Pattern-following, single-scope work self-certifies against a documented playbook (`/add-rest-endpoint`, `/add-bridge-method`, `/add-ps-cmdlet`, `/add-test`, and the like) and skips a separate review gate. Novel architecture, cross-role interfaces, data-model changes, and auth or security-surface changes route to the TL for a design review before build and a review of the PR before merge. Security-surface PRs are reviewed at the object level, on the diff, not on report.

## 3. Why it looks like this: the shared-checkout era

The current model is a reaction to concrete failures under the previous one, where roles committed to a *shared* local `main` checkout:

- **Divergence treadmill.** A worktree push landed on `origin/main` without advancing the shared local `main`; other roles then committed onto the lagging pointer and diverged from origin, sometimes twice in one afternoon.
- **Duplicate-commit race.** Committing on the shared ref and pushing a cherry-picked copy produced byte-identical twin commits on origin.
- **Stranded fixes and dirty-tree false witness.** A deletion committed while its importer's fix sat uncommitted in the shared tree broke `main` invisibly, and "verifying" by building the dirty shared tree masked the breakage.
- **Near-loss of real work.** A reconcile that hard-reset the shared local `main` wiped local-only commits more than once.

The commit guard (t/1926) was the stopgap. The retire-shared-checkout migration (t/2008) is the durable fix: with no shared `main` to author on, the divergence class is designed out rather than merely guarded. The migration was executed as a freeze-drained, snapshot-backed cutover, and even then the "verify before the irreversible step" habit earned its place. The hub turned out to be diverged (22 local-only commits) rather than the clean fast-forward the plan assumed, and all 22 had to be confirmed content-present on origin before the reset ran.

## 4. Benefits

- **Concurrency without contention.** Per-role worktrees let many agents build, test, and commit at once without stepping on one working tree.
- **Verified before merge, structurally.** Nothing reaches `main` without passing the aggregate CI gate and the differential security gate. Because these are *required contexts*, the guarantee does not depend on any agent remembering to check. This session's own security fixes were structurally prevented from merging with a new alert.
- **Clear ownership and auditable history.** `resolve_owner` routing, `Co-Authored-By` trailers, and ticket references make every change traceable to an owner, a rationale, and the collaborating roles.
- **Divergence designed out.** The guard and the worktree topology remove the shared-mutable-state failure class at its root.
- **Isolation for risky work.** Worktrees are disposable. A bad experiment is a `worktree remove`, not a polluted shared tree.
- **Clean public/private separation.** Code stays public; Orca infrastructure and secrets never enter it, via the overlay repo and bring-your-own-key with no committed credentials.
- **The gate catches build-path gaps, not only code bugs.** When a new `lib/` runtime dependency was not installed by the container builder, the required container check went red instead of shipping a broken image.

## 5. Costs

- **Provisioning overhead.** Each worktree needs its own `npm ci` and Electron binary, which costs disk and setup time per role. A fleet of about thirteen worktrees runs to real gigabytes.
- **Ceremony per change.** Branch, worktree, install, commit, push, PR, merge, hub-sync is a lot of steps for a one-line fix. The `/land-from-worktree` skill encodes the sequence, but it is not free.
- **CI wall-time on the critical path.** The Electron test job dominated at roughly eleven minutes. Until it was cut by about 55% (t/1988) it gated every merge, and it is the reason `strict: false` was necessary.
- **High change volume from a large fleet.** Many concurrent roles plus Dependabot generate a lot of PRs, and without a merge policy they accumulate. The backlog reached 32 open PRs this session, a mix of unmanaged bot bumps and green-but-stranded fleet work.
- **Migration side-effects strand in-flight work.** Swapping a required status context stranded the open PRs that predated the swap, because they lacked the new check and their armed auto-merge could not fire. A required-context change needs a "re-trigger all open PRs" step that is easy to forget.
- **Multi-repo cognitive load.** `git` versus `ogit` versus the data repo, three remotes, and a dual-tracked `AGENTS.md` (main-repo authoritative, overlay secondary) are a standing source of foot-guns.
- **GitHub subtleties bite.** Making CodeQL a required *check-run*, not the workflow *job* (which passes even on a new alert), was load-bearing and non-obvious. Several platform features (merge queue, ruleset `evaluate` mode) turned out to be org-only and unavailable on this user-owned repo.
- **Agents cannot verify their own guardrail changes.** A running session's feedback-rule runner is pinned to the manifest loaded at session start, so a rule change cannot be trigger-verified in the session that made it. Verification waits for a later session.
- **Coordination tax.** Design gates and pre-merge reviews add latency. They are justified for security and architecture surfaces but a drag if applied too broadly, which is why this session narrowed TL pre-merge review to novel and critical input-surface changes and let canonical remediations self-certify.

## 6. Suggested improvements

Ordered roughly by expected payoff.

1. **Cut CI critical-path time further.** Dropping `test-electron` from about eleven minutes to five already removed the biggest source of stale-base churn. Pushing it lower would make re-enabling `strict: true` (up-to-date-required) viable and remove the residual stale-base risk without the old livelock. This is the strongest available move now that merge queue is off the table as org-only.
2. **Adopt the pnpm shared store.** It is proven viable (`nodeLinker: hoisted`, shared-store hardlinking) but not yet adopted, and it collapses the per-worktree `node_modules` disk cost, which is the direct attack on provisioning overhead. It sits as an unscheduled optimization today.
3. **Automate PR-backlog hygiene.** Dependabot auto-merge for green minor and patch bumps landed this session. Extend the same idea to a periodic triage that re-triggers stranded green PRs, closes superseded or conflicting bot PRs, and surfaces the rest, so a large fleet's PR volume self-drains instead of accumulating.
4. **Make required-context swaps safe by construction.** Any change to the required status contexts should carry a mandatory, scripted "re-trigger every open PR" step, so the swap cannot silently strand in-flight work.
5. **Add a build-path-coverage check.** A new workspace dependency must be installed in every build path, both the CI job and each Docker builder. A lint that flags "a package gained a dependency the container builder does not `npm ci`" would have caught this session's container break before CI did.
6. **Finish the shared-primitive dedups.** When logic is extracted to `lib/` (the sanitizer core, the entity resolver), fold the remaining per-consumer copies onto it promptly. Hand-synced duplicates, such as a secret-prefix regex kept byte-identical across two files by hand, are a latent drift bug.
7. **Reduce the multi-repo foot-guns.** Settle the dual-tracked `AGENTS.md` on one authoritative repo, and give the overlay and data commit flows the same guard-rails the code repo has, so "commit everything" is safe rather than needing per-repo care.
8. **Keep verification structural, not memory-dependent.** The habit that repeatedly paid off this session was to prove the gate rather than assume it, confirm state on `main` rather than on a PR check, and verify before an irreversible step. It should keep migrating from discipline into enforced gates, the way making CodeQL required did for the "confirm CodeQL is green" habit.

## 7. Summary

The fleet trades per-change ceremony and CI and provisioning overhead for concurrency, structurally verified merges, and a divergence class that is designed out rather than guarded. The remaining costs are largely about speed (CI wall-time, provisioning) and volume (PR backlog from many agents). Both are addressable with the improvements above, and none requires a change to the core model.
