**Last updated:** 2026-07-29
**Author:** Technical Lead

# Branch Protection & Deployment Pipeline

This document explains the branch protection rules, CI pipeline, and deployment workflow for the AI Triad Research codebase — why they exist, how they interact, and when direct-to-main pushes are appropriate.

## The Theory: Defense in Depth

The goal is to prevent broken code from reaching production. We use three layers:

1. **Branch protection** — gates what can merge to `main`
2. **CI pipeline** — validates every push and PR automatically
3. **Blue-green deployment** — catches runtime failures that tests can't

Each layer catches a different class of failure. Tests catch logic errors. Branch protection catches process errors (untested code, unreviewed changes). Blue-green deployment catches environment errors (missing env vars, container startup failures, infrastructure drift). No single layer is sufficient alone.

## Branch Protection Rules

The `main` branch has GitHub branch protection enabled with:

- **Required status checks (6), strict** — all must pass before a merge, and `strict`
  means the branch must be up to date with `main` first:
  1. `test-powershell` — Pester tests, module build, manifest validation
  2. `test-electron (taxonomy-editor)` — npm ci, TypeScript check, vitest, coverage, build
  3. `test-electron (poviewer)` — npm ci, TypeScript check, build
  4. `test-electron (summary-viewer)` — npm ci, TypeScript check, build
  5. `test-electron (workflow-app)` — npm ci, TypeScript check, build
  6. `test-container` — Dockerfile lint, container build, smoke test
- **Pull requests are NOT required by the platform** — `required_pull_request_reviews`
  is not configured (required review removed 2026-07-29). PR-flow is the fleet's
  *convention* (see `/land-from-worktree`), enforced by TL review before Done — not by
  GitHub. Do not read green protection settings as evidence the review gate is enforced.
- **Bypass rights** — `enforce_admins=false`, so the admin identity (`jpsnover`) bypasses
  the required checks on a direct push. The Orca fleet commits and pushes as this same
  identity, so agent worktree direct-pushes bypass them too.
- **Force pushes** — disabled (`allow_force_pushes=false`).

### Why 6 Checks, Not 1

Each check validates a different blast radius:

| Check | What it catches | Time |
|---|---|---|
| `test-powershell` | Broken cmdlets, module manifest drift, missing exports | ~30s |
| `test-electron (taxonomy-editor)` | TypeScript errors, test failures, coverage regressions, build failures | ~2min |
| `test-electron (poviewer/summary-viewer/workflow-app)` | Cross-app TypeScript breakage from shared lib changes | ~1min each |
| `test-container` | Dockerfile syntax, container build failures, startup crashes, health probe failures | ~3min |

The `test-container` job depends on both `test-powershell` and `test-electron` completing — it only runs if the code compiles and tests pass, then validates the full container build and startup sequence. This catches failures invisible to unit tests: missing native dependencies, broken `npm ci` in the container layer, health endpoint regressions, environment variable misconfiguration.

### Why Matrix, Not Monolith

The 4 Electron apps share code via `lib/` but have independent `package.json`, `tsconfig`, and build pipelines. A change to `lib/debate/` could break `taxonomy-editor` without breaking `poviewer`. The matrix strategy (`fail-fast: false`) runs all 4 in parallel and reports each independently — a failure in one app doesn't mask results from others.

## CI Pipeline (`ci.yml`)

Triggers on every push to `main` and every PR targeting `main`.

```
Push/PR to main
    |
    ├── test-powershell (parallel)
    │     ├── Pester tests with coverage
    │     ├── Build module (Build-Module.ps1 -Clean)
    │     └── Validate built manifest
    │
    ├── test-electron × 4 apps (parallel matrix)
    │     ├── npm ci + npm audit
    │     ├── ESLint
    │     ├── TypeScript check (tsc --noEmit)
    │     ├── vitest (taxonomy-editor only: + coverage)
    │     └── Build (taxonomy-editor only)
    │
    └── test-container (depends on both above)
          ├── Dockerfile lint (hadolint)
          ├── Docker build
          └── Smoke test (health check, data availability)
```

### CI on Direct Push vs. PR

CI runs on **both** pushes and PRs. When you push directly to `main` (via bypass), CI still runs — but it runs *after* the code is already on `main`. If CI fails, `main` is broken until the fix lands. With a PR, CI runs *before* merge — broken code never reaches `main`.

This is the key tradeoff: direct push is faster (no PR overhead) but riskier (no pre-merge validation). The PR path adds ~5 minutes of latency but guarantees `main` is always green.

## Deployment Pipeline

Deployment is a separate, manually-triggered pipeline — CI passing does not auto-deploy.

