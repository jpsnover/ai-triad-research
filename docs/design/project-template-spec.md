# Project Template Repo Spec (t/800)

**Status:** Draft — for review  
**Author:** Technical Lead  
**Date:** 2026-06-22

## Goal

Create a GitHub template repo (`ai-research-template`) that packages the best infrastructure, patterns, and guidance from AI Triad Research into a reusable starting point for new projects. Every project that uses this template will get: flight recorder, error handling, code review guides, CI/CD, SBOM, secret management, AI abstraction, and a principled directory layout — out of the box.

**Assumptions:** All template projects target GitHub + Azure. No Orca dependency (Orca is a separate overlay concern). Projects will use AI and will have secrets.

---

## 1. Directory Layout

```
project-root/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # Lint + test (TS + PS matrix)
│   │   ├── container.yml           # Docker build + smoke test
│   │   ├── deploy-azure.yml        # Azure Container Apps deploy
│   │   ├── release.yml             # Multi-platform build + publish
│   │   ├── codeql.yml              # Security scanning
│   │   └── cache-cleanup.yml       # GH Actions cache pruning
│   ├── dependabot.yml              # Automated dependency updates
│   └── CODEOWNERS                  # Review assignment
│
├── lib/                            # Shared libraries (consumed by apps + scripts)
│   ├── ai-client/                  # Multi-backend AI abstraction
│   │   ├── index.ts                # Public API
│   │   ├── client.ts               # AIClient interface + factory
│   │   ├── types.ts                # GenerateOptions, ProviderResult, ToolDefinition
│   │   ├── registry.ts             # Model resolution + fallback chains
│   │   ├── retry.ts                # Exponential backoff + rate limit parsing
│   │   ├── defaults.ts             # DEFAULT_MODEL, DEFAULT_TEMPERATURE
│   │   └── providers/              # One file per backend
│   │       ├── claude.ts
│   │       ├── gemini.ts
│   │       ├── groq.ts
│   │       ├── openai.ts
│   │       ├── deepseek.ts
│   │       └── ollama.ts
│   ├── flight-recorder/            # Ring-buffer diagnostic recorder
│   │   ├── index.ts                # Global singleton API
│   │   ├── flightRecorder.ts       # Core recorder class
│   │   ├── ringBuffer.ts           # Circular buffer
│   │   ├── dictionary.ts           # String interning (memory efficiency)
│   │   ├── serializer.ts           # NDJSON dump format
│   │   ├── types.ts                # Config + event types
│   │   └── flightRecorder.test.ts
│   └── eslint.config.mjs           # Shared ESLint base (async safety)
│
├── app/                            # Primary application (Electron/web/CLI)
│   ├── src/
│   │   ├── main/                   # Electron main process (or Node.js entry)
│   │   ├── renderer/               # React/UI layer
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── bridge/             # Platform abstraction (Electron IPC vs REST)
│   │   │   └── lib/
│   │   └── server/                 # Express/Node.js server
│   │       ├── keyStore.ts         # Secret management (local + Key Vault)
│   │       ├── proxyTiers.ts       # AI proxy tier config
│   │       └── rateLimiter.ts      # Sliding-window rate limiting
│   ├── eslint-rules/               # Custom ESLint rules
│   │   └── require-flight-recorder-in-catch.js
│   ├── package.json
│   └── vite.config.ts
│
├── scripts/                        # PowerShell module + automation
│   ├── Project-Template/           # PS module (rename via Initialize-ProjectModule)
│   │   ├── Project-Template.psd1  # Module manifest (v0.1.0)
│   │   ├── Project-Template.psm1  # Root module (dot-sources Public/ + Private/)
│   │   ├── Public/                 # 15 exported cmdlets (see §12)
│   │   ├── Private/                # Internal helpers (ActionableError, recovery)
│   │   └── en-US/                 # Help files
│   ├── Build-Module.ps1            # Build + bundle script
│   ├── project-map.mjs            # Live project overview (dir tree + exports + status)
│   └── requirements.txt            # Python dependencies
│
├── deploy/
│   └── azure/
│       ├── main.bicep              # Container Apps + Key Vault + Log Analytics
│       ├── Dockerfile              # App container
│       ├── Dockerfile.base         # Base image (system deps + ML venv)
│       ├── deploy.ps1              # Deployment orchestration
│       └── runbooks/               # Incident response playbooks
│           └── incident-response.md
│
├── docs/                           # Internal documentation (for contributors)
│   ├── architecture.md             # System architecture overview
│   ├── error-handling.md           # Error handling standard
│   ├── flight-recorder-guide.md    # Flight recorder usage guide
│   ├── CodeReview/
│   │   ├── typescript-review-guide.md
│   │   └── python-review-guide.md
│   ├── design/                     # Architecture proposals + ADRs
│   │   └── adr/                   # Architecture Decision Records (Nygard format)
│   │       ├── 000-template.md    # ADR template
│   │       └── 001-example.md     # Example: "Use ActionableError for all unrecoverable errors"
│   └── runbooks/                   # Operational playbooks
│
├── docs-public/                    # External documentation (for users)
│   ├── getting-started.md
│   ├── api-reference.md
│   └── deployment-guide.md
│
├── tests/                          # PowerShell Pester tests
│   └── *.Tests.ps1
│
├── .env.example                    # Environment variable template (no secrets!)
├── .gitignore
├── CLAUDE.md                       # AI agent instructions (project conventions)
├── LICENSE
├── README.md
├── SECURITY.md                     # Vulnerability reporting policy
├── THIRD-PARTY-NOTICES.txt         # Generated SBOM (committed)
└── CONTRIBUTING.md                 # Contribution guidelines
```

