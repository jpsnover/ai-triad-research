# CI/CD Quality Improvements for AI-Authored Codebase

**Author:** Technical Lead
**Date:** 2026-05-23
**Status:** Proposal — awaiting review

## Context

This project is predominantly AI-authored — Orca agents write most production code across PowerShell, TypeScript/Electron, and Python. Two external guides were reviewed for applicable practices:

- [Semaphore: Enforcing Quality Checks on AI-Generated Code in CI/CD](https://semaphore.io/how-do-i-enforce-quality-checks-on-ai-generated-code-in-ci-cd)
- [Dev.to: Before You Deploy AI-Generated Code — A Production Checklist](https://dev.to/gaurav_talesara/before-you-deploy-ai-generated-code-a-production-checklist-1m80)

Both articles converge on a key insight: **AI-generated code compiles but lacks contextual correctness.** It introduces subtle issues — unused imports, missing edge-case handling, insecure patterns from training data — that pass syntax checks but fail in production. The solution is not AI-specific pipelines, but stronger universal CI gates.

## Current State Audit

### What we have (strengths)

| Check | Scope | Notes |
|-------|-------|-------|
| Pester tests | PowerShell module | CI job `test-powershell` |
| Vitest suite | taxonomy-editor | CI job `test-electron` |
| ESLint | taxonomy-editor | Conditional — only if config file exists |
| TypeScript type check | taxonomy-editor main process | `tsc --noEmit -p tsconfig.main.json` |
| Dockerfile linting | Container builds | Hadolint with `failure-threshold: error` |
| Container security scan | Base image + app image | Trivy with SARIF upload to GitHub Security |
| Container smoke test | Deployed container | Health check, liveness probe, data availability |
| Module build + manifest validation | PowerShell module | `Build-Module.ps1 -Clean` + `Test-ModuleManifest` |

### What we're missing (gaps)

| Gap | Risk | Priority |
|-----|------|----------|
| **No dependency audit** | Vulnerable packages ship undetected | High |
| **No test coverage enforcement** | AI agents can merge code with 0% test coverage | High |
| **No security scanning (SAST) for source code** | Trivy scans containers only; no SAST on TypeScript/PowerShell | High |
| **No linting for 3 of 4 apps** | poviewer, summary-viewer, workflow-app have no lint step | Medium |
| **No TypeScript check for 3 of 4 apps** | Only taxonomy-editor main process is type-checked in CI | Medium |
| **No Dependabot / Renovate** | Dependencies drift silently; no automated PR for updates | Medium |
| **No branch protection rules** | Main branch can receive direct pushes without passing CI | Medium |
| **ESLint is conditional** | `if: hashFiles(...)` means lint is skipped when no config exists | Low |
| **No npm audit in CI** | Known CVEs in node_modules pass undetected | High |
| **No Pester code coverage** | PowerShell module has no coverage threshold | Medium |

## Recommended Improvements

### Priority 1: Security (immediate)

#### 1a. Add `npm audit` to CI

Run `npm audit --audit-level=high` for each Electron app. Fail the build on high/critical vulnerabilities.

```yaml
- name: Audit dependencies
  working-directory: taxonomy-editor
  run: npm audit --audit-level=high
```

**Cost:** 5 lines of YAML per app. **Blast radius:** May surface existing vulnerabilities that need triage.

#### 1b. Enable Dependabot

Create `.github/dependabot.yml` to auto-PR dependency updates for all 4 Node apps and GitHub Actions.

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /taxonomy-editor
    schedule:
      interval: weekly
  - package-ecosystem: npm
    directory: /workflow-app
    schedule:
      interval: weekly
  - package-ecosystem: npm
    directory: /poviewer
    schedule:
      interval: weekly
  - package-ecosystem: npm
    directory: /summary-viewer
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

#### 1c. Add SAST for TypeScript

GitHub's CodeQL or Semgrep can scan TypeScript source for injection, XSS, and insecure patterns. This is especially relevant because AI agents are the primary authors and may reproduce insecure patterns from training data.

```yaml
- name: Run Semgrep
  uses: semgrep/semgrep-action@v1
  with:
    config: p/typescript
```

### Priority 2: Test coverage enforcement

#### 2a. Add coverage thresholds to Vitest

The taxonomy-editor already has Vitest. Add coverage reporting and a minimum threshold.

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
});
```

CI step: `npm run test -- --coverage` and fail if below threshold.

#### 2b. Add Pester code coverage

```powershell
$config = New-PesterConfiguration
$config.Run.Path = './tests/'
$config.CodeCoverage.Enabled = $true
$config.CodeCoverage.Path = @('./scripts/AITriad/Public/*.ps1')
$config.CodeCoverage.CoveragePercentTarget = 50
```

**Starting thresholds should be low** (50-60%) and ratcheted up quarterly. The goal is preventing regression, not achieving 100%.

### Priority 3: Expand linting and type checking

#### 3a. Add ESLint + TypeScript checks for all Electron apps

Currently only taxonomy-editor is linted/type-checked in CI. The workflow-app, poviewer, and summary-viewer ship without any static analysis.

Add a matrix strategy to the `test-electron` job:

```yaml
test-electron:
  runs-on: ubuntu-latest
  strategy:
    matrix:
      app: [taxonomy-editor, workflow-app, poviewer, summary-viewer]
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
        cache-dependency-path: ${{ matrix.app }}/package-lock.json
    - run: npm ci
      working-directory: ${{ matrix.app }}
    - run: npm run lint --if-present
      working-directory: ${{ matrix.app }}
    - run: npx tsc --noEmit
      working-directory: ${{ matrix.app }}
    - run: npm test --if-present
      working-directory: ${{ matrix.app }}
