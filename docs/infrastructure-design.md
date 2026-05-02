# Infrastructure & Deployment — High-Level Design

**Status:** Living document  
**Last updated:** 2026-05-01  
**Author:** Jeffrey Snover  
**Audience:** Engineers and operators who need to understand the platform's CI/CD, containerization, cloud deployment, and operational model.

---

## 1. Problem Statement

The AI Triad platform has multiple deployment targets: researchers running locally on Windows/macOS/Linux, a cloud-hosted instance on Azure for shared access, and CI pipelines that must validate both PowerShell and TypeScript code. Each target has different requirements — desktop needs native installers, cloud needs containerization, CI needs reproducible test environments.

The infrastructure must support all three without forcing contributors to understand the full deployment surface. A researcher who only uses the PowerShell module shouldn't need Docker; a cloud operator shouldn't need to understand Pester tests.

## 2. Goals and Non-Goals

### Goals

- **G1:** Automated testing on every push/PR (PowerShell + TypeScript)
- **G2:** One-command release for all platforms (macOS, Windows, Linux desktop + container image)
- **G3:** Cloud deployment with zero infrastructure management (serverless containers)
- **G4:** BYOK model — platform never holds shared API keys
- **G5:** Data persistence across container restarts (Azure Files volume)
- **G6:** Optional authentication (anonymous, Google OAuth, GitHub OAuth)

### Non-Goals

- **NG1:** Multi-region deployment — single Azure region is sufficient for research team
- **NG2:** Auto-scaling under load — research workload is single-digit concurrent users
- **NG3:** Kubernetes — Container Apps provides sufficient orchestration
- **NG4:** Secrets rotation automation — manual key management via Key Vault is adequate
- **NG5:** Blue-green or canary deployments — single-instance rolling updates are acceptable

## 3. CI/CD Pipeline Architecture

### 3.1 Pipeline Map

```
Push/PR to main
    │
    ├─► ci.yml ─────────────────────────────────────────┐
    │   ├─ test-powershell (Ubuntu)                     │
    │   │  └─ Pester tests → Build module → Validate   │
    │   └─ test-electron (Ubuntu)                       │
    │      └─ npm ci → tsc check → npm run build        │
    │                                                    │
Tag v*                                                   │
    │                                                    │
    ├─► release.yml ────────────────────────────────────┐│
    │   ├─ resolve-version (check PSGallery)            ││
    │   ├─ test (Pester)                                ││
    │   ├─ build-ps-module                              ││
    │   ├─ build-electron-mac                           ││
    │   ├─ build-electron-win                           ││
    │   ├─ build-electron-linux                         ││
    │   └─ create-release (GitHub release + artifacts)  ││
    │                                                    ││
    ├─► container.yml ──────────────────────────────────┘│
    │   └─ Docker multi-platform build (amd64, arm64)    │
    │   └─ Push to GHCR                                  │
    │                                                    │
Manual trigger                                           │
    │                                                    │
    └─► deploy-azure.yml ───────────────────────────────┘
        └─ Azure Container Apps deployment
```

### 3.2 CI Test Matrix

**test-powershell** job:

```
1. Checkout ai-triad-research (code)
2. Checkout ai-triad-data (shallow clone, separate path)
3. Symlink data to ../ai-triad-data
4. Install Pester module
5. Invoke-Pester ./tests/
6. Build-Module.ps1 -Clean
7. Test-ModuleManifest ./build/AITriad/AITriad.psd1
```

The data repo checkout is necessary because tests exercise taxonomy queries, summarization, and conflict detection against real data. Shallow clone keeps checkout time manageable (~50 MB vs. 410 MB full clone).

**test-electron** job:

```
1. Setup Node 20
2. cd taxonomy-editor && npm ci
3. npx tsc --noEmit -p tsconfig.main.json
4. npm run build
```

TypeScript check validates types across the full codebase. The build step catches Vite configuration issues and missing dependencies.

### 3.3 Release Pipeline

Triggered by pushing a `v*` tag (e.g., `v0.8.0`):

```
resolve-version ──► test ──► build-ps-module ──┐
                                                ├──► create-release
                    build-electron-mac ─────────┤
                    build-electron-win ─────────┤
                    build-electron-linux ────────┘
```

**resolve-version** checks PSGallery for the current published version. If the tag version matches an already-published version, it auto-bumps the patch number to avoid collisions.