**Key decisions:**
- `lib/` for shared code consumed by multiple apps — NOT app-specific
- `app/` instead of a named app dir — rename per project; supports multiple apps later
- `docs/` for internal (contributor) docs; `docs-public/` for external (user) docs
- `scripts/` for PowerShell module + Python deps + automation
- `deploy/` for all IaC, Docker, and deployment scripts
- `tests/` at root for PowerShell Pester; app tests co-located with source (`*.test.ts`)

---

## 2. Flight Recorder

**Source:** `lib/flight-recorder/` (8 files, fully self-contained)

**What it provides:**
- Ring-buffer event recording (configurable capacity, default 3000 events)
- String interning dictionary (memory efficiency for repeated component names)
- NDJSON dump format (one event per line, grep-friendly)
- Global singleton API (`getGlobalRecorder()?.record({...})`)
- Context snapshots (app version, deployment mode, user state at dump time)
- Manual + automatic dump triggers (crash, threshold, user-initiated)

**Template generalization:**
- Remove AI Triad-specific event types (`debate.*`, `an.*`, `turn.*`)
- Keep generic event types: `system.error`, `system.warn`, `ai.request`, `ai.response`, `api.call`, `state.change`, `user.action`
- Project-specific types added via TypeScript union extension
- Include the ESLint rule (`require-flight-recorder-in-catch.js`) that enforces recorder usage in catch blocks

---

## 3. Error Handling Standard

**Source:** `docs/error-handling.md` + `ActionableError` class

**Template includes:**

### ActionableError (TypeScript)
```typescript
class ActionableError extends Error {
  constructor(opts: {
    goal: string;        // What were you trying to do?
    problem: string;     // What went wrong?
    location: string;    // file:line — function
    nextSteps: string[]; // What should the user/developer do?
    innerError?: unknown;
  })
}
```

### New-ActionableError (PowerShell)
```powershell
New-ActionableError -Goal '...' -Problem '...' -Location '...' -NextSteps @('...')
```

### Rules
1. All unrecoverable errors MUST use ActionableError — no bare `throw "message"`
2. Every `catch` block MUST call `getGlobalRecorder()?.record()` BEFORE throwing/returning
3. Expected errors (404, ENOENT) record at level `warn`, then return null/empty
4. Prefer recovery (retry, fallback, partial results) over failure
5. ESLint rule enforces flight recorder in catch blocks

---

## 4. Code Review Guides

**Source:** `docs/CodeReview/` (2 comprehensive guides)

**Template includes:**
- **TypeScript Stack Review Guide** — Electron security, IPC/Zod validation, async safety, memory management, Vite+Electron patterns
- **Python Packages Review Guide** — Anthropic SDK, resource lifecycle, input validation, ML library patterns

**Generalization:** Remove project-specific tool names, keep security postures and architectural patterns. These are designed to be used by AI code review agents (sub-agents spawned during PR review).

---

## 5. CI/CD Rules

