# Threat Model

**Status:** Active
**Last reviewed:** 2026-06-22
**Owner:** Technical Lead

## Overview

AI Triad Research is a multi-user web application (also available as an Electron desktop app) for AI policy/safety research. It handles user-provided API keys, serves authenticated and anonymous users, and integrates with GitHub, Azure, and multiple AI provider APIs.

This document maps trust boundaries, data flows, attack surfaces, and mitigations. New features should be evaluated against these surfaces before implementation.

---

## 1. Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    User Browser (Untrusted)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ BYOK API Keys│  │ User Content │  │ Session Cookies   │  │
│  │ (sessionStore)│  │ (chats/debates)│ │ (anon_session_id) │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────────┘  │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │ HTTPS            │ HTTPS            │ HTTPS
══════════╪══════════════════╪══════════════════╪══════════════════
          │         Azure Easy Auth (reverse proxy)
══════════╪══════════════════╪══════════════════╪══════════════════
┌─────────┼──────────────────┼──────────────────┼──────────────┐
│         ▼                  ▼                  ▼              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │          Azure Container App (Trusted Server)        │    │
│  │                                                      │    │
│  │  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │    │
│  │  │ Key Store  │  │ Rate Limiter│  │ User Context  │  │    │
│  │  │ (AES-256)  │  │ (per-user)  │  │ (AsyncLocal)  │  │    │
│  │  └─────┬──────┘  └────────────┘  └───────────────┘  │    │
│  └────────┼─────────────────────────────────────────────┘    │
│           │                                                   │
│  ┌────────┼────────────────────────────────────────────────┐ │
│  │        ▼           External APIs (Semi-trusted)          │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐             │ │
│  │  │ GitHub   │  │ AI APIs  │  │ Azure     │             │ │
│  │  │ API      │  │ (Gemini, │  │ Key Vault │             │ │
│  │  │          │  │  Claude…) │  │ + Blob    │             │ │
│  │  └──────────┘  └──────────┘  └───────────┘             │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Boundary Descriptions

| Boundary | Trust Level | Authentication |
|----------|-------------|----------------|
| User browser → Server | Untrusted | Azure Easy Auth (GitHub/Google OAuth) or anonymous |
| Server → GitHub API | Trusted (server-side) | GitHub App installation token (RS256 JWT) or PAT |
| Server → AI providers | Trusted (server-side) | Platform keys (env var) or proxied BYOK keys |
| Server → Azure Key Vault | Trusted (managed identity) | DefaultAzureCredential (managed identity in prod) |
| Server → Azure Blob Storage | Trusted (managed identity) | DefaultAzureCredential |
| Electron app (local) | Fully trusted | No network auth; local filesystem access |

---

## 2. Data Flows

### User API Keys (BYOK)

```
User enters key in UI → sessionStorage (browser-only, never sent to server for BYOK tier)
                       → Platform tier: server-side, encrypted AES-256-GCM, stored in Key Vault
                       → Free tier: server-side env var (FREE_TIER_GEMINI_KEY)
```

- **Encryption:** AES-256-GCM with 16-byte random IV, PBKDF2-SHA256 (100K iterations)
- **Key material:** 64-byte random file at `.aitriad-key-material` (mode 0600) or Azure Key Vault secret
- **BYOK keys never leave the browser** — proxied requests use the key in-transit only

### Taxonomy Data

```
GitHub repo (ai-triad-data) → Server in-memory tree (cached) → Client (read-only for anon, edit via session branches for auth users)
```

- Shared data (taxonomy, conflicts, calibration) is public — no per-user isolation needed
- Edits go through session branches (`api-session/{userId}`) — isolated per user

### User Content (Chats, Debates)

```
Auth users: Browser → Server → Azure Blob Storage (users/{storageUserId}/chats|debates/)
Anonymous:  Browser → Server → Filesystem (ephemeral, 4-hour TTL, LRU eviction)
```

- `storageUserId` derived deterministically from principal name (human-readable, e.g., `jpsnover`)
- Anonymous sessions identified by `anon_session_id` cookie (HttpOnly, SameSite=Lax, Secure in prod)

### Community Submissions

```
Auth user submits → community/_submissions/ (pending queue) → Admin approves → community/chats|debates/ (public)
```

- Sanitized on approval: debug data stripped, attribution added
- Anonymous users cannot submit (403)
- Rate limited: 5 submissions/hour per user

---

## 3. Attack Surfaces

### AS-1: API Key Theft

| Vector | Risk | Likelihood |
|--------|------|------------|
| XSS extracting BYOK keys from sessionStorage | High | Low (CSP blocks inline scripts) |
| Flight recorder logging API keys | High | Mitigated (truncation fix deployed June 2026; ADR for redaction layer pending in t/808) |
| Server error messages leaking key values | High | Low (ActionableError standard strips secrets) |
| Key material file compromise on Azure Files | High | Low (file mode 0600, managed identity access only) |

**Existing mitigations:** CSP (`script-src 'self'`), AES-256-GCM encryption at rest, BYOK keys stay in browser sessionStorage, flight recorder key truncation.

**Gaps:** No key material rotation mechanism. No redaction safety net in flight recorder serializer (t/808). Key Vault secret names are hashed but derivable.

### AS-2: Path Traversal

| Vector | Risk | Likelihood |
|--------|------|------------|
| User-provided IDs in file paths (debates, chats, community) | Critical | Low |
| POV parameter injection | Medium | Low |

**Existing mitigations:** `assertSafeId()` whitelist (`^[a-zA-Z0-9_-]+$`) at 24+ call sites. `safeSegment()` for anonymous sessions (max 200 chars, rejects `.` and `..`).

**Gaps:** Path validation is caller-responsibility, not enforced at the routing layer. Not all POV parameters are validated via `assertSafePov()`.