**create-release** downloads all build artifacts and creates a GitHub release with auto-generated release notes (derived from commit messages since the last tag).

## 4. Container Architecture

### 4.1 Build Strategy

Two-stage multi-platform build (amd64 + arm64):

```dockerfile
# Stage 1: Builder
FROM node:22-bookworm-slim AS builder
# Install build deps (python3, make, g++ for node-gyp native modules)
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:container
# Output: dist/server/ (Express app) + dist/renderer/ (Vite bundle)

# Stage 2: Runtime
FROM ghcr.io/jpsnover/ai-triad-base:latest
# Base image: Python 3.11, Node 22, pandoc, ffmpeg, ghostscript
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER aitriad
EXPOSE 7862
HEALTHCHECK CMD curl -f http://localhost:7862/health
CMD ["node", "dist/server/index.js"]
```

### 4.2 Base Image

The base image (`deploy/azure/Dockerfile.base`) pre-installs heavy dependencies:

| Component | Purpose | Size Impact |
|---|---|---|
| Python 3.11 | Embedding computation (sentence-transformers) | ~200 MB |
| Node 22 | Application runtime | ~100 MB |
| pandoc | Document conversion (PDF/DOCX → Markdown) | ~50 MB |
| ffmpeg | Audio generation for debate transcripts | ~80 MB |
| ghostscript | PDF processing | ~30 MB |

Building the base image separately (via `base-image.yml`) means application builds don't reinstall these dependencies, reducing build time from ~15 minutes to ~3 minutes.

### 4.3 Runtime Configuration

| Environment Variable | Purpose | Default |
|---|---|---|
| `AI_TRIAD_DATA_ROOT` | Data directory path | `/data` |
| `ALLOWED_ORIGINS` | CORS origins | Deployment FQDN |
| `DEPLOY_SHA` | Git commit for traceability | Set at deploy time |
| `GIT_SYNC_ENABLED` | Enable GitHub data sync | `false` |
| `GITHUB_REPO` | Data repo for git sync | — |
| `GITHUB_APP_ID` | GitHub App for data sync | — |

## 5. Azure Deployment

### 5.1 Infrastructure (Bicep)

`deploy/azure/main.bicep` defines the complete infrastructure:

```
┌────────────────────────────────────────────────────────┐
│ Resource Group                                          │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Container Apps Environment                        │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │ Container App                              │  │  │
│  │  │  ├─ Image: ghcr.io/jpsnover/ai-triad:tag  │  │  │
│  │  │  ├─ Port: 7862                             │  │  │
│  │  │  ├─ Managed Identity → Key Vault access    │  │  │
│  │  │  ├─ Volume mount: Azure Files → /data      │  │  │
│  │  │  └─ Scale: 0-1 replicas (scale-to-zero)    │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────┐  ┌───────────────────────────┐   │
│  │ Storage Account │  │ Key Vault                 │   │
│  │  └─ Azure Files │  │  ├─ OAuth client secrets  │   │
│  │     └─ /data    │  │  ├─ GitHub App key        │   │
│  │       volume    │  │  └─ GHCR password         │   │
│  └─────────────────┘  └───────────────────────────┘   │
│                                                         │
│  ┌────────────────────────┐                            │
│  │ Log Analytics Workspace│                            │
│  └────────────────────────┘                            │
└────────────────────────────────────────────────────────┘
```

**Scale-to-zero:** The container app scales to 0 replicas when idle (no incoming requests), eliminating compute costs during inactive periods. First request after idle triggers a cold start (~10–15 seconds).

### 5.2 BYOK (Bring Your Own Key) Model

The platform never holds shared API keys. Users manage their own keys:

```
User enters API key in UI
    │
    ▼
Client-side AES-256-GCM encryption
    │
    ▼
Encrypted key stored on /data volume
    │
    ▼
At inference time:
    ├─ Decrypt key in memory
    ├─ Send to AI backend
    └─ Key never logged or persisted in plaintext
```

This model means:
- **No shared API costs** — each user pays for their own usage
- **No key rotation burden** — users manage their own keys
- **No credential exposure risk** — the platform stores only encrypted blobs
- **Per-user backend choice** — one user can use Gemini while another uses Claude

### 5.3 Authentication Modes

Three configurable modes via deployment parameters:

