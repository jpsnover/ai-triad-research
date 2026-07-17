# API Patterns

Failure patterns related to external APIs, HTTP handling, and authentication.

---

## [API] GHCR Push Fails Due to Insufficient OAuth Token Scopes

**Pattern:** `docker push` to GitHub Container Registry (GHCR) fails with `permission_denied: token does not match expected scopes` when the `gh` CLI OAuth token lacks `write:packages`.

**Instances:**
- 2026-05-28 — Taxonomy Editor: GHCR push failed after successful Docker build. The `gh` OAuth token didn't include `write:packages` scope. Fix: `gh auth refresh -s write:packages` to add the scope (p/6#11).

**Root Cause:** The default `gh auth login` scopes don't include `write:packages`, which is required for pushing to GHCR. This is a one-time setup issue per machine/token.

**Prevention:**
1. Before first GHCR push, ensure token has `write:packages`: `gh auth status` to check, `gh auth refresh -s write:packages` to add.
2. For CI, ensure the `GITHUB_TOKEN` or PAT has `packages: write` permission.
3. Add GHCR auth setup to dev environment onboarding docs.

**Status:** Active

**Applies To:** All agents pushing Docker images to GHCR.

---

## [API] HTTP Redirect Handling Must Cover All 3xx Codes

**Pattern:** Custom HTTP download helpers that only handle 301/302 redirects break when servers use other redirect codes (307, 308). Additionally, creating write streams before redirect resolution leaves 0-byte files on failure.

