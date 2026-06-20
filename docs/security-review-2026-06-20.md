# Security Review Report — AI Triad Research

**Date:** 2026-06-20
**Reviewer:** Technical Lead
**Ticket:** t/703
**Scope:** Application code, dependencies, build/deploy pipelines, Azure infrastructure, runtime configuration

---

## Executive Summary

The project has a strong security foundation — OIDC for Azure auth, non-root containers, blue-green deployments with rollback, Trivy scanning, SBOM generation, CodeQL SAST, and comprehensive logging redaction. However, the review identified **3 Critical**, **10 High**, **~15 Medium**, and **~14 Low** findings. The Critical findings are all in the ephemeral runner infrastructure (not the main application). One High dependency vulnerability (hono CORS/path traversal) was fixed during the review.

---

## Findings by Severity

### CRITICAL (3) — All in Runner Infrastructure

| # | Finding | File | Remediation |
|---|---------|------|-------------|
| C1 | Runner Function App has **Contributor** role on entire resource group — compromise grants full control of production | `deploy/azure/runner/runner.bicep:120-127` | Create custom role limited to ACI operations only |
| C2 | `GITHUB_RUNNER_PAT` and `GITHUB_RUNNER_WEBHOOK_SECRET` stored as **plain-text** app settings | `runner.bicep:111-112` | Store in Key Vault, reference as `@Microsoft.KeyVault(...)` |
| C3 | Runner storage account **connection strings with account keys** in app settings | `runner.bicep:95-96` | Use managed-identity-based storage connection (`AzureWebJobsStorage__accountName`) |

### HIGH (10)

| # | Area | Finding | File | Remediation |
|---|------|---------|------|-------------|
| H1 | Infra | Storage account: **shared key access not disabled** | `main.bicep:252-264` | Add `allowSharedKeyAccess: false` |
| H2 | Infra | Key Vault: **public network access, no network ACLs** | `main.bicep:177` | Add `networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }` |
| H3 | Infra | Storage account: **no network rules** | `main.bicep:252-264` | Add `networkAcls` with deny default |
| H4 | Infra | Key Vault soft delete retention: **only 7 days** (min allowed) | `main.bicep:175` | Increase to 30-90 days |
| H5 | Infra | **Staging app shares production** Key Vault and Storage | `main.bicep:437-514` | Separate KV/storage for staging, or read-only access |
| H6 | Infra | Runner uses **uncontrolled third-party image** `myoung34/github-runner:latest` | `runner.bicep:29` | Pin to digest or self-host runner image |
| H7 | Pipeline | **Actions pinned to floating tags**, not SHA digests | All workflows | Pin third-party actions to commit SHA |
| H8 | Pipeline | **Script injection** via `${{ inputs.image_tag }}` in shell | `deploy-azure.yml:66-67` | Bind to env var, reference as `$IMAGE_TAG` |
| H9 | Pipeline | **Unquoted shell interpolation** of `${{ steps.base_tag.outputs.tag }}` | `ci.yml:167-168` | Quote: `TAG="${{ steps.base_tag.outputs.tag }}"` |
| H10 | Pipeline | **GHCR_PAT** (long-lived PAT) instead of OIDC for registry | `deploy-azure.yml:165,206` | Evaluate managed-identity GHCR auth |

### MEDIUM (15)

| # | Area | Finding | File |
|---|------|---------|------|
| M1 | Code | **Path traversal** in `readPsPrompt` — `promptName` unsanitized | `fileIO.ts:1608-1617` |
| M2 | Code | **Path traversal** in `loadCommunityItem` — `id` not validated | `community.ts:76-82` |
| M3 | Code | **Reflected XSS** in flight recorder viewer — `</script>` not escaped | `server.ts:1008-1019` |
| M4 | Runtime | **Error messages leak** internal file paths to clients | `server.ts:227-229` |
| M5 | Runtime | **Health endpoint exposes** operational details publicly | `server.ts:297-338` |
| M6 | Runtime | **No rate limiting** on community submission endpoint | `server.ts:1171` |
| M7 | Runtime | **No rate limiting** on general API write endpoints | All routes |
| M8 | Runtime | **No WebSocket message size limit** (default 100 MB) | `server.ts:3040` |
| M9 | Pipeline | `ci.yml` has **no top-level `permissions`** block | `ci.yml` |
| M10 | Pipeline | **Trivy scan** has `continue-on-error: true` — image ships regardless | `container.yml:197-198` |
| M11 | Infra | **ADMIN_API_KEY** env var backdoor path (inactive but available) | `server.ts:2814-2831` |
| M12 | Infra | Webhook function auth: **anonymous** + fail-open on missing secret | `github-webhook.js:117,125` |
| M13 | Infra | **Log retention only 30 days** (security investigations need 90+) | `main.bicep:158,227` |
| M14 | Infra | **No container delete retention policy** on blob storage | `main.bicep:266-275` |
| M15 | Pipeline | `DATA_REPO_TOKEN` **scope not validated** (could have write access) | `migrate-user-content.yml:63` |