| Mode | Behavior | Use Case |
|---|---|---|
| `authDisabled = true` | No login UI, anonymous access only | Personal instance, local testing |
| `authOptional = true` | Login page with "continue anonymously" option | Shared instance with optional identity |
| Neither | Login required, no anonymous access | Restricted access, audit trail needed |

OAuth providers (optional):
- **Google** — configured via `googleClientId` / `googleClientSecret`
- **GitHub** — configured via `githubClientId` / `githubClientSecret`

Secrets stored in Azure Key Vault, accessed via managed identity (no hardcoded credentials in the container).

### 5.4 Data Sync

Optional feature that synchronizes the data volume with the `ai-triad-data` GitHub repository:

```
Cloud instance ←─ GitHub App ─→ ai-triad-data repo
                   │
                   ├─ Pull: sync latest taxonomy/sources/summaries
                   └─ Push: sync debates, new summaries
```

Requires: GitHub App with installation on the data repo, App ID + private key stored in Key Vault. Enabled via `gitSyncEnabled` deployment parameter.

## 6. Version Management

### 6.1 Release Process

```
1. Update version in 3 files:
   ├─ scripts/AITriad/AITriad.psd1      (source manifest)
   ├─ build/AITriad/AITriad.psd1        (build via Build-Module.ps1 -Clean)
   └─ AGENTS.md                          (documentation reference)

2. Commit: "chore: bump version to 0.x.y"

3. Tag: git tag v0.x.y && git push origin v0.x.y

4. Automated:
   ├─ release.yml builds all artifacts
   └─ container.yml builds and pushes Docker image

5. Manual: trigger deploy-azure.yml (workflow_dispatch)
```

### 6.2 Version Consistency Checks

The CI pipeline validates version consistency:
- `Test-ModuleManifest` ensures `AITriad.psd1` is well-formed
- Release pipeline's `resolve-version` step checks PSGallery for conflicts
- Manual verification: source manifest version must match build manifest version

## 7. Supporting Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `batch-summarize.yml` | Schedule or manual | Re-summarize documents when taxonomy changes (triggered by `TAXONOMY_VERSION` bump) |
| `cluster-conflicts.yml` | Manual | Cluster raw conflicts into deduplicated consolidated set |
| `taxonomy-version-reminder.yml` | Daily schedule | Reminds team to check taxonomy health metrics |
| `base-image.yml` | Manual | Rebuild base runtime image with updated system packages |

## 8. Design Decisions and Trade-offs

### D1: Azure Container Apps Over App Service / AKS

**Chosen:** Azure Container Apps (serverless containers).