```

This requires adding `eslint` and `tsconfig.json` to apps that don't have them yet — a separate ticket per app.

#### 3b. Make ESLint non-conditional

Remove `if: hashFiles('taxonomy-editor/eslint.config.*') != ''`. If the config doesn't exist, that's a bug — ESLint should always run.

### Priority 4: Branch protection

#### 4a. Require status checks before merge

Configure GitHub branch protection for `main`:
- Require CI (`test-powershell`, `test-electron`, `test-container`) to pass
- Require at least 1 PR review (human or designated reviewer agent)
- Dismiss stale reviews on new pushes
- No direct pushes to main

This is especially critical in an AI-agent-heavy project where multiple agents can push code. Branch protection ensures every change passes the full gate.

### Priority 5: Observability (future)

#### 5a. Structured logging for the web deployment

The taxonomy-editor web server (`src/server/server.ts`) should emit structured JSON logs (not `console.log`) for:
- Request tracing (correlation IDs)
- Error reporting with stack traces
- API key usage events (BYOK model — track which backends are called)

Tools: Winston or Pino for Node.js structured logging.

#### 5b. Error monitoring

Consider Sentry or similar for the deployed web app to catch runtime errors that CI can't predict. Particularly valuable for AI-agent-authored code where edge cases are the primary risk.

## What We Don't Need

Both articles mention several practices that don't apply to this project:

- **N+1 query optimization, database indexing** — No database; all data is JSON on disk
- **Rate limiting for APIs** — The app proxies user-provided API keys; rate limits are the backend provider's concern
- **Background job queues (Redis, BullMQ)** — Architecture is synchronous PowerShell pipelines and Electron IPC
- **Circuit breakers** — AI backend calls already have retry logic in `AIEnrich.psm1`; adding circuit breakers would over-engineer for 1-3 concurrent users

## Implementation Order

| Phase | Items | Effort |
|-------|-------|--------|
| **Phase 1** (this sprint) | npm audit in CI, Dependabot config, make ESLint non-conditional | Small — YAML only |
| **Phase 2** (next sprint) | Coverage thresholds (Vitest + Pester), SAST scan | Medium — config + threshold tuning |
| **Phase 3** (next month) | Lint/type-check all 4 apps, branch protection | Medium — per-app setup |
| **Phase 4** (future) | Structured logging, error monitoring | Large — code changes |

## References

- Current CI: `.github/workflows/ci.yml`
- Container security: `.github/workflows/container.yml`, `.github/workflows/base-image.yml`
- Error handling standard: `docs/error-handling.md`
- Code review guides: `docs/CodeReview/`