**Assumptions:** GitHub Actions, Azure Container Apps, no Orca.

### ci.yml (on push/PR to main)
- **test-powershell**: Pester tests, module build, manifest validation, coverage threshold
- **test-typescript**: `npm ci`, ESLint (zero errors), `tsc --noEmit`, vitest with coverage
- **Matrix**: runs both jobs in parallel

### container.yml (manual or on release tag)
- Build Docker image from `deploy/azure/Dockerfile`
- Smoke test: start container, health check endpoint
- Push to `ghcr.io/{owner}/{repo}:latest`

### deploy-azure.yml (manual or post-container)
- Deploy Bicep template
- Update Container App revision
- Blue-green traffic shift (if multi-revision mode)
- Health check after deploy

### codeql.yml (weekly + on PR)
- JavaScript/TypeScript + Python analysis
- Alerts -> Security tab

### Dependabot (dependabot.yml)
- npm: weekly updates for each `package.json`
- pip: weekly updates for `requirements.txt`
- GitHub Actions: monthly version bumps

### Rules enforced by CI
- Zero ESLint errors (warnings allowed but tracked)
- TypeScript strict mode (`tsc --noEmit`)
- All tests pass
- Coverage doesn't regress below threshold
- THIRD-PARTY-NOTICES.txt is up to date (SBOM)

---

## 6. SBOM Generation

**Pattern:** `generate-license-file` npm package + post-processing script

**package.json:**
```json
{
  "scripts": {
    "licenses": "generate-license-file --input package.json --output THIRD-PARTY-NOTICES.txt"
  }
}
```

**Rules:**
- `THIRD-PARTY-NOTICES.txt` committed to repo (not gitignored)
- Regenerated before each release
- CI can verify it's current via diff check
- Covers npm dependencies; Python deps documented separately in `requirements.txt` (pip-licenses for Python SBOM)

---

## 7. Secret Management

**Pattern:** BYOK (Bring Your Own Key) — no secrets in infrastructure

### Tiers
| Tier | Key Source | Storage |
|------|-----------|---------|
| Platform | Server-side | Env var -> Azure Key Vault |
| BYOK | User-provided | Browser sessionStorage (never persisted server-side) |
| Free | Server-side (dedicated account) | Env var (`FREE_TIER_*_KEY`) |

### Implementation
- `keyStore.ts` — dual-mode: `LocalFileKeyStore` (AES-256-GCM) for dev, `AzureKeyVaultKeyStore` for prod
- `.env.example` — documents all env vars with placeholder values, NEVER real secrets
- `.gitignore` — excludes `.env`, `*.enc`, `key-material` files
- GitHub Actions secrets — for CI/CD deployment keys
- Bicep params — for runtime env vars (wired via GH Actions variables, not hardcoded)

### Rules
- NO secrets in code, config files, or Docker images
- API keys are per-user, per-backend, encrypted at rest
- Key rotation requires only env var update + redeploy
- Error messages MUST NOT leak key values

---

## 8. AI Usage Patterns

**Source:** `lib/ai-client/` (15 files)

### What the template provides
- **Multi-backend client** — Claude, Gemini, Groq, OpenAI, DeepSeek, Ollama
- **Model registry** — JSON config mapping model names to providers + API model IDs
- **Fallback chains** — if primary model fails, try secondary (e.g., Gemini -> Groq)
- **Retry logic** — exponential backoff with rate-limit header parsing
- **Streaming** — async iterator API for streaming responses
- **Tool use** — JSON Schema tool definitions with validation
- **Token tracking** — input/output token counts for cost monitoring
- **Proxy tier system** — rate limiting per user/session, backend allowlists

### Configuration
```json
{
  "models": {
    "gemini-flash-lite": { "backend": "gemini", "apiModel": "gemini-2.5-flash-lite" },
    "claude-sonnet": { "backend": "claude", "apiModel": "claude-sonnet-4-6" }
  },
  "defaultModel": "gemini-flash-lite",
  "fallbacks": { "claude-sonnet": ["gemini-flash"] }
}
```

---

## 9. Additional Template Components

### Git Conventions
- **Commit messages**: `type(scope): description` (conventional commits)
- **Co-author attribution**: `Co-Authored-By:` trailer for multi-agent/pair work
- **No `--amend` on shared branches** — always new commits
- **Pathspec commits**: `git commit -- <files>` to avoid sweeping in unrelated staged files