**Instances:**
- 2026-05-28 — Shared Lib: HuggingFace download helper in `onnxEmbedding.ts` only handled 301/302, but HF uses 307 for `tokenizer.json`. Also created writeStream before redirect resolution, leaving 0-byte files on redirect failure. Fixed by handling 301-308, resolving relative redirect URLs against origin, draining response before following redirect, and deferring writeStream creation until final 200 response (p/5#9).

**Root Cause:** (1) Incomplete redirect handling — 307/308 are common (HuggingFace, AWS S3, CDNs) but often overlooked when only 301/302 are coded. (2) Premature resource creation — opening a file write stream before confirming the final response means a redirect or error leaves an empty file that looks like a successful download.

**Prevention:**
1. Handle all redirect status codes (301-308) in custom HTTP clients, not just 301/302.
2. Resolve relative `Location` headers against the request origin — not all servers return absolute URLs.
3. Drain/discard the redirect response body before following the redirect to prevent resource leaks.
4. Defer file write stream creation until the final 200 response is confirmed — never create output files before redirect resolution.
5. Consider using a library with built-in redirect handling (e.g., `node-fetch`, `undici`) instead of manual `http.get` chains.

**Status:** Active

**Applies To:** All agents writing custom HTTP download/fetch helpers.

---

## [API] Lossy Error Boundaries — Success/Failure Detail Discarded at the Provider Edge

**Pattern:** At the boundary between our code and an AI provider, the specific success/failure detail — the provider's own error reason, the resolved model id, the actual key source — is discarded and replaced with a generic message, a verbatim-but-unmapped value, or an empty/`(none found)` string. Diagnosis then loses the one fact that would have pointed at root cause, so an outage or misconfiguration reads as an opaque failure.

**Instances:**
- 2026-07-16 — Technical Lead (t/1618 / t/1619, Z.AI outage, resolved c51018af): an unmapped Z.AI model id was passed **verbatim** to the provider instead of being validated against the model registry, so the failure surfaced as a raw provider error rather than a clear "unknown model id X" (p/8#69).
- 2026-07-16 — Technical Lead (t/1620): the Gemini API-key test **collapses the provider's reason** into a generic failure string — the actual reason Google returned never reaches the user (p/8#69).
- 2026-07-16 — Technical Lead (t/1621), root-cause detail from PowerShell (p/20#16), fixed **cd020938**: `Test-AIApiKey` reported `KeySource="(none found)"` on an HTTP **200**. Mechanism: it read AIEnrich's private `$script:LastApiKeySource` through a cross-module scriptblock (`& (Get-Module AIEnrich) {…}`), which **throws when `Get-Module` resolves 0 or >1 module objects**; the throw was swallowed by `catch{$null}`, so a genuinely-resolved key surfaced as absent. A lossy *success* path — the **diagnostic read silently degraded its own reporting** while the primary path (`Invoke-AIApi`, same-scope read) worked fine. Fix: an exported accessor bound to the same module instance.
- 2026-07-17 — **Diagnostics** (t/1626, flight-recorder triage of debate `a7ddc788`, model `zai-glm-5-2`), ticketed to Taxonomy Editor — **the 5th instance, which broadens the genus.** `parseAIJson` (`lib/debate/helpers.ts:53-90`) ran all 3 recovery strategies and **silently returned `null` on a valid 6728-char body**, so claim-extraction threw and **all 7 of the debater's claim sketches were discarded** (0-of-7; `an_nodes:0`) even though `has_debater_claims:true`. Two lossy facets: (a) **generic recovery masked a real payload** — a null parse dropped everything instead of falling back to the debater's already-present sketches; (b) the failure event captured **head-only** `response_preview`+`raw length`, so a *truncated* response was indistinguishable from a *malformed body* without the raw text. This site (`parseAIJson`/`argumentNetwork.ts`) sits **outside the t/1623 hook's current path scope** — the genus now extends past the provider edge to any generic recovery/parse boundary that discards a recoverable payload.

**Root Cause:** Status/error handling at provider boundaries collapses rich provider responses into generic strings (or drops them entirely) instead of preserving them. There is no `ActionableError`/`New-ActionableError` capturing Goal/Problem/Location/Next Steps at the edge, so the provider's verbatim reason, the resolved model id, and the detected key source are all thrown away before anyone can read them. The tell is uniform: **success/failure detail discarded at the boundary** — visible on both the error path (generic message) and the success path (`(none found)` on a 200). A sharp sub-species (t/1621): a **diagnostic/observability read that swallows its own failure** (`catch{$null}`, sentinel default) degrades silently while the primary path works — you get a confident false-negative about a healthy system.

**Prevention:**
1. At every AI provider boundary, **preserve the provider's own reason/detail** in the surfaced error — never replace it with a generic message (ADR-001).
2. Use `ActionableError` (TS) / `New-ActionableError` (PS): **Problem** carries the provider's verbatim reason, **Location** names backend+model, **Next Steps** names the config fix.
3. **Echo the resolved identity** (mapped model id, detected key source) on BOTH success and failure paths — a success that reports `(none found)` is a lossy success, not just a lossy error.
4. **Validate model ids against the registry** before calling the provider — never pass an unmapped/unknown id verbatim; fail with the unknown id named.
5. **Never let a diagnostic/observability read swallow its own failure** — a `catch{$null}` or sentinel default on a status/health read reports a false-negative on a working system. Surface the read's own failure distinctly from the thing it observes; bind cross-module/scope reads to the resolved instance (exported accessor) rather than a scriptblock that can throw on 0/>1 module resolution.
6. **Generic recovery must not discard a recoverable payload** (t/1626). When a parse/recovery step fails but usable upstream data already exists (e.g. debater-supplied claim sketches present on the turn), **fall back to it** rather than emitting the worst-case empty result — dropping 7-of-7 sketches on a `parseAIJson`→null is a data-loss bug, not graceful degradation. And make the failure event **diagnosable**: capture head **+ tail (bounded)**, a `response_truncated` flag, and which recovery strategy failed / the terminal `extractionTrace.status`, so a *truncated* response is distinguishable from a *malformed body* without the raw text.

**Status:** Active (defenses in force) — **escalation triggered + resolved (5th instance, 2026-07-17).** 5 instances across t/1618–t/1621 + t/1626, **3 reporting agents** (TL, PowerShell, Diagnostics). The genus **broadened** from the provider edge to *any generic recovery/parse boundary that discards a recoverable payload* (t/1626: `parseAIJson`→null in `lib/debate/helpers.ts` / `argumentNetwork.ts`). Two-track defense, both landed 2026-07-17:
- **(1) Mechanical — PRIMARY. Diagnostics expanded the t/1623 `lossy-error-boundary-guard` hook (p/9#23)** with a 2nd boundary **Family B** — `lib/debate/helpers.ts` (`parseAIJson`/`repairJson`) + `argumentNetwork.ts` extraction — genus-tailored checklist: don't drop a non-empty recoverable body to null; fall back to debater sketches; capture head+tail+truncation flag; flight-record before dropping. **Verified live + t/1623 closed (p/9#25, object-level, t/1623#3):** the compiled template (Family A + Family B + self-skip) is intact across **55 manifest snapshots** (was 0). Both Family-A blockers also landed — t/1620 (333a673d), t/1621 (cd020938). Liveness was confirmed via manifest presence + live-fire, NOT `has_run` (pattern #68).
- **(2) Behavioral — minimal, debate-local. TL ruled (p/8#75)** a ONE-line rule in **lib/debate/AGENTS.md** that must NOT restate ADR-001; **DebateTool landed it (p/70#5, overlay 31e0eeb):** the recovery-vs-silent-loss bullet — *a recovery that returns a sentinel (null/empty/default) while discarding a non-empty payload is a silent lossy failure, not recovery — record discarded bytes + surface.* The point-of-use hook stays the primary defense; the rule earns its keep only because hooks fire on enumerated sites, and this genus broadening signals enumeration will chase the tail.

**Applies To:** All AI backend/provider integration code — server `aiBackends.ts`, PS key-test cmdlets (`Test-AIApiKey`), debate-engine adapters, and any UsageID call site that surfaces provider errors.
