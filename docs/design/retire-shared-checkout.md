# ADR: Retire the shared local-`main` checkout

**Status:** Accepted (owner-approved 2026-07-30)
**Decision ticket:** t/1926
**Authors:** Technical Lead, with the review panel below.

---

## Context

The fleet shares one clone of the code repo at `repos/ai-triad-research` with `main` checked out. Every agent works in that single working tree. This produces two chronic failures:

1. **Daily `main` divergence.** Direct commits to the shared `main` accumulate; a realign was needed repeatedly (t/1768, t/2004). The t/1926 pre-commit hook stopped *new commit* divergence, but not the underlying condition.
2. **A monotonic dirt accumulator.** Because landing happens via `/land-from-worktree` (isolated worktrees), normal productive work never *cleans* the shared tree — it only adds to it. Measured 2026-07-30: 134 modified + 228 untracked files (152 of the untracked are zero-byte shell-mangling junk; ~76 are real source across ≥5 roles). This drives the recurring, risky reconcile ceremonies.

The hook was a stopgap. The structural fix is to remove the shared mutable tree entirely.

## Decision

**No agent works in the root clone's working tree.** Each **leaf role that lands its own PRs** works in its own persistent worktree checked out off `origin/main`, and lands via the existing `/land-from-worktree` PR flow. The root clone becomes a **fetch-hub**: it holds `.git`, the `.orca-git` overlay, and `.aitriad.json`; its `main` is kept `== origin/main` via ff-only sync and is never committed to or edited.

Origin becomes the sole source of truth. There is no shared local `main` to diverge and no shared working tree to accumulate dirt.

## Architecture