### Environment Configuration
- `.env.example` with ALL vars documented and placeholder values
- `$env:VAR` / `process.env.VAR` — never hardcoded
- Priority: env var > config file > built-in default
- `config.ts` module centralizes all env var reads with typed accessors

### Observability
- Flight recorder for client-side diagnostics
- Structured logging (JSON) for server-side
- Health check endpoint (`GET /health`) — required for Azure Container Apps
- Build version in every log line (`git describe --tags --always`)

### Security
- `SECURITY.md` — vulnerability reporting policy
- CodeQL scanning in CI
- Dependabot enabled for all package managers
- `assertSafeId()` / `safeSegment()` — path traversal prevention on any user-provided ID
- `HttpOnly` + `Secure` cookies only
- CORS configured per environment
- CSP headers for web apps

### Testing Conventions
- TypeScript: Vitest, co-located `*.test.ts` files, coverage thresholds in `vite.config.ts`
- PowerShell: Pester, `tests/` directory at root, coverage via `CodeCoverage` config
- Every bug fix includes a regression test
- Integration tests hit real services where possible (no mocks for DB/API in integration tier)
- **Local verification gate**: `npm run verify` = `tsc --noEmit && eslint . && vitest run` — agents and contributors run this before reporting any task as complete
- CLAUDE.md convention: "Run `npm run verify` before reporting any task as complete"

### Architecture Decision Records (ADRs)
- Stored in `docs/design/adr/` using the Michael Nygard format
- Each ADR has: **Status** (proposed/accepted/deprecated/superseded), **Context**, **Decision**, **Consequences**
- Template file at `docs/design/adr/000-template.md`
- Active ADR constraints summarized as bullet points in CLAUDE.md under "Key Architectural Constraints" — this is what agents read at session start
- ADRs are for one-way-door decisions only — reversible choices don't need one
- Example ADRs to seed: "Use ActionableError for all unrecoverable errors", "BYOK key model — no secrets in infrastructure", "Flight recorder in every catch block"

### Project Map Tool
- `scripts/project-map.mjs` — generates a live project overview on demand
- Output: directory tree (depth 3), `lib/` export signatures, CLAUDE.md content, git status summary
- Computed on demand, never cached — always reflects current state
- Mentioned in CLAUDE.md: "Run `node scripts/project-map.mjs` for a low-token project overview"
- NOT a pre-commit hook or auto-generated artifact — a tool agents can invoke when orienting

### Documentation
- `docs/` — internal (architecture, error handling, code review, flight recorder, design proposals, ADRs)
- `docs-public/` — external (getting started, API reference, deployment)
- `CONTRIBUTING.md` — how to set up dev environment, run tests, submit PRs; notes that agents should use their runtime's native persistence (memory, plans, status) instead of modifying CLAUDE.md for transient state
- `README.md` — project overview, quick start, architecture diagram

---

## 10. Components to Extract (by priority)

### Tier 1: Copy near-verbatim (HIGH reuse, minimal changes)
| Component | Files | Change needed |
|-----------|-------|---------------|
| Flight Recorder | 8 files | Remove project-specific event types |
| AI Client | 15 files | Parametrize model registry |
| ESLint config + custom rule | 2 files | Update paths |
| Code Review Guides | 2 files | Remove project-specific examples |
| Rate Limiter | 1 file | None — fully generic |

### Tier 2: Extract + generalize (MEDIUM effort)
| Component | Files | Change needed |
|-----------|-------|---------------|
| Proxy Tiers | 1 file | Generalize tier names |
| Key Store | 1 file | Replace backend type |
| Error Handling doc + ActionableError | 2 files | Decouple from project |
| CI workflows | 5-8 files | Parametrize app names, paths |
| SBOM generation | npm script + parse script | Minimal |

### Tier 3: Template + document (reference patterns)
| Component | Source | Template form |
|-----------|--------|---------------|
| Directory layout | This spec | Scaffold with placeholder dirs |
| ADR directory + template | docs/design/adr/ | Nygard-format template + seed examples |
| Project map tool | scripts/project-map.mjs | Generic dir-tree + export scanner |
| Verify script | package.json | `npm run verify` = tsc + eslint + vitest |
| Bicep templates | deploy/azure/ | Generalize resource names |
| Dockerfile patterns | deploy/azure/ | Multi-stage template |
| PS module structure | scripts/AITriad/ | `scripts/Project-Template/` with 15 cmdlets (see §12) |
| Git conventions | CLAUDE.md | CONTRIBUTING.md section |
| Security patterns | Various | SECURITY.md + assertSafeId utility |

