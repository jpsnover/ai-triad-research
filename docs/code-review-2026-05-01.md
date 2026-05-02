# Codebase Review — 2026-05-01

**Reviewer:** Tech lead review (5 parallel analysis agents)
**Scope:** Full codebase — lib/debate/, taxonomy-editor/, poviewer/, summary-viewer/, deploy/
**Methodology:** Security (OWASP + Electron), architecture, error handling, test coverage, performance/tech debt

---

## Executive Summary

The codebase has strong fundamentals — clean type hierarchy, well-layered debate engine, solid Electron security defaults (contextIsolation, no nodeIntegration), and exemplary test quality where tests exist (246 cases, all active, no skips). However, the review uncovered **3 critical security vulnerabilities** in the web deployment, a **systemic architecture problem** (dual-maintained engine logic), and **35 of 43 debate engine modules with zero test coverage**.

**Top 5 actions by leverage:**
1. ~~Fix the 3 P0 security vulnerabilities (SSRF, unauthenticated WebSocket, XSS)~~ — **DONE** (c056268)
2. Extract shared DebateOrchestrator to eliminate the dual-maintenance monolith — **IN PROGRESS** (Stage 1 moderator selection done, Stages 2-3 pending)
3. Add tests for `parseAIJson`/`helpers.ts` — 1 day, covers the single most fragile code path
4. ~~Compute QBAF once per turn instead of 3x~~ — **DONE** (57eff97)
5. ~~Add path traversal guards to `fileIO.ts`~~ — **DONE** (c056268)

---

## P0 — Critical (fix before next deployment)

### Security

| # | Finding | File | Impact | Status |
|---|---------|------|--------|--------|
| S1 | ~~**SSRF via `/api/fetch-url`** — accepts arbitrary URLs, can reach Azure IMDS (169.254.169.254) to steal managed identity tokens~~ | `server/fileIO.ts:714`, `server/server.ts:551` | Token theft, lateral movement | **DONE** (c056268) |
| S2 | ~~**Unauthenticated WebSocket terminal** — `/ws/terminal` bypasses Easy Auth, gives shell access to any client~~ | `server/server.ts:1223-1238` | Remote code execution | **DONE** (c056268) |
| S3 | ~~**Reflected XSS in FORBIDDEN_PAGE** — `principalName` header interpolated into HTML without encoding~~ | `server/server.ts:1071` | Session hijacking if Easy Auth is misconfigured | **DONE** (c056268) |

**Fixes:**
- ~~S1: Restrict to `https://` only, reject RFC-1918/link-local addresses, add DNS rebind check~~ — added `validateFetchUrl()` with private IP rejection, HTTPS enforcement, redirect validation
- ~~S2: Extract Easy Auth header check from HTTP handler, apply to WebSocket upgrade~~ — added `isWebSocketAuthorized()` gate on `server.on('upgrade')`
- ~~S3: HTML-encode `<`, `>`, `"`, `'`, `&` before interpolation~~ — added `escapeHtml()` to FORBIDDEN_PAGE

### Architecture

| # | Finding | Scope | Impact | Status |
|---|---------|-------|--------|--------|
| A1 | **4,209-line `useDebateStore.ts` reimplements `debateEngine.ts`** — `crossRespond()` alone is 660 lines duplicating moderator selection, intervention, claim extraction, QBAF, GC, convergence, crux tracking, gap injection, and sycophancy detection | Both files | Every behavioral change must be made in two places; bugs fixed in one path silently remain in the other (as we saw with the intervention compliance bug today) | **DONE** — Stages 1-2 extracted, Stage 3 deferred (post-turn logic intentionally divergent) |
| A2 | ~~**AI backend HTTP client triplicated** — Gemini/Claude/Groq/OpenAI call logic exists in `aiAdapter.ts` (851 lines), `embeddings.ts` (1,125 lines), and `aiBackends.ts` (634 lines)~~ | ~2,600 lines of duplication | Retry logic only exists in 1 of 3 copies for non-Gemini backends | **DONE** — shared `lib/ai-client/` (791 lines): providers, retry, registry, embeddings, grounded search. aiAdapter 565→248, aiBackends 535→338. All backends share retry via `withRetry`. |

