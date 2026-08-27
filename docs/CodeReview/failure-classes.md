# Failure-Class Taxonomy — Prospective Review Checklist

**Last updated:** 2026-08-27
**Owner:** Diagnostics (source analysis) / Tech Lead (review checklist)
**Source:** e/84 systemic quality analysis of the 2026-08-09 Azure production bug sweep; Class 6 added from the 2026-08-15 dual-build / staging-prod-isolation sweep (t/2669); Class 7 added from the 2026-08-27 embeddings-cache incident (t/3085).

Purpose: turn post-incident hindsight into foresight. Before landing a change — especially at a producer/consumer seam, on a deploy path, or touching config — ask **"which of these classes could this change introduce?"** and require the corresponding test or gate. Each incident maps to one of seven structural classes.

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

## Class 6 — Silent degradation under single-context validation

A failure that **returns a success-shaped result** (empty list + HTTP 200, swallowed write + continue, "renders without error" on zero data) in a code path that was **validated in only one context** (local not hosted, staging not prod, authenticated not anonymous). The two properties are lethal *together*: single-context validation means the broken context is never exercised, and silent degradation means that when it does run, it looks like success. The failure is invisible in the context you checked and silent in the one you didn't.

- **Examples (2026-08-15 dual-build / staging-prod-isolation sweep):**
  - **Dual-build read parity** — Entities/Organizations render locally (Electron/filesystem) but return `[]` on hosted web — the github-api read fell through to empty and ADR-001 graceful-empty rendered zero with no error (t/2648/t/2661); the github-api backend read the session branch not `main`, and `toRepoPath` stripped `cacheDir` not `getDataRoot()`, so a divergent staging cache mount 404'd every read into a silent empty (t/2662/t/2670). The deploy smoke went **26/26 green while entities were visibly broken** because it asserted "endpoints respond," not "data populates" (t/2669).
  - **Swallow-and-continue** — analytics `appendEvents` swallowed a blob error and returned success → events dropped invisibly (t/2664); a route-layer `log.error` that never fired because `log` was a child-logger map (PR #1065).
  - **Deploy/env false-greens** — AUTH_OPTIONAL smoke reclassified the cookie-less Sign-In **HTML interstitial** as a PASS for JSON endpoints; a durability check passed on `revision restart` (≠ scale-to-zero), a false-positive from validating the wrong condition (t/2642); a staging `AI_TRIAD_DATA_ROOT` pointed at the empty cache mount so reads were silently empty (t/2670).
  - **Concurrency swallow** — a multi-replica stale-cache clobber overwrote a prod feature flag and returned success (t/2644).
- **Prevention (three coupled countermeasures — one alone is insufficient):**
  1. **Validate in the deployed context, not a proxy for it.** A dual-build/data-reading feature is verified on the **hosted web profile via the github-api path against real deployed data** before Done — "works locally" is not sign-off (tech-lead `AGENTS.md` Cross-Profile Impact; t/2669 AC2).
  2. **Assert the positive outcome, not the absence of error.** Smokes assert **data presence** (count > 0 / expected shape), never "renders" / "endpoint responds" — a graceful-empty page and a broken page are indistinguishable to a renders-without-error check (t/2671 data-presence smoke).
  3. **Make degradation observable.** Every graceful-empty (ADR-001) and swallow-and-continue path emits a log/metric ("loaded 0 / write failed") so a zero/failed result is **detectable**, not invisible — this turns "silently empty" into "detectably empty" (t/2664 analytics signal; Server-Storage graceful-empty observability).
- **Tickets:** t/2669 (process-gap epic), t/2671 (hosted data-presence smoke), t/2672 (graceful-empty observability), t/2664 (analytics swallow signal). Process rule landed in the tech-lead `AGENTS.md` **Cross-Profile Impact** ("Data-read parity").

## Class 7 — Migration remnant / incomplete-abstraction bypass

A migration moves data consumers behind a shared abstraction (storage backend, resolver, client) but leaves **one consumer on the old raw path**. That straggler silently diverges — the abstraction's guarantees (hydration, freshness, observability, error handling) never apply to it, so it reads a stale, absent, or empty source and returns a success-shaped result. Distinct from Class 1: there is no *seam* between two live components, just the one consumer the migration forgot.

- **Examples:** the 2026-08-27 debate re-embed storm — `loadEmbeddingsFile` kept a raw `fs.readFileSync` of the data-root `embeddings.json` after the May-14 API-First migration routed every *other* taxonomy consumer through `StorageBackend`. When the share held a **stale 36MB file** (vs the 63MB / 4,144-node canonical), the precomputed-cache lookup missed and every debate re-embedded ~3,600 static texts in-process for ~3.5 months — invisible, because the file was **present** (no ENOENT) and **non-empty** (no empty-guard trip), so neither an absence check nor a presence>0 check would have caught it (t/3085/t/3090).
- **Prevention (three coupled):**
  1. **A single sanctioned reader.** All data-root reads route through one storage-owned function (`readDataFile()`, t/3092) that owns the large-file branch, hydration, and the guard — no consumer touches a resolver result with raw `fs`.
  2. **A shape/freshness guard, not just presence.** The sanctioned reader asserts *expected shape/count* (a stale/short file is non-empty and non-ENOENT — presence>0 passes it); an empty/missing/invalid read emits a loud `ActionableError` + flight-recorder event, never a silent empty result.
  3. **An empty-baseline conjunction gate** (t/3087) flags any file outside `storage/` that calls a data-root resolver *and* raw `fs.readFile*` — catching the next straggler at review time.
- **Convention — data-root reader location:** any new exported function whose return value is a data-root path (wraps `resolveDataPath`, `getTaxonomyDir`, or `getEmbeddingsPath`) must live in `src/server/storage/` or `src/server/config.ts` — not a separate helper module. This closes the cross-file data-flow hole the conjunction gate cannot statically track: a caller importing `getEmbeddingsPath` from an outside module and passing it straight to `fs.readFile` never trips the same-file conjunction.
- **Tickets:** t/3085 (root cause), t/3090 (delivery fix), t/3092 (`readDataFile`), t/3087 (gate + convention).

## How to use this

- **Reviewing a change:** ask which class(es) it could introduce; require the corresponding contract test, user-type coverage, prod-config check, or gate before approving.
- **After an incident:** classify it here, then file a **prevention** ticket (not only observability) that closes that class's gap *for the affected surface* — per the *Prevention-per-incident* rule in the root `AGENTS.md` **Incident Response** section.
- **Gate-touching prevention** routes to **Main (TL)** for a Gate-Verification review (both arms proven, reliable enough to block, config co-located).

Coverage is point-in-time. This checklist exists so it tracks system growth prospectively, rather than waiting for the next prod bug to find the next gap.
