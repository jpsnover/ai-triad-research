# Diagnostic Session Retrospective — June 26, 2026

Seven production bugs surfaced and fixed in a single session. This retrospective evaluates each through three lenses: diagnosability, codebase prevalence, and test gap analysis.

---

## Bug 1: t/1060 — AnonymousSessionStore ENOENT on first save

**Root cause:** `writeItem()` called `stat()` and `sessionSize()` before `mkdir`, so a brand-new session (no directories yet) hit ENOENT cascades → misinterpreted as "storage limit exceeded" → returned 429.

### 1) What would have made it easier to diagnose?

The server flight recorder captured the ENOENT cascade clearly, so root cause identification was fast. The problem was the **misleading 429 status code** — the client showed "rate limited" when the real cause was a storage initialization failure. If the server had distinguished "storage init failure" (500 + ActionableError) from "quota exceeded" (genuine 429), the client-side diagnosis would have been immediate without needing server-side JSONL analysis.

### 2) Other instances in the codebase?

`anonymousSessionStore.ts` has 10+ `fsp.stat/readdir/readFile` calls (lines 129, 142, 160, 190, 204, 221, 243, 345, 360, 392). Post-fix, most handle ENOENT gracefully. The pattern is now consistent, but **no integration test exercises the full session lifecycle** (create → write → read → cleanup → re-create). An ordering regression could reintroduce this.

### 3) Why didn't we catch this? What tests would?

Tests only exercised the happy path with pre-existing directories. No test called `writeItem()` on a brand-new session.

**Tests to add:**
- Cold-start lifecycle: fresh store → first write → read back → second write → cleanup → re-create
- Session with empty `baseDir` (no subdirectories at all)
- **Fault injection profile** `firstWriteEnoent` (t/1084)

---

## Bug 2: t/1061 — Free tier 50K daily token budget exhausted by single debate round

**Root cause:** A single debate round fires 3 AI calls consuming ~54K tokens, exceeding the 50K daily budget on the very first round. Budget was set for single-user testing, not real debate workloads.

### 1) What would have made it easier to diagnose?

The server logged 80% and 95% milestone warnings correctly, but **these never surfaced to the UI**. The user saw a bare 429 with no context. If milestone warnings were shown as a banner ("You've used 80% of your daily quota"), the user would have understood the limit before hitting it.

Additionally, the `/health` endpoint **hardcoded** `tokensPerDay: 50_000` instead of reading from config — so even checking health wouldn't have revealed the real runtime value if it had been overridden.

### 2) Other instances in the codebase?

The `/health` hardcoding was fixed (now reads from runtime config). Remaining risk: **test assertions that hardcode expected values**. `freeTier.test.ts:71` was updated to 500K, but any future budget change requires manually finding and updating test assertions. No assertion reads from the config source of truth.

### 3) Why didn't we catch this? What tests would?

No test simulated a **realistic debate round's token consumption** against the budget. Unit tests verified rate-limiting mechanics but not whether the budget is sufficient for the actual workload. This is a capacity planning gap, not a code logic gap.

**Tests to add:**
- Integration test: 3 sequential AI calls with realistic token counts (~20K each) → verify 4th call still allowed
- Rate limiter milestone events verified at 50%, 80%, 95% thresholds
- **Fault injection profile** `tokenExhaustion` (t/1085)

---

## Bug 3: t/1062 — Embeddings 403 for anonymous users

**Root cause:** The free-tier auth gate (`freeTierRoute`) only whitelisted `POST /api/ai/generate`. When the debate engine called `POST /api/embeddings/compute`, anonymous users got 403.

### 1) What would have made it easier to diagnose?

Actually well-instrumented — the `X-Auth-Reason: anon_route_blocked` header and flight recorder event made diagnosis immediate. The issue was that the allowlist was incomplete, not that the error was opaque.

### 2) Other instances in the codebase?

The `freeTierRoute` check at `server.ts:4087-4089` now covers both endpoints. But **no automated test verifies that all debate-engine API calls are allowlisted for anonymous users**. If we add a new API endpoint that the debate engine needs (e.g., `POST /api/ai/search`, `POST /api/nli/classify`), we'd need to manually remember to add it to the allowlist.

The `isAnonAllowedRoute` function in `accessControl.ts` handles GET routes separately. The `accessControl.test.ts` tests GET allowlisting but **not POST/freeTierRoute allowlisting**.

### 3) Why didn't we catch this? What tests would?

The auth gate was tested for correctness (blocks unauthenticated requests) but not for **completeness** (allows all routes anonymous users need).

**Tests to add:**
- Integration test: simulate an anonymous user running a full debate round (all API calls: generate, embeddings, etc.) → verify no 403s
- Allowlist completeness test: extract all API endpoints the debate engine calls, verify each is in the anonymous allowlist
- **Regression anchor**: any new `POST` endpoint consumed by the debate pipeline must be added to `freeTierRoute` or `isAnonAllowedRoute`

---

## Bug 4: t/1063 — DiagnosticsChatSidebar shows API key error to anonymous web users