---

## 11. What the Template Does NOT Include

- **Orca** — overlay repo, agent roles, AGENTS.md hierarchy (separate concern)
- **Domain-specific logic** — taxonomy, debates, BDI model, POV camps
- **Data repo patterns** — two-repo split is project-specific
- **Electron-specific IPC** — bridge pattern is included as reference, not scaffolded
- **ML model downloads** — sentence-transformers, embedding models (project-specific)

---

## 12. PowerShell Module (`scripts/Project-Template/`)

**Source:** Generalized from `scripts/AITriad/` (120+ cmdlets), distilled to 15 reusable infrastructure cmdlets + 2 private helpers. All domain-specific cmdlets (taxonomy, debate, embedding, POV) are excluded — this module provides the operational backbone that every project needs.

**Post-clone setup:** Run `Initialize-ProjectModule -ProjectName 'YourProject'` to rename the module directory, manifest, and root module.

### Module Structure

```
scripts/Project-Template/
├── Project-Template.psd1           # Module manifest (v0.1.0, PS 7.0+)
├── Project-Template.psm1           # Root module (auto-discovers repo root, dot-sources Public/ + Private/)
├── Public/                          # 15 exported cmdlets
│   ├── Get-FlightRecorderDump.ps1
│   ├── Get-FlightRecorderReport.ps1
│   ├── Show-FlightRecorder.ps1
│   ├── Find-FlightRecorderPattern.ps1
│   ├── Test-FlightRecorderPII.ps1
│   ├── Invoke-VerifyGate.ps1
│   ├── Invoke-LicenseAudit.ps1
│   ├── Invoke-DependencyAudit.ps1
│   ├── Test-VersionConsistency.ps1
│   ├── Test-SBOMCurrency.ps1
│   ├── New-ADR.ps1
│   ├── Get-ADRIndex.ps1
│   ├── Get-ProjectHealth.ps1
│   ├── Get-ProjectMap.ps1
│   └── Initialize-ProjectModule.ps1
├── Private/                         # Internal helpers
│   └── New-ActionableError.ps1     # ActionableError + Invoke-WithRecovery
└── en-US/                           # Help files
```

### Cmdlet Catalog

#### Flight Recorder Processing (5 cmdlets)

| Cmdlet | Purpose | Key Parameters |
|--------|---------|----------------|
| `Get-FlightRecorderDump` | List/retrieve NDJSON dump files from platform-specific app data | `-Last <N>`, `-DumpDir`, `-AppName` |
| `Get-FlightRecorderReport` | Parse dump → structured analysis (levels, components, errors, time range, trigger) | `-Path`, `-Detailed`, `-AsObject` |
| `Show-FlightRecorder` | Open dump in interactive HTML viewer (embeds data, launches browser) | `-Path`, `-Last` |
| `Find-FlightRecorderPattern` | Scan multiple dumps for recurring error patterns (weekly maintenance check) | `-MinOccurrences 3`, `-DumpDir`, `-Last` |
| `Test-FlightRecorderPII` | Scan dump for PII/secret leaks (API keys, emails, tokens, JWTs) | `-Path` (pipeline from Get-FlightRecorderDump) |

**Pipeline example:**
```powershell
Get-FlightRecorderDump -Last 5 | Get-FlightRecorderReport -AsObject | Where-Object ErrorCount -gt 0
Get-FlightRecorderDump -Last 1 | Test-FlightRecorderPII
Find-FlightRecorderPattern -MinOccurrences 2 -Last 10
```

#### Maintenance & Compliance (5 cmdlets)

| Cmdlet | Purpose | Maintenance Cadence |
|--------|---------|---------------------|
| `Invoke-VerifyGate` | Auto-detect app dirs, run `npm run verify` + Pester tests | Per-task |
| `Invoke-LicenseAudit` | Check npm dependencies against allow/deny license lists | Weekly |
| `Invoke-DependencyAudit` | Run `npm audit` + `pip-audit`, categorize by CVSS severity with SLA deadlines | Weekly |
| `Test-VersionConsistency` | Verify version strings match across .psd1, package.json, CLAUDE.md | Per-release |
| `Test-SBOMCurrency` | Regenerate THIRD-PARTY-NOTICES.txt, diff against committed version | Weekly |