**Fixes:**
- A1: Extract shared orchestration functions with callback interfaces. `lib/debate/orchestration.ts` created with `runModeratorSelection()` (Stage 1) and `executeTurnWithRetry()` (Stage 2). Both consumers wired — engine reduced 3,458→3,141 lines, store reduced 4,200→4,003 lines. Stage 3 (post-turn processing) deferred: analysis showed the two consumers' post-turn logic is intentionally divergent (engine has steelman validation, context manifests; store has sycophancy detection, gap injection, different state management) — extracting would create a leaky abstraction.
- ~~A2: Extract `lib/ai-client/` shared package. Inject `fetch` as dependency.~~ — **DONE**. Added `systemMessage` to `GenerateOptions` so all 4 providers natively handle system+user messages. Envelope functions in aiAdapter collapsed from 250 lines to 10-line wrapper calling `callProvider`. Gemini batch embeddings extracted to `gemini-embeddings.ts` (uses `withRetry` instead of manual loop). Gemini grounded search extracted to `gemini-search.ts` (shared by both CLI and server). Net reduction: ~500 lines across aiAdapter+aiBackends, with all retry logic unified through shared `withRetry`.

### Performance

| # | Finding | File | Impact | Status |
|---|---------|------|--------|--------|
| P1 | ~~**QBAF computed 3x per turn** — `computeConvergenceSignals()` runs it internally, then it's run again for strength propagation, then again for GC~~ | `useDebateStore.ts:725-769` | 67% wasted CPU on O(N*E*I) computation | **DONE** (57eff97) |
| P2 | ~~**10+ shallow clones per turn** — sequential `set({ activeDebate: { ...debate, ... } })` calls each copy the entire DebateSession and trigger React re-renders~~ | `useDebateStore.ts:680-770` | Re-render storm, UI jank during turn processing | **DONE** (57eff97) |

**Fixes:**
- ~~P1: Compute QBAF once, pass result to convergence signals and GC~~ — added `precomputedStrengths` param to `computeConvergenceSignals()`
- ~~P2: Batch all mutations into a single `set()` call~~ — collapsed 6 sequential `set()` calls into one batched update

---

## P1 — High (fix this sprint)

### Security

