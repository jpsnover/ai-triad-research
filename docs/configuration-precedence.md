# Configuration Precedence — Model Resolution

**Last updated:** 2026-07-03 · **Author:** Technical Lead (repo-review B-208)
**Scope:** answers "which model will this AI call actually use?" for every entry path, with the exact code-verified resolution order. See FINDINGS.md F-018 for the full 14-mechanism config census. ADR-006 defines what belongs in `ai-usages.json` (routing/params) vs code (prompt text).

## The one-paragraph answer

There is no single global precedence — there are **four entry paths with four different orders**, by design. Server requests are tier-gated (free tier is pinned regardless of what anyone asks for); the debate engine is config-frozen at initialization; PowerShell honors explicit overrides above all; the renderer's stored choice is advisory and can be silently overridden server-side. The tables below are the authority; every step is file:line-verified as of 2026-07-03.

## Path 1 — Server request (`POST /api/ai/generate` and kin)

| Order | Source | Where |
|---|---|---|
| 1 | **`tier.pinnedModel`** — free tier only; wins over everything | `server.ts:1247`; from `runtimeConfig.ts:152` (`{dataRoot}/admin/runtime-config.json` → `tiers.free.pinnedModel`, hot-reloaded, default `gemini-flash-lite-latest`) |
| 2 | Request-body `model` param (paid/BYOK tiers) | `server.ts:1231,1247` |
| 3 | `DEFAULT_MODEL` constant | `lib/ai-client/defaults.ts:4` (`gemini-flash-lite-latest`) |
| then | UsageID merge: caller `overrides` > `ai-usages.json` entry fields | `aiBackends.ts:514-515` |
| gate | `proxyTiers` `allowedBackends` — gates the backend, doesn't select the model (free = gemini only) | `proxyTiers.ts:149,255` |

**Deliberate behavior to know:** a free-tier user's UI model choice is accepted by the renderer, sent to the server, and **silently replaced** by `pinnedModel`. This is cost control, not a bug; the substitution is recorded in the flight recorder (`server.ts:1328-1334`).

## Path 2 — Debate engine (`lib/debate`)

The engine **never** reads localStorage, request params, or env vars — the model is frozen into `DebateConfig` at initialization by the caller. Resolution inside the engine:

| Order | Source | Where |
|---|---|---|
| 1 | Per-stage override `config.stageModels[stage]` (brief/plan/draft/cite/evaluator/scope/summary/moderator/crux) | `debateEngine.ts:644` |
| 2 | Per-speaker override `config.speakerModels[speaker]` | `debateEngine.ts:1272-1274` |
| 3 | `config.model` (required — throws if absent) | `debateEngine.ts:1233` |
| failover | `config.fallbackChain` then `config.model`, all filtered by `config.maxModelId` cost ceiling | `debateEngine.ts:1276-1289` |
| via UsageID | `generateViaUsage` uses the `ai-usages.json` entry when `usageDeps` present; falls back to plain `generate()` otherwise | `debateEngine.ts:1251-1270` |

Who populates `DebateConfig`: the renderer (`useDebateStore.debateModel` → `getConfiguredModel()`, `helpers.ts:304-314`), the CLI, or `Show-TriadDialogue` — i.e., the *caller's* path determines the initial model, then the engine is deterministic.

## Path 3 — PowerShell (`Invoke-AIByUsage`)

| Order | Source | Where |
|---|---|---|
| 1 | `-Override @{ model = ... }` — absolute precedence | `Invoke-AIByUsage.ps1:82-84` |
| 2 | `ai-usages.json` entry `model` (via `Get-UsageConfig`, `_extends` resolved) | `Invoke-AIByUsage.ps1:79,123` |
| 3 | `Invoke-AIApi` parameter default (`gemini-2.5-flash`) — rare | `AIEnrich.psm1:313` |
| failover | explicit `-FallbackModels`, else `ai-models.json` `fallbackChains[model]` — entered only on API failure (429/503/529/401/403) | `AIEnrich.psm1:622-625` |

**Correction to folklore:** `$env:AI_MODEL` is **not** consulted for model selection in the UsageID path — env vars supply API keys only (`Resolve-AIApiKey`). (Legacy direct `Invoke-AIApi` callers passing their own `-Model` remain unaffected.)

## Path 4 — Renderer / Electron

| Order | Source | Where |
|---|---|---|
| 1 | Debate-specific: `useDebateStore.debateModel` | `useDebateStore/helpers.ts:304-310` |
| 2 | localStorage `taxonomy-editor-gemini-model` (validated against server-loaded `ALL_MODEL_IDS`) | `settingsSlice.ts:129-138` |
| 3 | `DEFAULT_MODELS[backend]` (backend from localStorage `taxonomy-editor-ai-backend`, default gemini) | `settingsSlice.ts:105-137` |
| 4 | `DEFAULT_MODEL` constant | `defaults.ts:4` |
| then | the chosen model is *sent* to the server (web build) or main process (Electron) — **web-build requests re-enter Path 1**, where free tier overrides it |

## Known sharp edges

1. **Free-tier UI/server disagreement (intentional):** renderer shows the user's stored choice; server substitutes `pinnedModel`. If a user reports "it's not using the model I picked," check their tier first.
2. **Misnamed localStorage key:** `taxonomy-editor-gemini-model` stores models from *any* backend (claude/groq included), not just Gemini. Don't infer backend from the key name.
3. **Debate ≠ server precedence:** `tier.pinnedModel` does not reach the debate engine's internal failover; free-tier debate cost control happens at the entry point that builds `DebateConfig`, not inside the engine.
4. **`fallbackChains` are failover, not selection:** in every path, `ai-models.json` chains only engage after an API error — they never pick the first model.

## Change guidance

- Change a model **for one usage everywhere** → edit that entry in `ai-usages.json` (ADR-006).
- Change the **free-tier pinned model** → `{dataRoot}/admin/runtime-config.json` `tiers.free.pinnedModel` (hot-reloads; also settable via `Set-TriadConfig` remote admin).
- Change **failover behavior** → `ai-models.json` `fallbackChains`.
- Change the **hard default** → `lib/ai-client/defaults.ts` `DEFAULT_MODEL` (affects Paths 1, 4) *and* `AIEnrich.psm1:313` (Path 3) — these are independent constants; keep them aligned.
