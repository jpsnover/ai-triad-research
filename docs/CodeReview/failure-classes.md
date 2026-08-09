# Failure-Class Taxonomy — Prospective Review Checklist

**Last updated:** 2026-08-09
**Owner:** Diagnostics (source analysis) / Tech Lead (review checklist)
**Source:** e/84 systemic quality analysis of the 2026-08-09 Azure production bug sweep.

Purpose: turn post-incident hindsight into foresight. Before landing a change — especially at a producer/consumer seam, on a deploy path, or touching config — ask **"which of these classes could this change introduce?"** and require the corresponding test or gate. Each incident maps to one of five structural classes.

## The Core Gap

CI proves individual components work **in isolation, in the CI environment, with authenticated users.** Production requires **integrated** components, for **all user types**, in the **prod environment**. Every gap between those two sentences is one of the classes below.

## Class 1 — Cross-scope semantic contract violations

Two components each correct in isolation, broken at the seam. The invariant *"what I can list, I can load"* holds for neither producer nor consumer alone.

- **Examples:** community debate 404 (`listDebateSessionsMeta` surfaces it, `loadDebateSession` can't resolve it for the user — t/2368); CORS crash (`getCorsOrigin()` returns `[]` → `undefined` → Node 22 `setHeader()` throws — t/723); AUTH_OPTIONAL serving HTML to JSON-expecting API clients.
- **Prevention:** contract-invariant tests at every producer→consumer seam.

## Class 2 — User/identity path gaps

A flow tested for only one identity type.

- **Examples:** community 404 — the anonymous user path was never tested; AUTH_OPTIONAL acceptance tests ran without establishing an anonymous session.
- **Prevention:** an explicit user-type matrix `{anon, authenticated, admin}` × key flows.

## Class 3 — Runtime / environment divergence

Works in dev/CI, fails in prod because the runtime environment differs.

- **Examples:** `NODE_ENV=production` changes config init and produces the CORS crash; a floating `FROM node:22` picked up a patch bump (22.23.1→22.23.2) on rebuild — CI tested the old image, prod got the new one (t/2047).
- **Prevention:** a prod-config CI variant; pinned base-image digests; a pre-promotion smoke gate (t/2376/2377).

## Class 4 — Infrastructure configuration drift

Deployed state diverges from declared intent between deploys.

- **Examples:** CLI `--set-env-vars` config wiped by the next Bicep apply (t/2049/2050); ACA auto-promotes traffic to the latest revision unless `ingress.traffic` is explicitly pinned.
- **Prevention:** post-deploy config verification — actual ACA state vs Bicep intent (t/2378).

## Class 5 — CI gate blind spots

A gate that was sufficient when written, outgrown as the system added surfaces.

- **Examples:** renderer type errors invisible to the server `tsconfig`; the shell-quoting junk-spray guard condition was too narrow (t/2222).
- **Prevention:** gate-coverage review after every incident (the Prevention-per-incident rule); cross-project `tsc` in CI.

## How to use this

- **Reviewing a change:** ask which class(es) it could introduce; require the corresponding contract test, user-type coverage, prod-config check, or gate before approving.
- **After an incident:** classify it here, then file a **prevention** ticket (not only observability) that closes that class's gap *for the affected surface* — per the *Prevention-per-incident* rule in the root `AGENTS.md` **Incident Response** section.
- **Gate-touching prevention** routes to **Main (TL)** for a Gate-Verification review (both arms proven, reliable enough to block, config co-located).

Coverage is point-in-time. This checklist exists so it tracks system growth prospectively, rather than waiting for the next prod bug to find the next gap.