### LOW (14)

| # | Area | Finding |
|---|------|---------|
| L1 | Code | `AUTH_DISABLED=1` bypass with no production warning |
| L2 | Code | `/api/data/set-root` endpoint not admin-gated |
| L3 | Code | `/api/data/clone` endpoint not admin-gated with arbitrary target path |
| L4 | Code | `harvestAddVerdict` missing `assertSafeId` on `conflictId` |
| L5 | Code | DNS rebinding not fully mitigated in `fetchUrlContent` (SSRF) |
| L6 | Code | Terminal WebSocket not admin-gated |
| L7 | Code | Community submissions: per-user limit but no global cap |
| L8 | Runtime | Missing `Permissions-Policy` header |
| L9 | Runtime | CSP uses `unsafe-inline` for styles |
| L10 | Runtime | File upload endpoint (`/api/upload-document`) has no size limit |
| L11 | Runtime | No brute-force protection on admin API key |
| L12 | Deps | esbuild 0.27.3-0.28.0 arbitrary file read on Windows (dev-only) |
| L13 | Infra | Blob soft delete only 7 days |
| L14 | Infra | No DDoS protection / WAF (acceptable at current tier) |

### FIXED DURING REVIEW (1)

| Finding | Action |
|---------|--------|
| **hono 4.12.23** — CORS credential reflection (CVSS 7.1) + path traversal (CVSS 5.9) | Bumped to 4.12.26 (commit `b70ae15`) |

---

## Dependencies Summary

| Severity | Count | Production Impact |
|----------|-------|-------------------|
| Critical | 0 | — |
| High | 1 | **Fixed** (hono → 4.12.26) |
| Medium | 1 | Dev-only (azurite transitive chain) |
| Low | 1 | Dev-only (esbuild dev server) |

**Production posture: Clean.** All 4 apps pass `npm audit --omit=dev` with 0 vulnerabilities after the hono fix. 17 of 21 Dependabot alerts trace to azurite (devDependency) — consider dismissing or scoping Dependabot to production deps.

---

## Positive Security Controls (Already in Place)

1. **OIDC for Azure auth** — no long-lived Azure credentials in GitHub Secrets
2. **Blue-green deployment** with auto-rollback on health check failure
3. **Non-root container** execution (`USER aitriad`)
4. **Multi-stage Docker build** — no build tools in runtime image
5. **Easy Auth header spoofing prevention** (S9 — only trusts headers when `WEBSITE_AUTH_ENABLED=True`)
6. **AES-256-GCM encryption** for BYOK API keys with random IV, PBKDF2 key derivation
7. **Constant-time comparison** for admin API key and webhook HMAC
8. **Pino log redaction** of apiKey, token, password, secret, authorization, credentials
9. **WebSocket origin validation** against ALLOWED_ORIGINS allowlist
10. **Azure Blob path traversal protection** in `toBlobPath()` (normalize + `..` check)
11. **Anonymous session store** with memory limits, LRU eviction, secure cookies
12. **Community submission sanitization** (strips API key patterns, assigns new UUIDs)
13. **CodeQL SAST** with security-extended queries on push/PR + weekly
14. **Trivy vulnerability scan** + SBOM generation for container images
15. **Concurrency groups** preventing parallel deployments

---

## Priority Remediation Order

### Immediate (this sprint)
1. **C1-C3**: Harden runner infrastructure (scope role, KV secrets, managed identity storage)
2. **H8-H9**: Fix script injection in deploy/CI workflows (quick fix, high impact)
3. **M1-M3**: Add `assertSafeId`/`assertSafeFilename` to 3 endpoints + escape XSS
4. **M9**: Add `permissions: contents: read` to ci.yml

### Short-term (next 2 sprints)
5. **H1-H3**: Disable shared key access, add network ACLs to KV and storage
6. **H5**: Isolate staging from production data
7. **H7**: Pin third-party actions to SHA digests
8. **M4-M5**: Genericize error responses in production, restrict health details
9. **M6-M8**: Add rate limiting middleware and WebSocket payload limits

### Medium-term (next quarter)
10. **H4**: Increase KV soft delete retention (may require new vault)
11. **H6**: Self-host runner image
12. **H10**: Evaluate OIDC/managed-identity GHCR auth
13. **M10-M15**: Pipeline hardening (Trivy blocking, log retention, etc.)
14. **L1-L14**: Low-severity items as capacity allows
