# Production Failure Review Checklist

**Purpose:** Before landing a change, ask "which failure class could this introduce?" — catching structural gaps before they reach production. Five classes derived from a systemic sweep of all Azure production incidents (e/84, 2026-08-09).

Complements the post-incident reflection flywheel (t/2379). This is the pre-incident gate.

---

## Class 1 — Cross-Scope Semantic Contract Violations

**Pattern:** Two components are individually correct but broken together — a producer and consumer agree on an interface informally, then diverge (scope mismatch, type mismatch, undefined propagation).

**Review question:** Does this change create or modify a producer-consumer seam? Is there a contract test proving "what the producer emits, the consumer can consume"?

**Specific variant — list/load contract:** If a component lists resources (returns IDs, URLs, session keys), verify the load path accepts every item from the list. A scope filter on either side that doesn't appear on the other is a silent 404 waiting in production.

**Examples from the incident archive:**
- `listDebateSessionsMeta` surfaced community debates; `loadDebateSession` scoped to `_local` — correct individually, 404 in prod (t/2368)
- `getCorsOrigin()` returned `ALLOWED_ORIGINS[0]`; upstream produced `[]` under `NODE_ENV=production` → `undefined` → Node.js `setHeader()` crash on every request (t/723)
- AUTH_OPTIONAL server returned 200 HTML; API clients expected JSON — format contract missing

---

## Class 2 — User/Identity Path Gaps

**Pattern:** Code is tested with one user type (typically authenticated); other types (anonymous, admin, unauthenticated API client) hit different branches, missing data, or different response formats in production.

**Review question:** Have I tested this flow for every user type that will hit it in production? Minimum matrix: `{anonymous, authenticated, admin}` × key flows.

**Examples from the incident archive:**
- Community 404: anonymous user path was never exercised in tests; authenticated path passed (t/2368)
- AUTH_OPTIONAL: acceptance tests ran without establishing an anonymous session; the anonymous branch was untested

---

## Class 3 — Runtime/Environment Divergence

**Pattern:** Code works in CI/dev environment, breaks in the production environment — different `NODE_ENV`, different env var values, different Node.js version, floating base image.

**Review question:**
1. Does this code's behavior depend on `NODE_ENV`, env vars, or runtime configuration that differs between CI and prod?
2. Is the Docker base image pinned to a digest, or does `FROM node:22` pick up the next patch on rebuild?

**Examples from the incident archive:**
- CORS crash (t/723): `NODE_ENV=production` changed config initialization; dev worked, prod dead
- Base-image bump (t/2047): floating `FROM node:22` picked up 22.23.1→22.23.2 on rebuild; CI tested old image, prod crashed on the new one (`/healthz` 503 → crash loop)

---

## Class 4 — Infrastructure Configuration Drift

**Pattern:** Correct configuration is applied once, then silently overwritten by a subsequent deployment or automation. The app behaves correctly immediately after the targeted deploy and incorrectly after the next routine one.

**Review question:**
1. Is this configuration change persisted in Bicep (or the authoritative IaC source)? Or applied ad-hoc via CLI?
2. Could a routine redeployment wipe this setting?
3. Is ACA ingress traffic pinned in `main.bicep`, or will the next Bicep apply auto-promote the latest revision to 100%?

**Examples from the incident archive:**
- ACA env var drift (t/2049+t/2050): `az containerapp update --set-env-vars` applied correctly; next Bicep deploy wiped the change
- Traffic auto-promotion: Bicep applied without `ingress.traffic` pinned → latest revision promoted to 100% unexpectedly

---

## Class 5 — CI Gate Blind Spots

**Pattern:** The CI gate verifies a subset of what can break. New surfaces accumulate outside the gate's coverage. A change lands green; the gap is discovered in production.

**Review question:**
1. Does CI catch the failure mode this change could introduce? Is there a gate for it?
2. Does this change introduce a new surface — a new module, a new config path, a new user type, a new environment — outside the current gate's scope?
3. After this change, is the gate coverage still complete?

**Examples from the incident archive:**
- Renderer type errors invisible to `tsconfig.server.json` — server typecheck passed, renderer errors went to prod
- Shell-quoting junk-spray (t/2222): the `shell-code-mangling-guard` hook condition was too narrow; pattern recurred until the condition was widened (2026-08-09)

---

## Quick Reference

| Class | Core question |
|---|---|
| 1 — Cross-scope contract | What I produce, can the consumer use? What I list, can the loader load? |
| 2 — User/identity paths | Tested as anon, authenticated, AND admin? |
| 3 — Runtime/environment | Behavior differs between CI env and prod env? Base image pinned? |
| 4 — Config drift | Config persisted in IaC? Survives next Bicep apply? Traffic pinned? |
| 5 — Gate blind spots | CI catches this failure mode? New surface outside gate coverage? |

**Source:** e/84 (Diagnostics systemic analysis, 2026-08-09) — see also `docs/LessonsLearned.md`