```
1. Developer tags a release (v0.x.x)
   or manually triggers "Container Image" workflow
       |
       v
2. Container Image workflow
   ├── Lint Dockerfile
   ├── Fetch taxonomy snapshot (baked fallback data)
   ├── Build + push to GHCR
   ├── Trivy security scan (CRITICAL + HIGH)
   └── Generate SBOM
       |
       v
3. Auto-Deploy to Staging (triggered automatically)
   ├── Deploy new revision to staging Container App
   └── Health check (18 attempts × 10s = 3 min)
       |
       v
4. Manual verification on staging
   (human checks staging URL, reviews logs)
       |
       v
5. Deploy to Azure (manual trigger)
   ├── Bicep what-if (preview infrastructure changes)
   ├── Deploy Bicep template (full infrastructure)
   ├── Deploy new revision at 0% traffic
   ├── Health check (30 attempts × 10s = 5 min)
   ├── Shift traffic to 100% (if healthy)
   └── Auto-rollback (if unhealthy)
```

### Blue-Green Deployment

Azure Container Apps runs in `Multiple` revision mode. A new deploy creates a revision at 0% traffic. The workflow health-checks the new revision directly (via its revision-specific FQDN). Only after the health check passes does it shift traffic to 100%. If the check fails, the workflow deactivates the failed revision and restores traffic to the previous one.

This means a bad deploy **never serves user traffic** — the old revision keeps running throughout.

### Why Deployment Is Manual

Deploying from CI without human verification would mean:
- A passing test suite automatically reaches production
- Test suites can't catch everything (missing env vars, OAuth misconfiguration, API rate limit changes)
- There's no opportunity to verify on staging first

The staging auto-deploy provides a safe preview. Production deploy requires explicit human action.

## When Direct-to-Main Push Is Appropriate

The repo owner has bypass rights. These exist for specific scenarios:

| Scenario | Direct push OK? | Why |
|---|---|---|
| Multi-agent batch (many coordinated commits) | Yes, with caution | PR overhead for 10+ agent commits is impractical; owner reviews locally |
| Urgent hotfix (production down) | Yes | Speed matters more than process when users are affected |
| Documentation-only changes | Acceptable | Low risk, no runtime impact |
| CI/workflow file changes | Acceptable | Often can't be tested via PR (the PR itself needs the workflow change) |
| Feature code, refactors, new dependencies | **No** — use a PR | These are exactly what the 6 checks protect against |
| Infrastructure changes (Bicep, Dockerfile) | **No** — use a PR | `test-container` validates the full build; Bicep `what-if` runs in the deploy workflow |

### The Multi-Agent Case

In this project, multiple Orca agents commit to `main` concurrently. A typical feature involves 3-5 agents making coordinated changes across server, renderer, lib, and infrastructure. Running each through a separate PR would:

1. Create sequencing problems (PR B depends on PR A, but PR A's CI runs without PR B's code)
2. Add hours of CI latency for work that was already reviewed in-conversation by the Tech Lead
3. Force artificial branch management for changes designed to land together

The current pattern — agents commit locally, TL reviews, owner pushes to `main` with bypass — trades PR-based gating for in-conversation review. This works because:

- The TL reviews every implementation before marking tickets Done
- Code review sub-agents run against the changes (architecture, security, error handling)
- The owner verifies the full commit set before pushing
- CI still runs post-push, catching anything the review missed

**The risk**: if CI fails after a direct push, `main` is broken. Mitigations:

- Don't deploy until CI passes (deployment is manual and separate)
- Watch CI results after pushing — fix immediately if red
- For high-risk changes (new dependencies, Dockerfile changes, infrastructure), prefer a PR even in the multi-agent workflow

## Recommended Workflow Going Forward

### For routine multi-agent work:
1. Agents commit to local `main`
2. TL reviews all changes
3. Owner pushes with bypass
4. **Watch CI** — if it fails, fix before deploying
5. Verify staging, then manually trigger production deploy

### For high-risk changes:
1. Create a feature branch
2. Agents commit to the branch
3. Open PR against `main`
4. All 6 checks must pass
5. Owner merges
6. Deploy follows the same staging → production path

### What qualifies as high-risk:
- New npm packages (especially native addons — they can fail in the container)
- Dockerfile changes (build layer ordering, base image updates)
- Bicep infrastructure changes (new resources, role assignments, env vars)
- Authentication or authorization changes
- Changes to the deployment workflows themselves

## Key Files

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | CI pipeline — 6 status checks |
| `.github/workflows/container.yml` | Container image build + GHCR push + security scan |
| `.github/workflows/deploy-azure.yml` | Production blue-green deployment |
| `.github/workflows/deploy-staging.yml` | Auto-deploy to staging after container build |
| `deploy/azure/main.bicep` | Infrastructure-as-code (Container Apps, Key Vault, Storage, alerts) |
| `taxonomy-editor/Dockerfile` | App container definition |
| `deploy/azure/Dockerfile.base` | Base image with system dependencies |