**Why:** Scale-to-zero eliminates compute costs during idle periods (the research team doesn't use the cloud instance 24/7). Container Apps provides managed HTTPS, custom domains, and volume mounts without the operational overhead of Kubernetes. App Service doesn't support scale-to-zero for containers.

**Trade-off accepted:** Cold start latency (~10–15 seconds) when the app scales from zero. For a research tool with single-digit concurrent users, this is acceptable. WebSocket connections (used by the terminal) may be interrupted by scale events.

**Alternative considered:** AKS (Azure Kubernetes Service). Rejected as over-provisioned for a single-container, single-user workload. The operational burden of managing a Kubernetes cluster outweighs any orchestration benefits at this scale.

### D2: BYOK Over Shared API Keys

**Chosen:** Users bring their own AI API keys.

**Why:** Shared keys create cost management problems (who pays for API usage?), rate limit conflicts (multiple users sharing a single key), and credential rotation responsibilities. BYOK eliminates all three. Each user is responsible for their own costs, rate limits, and key management.

**Trade-off accepted:** Higher friction for new users — they must obtain and configure API keys before using AI features. `Register-AIBackend` provides guided setup, and the UI has a key configuration flow, but it's still an extra step compared to "just works."

### D3: Bicep Over Terraform

**Chosen:** Azure Bicep for infrastructure-as-code.

**Why:** The deployment is Azure-only. Bicep is Azure-native, requires no additional tooling (ships with Azure CLI), and produces ARM templates directly. Terraform would add a dependency (HashiCorp provider) and state management complexity for a single-cloud deployment.

**Trade-off accepted:** If the platform ever deploys to AWS or GCP, Bicep won't help. At current scale and plans, Azure-only is sufficient.

### D4: Separate Base Image

**Chosen:** Pre-built base image (`ai-triad-base`) with heavy dependencies.

**Why:** Python 3.11, pandoc, ffmpeg, and ghostscript take 5–10 minutes to install. Baking them into a base image that changes rarely (rebuilt via manual `base-image.yml` trigger) means application builds are fast (~3 minutes). The base image changes only when system-level dependencies are added or updated.

**Trade-off accepted:** Base image staleness — if a security patch affects Python or pandoc, the base image must be manually rebuilt. The `base-image.yml` workflow exists for this purpose, but there's no automated trigger on upstream CVEs.

### D5: GitHub Actions Over Azure DevOps

**Chosen:** GitHub Actions for all CI/CD.

**Why:** The repository is hosted on GitHub. Actions provides native integration (PR checks, release creation, GHCR push) without cross-platform credential management. The team's existing workflow is GitHub-centric (issues, PRs, discussions).

**Trade-off accepted:** GitHub Actions' runner fleet is limited (2-core Ubuntu runners for free tier). Build times for multi-platform Electron builds are ~15 minutes. Self-hosted runners could reduce this but add maintenance overhead.

### D6: Azure Files Over Blob Storage / Managed Disk

**Chosen:** Azure Files (SMB share) for the `/data` volume.

**Why:** Azure Files provides a POSIX-compatible filesystem that mounts directly into the container as a standard directory. The application reads and writes taxonomy JSON, debate transcripts, and source documents using normal file I/O — no SDK changes needed. Blob Storage would require rewriting all file access to use the Azure SDK.

**Trade-off accepted:** Azure Files has lower IOPS and throughput than managed disks or Blob Storage. For a research workload that reads/writes individual JSON files (not streaming large datasets), this is a non-issue.

### D7: Optional Authentication

**Chosen:** Three auth modes (disabled, optional, required) configurable at deploy time.

**Why:** Different deployment contexts need different auth postures. A personal instance on a home network doesn't need authentication. A shared instance for a research team needs optional login (some users want attribution, others want anonymity). An institutional deployment might require login for compliance.

**Trade-off accepted:** Anonymous mode means debate transcripts and taxonomy edits have no attribution. The `authorized-users.json` file gates access but doesn't enforce identity for every action.

## 9. Operational Runbook

### Health Monitoring

| Check | How | Frequency |
|---|---|---|
| Container health | `GET /health` (built-in liveness probe) | Every 30 seconds |
| Application logs | Azure Log Analytics → container stdout | Continuous |
| Data volume | Azure Files metrics (IOPS, capacity) | On demand |
| API key validity | First AI call fails with 401 → user-visible error | Per-request |

### Common Operations

| Operation | Command/Action |
|---|---|
| Deploy new version | `gh workflow run deploy-azure.yml` |
| View container logs | Azure Portal → Container Apps → Log stream |
| Rebuild base image | `gh workflow run base-image.yml` |
| Force restart | Azure Portal → Container Apps → Restart |
| Check data volume | Azure Portal → Storage Account → File Shares |

## 10. Risks and Open Questions

| Risk | Impact | Mitigation |
|---|---|---|
| **Base image staleness** | Unpatched system packages | Manual rebuild via `base-image.yml`; consider automated CVE scanning |
| **Cold start latency** | 10–15 second delay after idle | Acceptable for research use; could configure min replicas = 1 if needed |
| **Azure Files performance** | Slow for large batch operations | Not an issue at current scale; Blob Storage migration path exists |
| **Single-region** | Outage = complete downtime | Acceptable for research team; multi-region not justified at current scale |
| **GHCR image pull auth** | PAT expiration breaks deployments | `ghcrPassword` in Key Vault; manual rotation needed |

## 11. Glossary

| Term | Definition |
|---|---|
| **BYOK** | Bring Your Own Key — users supply their own AI API keys |
| **GHCR** | GitHub Container Registry — hosts Docker images |
| **Bicep** | Azure-native infrastructure-as-code language |
| **Container Apps** | Azure serverless container hosting with scale-to-zero |
| **Managed Identity** | Azure-assigned identity for resource-to-resource auth (no credentials in code) |
| **Scale-to-zero** | Container stops when idle; no compute costs during inactivity |
| **Cold start** | Delay when a stopped container starts in response to the first request |
| **Azure Files** | Managed SMB file share, mountable as a container volume |