**SLA deadlines** (from `docs/security/dependency-policy.md`):
- Critical: 48 hours
- High: 7 days
- Medium/Moderate: 30 days
- Low: Next maintenance cycle

#### ADR Management (2 cmdlets)

| Cmdlet | Purpose | Key Parameters |
|--------|---------|----------------|
| `New-ADR` | Auto-number + scaffold ADR from Nygard template, open in editor | `-Title` (mandatory), `-Author`, `-Status`, `-ADRDir` |
| `Get-ADRIndex` | Parse all ADRs → structured index (number, title, status, date, author) | `-Status` filter, `-ADRDir` |

**Example:**
```powershell
New-ADR -Title 'Use ring buffer for diagnostic recording'
Get-ADRIndex -Status accepted | Format-Table Number, Title, Date
```

#### Project Health & Utilities (3 cmdlets)

| Cmdlet | Purpose | Key Parameters |
|--------|---------|----------------|
| `Get-ProjectHealth` | Aggregate dashboard: version consistency + ADR status + SBOM + dependency audit | `-Quick` (skip slow checks) |
| `Get-ProjectMap` | Generate project overview: directory tree, key files, git status | `-Depth`, `-IncludeGitStatus` |
| `Initialize-ProjectModule` | Post-clone: rename module from Project-Template to project name, update GUID/author | `-ProjectName` (mandatory), `-Author` |

**Health check output:**
```
=== Project Health Check ===
Check                Status Detail
-----                ------ ------
Version Consistency  PASS   v0.1.0
ADR Status           PASS   Active: 3, Proposed: 1, Deprecated: 0
SBOM Currency        PASS   Up to date
Dependency Audit     FAIL   Critical: 0, High: 2, Medium: 5, Low: 3
```

#### Private Helpers (2 functions)

| Function | Purpose |
|----------|---------|
| `New-ActionableError` | Structured error with Goal/Problem/Location/NextSteps. Supports `-Throw`, `-PassThru`, `-InnerError`. |
| `Invoke-WithRecovery` | Retry + fallback wrapper. Configurable `-MaxRetries`, `-RetryDelaySeconds`, `-Fallback` scriptblock. |

### Design Principles

1. **All errors use ActionableError** — no bare `throw "message"` in any cmdlet (ADR-001)
2. **Pipeline-first** — every cmdlet accepts pipeline input where sensible (Get-FlightRecorderDump | Get-FlightRecorderReport | ...)
3. **Auto-discovery** — cmdlets find repo root, app dirs, dump dirs automatically; override with explicit parameters
4. **Structured output** — every cmdlet returns PSCustomObject with typed properties; formatted text is the default display, not the data
5. **Cross-platform** — all cmdlets work on Windows, macOS, Linux (PS 7.0+)
6. **No project-specific logic** — flight recorder event types, maintenance SLAs, and license policies are configurable, not hardcoded

### Maintenance Schedule Integration

These cmdlets map directly to the tasks in `docs/maintenance-schedule.md`:

| Schedule Task | Cmdlet |
|---------------|--------|
| Flight recorder spot check (weekly) | `Find-FlightRecorderPattern` |
| Dependency audit — npm (weekly) | `Invoke-DependencyAudit` |
| Dependency audit — pip (weekly) | `Invoke-DependencyAudit -SkipNpm` |
| SBOM currency (weekly) | `Test-SBOMCurrency` |
| Run verify gate (per-task) | `Invoke-VerifyGate` |
| Version consistency (per-release) | `Test-VersionConsistency` |
| ADR review (quarterly) | `Get-ADRIndex` |
| Overall health check | `Get-ProjectHealth` |

---

## Implementation Approach

1. Create empty `ai-research-template` repo on GitHub with template flag
2. Scaffold directory layout from this spec
3. Copy Tier 1 components verbatim, update headers
4. Extract + generalize Tier 2 components
5. Write template README with "Extract & Adapt" guide
6. Test: create a new repo from template, verify CI runs, flights record, AI client works
7. Tag v1.0.0