| # | Finding | File | Status |
|---|---------|------|--------|
| S4 | ~~**Path traversal in fileIO** — `pov`, `claimId`, `id`, `docId` params used in file paths without sanitization (Electron IPC has these guards, server doesn't)~~ | `server/fileIO.ts` (15 functions) | **DONE** (c056268) |
| S5 | ~~**No request body size limit** — `readBody()` reads entire body into memory, 1 GB container RAM~~ | `server/server.ts:902-912` | **DONE** (c056268) |
| S6 | ~~**`webviewTag: true`** with user-controlled URLs — can load arbitrary external content~~ | `main/main.ts:117` | **DONE** (c056268) — `will-attach-webview` handler restricts to HTTPS |
| S7 | ~~**Cookie missing `Secure` flag** — `auth_anonymous` sent over HTTP downgrades~~ | `server/server.ts:1135` | **DONE** (c056268) |

### Error Handling

| # | Finding | Scope |
|---|---------|-------|
| E1 | ~~**145 bare `throw new Error`** — only 2 uses of `ActionableError` in entire codebase despite project mandate~~ | `aiAdapter.ts` (34), `embeddings.ts` (24), `aiBackends.ts` (21), `ipcHandlers.ts` (10) | **DONE** — migrated 72 throws to ActionableError across aiAdapter, embeddings, aiBackends, ipcHandlers, cli, taxonomyLoader, fileIO (main+server), turnPipeline, modelDiscovery, web-bridge, syncApi. 73 remain in summary-viewer (26), poviewer (15), test files (12), and misc |
| E2 | ~~**Non-Gemini backends have zero retry** in Electron — single 429 from Claude/Groq kills the turn~~ | `server/aiBackends.ts:191-298` | **DONE** — `retryableFetch()` already handles 429/503 retry for all backends |
| E3 | ~~**Bare `JSON.parse(bodyText)` without try/catch** on 7 API response parse sites in Electron~~ | **DONE** — all parse sites already have try/catch with ActionableError |
| E4 | ~~**No timeout on most `generate()` calls** — moderator selection, compression, missing-args have no timeoutMs~~ | `debateEngine.ts` (8 call sites) | **DONE** — default 120s timeout on `generate`/`generateWithEvaluator`/`generateWithModel`; 60s on orchestration moderator calls |

### Architecture

| # | Finding | Scope |
|---|---------|-------|
| A3 | ~~**Barrel export missing 15 modules** — consumers bypass barrel with deep imports (`@lib/debate/documentAnalysis`, etc.)~~ | `lib/debate/index.ts` | **DONE** — added 11 missing module exports; excluded 3 Node.js-only modules (phaseTransitions, repairTranscript, judgeAudit) to avoid polluting renderer bundles |
| A4 | ~~**DebateSession grows unboundedly** — transcript, diagnostics (full prompts), convergence_signals, position_drift, turn_embeddings, health_history never pruned~~ | **DONE** — `pruneSessionData()` caps convergence_signals (30), position_drift (30), turn_embeddings (20), diagnostics (15); `pruneModeratorState()` caps health_history (20). Called after each turn in both consumers. |

### Test Coverage

| # | Finding | Risk |
|---|---------|------|
| T1 | ~~**`helpers.ts` `parseAIJson`/`repairJson`** — 0 tests for the LLM output parser every AI response flows through. Has 3 cascading strategies with character-level heuristic walking.~~ | **DONE** — 103 tests covering all 3 strategies, repair heuristics, adversarial edge cases, and realistic LLM output |
| T2 | ~~**`debateEngine.ts`** — 0 tests for 3,456-line core orchestrator with 36 catch blocks~~ | **DONE** — 44 tests covering construction, turn flow, error handling |
| T3 | ~~**`phaseTransitions.ts`** — 0 tests for phase state machine (18 exported functions, complex predicate evaluation)~~ | **DONE** — 87 tests covering phase evaluation, signal computation, crux detection |
| T4 | ~~**`aiAdapter.ts`** — 0 tests for retry/fallback/timeout across 3 backends~~ | **DONE** — 60 tests covering retry, fallback, timeout across all backends |

### Performance

| # | Finding | File |
|---|---------|------|
| P3 | ~~**15+ components use `useDebateStore()` without selectors** — subscribe to entire store, re-render on any change~~ | **DONE** — all components now use selectors (`s => s.field` or destructured picks) |
| P4 | ~~**`turn_embeddings` never pruned** — 384-dim float arrays per turn, cloned on every spread~~ | **DONE** — `pruneSessionData()` caps turn_embeddings at 20 (see A4) |

---

## P2 — Medium (fix this month)

### Security

| # | Finding | File |
|---|---------|------|
| S8 | ~~**CORS defaults to `*`** when ALLOWED_ORIGINS unset~~ | `server/server.ts:918-926` | **DONE** — rejects cross-origin in production when unset |
| S9 | ~~**Easy Auth headers trusted without proxy verification** — spoofable if container exposed directly~~ | `server/server.ts:1111-1112` | **DONE** — gated on `WEBSITE_AUTH_ENABLED` env var |
| S10 | ~~**No CSP/X-Frame-Options/HSTS headers**~~ | `server/server.ts` | **DONE** — X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS, CSP |
| S11 | ~~**Local key store derives AES key from hostname** — not a secret~~ | `server/keyStore.ts:37-39` | **DONE** — random key material on disk with legacy migration |

### Error Handling

| # | Finding | File |
|---|---------|------|
| E5 | ~~**`console.warn` in 12 catch blocks without UI state propagation** — users see no indication features are degraded~~ | `useDebateStore.ts` (12 sites) | **DONE** — added `pushWarning()` to 4 silent catch blocks (summarization retry, fact-check save, seed claim extraction, vocabulary loading); 1 already had store-level warning propagation; remaining sites already use `pushWarning` |
| E6 | ~~**No AbortController/cancellation** for long debates — 20+ minute run can't be stopped~~ | `debateEngine.ts` | **DONE** — `signal` added to `GenerateOptions`, passed through `generate`/`generateWithModel`/`generateWithEvaluator` to all 4 backend fetch calls |
| E7 | ~~**Swallowed synthesis JSON parse fallback** — both `parseJsonRobust` and `extractArraysFromPartialJson` can return empty with no warning~~ | `debateEngine.ts:2419-2444` | **DONE** — empty-result detection after each synthesis phase's try/catch |

### Architecture

| # | Finding | File |
|---|---------|------|
| A5 | ~~**POV taxonomy keys scattered as literal arrays** — `['accelerationist', 'safetyist', 'skeptic'] as const` appears 10 times in useDebateStore, more in engine~~ | Multiple files | **DONE** — added `AI_POVERS` and `POV_KEYS` constants to `lib/debate/types.ts`; replaced 53 literal arrays across 21 files |
| A6 | ~~**3 Electron apps duplicate boilerplate** — ErrorBoundary, apiKeyStore, useResizablePanes, ApiKeyDialog copied across poviewer/summary-viewer~~ | 3 apps | **DONE** (partial) — extracted `ErrorBoundary` and `useResizablePanes` to `lib/electron-shared/`; apiKeyStore and ApiKeyDialog left as-is (architecturally different) |
| A7 | ~~**`routeTurnValidatorHintsIntoSuggestions` duplicated** between engine and store~~ | **DONE** — deduplicated, only in useDebateStore now |

### Performance

| # | Finding | File |
|---|---------|------|
| P5 | ~~**O(N*E) crux detection** — scans all edges for every node, then all nodes for each matching edge~~ | `phaseTransitions.ts:364-381` | **DONE** — O(N+E) via pre-built index maps |
| P6 | ~~**Barrel export forces bundler to resolve all 22 modules** on any import from `@lib/debate`~~ | `lib/debate/index.ts` | **DONE** — 23 renderer files updated to direct module imports + `sideEffects: false` |

### Test Coverage

| # | Finding | Risk |
|---|---------|------|
| T5 | ~~`convergenceSignals.ts` / `argumentNetwork.ts` — 0 tests for core data pipeline feeding moderator decisions~~ | **DONE** — 66 tests covering all 8 metrics |
| T6 | ~~`useDebateStore.ts` — 0 tests for 4,209 lines with 48 catch blocks and concurrent mutations~~ | **DONE** — 98 tests covering init, CRUD, phase, transcript, errors, concurrency, sessions, config, diagnostics, claims |
| T7 | ~~`turnValidator.ts` Stage-A deterministic gate — only 3 of 30+ validation paths tested~~ | **DONE** — 88 tests covering all 11 rules + orchestrator + aliases + judge |
| T8 | ~~**Zero React component tests** — 78 components, 0 `.test.tsx` files~~ | **DONE** — 27 tests across 4 components (TabBar, DeleteConfirmDialog, FieldHelp, LinkedChip) + jsdom infrastructure |

---

## P3 — Low (backlog)

| # | Category | Finding | Status |
|---|----------|---------|--------|
| S12 | Security | ~~`open-external` in poviewer lacks URL scheme validation~~ | **DONE** — added `https?://` scheme guard |
| S13 | Security | ~~Git token in remote URL may leak to Azure logs~~ | **DONE** — redacted tokens from log output |
| S14 | Security | ~~`.gitignore` doesn't cover `.aitriad-key-*.enc` files~~ | **DONE** — added to secrets section |
| S15 | Security | ~~Terminal ConstrainedLanguage mode has 500ms race window~~ | **DONE** — sentinel-based lockdown; user input gated until lockdown confirmed |
| A8 | Architecture | ~~Unused `withRecovery()` utility in `errors.ts` (0 call sites)~~ | **DONE** — deleted 60-line dead function; updated docs |
| A9 | Architecture | ~~Dead code: `loadNodeEmbeddings()` always returns `{}`~~ | **DONE** — deleted dead function and unused `_nodeEmbeddingsCache` |
| A10 | Architecture | ~~`stageGenerate` closure duplicated within useDebateStore~~ | **DONE** — extracted `makeStageGenerate()` factory; both call sites use it |
| A11 | Architecture | `HARD_CAP = 200` in networkGc.ts should be configurable | Deferred — low impact, config surface already large |
| P7 | Performance | ~~`as any` type assertions: 25 in debateEngine, 12 in useDebateStore, 30+ in DiagnosticsPanel~~ | **DONE** — removed 70 assertions (28 debateEngine, 12 useDebateStore, 30 DiagnosticsPanel); 4 remain with eslint-disable (Zustand helper params, complex AI JSON) |
| P8 | Performance | ~~O(T^2) recycling detection in convergenceSignals — cap lookback to 10~~ | **DONE** — `RECYCLING_LOOKBACK = 10` cap |
| P9 | Performance | ~~Heavy Azure SDK deps in bundle — should be lazy-loaded~~ | **DONE** — dynamic `require()` inside conditional guard |
| P10 | Performance | ~~`formatRecentTranscript` filters entire transcript to take last 8~~ | **DONE** — pre-slice to 2x window before filtering |
| E8 | Error handling | ~~`console.warn` in neutral eval bypasses structured `warn()` pipeline~~ | **DONE** — replaced with `this.warn()` |
| E9 | Error handling | ~~Fire-and-forget `.catch(() => {})` on 4 async calls loses errors silently~~ | **DONE** — replaced 6 sites with structured `this.warn()` logging |
| T9 | Test coverage | ~~`prompts.ts` (27+ functions, 0 tests) — low logic risk but prompt drift undetected~~ | **DONE** — 101 tests covering 30+ prompt functions |
| T10 | Test coverage | ~~Supporting modules (networkGc, pragmaticSignals, signalConfidence) — 0 tests~~ | **DONE** — 78 tests (21 networkGc, 27 pragmaticSignals, 30 signalConfidence) |
| UX1 | UX | ~~Moderator veto/force buttons are dead (onClick wired to empty TODO)~~ | **DONE** — hidden until store actions implemented; comment documents dependency |

---

## What Works Well

- **Electron security defaults** — `contextIsolation: true`, `nodeIntegration: false`, properly scoped preload APIs
- **No circular dependencies** in lib/debate/ — clean layered architecture
- **Test quality where tests exist** — moderator.test.ts (107 tests) is exemplary with property-based invariants
- **Graceful degradation pattern** — optional features (gap injection, neutral eval, coverage) never abort debates
- **CLI adapter retry logic** — exponential backoff, fallback chains, timeout wrappers on every fetch
- **schemas.ts correctly excluded** from barrel to isolate Zod dependency
- **No string throws** — `throw "..."` never appears (only `throw new Error`)
- **Network GC** — argument network has proper topology-aware pruning at 175/150/200 caps

---

## Recommended Prioritization

### This week (security fixes) — **ALL DONE** + S6/S7 also fixed
1. ~~S1: SSRF URL validation~~ — **DONE** (c056268)
2. ~~S2: WebSocket auth gate~~ — **DONE** (c056268)
3. ~~S3: HTML-encode principalName~~ — **DONE** (c056268)
4. ~~S4: Path traversal guards in fileIO~~ — **DONE** (c056268)
5. ~~S5: Request body size limit~~ — **DONE** (c056268)
6. ~~S6: Webview URL restriction~~ — **DONE** (c056268)
7. ~~S7: Cookie Secure flag~~ — **DONE** (c056268)

### Next 2 weeks (stability) — ALL DONE
6. ~~P1+P2: QBAF single-compute + batch Zustand mutations~~ — **DONE** (57eff97)
7. ~~E2: Add retry logic to non-Gemini backends~~ — **DONE** (already had `retryableFetch` for all backends)
8. ~~T1: Tests for parseAIJson/repairJson (highest fragility)~~ — **DONE** (103 tests)
9. ~~E4: Add timeoutMs to all generate() calls~~ — **DONE** (default 120s + 60s for orchestration)
10. ~~A4: Prune turn_embeddings, convergence_signals, diagnostics~~ — **DONE** (`pruneSessionData` + `pruneModeratorState`)

### Next month (architecture) — A1, A2, T2-T4, P3 done
11. ~~A2: Extract shared AI client library (eliminates triple duplication + fixes retry gap)~~ — **DONE** (lib/ai-client 791 lines; aiAdapter 565→248, aiBackends 535→338)
12. ~~A1: Extract DebateOrchestrator (eliminates dual-maintained engine logic)~~ — **DONE** (Stages 1-2 extracted; Stage 3 deferred as intentional divergence)
13. ~~T2-T4: Tests for debateEngine, phaseTransitions, aiAdapter~~ — **DONE** (44 + 87 + 60 = 191 tests)
14. ~~P3: Add Zustand selectors to all 15+ unselectored components~~ — **DONE** (all use selectors now)
15. ~~A3: Complete barrel exports~~ — **DONE** (11 modules added; 3 Node.js-only excluded)

### Backlog — ALL DONE (except A11 deferred)
16. ~~E1: Migrate 145 bare throws to ActionableError (incremental)~~ — **DONE** (72 migrated in core files; 73 remain in secondary apps and test files)
17. ~~A6: Extract shared Electron boilerplate~~ — **DONE** (ErrorBoundary, ResizeHandle, useResizablePanes, searchRegex extracted to `lib/electron-shared/`)
18. ~~T8: Start React component testing~~ — **DONE** (27 tests across 4 components + jsdom/testing-library infrastructure)
19. ~~E6: Add AbortController cancellation support~~ — **DONE** (signal passthrough to all backends)
20. ~~P3 backlog (S12–S15, A8–A10, P7–P10, E8–E9, T9–T10, UX1)~~ — **DONE** (16 of 17 items; A11 deferred)