**Root cause:** Component checks `hasApiKey(backend)` which reads `sessionStorage.getItem('byok-${backend}')`. Anonymous users have no BYOK keys → shows "No Gemini API key configured" instead of a web-mode-appropriate message.

### 1) What would have made it easier to diagnose?

This was a UX issue, not a crash — the flight recorder wouldn't capture it. Diagnosis required manually testing the anonymous user flow. **Persona-based test scenarios** (run the app as each user type: admin, authenticated, anonymous, desktop) would catch this class of bug.

### 2) Other instances in the codebase?

**Yes — potential instances found:**

| Component | Uses `hasApiKey` | Handles anonymous/web? |
|-----------|-----------------|----------------------|
| `NewDebateDialog.tsx:315` | Yes | **Yes** — correctly: `hasApiKey[backend] !== false \|\| (freeTier && tierInfo.allowedBackends.includes(backend))` |
| `SearchBar.tsx:125` / `SearchPanel.tsx:168` | Yes, from taxonomy store | **Unknown** — `checkApiKey()` calls `api.hasApiKey()` which checks sessionStorage for web users. Anonymous users get `false`. May disable semantic search even though embeddings now work via free tier (t/1062 fix). **Needs verification.** |
| `NewChatDialog.tsx:45` | Yes, per backend | **Unknown** — may show "no key" state to anonymous users |
| `SettingsDialog.tsx:274` | Yes | Shows key management UI — anonymous users probably shouldn't see "configure your key" prompts |

The `SearchBar`/`SearchPanel` case is particularly concerning: the backend can now serve embeddings to anonymous users (t/1062 fix), but the frontend gate (`hasApiKey: false`) may prevent the UI from even attempting the call.

### 3) Why didn't we catch this? What tests would?

Tests mock `hasApiKey` as true or false but don't test **what the user sees** in web/anonymous mode specifically.

**Tests to add:**
- For each component using `hasApiKey`: test variant where `isElectronMode() = false` AND `hasApiKey = false` AND `freeTier = true` → verify UI shows appropriate messaging, not "configure your API key"
- Semantic search specifically: verify anonymous web users can trigger semantic search despite `hasApiKey: false` (embeddings route through free tier proxy)

---

## Bug 5: t/1064 — Flight recorder download blocked by admin gate

**Root cause:** `GET /api/flight-recorder/download-merged/:dumpId` was `requireAdmin`-gated. `isAdmin()` returns false for `_local` users (Electron). Local users could create dumps but not download them.

### 1) What would have made it easier to diagnose?

The error was a bare string "Merged download failed" with no details. The fix added a structured ActionableError body (`{ error, goal, problem, location, nextSteps[], dumpId, requestId }`). **Diagnostic tools must never fail with opaque errors** — they should be the most robustly error-reported code in the system.

### 2) Other instances in the codebase?

`requireAdmin` is used ~30 times in `server.ts`. After the fix, the remaining admin-gated endpoints are appropriately restricted (data-root management, key rotation, community admin, runtime config admin). However, `isAdmin()` returning false for `_local` means **Electron/desktop users can never access admin endpoints**. This is correct for now (admin features are web-only), but any future diagnostic or debug endpoint that gets admin-gated will repeat this bug.

### 3) Why didn't we catch this? What tests would?

`adminReview.test.ts:208` explicitly tests that `requireAdmin` returns false for `_local` — the behavior was **known and tested**. The bug was a **design review gap**: someone applied `requireAdmin` to the download endpoint without asking "do local users need this?"

**Tests to add:**
- Integration test: in `_local` mode, verify all flight-recorder endpoints (dump, download-merged, list) return 200
- **Code review checklist item**: when adding `requireAdmin`, ask "do Electron/local users need this endpoint?"

---

## Bug 6: t/1068 — Debate engine hangs on silent AI drop (no timeout)

**Root cause:** `bridge.generateText` had no call-level timeout. When the Anthropic API silently dropped the connection, the Promise hung forever — no resolve, no reject, no timeout.

### 1) What would have made it easier to diagnose?

The flight recorder showed the gap clearly — a `bridge.generateText` request at event 184 with no matching response event. The user had to **manually dump after 7 minutes of frozen UI**. An auto-detection mechanism (show warning banner when no AI response arrives within 2× expected time) would have surfaced the problem immediately.

### 2) Other instances in the codebase?

The `callWithTimeout` wrapper now covers all `generateText` calls in `aiAdapter.ts`. But other async external calls may still lack timeouts:

| Call | Location | Has timeout? |
|------|----------|-------------|
| `generateText` (debate) | `lib/debate/aiAdapter.ts` | **Yes** (t/1068 fix) |
| `computeEmbeddings` (Gemini) | `taxonomy-editor/src/server/ai/aiBackends.ts:536` | **No explicit timeout** — relies on Gemini SDK defaults |
| `nliClassify` (Python) | Python subprocess | Has subprocess timeout, but no HTTP timeout if REST |
| Bridge REST calls | `taxonomy-editor/src/renderer/bridge/resilience.ts` | **Yes** — per-category timeouts (AI: 120s, read: 30s, mutation: 60s) |
| WebSocket connections | `web-bridge.ts:294,337` | **No** — `new WebSocket()` has no built-in timeout for handshake |

