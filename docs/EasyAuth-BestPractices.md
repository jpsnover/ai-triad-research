# Azure Easy Auth — Best Practices

**Last updated:** 2026-07-02
**Author:** Technical Lead (AI Triad Research)
**Status:** Living document — distilled from 7 production incidents and ~6 weeks of operating Easy Auth on Azure Container Apps (taxonomy-editor). Every rule below was paid for.

This document is written for the next project that adopts Easy Auth. It covers architecture, configuration, identity handling, cookie lifecycle, logging, testing, and an incident runbook. File references point at the AI Triad Research repo (`taxonomy-editor/src/server/...`) as the reference implementation.

---

## 1. Mental Model

Easy Auth is a **reverse-proxy authentication sidecar**. Azure terminates OAuth (GitHub/Google/AAD), manages session cookies, and injects identity headers (`X-MS-CLIENT-PRINCIPAL-NAME`, `X-MS-CLIENT-PRINCIPAL-IDP`) into requests before they reach your container. You never implement OAuth yourself.

Consequences that drive everything else:

1. **Your app never sees credentials** — only headers. Your job is to *trust the headers correctly* (§4) and *map them to identities correctly* (§5).
2. **Azure owns the session cookie** (`AppServiceAuthSession`), and it does not behave the way you expect (§6). Three of our seven production incidents were cookie-lifecycle bugs.
3. **The proxy's own auth mode should be permissive; your app enforces policy.** Set `unauthenticatedClientAction: 'AllowAnonymous'` and gate in application code. If you let Azure auto-redirect (`Redirect` mode), you lose: custom login pages, anonymous/free tiers, API clients getting JSON (they get HTML redirects instead), health probes, and Electron/local parity.

## 2. Decide the Access Model First

Before writing any code, decide your tiers and encode them as *deployment-time* configuration (not runtime toggles):

| Mode | Env var | Behavior |
|------|---------|----------|
| Disabled | `AUTH_DISABLED=1` | Everything anonymous, full access. Dev/local only — **hard-block it in production in code** (see below) |
| Optional | `AUTH_OPTIONAL=1` | Login page offers providers *plus* "continue anonymously." Anonymous = read-only + free tier; signed-in = full |
| Required | (neither) | Must sign in AND be on an allowlist |

**Hard-block dangerous modes in code, not just convention.** Our server refuses `AUTH_DISABLED=1` when `NODE_ENV=production` (`isAuthDisabledAllowed()`, `server.ts:197-208`). A config mistake should fail closed, loudly.

**Design the anonymous tier as a real persona, not an afterthought.** Five of the seven bugs in our worst diagnostic day (2026-06-26: t/1060–t/1064) were "the anonymous path was never tested end-to-end." If you support anonymous users, they need: an explicit session bootstrap endpoint (`POST /.auth/anonymous` setting an `anon_session_id` cookie), an explicit route allowlist (§7), and an E2E smoke test (§9).

## 3. Configuration: Everything in IaC, Nothing Ad-Hoc

### 3.1 The Bicep shape

Configure Easy Auth as a child resource of the container app:

```bicep
resource authConfig 'Microsoft.App/containerApps/authConfigs@2024-10-02-preview' = {
  parent: containerApp
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: { unauthenticatedClientAction: 'AllowAnonymous' }  // app enforces policy
    identityProviders: {
      google:  { enabled: googleEnabled, registration: { clientId: googleClientId, clientSecretSettingName: 'google-client-secret' } }
      gitHub:  { enabled: githubEnabled, registration: { clientId: githubClientId, clientSecretSettingName: 'github-client-secret' } }
      azureActiveDirectory: { enabled: aadEnabled, registration: { clientId: aadClientId, openIdIssuer: aadIssuer } }
    }
    login: {
      tokenStore: { enabled: true }
      allowedExternalRedirectUrls: ['https://${containerApp.properties.configuration.ingress.fqdn}']
      preserveUrlFragmentsForLogins: false
    }
  }
}
```

