# Runbook: `enforce_admins` Emergency Override

**Owner:** DevOps. **Last updated:** 2026-09-29

`main` branch protection has `enforce_admins: true` (t/3736). This binds **admins** — i.e. every agent acting with the PI's credentials — to the required status checks (`ci-gate`, `CodeQL`, `joint-gv-guard`). Before this, an admin could merge a PR whose required checks were red; that is how `fe98948e` reached `main` over a red `ci-gate`.

This doc is the **point-of-use record** (Gate Co-Location) for the setting's emergency override.

---

## What the setting does / does not do

- **Does:** refuse any merge — including an admin/API merge — while a required context is not `success`. Proven both arms on the live repo (t/3736): a PR with unsatisfied checks is refused `405 "required status checks are expected"`; an all-green PR merges normally.
- **Does NOT:** add or remove required contexts (unchanged: `ci-gate`, `CodeQL`, `joint-gv-guard`); gate consult/draft holds (that is t/3680's `consult-hold`); or close the stale-base vector (`strict: false` — t/3686). It closes **row 1 only** of the four routes in t/3736#2.

---

## The override — PI-only, NOT agent-reachable

**The only override is toggling `enforce_admins` off.** That toggle is a branch-protection `PATCH`, which is **classifier-blocked for every agent in the fleet** (verified t/3736). So in a P1 where `main` is red *and* CI itself cannot go green, an agent **cannot self-override** — it must escalate to the PI. This human dependency on the CI-broken hotfix path is the deliberate, accepted cost of the tightening.

### Emergency sequence (P1 only)

1. **Agent** escalates to the PI on the incident anchor ticket — states the red `main` / broken-CI condition and why a merge must bypass checks. **Self-report** the action (see below).
2. **PI** disables enforcement:
   ```bash
   gh api -X DELETE repos/jpsnover/ai-triad-research/branches/main/protection/enforce_admins
   ```
3. The fix lands.
4. **PI** re-enables enforcement:
   ```bash
   gh api -X POST repos/jpsnover/ai-triad-research/branches/main/protection/enforce_admins
   ```
5. **PI** records the window (off-at / on-at) and the reason in the anchor ticket. **This re-enable + record is mandatory** — an override left off silently re-opens the bypass for the whole fleet.

Verify current state at any time:
```bash
gh api repos/jpsnover/ai-triad-research/branches/main/protection --jq '.enforce_admins.enabled'
```

### Why "self-report", explicitly labelled

The GitHub audit log shows protection was disabled/re-enabled but **not by whom** — every agent acts as `jpsnover` (t/3736#3/#4). The toggling/escalating agent announcing itself (ping or ticket comment) is the **only** attribution available without platform work. Treat it as self-report, never as a logged fact.

---

## Surviving vectors (do not read enforcement as complete)

Through ordinary use, `enforce_admins: true` still leaves open:

- **Stale-base green merge** — `strict: false` lets a PR merge green against a moved base (t/3686 owns the decision; the #2516 4-second-green case is the worked example).
- **Consult/draft holds** — enforcement gates required *checks*, not review holds; a green-but-held PR can still merge (t/3680 `consult-hold` is the enforceable form).
- **The un-draft/auto-merge mystery** — an unattributed actor un-drafting/merging PRs (t/3716) is orthogonal to required-check enforcement.

These are tracked separately; this setting closes the red-required-check merge vector, not the class.