### AS-3: Authentication Bypass

| Vector | Risk | Likelihood |
|--------|------|------------|
| Easy Auth header spoofing (X-MS-CLIENT-PRINCIPAL-NAME) | Critical | Very Low (requires bypassing Azure Front Door) |
| Anonymous session ID prediction | Low | Very Low (UUID4) |
| Dev mode auth disabled in production | Critical | Very Low (gated on AZURE_AUTH_ENABLED env var) |

**Existing mitigations:** Authentication gated on `AZURE_AUTH_ENABLED`. Anonymous mode has limited permissions (no taxonomy edits, no community submissions). Authorized users allowlist.

**Gaps:** No session tokens or JWTs — pure reverse-proxy auth. If Easy Auth is misconfigured, the server trusts arbitrary headers.

### AS-4: CSRF on State-Changing Endpoints

| Vector | Risk | Likelihood |
|--------|------|------------|
| Cross-origin POST/PUT/DELETE to /api/* | Medium | Low |

**Existing mitigations:** CORS origin allowlist in production. SameSite=Lax cookies. Content-Type enforcement (JSON body required for POST/PUT).

**Gaps:** No explicit CSRF tokens. Relies on CORS + SameSite + Content-Type as defense-in-depth.

### AS-5: Rate Limit Bypass

| Vector | Risk | Likelihood |
|--------|------|------------|
| Distributed requests across container replicas | Medium | Medium (consumption tier can scale) |
| Anonymous session cycling (new cookie per request) | Low | Low (rate limiter also keys on IP) |

**Existing mitigations:** Per-user RPM (sliding window), per-IP write limits (100/min), daily token buckets, per-user community submission limits (5/hour).

**Gaps:** Rate limit state is per-instance (in-memory Maps). No distributed rate limiting across replicas. State resets on container restart.

### AS-6: Prompt Injection

| Vector | Risk | Likelihood |
|--------|------|------------|
| Malicious debate/chat input influencing AI model behavior | Medium | Medium |
| AI output containing instructions that agents execute | Medium | Low |

**Existing mitigations:** Debate engine uses structured system prompts with character personas. Chat has system prompt framing. AI responses are rendered as markdown (not executed).

**Gaps:** No input sanitization for prompt injection patterns. No output validation for instruction-like content. This is an accepted risk for a research platform — the debate engine is designed to explore adversarial positions.

### AS-7: Data Isolation Breach

| Vector | Risk | Likelihood |
|--------|------|------------|
| User A accessing User B's chats/debates via crafted API call | Critical | Low |
| Anonymous session data visible to filesystem admin | Low | Accepted |

**Existing mitigations:** Per-user path routing in `fileIO.ts` (pivot on `storageUserId`). `assertSafeId()` prevents path traversal between user directories. Session branches isolate taxonomy edits.

**Gaps:** Data isolation is path-based, not ACL-based. A bug in `getStorageUserId()` or `fileIO.ts` routing could expose cross-user data. Anonymous session files are unencrypted on shared filesystem.

---

## 4. Mitigations Summary

### What We Have

| Control | Implementation | Location |
|---------|---------------|----------|
| Authentication | Azure Easy Auth (OAuth) | server.ts:3205-3335 |
| Authorization | Authorized users allowlist, admin flag | server.ts, authorized-users.json |
| Encryption at rest | AES-256-GCM (PBKDF2-SHA256, 100K iter) | keyStore.ts |
| Path safety | `assertSafeId()` whitelist, `safeSegment()` | fileIO.ts:57-65, anonymousSessionStore.ts:66-74 |
| CSP | `script-src 'self'`, `frame-ancestors 'none'` | server.ts:3192 |
| CORS | Origin allowlist in production | server.ts:3181-3200 |
| Security headers | HSTS, X-Frame-Options: DENY, nosniff, Referrer-Policy, Permissions-Policy | server.ts |
| Rate limiting | Per-user RPM, per-IP writes, daily token budgets | rateLimiter.ts |
| Cookie security | HttpOnly, SameSite=Lax, Secure (prod) | server.ts:3240-3260 |
| Dependency scanning | Dependabot, CodeQL, npm audit | .github/workflows/, dependency-policy.md |
| Secret scanning | GitHub Secret Scanning (default) | GitHub platform |
| Diagnostic safety | Flight recorder key truncation, ActionableError standard | flightRecorderInit.ts, error-handling.md |

### Known Gaps (Prioritized)

| Gap | Severity | Ticket | Notes |
|-----|----------|--------|-------|
| ~~Flight recorder has no redaction safety net~~ | ~~Medium~~ | t/808 | Fixed (7651fe41) — serializer-level redaction layer: API keys, tokens, emails scrubbed at serialization time |
| ~~Email addresses in server request IDs~~ | ~~Medium~~ | t/803 | Fixed (f7687bd8) — UUID-based request IDs, storageUserId in log context |
| No key material rotation | Medium | — | `.aitriad-key-material` has no scheduled rotation |
| Path validation is caller-responsibility | Medium | — | Should be enforced at middleware/routing layer |
| Per-instance rate limiting (not distributed) | Low | — | Acceptable at current scale (single replica) |
| No CSRF tokens | Low | — | CORS + SameSite + Content-Type provides defense-in-depth |
| `style-src 'unsafe-inline'` in CSP | Low | — | Required by React inline styles; XSS surface minimal with `script-src 'self'` |
| Prompt injection | Accepted | — | Research platform — adversarial positions are by design |

---

## Review Triggers

Re-evaluate this threat model when:
- New authentication method added
- New external API integration
- New data storage backend
- Multi-replica deployment
- Public-facing API surface changes
- New user roles or permission levels