- OAuth client secrets: `@secure()` Bicep params sourced from **GitHub Actions secrets** — never in the repo, never in plaintext parameters (they'd be exposed in deployment history).
- Allowlists (`ADMIN_USERS`, `ALLOWED_USERS`): GitHub Actions **variables** (not secrets — they're names, not credentials) wired through the workflow into Bicep params. This keeps personal-email-derived IDs out of a public repo while surviving redeploys.

### 3.2 The env-var drift trap (this WILL bite you)

Container App env vars declared in Bicep are a **declarative list that replaces everything** on each deploy. Any env var added out-of-band with `az containerapp update --set-env-vars` is **silently wiped by the next Bicep deploy**. We lost `ADMIN_USERS` this way — admin access vanished after an unrelated deploy, with no error anywhere.

**Rule:** every persistent env var lives in the Bicep template. CLI env changes are temporary stopgaps only, and must be followed by a Bicep PR the same day.

### 3.3 Multiple-revision mode trap

If the app runs in Multiple-revision mode (needed for blue-green), a config update creates a new revision at **0% traffic**. Your auth change is "deployed" but not live until traffic shifts. Symptoms: "I changed ADMIN_USERS and nothing happened." Also note: ACA **rejects sticky sessions in Multiple-revision mode** — don't design auth/session flows that assume replica affinity.

### 3.4 Redirect URIs

Register the exact callback URLs in each OAuth provider's app registration: `https://<fqdn>/.auth/login/github/callback` (same for `google`, `aad`). The #1 cause of "login worked yesterday, broken today" during infra changes is the FQDN changing (new environment, new app name) while provider registrations still point at the old one. Put the callback URLs in your deploy runbook's post-change checklist.

## 4. Header Trust: Gate on Environment, Always

Easy Auth headers are **just HTTP headers**. Anyone who can reach your container directly (bypassing Azure ingress) can forge them. Two rules:

1. **Only parse identity headers when an env var confirms Easy Auth is actually in front of you:**

```typescript
const AZURE_AUTH_ENABLED = process.env.WEBSITE_AUTH_ENABLED === 'True'
  || process.env.WEBSITE_AUTH_ENABLED === 'true';

const principalName = AZURE_AUTH_ENABLED
  ? (req.headers['x-ms-client-principal-name'] as string) || ''
  : '';
```

Without this guard, running the same image locally (or exposing the container directly) turns header injection into instant impersonation. Set `WEBSITE_AUTH_ENABLED=true` in the Bicep env block — hardcoded, not parameterized, so nobody can accidentally disable the guard in one environment.

2. **Never expose the container except through the authenticated ingress.** Internal-only ingress for any admin/diagnostic plane; no direct public IP.

## 5. Identity Normalization: The Decision You Can Never Change

You will need a stable per-user identifier for storage paths, Key Vault secret names, allowlists, and audit logs. Derive it **once**, deterministically, and treat the algorithm as immutable after first deploy (changing it orphans every user's data).

Our reference implementation (`userContext.ts:91-106`):

```typescript
function deriveStorageUserId(principalName: string, idp: string): string {
  if (!principalName || principalName === '_local') return '_local';
  const raw = idp === 'github'
    ? principalName.toLowerCase()                   // GitHub: username
    : principalName.toLowerCase()
        .replace(/@/g, '-at-').replace(/\./g, '-'); // email IdPs: jsnover13@gmail.com → jsnover13-at-gmail-com
  // Defense-in-depth: strip path separators, traversal sequences, null bytes
  return raw.replace(/[/\\\0]/g, '').replace(/\.\.+/g, '') || '_local';
}
```

Hard-won rules:

- **Human-readable beats hashed** if an operator will ever inspect the data store directly. Hashes are safer against enumeration; pick deliberately.
- **Sanitize for your storage layer** — the ID becomes directory names and secret names. Strip `/`, `\`, `..`, null bytes at derivation time, not at use sites.
- **Different IdPs produce different shapes.** A GitHub user is `jpsnover`; the same human via Google is `jsnover13-at-gmail-com`. These are *different identities*. Every allowlist entry must use the **derived** form for the provider the person actually signs in with. We lost admin access silently because `ADMIN_USERS` held an email-derived ID while the user signed in via GitHub — the mismatch produces a plain 403 with no clue.
- **Guard cross-provider collisions.** If two providers can present the same normalized ID (e.g., same email via Google and via AAD), the second provider silently inherits the first user's data. Persist a first-writer-wins `identity → provider` binding and reject sign-ins from a different provider with an explicit `provider_mismatch` error (`providerBinding.ts`).

## 6. Cookie Lifecycle: Three Incidents, Three Layers of Defense

Azure's `AppServiceAuthSession` cookie caused three separate production incidents. The failure modes compound, so you need all three fixes.

### 6.1 Logout must clear ALL cookie chunks (t/897)

The session cookie can be **chunked** (`AppServiceAuthSession`, `AppServiceAuthSession1`, `AppServiceAuthSession2`…). Redirecting to `/.auth/logout` alone did not clear the chunks — the next user of the browser inherited the session. Implement your own logout endpoint that expires every `AppServiceAuthSession*` cookie (match case-insensitively) and *then* redirects to `/.auth/logout?post_logout_redirect_uri=/`.

### 6.2 Serve the login page = clear stale cookies (t/940)

A stale/expired session cookie with no valid principal causes an **OAuth loop**: user clicks "Sign In" → Azure sees the stale cookie → bounces back unauthenticated → login page again. Fix: whenever your server renders the login page, check for `AppServiceAuthSession*` cookies and emit `Set-Cookie` expirations for them in the same response. Also give the user a manual "clear session" link as a fallback.

### 6.3 Fresh-login endpoint to defeat cached SPAs (t/1032)

If you ship a service worker (PWA/offline), the cached SPA can serve the sign-in UI **without hitting your server**, so fix 6.2 never runs and the loop returns. Fix: sign-in buttons must link to a server endpoint (`/api/auth/fresh-login/:provider`) that (a) expires all session cookies and (b) redirects to `/.auth/login/<provider>` — with the provider validated against a hard allowlist (`github|google|aad`) so it can't become an open redirect. Never link the SPA directly to `/.auth/login/...`.

**General lesson:** with Easy Auth + SPA + service worker, treat "the user cannot sign in" as a cookie/cache interaction until proven otherwise.

## 7. Route Gating: Test for Completeness, Not Just Correctness

Application-level gates fail in two directions, and code review only catches one:

- **Too loose** (security bug): an endpoint missing from the auth check. Reviews catch this.
- **Too tight** (availability bug): an endpoint missing from the *allowlist* that a legitimate flow needs. Reviews miss this because each endpoint looks correctly gated in isolation.

Incidents of the second kind:
- **t/1062:** the anonymous free-tier allowlist covered `/api/ai/generate` but the debate flow also calls `/api/embeddings/compute` — anonymous debates 403'd in production. The gate was tested for "blocks unauthenticated" but never for "allows everything the flow needs."
- **t/1064:** a diagnostic download endpoint got `requireAdmin` reflexively; Electron/local users (who are never "admin") could no longer download **their own** dumps.

Rules:
1. Keep the anonymous route allowlist **in one function** (`isAnonAllowedRoute()`), not scattered inline checks.
2. When adding any endpoint, ask: *which personas call this, in which flows?* Adding an endpoint that an anonymous-capable flow uses without extending the allowlist should fail a test (§9).
3. Before applying an admin gate, ask: **"Do local/Electron/single-operator users need this?"** Diagnostic endpoints usually want "your own data always; other users' data only if admin."
4. Order your middleware explicitly and document it: public paths (health, static, logout) → mode checks (disabled/optional/required) → persona resolution → route allowlist → handler. Ours is at `server.ts:4416-4469`.

## 8. Logging & Observability

Auth failures are silent by nature (a 403 tells the user nothing and often tells you nothing). Log deliberately:

### What to log

| Event | Fields | Why |
|-------|--------|-----|
| Auth decision on each request (sampled or on-deny) | derived userId, idp, route, decision, **reason code** | The reason code is everything: `not_in_allowlist`, `provider_mismatch`, `anon_route_denied`, `admin_required`, `stale_cookie_cleared` are five different runbook pages |
| Login page served | had stale cookie? cleared? | Detects §6 loops in aggregate |
| Logout | userId, cookie chunk count cleared | Detects chunking regressions |
| Principal derivation anomalies | raw shape (NOT raw value), fallback used | Detects IdP format changes |
| Admin gate rejections | derived userId, endpoint | Detects §5 allowlist-form mismatches: a real user being rejected from admin repeatedly = check the derivation |
| Test-persona attempts in production | always | Should be impossible (§9); if it fires, someone is probing |

### How to log

- **Log derived IDs, never raw emails,** in anything that leaves the container (Log Analytics, dumps). The derived ID is pseudonymous and consistent with your storage layer, so you can correlate without spraying PII.
- **Structured events, one stream.** We use a flight-recorder pattern: every server catch block records a structured event before throwing/returning (enforced by lint rule). Auth events go to the same stream, so "user can't log in at 14:02" correlates with the exact gate decision.
- **Client + server paired recorders.** Auth bugs frequently look client-side ("button does nothing") with a server-side cause. Emit a client event stream too, and make your diagnostic dump merge both. When triaging, *always* check for the server-side pair.
- **Record build identity in the log context** (`build_date`, version) — the first triage question is "does this build contain the fix?", and git SHA lies when operators run uncommitted local builds.
- Container stdout/stderr flows to Log Analytics automatically on ACA — but that's unstructured backup, not your primary signal. Alert on rates of specific reason codes (spike in `not_in_allowlist` after a deploy = derivation or env-var regression).

## 9. Testing: The Persona Matrix

### 9.1 Production-inert test personas (t/1125)

You cannot drive real OAuth from CI. Add a server-side override, engineered to be inert in production:

- Enabled **only** when `ENABLE_TEST_PERSONA_HEADER=1` (never set in prod) AND a shared secret matches (constant-time comparison).
- Header `X-Test-Persona: anonymous|authenticated|admin` + `X-Test-Persona-Secret: <secret>`.
- The admin persona resolves to an *existing* `ADMIN_USERS` entry — the header cannot inject an arbitrary admin identity.
- The entire code path is a no-op if the env var is unset; a set-but-wrong secret is logged (§8).

### 9.2 The endpoint × persona matrix

Maintain a table of critical endpoints × three personas with **expected** access (allow/deny), and a test that asserts actual == expected in both directions. Ours (`Test-PersonaEndpoints`, 7 endpoints × 3 personas) catches both too-loose and too-tight regressions. When you add an endpoint, adding its row is part of Definition of Done.

### 9.3 End-to-end persona flows

The matrix checks endpoints in isolation; flows catch composition bugs (t/1062 again). Script your primary user journey per persona — ours (`Test-AnonymousDebateFlow`) does: establish anonymous session → AI generate → embeddings → save → dump → download → query, reusing the session cookie throughout. Run it in the deploy pipeline **before traffic shift**, with auto-rollback on failure.

### 9.4 API tests need a session first

In optional-auth mode, an unauthenticated API request gets the **login page HTML**, not JSON — which breaks naive test suites with confusing parse errors. Establish the anonymous session first and carry a cookie jar:

```bash
COOKIE_JAR=$(mktemp)
curl -s -o /dev/null -c "$COOKIE_JAR" -L "${BASE_URL}/.auth/anonymous"
curl -s -b "$COOKIE_JAR" "${BASE_URL}/api/whatever"
```

## 10. Local Development Parity

- Locally there is no Easy Auth sidecar, so there are no identity headers. The §4 guard means local requests resolve to the anonymous/`_local` principal — by design, the same code path, not a mock.
- Use `AUTH_DISABLED=1` for single-operator local dev; remember it's production-blocked in code.
- Electron/desktop builds are permanent `_local` — every auth decision must have a sane answer for them (§7 rule 3).
- To test real OAuth end-to-end you need a deployed environment; keep a staging app with the same Bicep and separate OAuth registrations. Give staging **read-only** access to any shared secret store (our staging MSI gets `Key Vault Secrets User` vs prod's `Secrets Officer`) so a staging bug can't corrupt prod user secrets.

## 11. Incident Runbook

| Symptom | First suspects | Check |
|---------|----------------|-------|
| User can't sign in; login page loops | Stale cookie (§6.2); cached SPA (§6.3) | Do sign-in buttons hit `fresh-login`? Ask user to clear cookies once; if that fixes it, your auto-clear is broken |
| Sign-in works, user lacks expected access | Allowlist has wrong ID form (§5) | Compute `deriveStorageUserId` for their actual IdP; diff against `ADMIN_USERS`/allowlist byte-for-byte |
| Admin access vanished after a deploy | Env-var drift (§3.2); revision at 0% traffic (§3.3) | Was the var CLI-set? Is the new revision receiving traffic? |
| Second provider sign-in "sees someone else's data" or 403 `provider_mismatch` | Cross-provider collision (§5) | Inspect the provider binding record for that derived ID |
| Anonymous flow 403s on one step | Allowlist completeness (§7) | Which endpoint? Is it in `isAnonAllowedRoute`? Run the E2E persona flow |
| Electron/local user blocked from an endpoint | Reflexive admin gate (§7 rule 3) | Does the endpoint really need admin, or "own data" semantics? |
| Test suite gets HTML instead of JSON | No session established (§9.4) | Cookie jar + `/.auth/anonymous` first |
| Users logged in as each other on shared machines | Logout chunk clearing (§6.1) | Verify logout expires ALL `AppServiceAuthSession*` variants |
| Login broken after infra rename | OAuth callback URLs (§3.4) | Provider registrations still point at old FQDN? |

## 12. Bring-Up Checklist for a New Project

1. ☐ Access model chosen (disabled/optional/required) and dangerous modes production-blocked in code
2. ☐ `authConfigs` in Bicep with `AllowAnonymous`; OAuth secrets via `@secure()` + CI secrets; allowlists via CI variables
3. ☐ `WEBSITE_AUTH_ENABLED` guard on all identity-header parsing
4. ☐ `deriveStorageUserId()` written, sanitized, unit-tested, and **frozen** — documented as a one-way door (write the ADR)
5. ☐ Provider-binding collision guard
6. ☐ Logout endpoint clearing all cookie chunks; login page auto-clearing stale cookies; fresh-login endpoint with provider allowlist (all three — §6)
7. ☐ Single `isAnonAllowedRoute()`-style function; middleware order documented
8. ☐ Auth events logged with reason codes; derived IDs only; client+server streams; build identity in context
9. ☐ Test-persona override (production-inert) + endpoint×persona matrix + per-persona E2E flow in the deploy gate
10. ☐ Staging environment with separate OAuth registrations and read-only secret access
11. ☐ Runbook (§11) linked from the ops docs; callback-URL check in the infra-change checklist

---

*Reference implementation: `taxonomy-editor/src/server/` (server.ts auth middleware ~4100-4500, security/userContext.ts, security/accessControl.ts, security/providerBinding.ts), `deploy/azure/main.bicep` (authConfigs ~648-699), `scripts/AITriad/Public/Test-PersonaEndpoints.ps1`, `Test-AnonymousDebateFlow.ps1`. Incident tickets: t/897, t/940, t/1032, t/1062, t/1064, t/1125.*