The `computeEmbeddings` Gemini call and WebSocket handshakes are the highest-risk gaps.

### 3) Why didn't we catch this? What tests would?

All error tests used **rejecting promises or error responses**. No test simulated a **hanging Promise** (never resolves, never rejects). The "silent drop" scenario was untested.

**Tests to add:**
- For every async boundary making an external call: test where mock **never resolves** → verify timeout fires and caller gets ActionableError
- **Fault injection profiles** `silentAiDrop` and `totalAiOutage` (t/1083)

---

## Bug 7: t/1078 — BroadcastChannel HMR stale closure crash

**Root cause:** `BroadcastChannel('aitriad-debate-driver')` created at module scope in `helpers.ts` was never closed on HMR dispose. When Vite hot-reloaded the module, the old channel's `onmessage` handler fired with a stale closure, referencing a dead `reloadActiveDebateFromStorage` → `ReferenceError`.

### 1) What would have made it easier to diagnose?

Actually well-instrumented — the flight recorder auto-dumped via `uncaught_error` trigger with a clear stack trace pointing to the stale closure. Diagnosis was fast.

### 2) Other instances in the codebase?

**YES — two WebSocket instances lack HMR cleanup (same bug class, live today):**

| Resource | Location | HMR dispose? |
|----------|----------|-------------|
| `BroadcastChannel('aitriad-debate-driver')` | `helpers.ts:483` | **Yes** (t/1078 fix) |
| `BroadcastChannel('aitriad-diagnostics')` | `web-bridge.ts:369` | **Yes** (`web-bridge.ts:388-389`) |
| `BroadcastChannel('aitriad-flight-recorder')` | `flightRecorderInit.ts:578` | **Yes** (`flightRecorderInit.ts:590-591`) |
| **`WebSocket` (events)** | **`web-bridge.ts:294`** | **NO — missing `import.meta.hot.dispose()`** |
| **`WebSocket` (terminal)** | **`web-bridge.ts:337`** | **NO — missing `import.meta.hot.dispose()`** |

The `eventWs` WebSocket is particularly dangerous: its `onclose` handler (line 314-317) reconnects after 2s. On HMR, the old socket stays alive, fires stale `onmessage` handlers, AND the reconnect loop creates zombie connections.

### 3) Why didn't we catch this? What tests would?

HMR is a dev-mode phenomenon — vitest doesn't exercise HMR. There's no automated way to unit-test HMR cleanup. The best prevention is structural:

**Mitigations to add:**
- **ESLint rule or CI grep check**: every module-scope `new BroadcastChannel/WebSocket/EventSource/Worker` must have a corresponding `import.meta.hot.dispose()` cleanup. Count mismatches = build failure.
- **Code review checklist item**: "Does this module-scope resource have HMR dispose?"
- **Immediate fix**: add `import.meta.hot.dispose()` for `eventWs` and `terminalWs` in `web-bridge.ts`

---

## Cross-Cutting Themes

### Theme A: "Anonymous user path" was never end-to-end tested
Bugs t/1060, t/1061, t/1062, t/1063, and t/1064 all share a root cause: the anonymous/free-tier user path was tested in isolation (individual components, individual endpoints) but never **end-to-end**. No test simulated: "anonymous user opens app → starts debate → AI generates → embeddings compute → save session → download flight recorder." An E2E test hitting this path would have caught 5 of 7 bugs.

### Theme B: "What happens when it never responds?" was untested
Bug t/1068 revealed that tests covered failure (error responses) but not **absence** (never resolves). The `callWithTimeout` fix addresses the debate engine, but the pattern should be verified at every async boundary.

### Theme C: Module-scope resources need lifecycle management
Bug t/1078 and the WebSocket gaps show that any resource created at module scope (`new BroadcastChannel`, `new WebSocket`, `setInterval`) outlives HMR and creates stale closures. This needs a structural enforcement (lint rule), not just case-by-case fixes.

### Theme D: Auth gates default-deny without persona verification
Bugs t/1062, t/1063, and t/1064 show the same anti-pattern: a gate was added (admin check, auth allowlist, BYOK key check) that correctly restricts access but wasn't verified against all user personas (admin, authenticated, anonymous, local/Electron). A "persona matrix" test — run each critical path as each user type — would catch this class of bug systematically.

---

## New Issues Found During This Retrospective

| Finding | Bug Class | Severity | Action |
|---------|-----------|----------|--------|
| `web-bridge.ts:294` — `eventWs` WebSocket has no HMR dispose | t/1078 (stale closure) | High (dev) | File bug ticket |
| `web-bridge.ts:337` — `terminalWs` WebSocket has no HMR dispose | t/1078 (stale closure) | High (dev) | File bug ticket |
| `SearchBar`/`SearchPanel` — `hasApiKey: false` may block semantic search for anonymous users despite backend support | t/1063 (BYOK assumption) | Medium | File bug ticket |
| `computeEmbeddings` Gemini call has no explicit timeout | t/1068 (no timeout) | Low | Track in t/1080 Phase 2 |