- **Granularity = per-leaf-role.** Child roles land independently (e.g. ElectronMain #237, ServerAPI #239), and two worktrees cannot share a branch — so a worktree per leaf role that lands PRs (~11 JS + others), not per top-level family.
- **Worktrees live at `repos/wt-<role>`** — siblings under `repos/`, so `../ai-triad-data` resolves identically. Verified: `Import-Module`, `Invoke-Pester ./tests/`, and data-root resolution all work unchanged from a worktree (PowerShell review).
- **Each worktree sits at detached `origin/main`** and creates ephemeral per-task PR branches (`<type>/<slug>-t<ticket>`) — today's landing pattern, promoted to the default workspace.
- **The root/hub retains:** the `.git` object store, overlay operations (`ogit`), data-root config, and app running/serving (see Hub Writes).

## Failure-modes-addressed

The naive "just use worktrees" design **relocates** the wipe-class rather than killing it. This ADR closes both relocation paths (Sage review):

- **(a) Safe session-start re-detach.** Re-detaching a worktree onto `origin/main` is **ff-only / refuse-when-dirty-or-ahead**, never a hard reset. If the worktree is dirty or ahead of origin, the re-detach *stops and surfaces a playbook* (below) — it never discards.
- **(b) Detached-HEAD-commit guard.** Extend `.githooks/pre-commit`: a commit on a detached HEAD that is not a named PR branch is refused, preventing orphaned-commit loss.
- **(c) Hardened `/land-from-worktree` ships *with* the migration.** It becomes the *daily* path, so the worktree-land hazard cluster now bites at daily frequency; the hardened procedure cannot lag the cutover.

### Refuse-when-dirty re-detach playbook (§3a detail)

When session-start re-detach finds the worktree dirty or ahead of `origin/main`, it must **not** reset. The operator/agent:
1. Classifies the delta: uncommitted WIP vs. committed-ahead work.
2. Committed-ahead → land it via a PR branch first (`/land-from-worktree`), then re-detach.
3. Uncommitted WIP → stash to a **named branch or bundle** (never a bare stash), land or park it, then re-detach.
4. Only a genuinely clean, non-ahead worktree ff-re-detaches automatically.

## Migration plan

Blocking gates in **bold**. DevOps owns provisioning, drain, and the guard hook.

0. **Reap.** Audit the 17 existing worktrees; remove abandoned ones. The drain covers worktrees, not just the root — else the new model inherits old litter.
1. **Disk precondition (BLOCKING).** Before provisioning: free disk ≥ (N_js × measured taxonomy-editor `node_modules` + margin). The host has prior storage-instability history — treat disk pressure as live. Provision serially / small-batch with a disk check between steps; the parallel-`npm ci` **spike** is the hazard.
2. Provision `wt-<role>` off `origin/main`; `npm ci` (root + taxonomy-editor — the double-install is mandatory or `lib/debate` tsc fails; also run `node node_modules/electron/install.js` for the electron binary). Run the pre-commit hook TEST 1/2/3 trio **in each provisioned worktree** — the `..`-collapse / `C:`-vs-`/c/` path quirk already bit once.
3. **ACK-barrier freeze (BLOCKING), not a timer.** Each role posts a drain-complete ACK (WIP landed or captured in the snapshot). Convert any drain-stash → branch/bundle immediately. **Orphan-sweep:** after per-role drains, `resolve_owner` every remaining non-empty untracked file (228 span ~10 scopes; no single role recognizes all). Auto-clean the 152 zero-byte junk files separately first.
4. **Pre-cutover snapshot (BLOCKING) — the dominant control.** Before the first irreversible step, park **outside the repo**: a `git bundle` of all refs + a tar of the entire working tree **including untracked AND ignored** + copies of `.orca-git`, `.aitriad.json`, `.orca.local.yaml`. (`git stash -u` + a tag is insufficient — it misses ignored config.) This makes the whole destructive phase reversible.
5. Drain-complete gate → `git clean -fd` **without `-x`** + an allowlist for known-good ignored config (`.orca.local.yaml` and any relocated-write paths) → ff-align root `main` to `origin/main` (this is the t/2004 convergence, now safe).
6. Verify: hub tree clean; each role productive from its worktree; a test-land round-trips.
7. **Soak.** Routine, low-stakes work exercises the new model first.
8. **Canary 2–3 roles** before releasing the security Wave-2 (83 CodeQL highs) onto the model. Migrate-before-Wave-2 is right; migrate-and-immediately-peak-load is the risk.

## Risk register (transition)

| # | Risk | Sev (with controls) | Control |
|---|---|---|---|
| R1 | Drain misses genuine untracked work | High → **Low** | Pre-cutover snapshot (step 4); orphan-sweep; content-diff not path-existence |
| R2 | Rollback asserted over the irreversible half | Med → Low | Split rollback (below); snapshot is the named artifact |
| R3 | "Verify clean" wipes via `-x` | Med → Low | `git clean -fd` **without `-x`** + allowlist |
| R4 | Root-as-single-hub SPOF | Med (availability) | Health check (`git fsck` + ff-sync verify); ~30-min re-clone runbook |
| R5 | Disk exhaustion (cutover spike) | Med → Low | Disk BLOCKING precondition; serial provisioning |
| R6 | Per-worktree hook mis-detection (Win paths) | Low-Med → Low | TEST 1/2/3 in each worktree |
| R7 | Freeze coordination (asleep/blocked roles) | Med → Low | ACK-barrier; stashes → branches immediately |
| R8 | Migration defect surfaces under Wave-2 peak | Med → Low | Soak + canary before Wave-2 |

## Rollback

- **Pre-freeze (steps 0–3):** additive, trivially reversible.
- **Post-freeze (steps 4–5):** reversible **only** via the step-4 snapshot — that is the named rollback artifact. ("Everything lands to origin regardless" is true only if the drain was complete, which is the risk itself.)
- **Hub loss (R4):** availability, not durability, provided landed work is on origin. Recovery: re-clone → re-provision worktrees → re-apply `core.hooksPath` (~30 min).

**Snapshot retention (§4 detail):** the pre-cutover snapshot is retained until the migration has completed the soak (step 7) AND a canary role (step 8) has round-tripped a land cleanly, then a further 7 days, before deletion. It is the sole rollback artifact for the irreversible phase; do not delete it on "step 6 looks fine."

## Hub writes (a serving hub writes)

A serving/running hub writes runtime artifacts back into the tree, re-dirtying the "clean hub." **Enumerate and relocate every hub write outside the tree** (env-configured, e.g. `../ai-triad-runtime/`). Known first target: **flight recorders** (`taxonomy-editor` flight-recorder JSONL). Audit also: dev-server logs, caches, tmp, scratch writes. Anything that genuinely cannot be relocated goes on the step-5 `git clean` allowlist so it is never mistaken for dirt.

## Ownership & sequencing

- **DevOps** owns provisioning, the drain, and the guard hook (which reuses the pre-commit's Windows path-normalization + carve-outs and is dogfooded before fleet-enable). CI, branch protection, and merge infra need **zero** change — the PR-flow already *is* the model.
- **Sequencing:** security Wave-1 now (current model) → migrate → soak + canary → security Wave-2 + PR backlog on the new model. The freeze/drain window doubles as the t/2004 convergence and the dependency-PR clear — one window, three outcomes.

## Prerequisites & parallel tracks

- **npm provisioning** is the critical path (measured ~24 GB vs. ~399 GB free — not a blocker).
- **pnpm shared store** is a **parallel optimization, NOT a prerequisite.** Coupling the security migration to an unproven pnpm/electron-compat workstream would gate 83 security fixes on unrelated infra — the same anti-pattern rejected on t/2006. Adopt pnpm later (verify electron-builder/vite compat first); it then collapses per-worktree disk + install cost and dedupes the electron binary.
- **`Get-DataRoot` GetFullPath() normalization** (PowerShell) — kills the `..`-collapse path class before N worktrees multiply anchor dirs. Standalone pre-req.
- **Session-start staleness trigger:** the session-start hook compares the lockfile hash and reinstalls only on change — cheap reinstall is not automatic; this prevents the stale-deps failure CI structurally cannot catch.
- **Untrack `LAST_SESSION.md`:** the 21 tracked files would each become a per-session PR under the new model. Untrack (`git rm --cached` + `.gitignore`) as its own discrete pre-cutover PR — schedule it, don't let it surprise the freeze window. (Relies on persistent worktrees; the notes are disposable and acceptably lost on a hub re-clone.)

## Data repository (in scope, v1)

Deferring `../ai-triad-data` would leave the failure class alive on the half holding *irreplaceable* artifacts (~99 pending changes there today) — the more critical half. v1: apply the same divergence-block pre-commit guard to the data repo and **measure its contention**; full per-role-worktree adoption for data phases on that measurement (data has no `node_modules` but large binaries — different trade-offs).

## Consequences

- **Positive:** the divergence + dirt failure class is eliminated at the source, not patched. Reconcile ceremonies end. Landings stay clean under multi-role load (the security Wave-2 becomes the proof).
- **Cost:** N persistent worktrees (disk, manageable; pnpm later); a session-start freshness discipline; a one-time cutover with a mandatory snapshot.
- **Reversible:** the design is fundamentally reversible pre-freeze, and reversible post-freeze via the mandated snapshot. Worktrees are additive — rollback is removing them.

## Review record

Unanimous approve, conditions folded. Panel: DevOps (feasibility, owns execution), PowerShell (PS tooling — empirically verified), Taxonomy Editor (disk/pnpm), Sage (failure-modes — co-authored §Failure-modes-addressed), Risk Assessor (transition risk — the pre-cutover snapshot control), Tech Lead 2 (independent architect critique, re-reviewed under an updated model and **signed** t/1926#19).
