// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1687 (Phase 2 server.ts split, ADR-007): the auth-logout / AI-generation /
// proxy-info / embeddings+NLI route run, moved verbatim out of server.ts behind
// the registration seam. This run sits between registerKeysRoutes and
// registerDebatesRoutes, so registration order — and the routeTable snapshot —
// is preserved by placing registerAiRoutes() at its former position.
//
// The run's module-level helpers move in with it: FRESH_LOGIN_PROVIDERS,
// callerIdentity, BACKEND_DISPLAY, freeTierEmbeddingGate. callerIdentity and
// parseCookies are PURE mirrors of the server.ts helpers (they depend only on
// imports, hold no state) — duplicated here so this run needs no ServerCtx
// surface; server.ts keeps its own copies for the routes that stay behind.

import http from 'http';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param, getClientIp, withEndpointTimeout } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { callerTierIdentity, missingApiKeyError, expiredAuthCookies } from '../security/accessControl.js';
import { getCurrentUser } from '../security/userContext.js';
import { log, getRequestContext } from '../logger.js';
import { DEFAULT_MODEL } from '../../../../lib/ai-client/index.js';
import { hasApiKey, getPaidGeminiFallbackKey, type AIBackend } from '../config.js';
import * as proxyTiers from '../ai/proxyTiers.js';
import * as rateLimiter from '../security/rateLimiter.js';
import * as ai from '../ai/aiBackends.js';
import * as fileIO from '../storage/fileIO.js';

// Pure mirror of the server.ts parseCookies helper (used by the logout /
// fresh-login handlers). Depends only on the request headers; holds no state.
function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
}

/**
 * t/848: resolve the caller's identity from the verified ALS user context (set
 * once by the S9 middleware from AZURE_AUTH_ENABLED-guarded headers) — NEVER by
 * re-reading raw x-ms-client-principal-* headers, which are spoofable when the
 * container is reachable without Easy Auth (direct ingress / misconfig). An
 * anonymous caller maps to '' so resolveTier yields the free/anonymous tier
 * (the free tier keys on an empty principal), never platform.
 */
function callerIdentity(): { principalName: string; idp: string } {
  return callerTierIdentity(getCurrentUser());
}

// t/896: user-facing provider names for the missing_api_key fast-fail message.
// t/1959: keyed off the ApiKeyBackend union (AIBackend re-export) so omitting a
// backend is a COMPILE error, not a runtime fall-through to the raw backend id.
// Labels mirror ai-models.json (the single source of truth for provider names).
const BACKEND_DISPLAY: Record<AIBackend, string> = {
  gemini: 'Gemini', claude: 'Claude (Anthropic)', groq: 'Groq',
  openai: 'OpenAI', deepseek: 'DeepSeek', tavily: 'Tavily', ollama: 'Ollama',
  azure: 'Azure OpenAI', zai: 'Z.AI (GLM)', moonshot: 'Moonshot (Kimi)',
};

export function registerAiRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, post } = r;

  // t/897: Easy Auth's /.auth/logout left AppServiceAuthSession valid, so "Sign
  // Out" didn't terminate the session (next browser user inherited it). This GET
  // (browser navigates here) expires every Easy Auth session cookie present, then
  // hands off to /.auth/logout with a post-logout redirect home. Provider-agnostic
  // (same session cookie for GitHub/Google). The client links here, not /.auth/logout.
  get('/api/auth/logout', (req, res) => {
    res.writeHead(302, {
      'Set-Cookie': expiredAuthCookies(Object.keys(parseCookies(req))),
      'Location': '/.auth/logout?post_logout_redirect_uri=/',
    });
    res.end();
  });

  // t/1032: defense-in-depth fresh sign-in. The Workbox service worker serves the
  // cached SPA for navigations to '/', so t/940's stale-cookie clearing in the
  // server-rendered login page never runs for returning users. Routing the SPA's
  // sign-in links through here expires any stale Easy Auth session cookie BEFORE
  // initiating OAuth, so every attempt starts from a clean state regardless of SW
  // cache. Provider is allowlisted — it's interpolated into the redirect target.
  const FRESH_LOGIN_PROVIDERS = new Set(['github', 'google', 'aad']);
  get('/api/auth/fresh-login/:provider', (req, res) => {
    const provider = param(req, 'provider', '/api/auth/fresh-login/:provider');
    const location = FRESH_LOGIN_PROVIDERS.has(provider)
      ? `/.auth/login/${provider}?post_login_redirect_uri=/`
      : '/'; // unknown provider → land on the login page rather than an open redirect
    res.writeHead(302, {
      'Set-Cookie': expiredAuthCookies(Object.keys(parseCookies(req))),
      'Location': location,
    });
    res.end();
  });


  // ── AI generation ──

  post('/api/ai/generate', async (req, res, body) => {
    const { prompt, model, timeout, apiKey: clientKey, search, debateId } = body as { prompt: string; model?: string; timeout?: number; apiKey?: string; search?: boolean; debateId?: string };
    // t/966: stamp the debate client's debateId onto the request context so it lands
    // in the request-completion log (and every log line for this request) — debate
    // sessions become filterable in one query instead of correlating by user+time.
    if (typeof debateId === 'string' && debateId) {
      const rc = getRequestContext();
      if (rc) rc.debateId = debateId.slice(0, 64);
    }
    try {
      const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
      const tier = proxyTiers.resolveTier(principalName, idp);
      const isFree = tier.level === 'free';
      // Free tier (t/793): keyed per-IP (all keyless users would otherwise share
      // one bucket), with the model pinned and prompts capped. Other tiers key by
      // user and honour the requested model.
      const limitKey = isFree ? `free:${getClientIp(req)}` : (principalName || '_anonymous');
      const effectiveModel = isFree ? (tier.pinnedModel ?? model) : model;

      // Free-tier cost is bounded by tokensPerDay + per-IP rate limits; the
      // redundant per-prompt char cap was removed in t/812 (broke long debate
      // prompts: system instructions + soul docs + taxonomy context > 4000 chars).

      // Check backend is allowed
      const backend = ai.resolveBackend(effectiveModel || DEFAULT_MODEL);
      if (!proxyTiers.isBackendAllowed(tier, backend)) {
        // t/1463: record the tier context so a tier-restriction 403 is a one-line
        // FR read instead of a server.ts → proxyTiers → runtimeConfig code trace.
        getGlobalRecorder()?.record({
          type: 'ai.error', component: 'ai-generate', level: 'warn',
          message: `Backend '${backend}' not available on '${tier.level}' tier`,
          data: { tier_level: tier.level, requested_backend: backend, allowed_backends: tier.allowedBackends },
        });
        res.writeHead(403);
        res.end(JSON.stringify({ error: `Backend '${backend}' not available on your tier`, tier_level: tier.level, requested_backend: backend }));
        return;
      }

      // Rate limiting (per-IP sliding window for the free tier)
      const rpmCheck = isFree
        ? rateLimiter.checkRate(limitKey, tier.limits.requestsPerMinute, 60_000)
        : rateLimiter.checkRequestRate(limitKey, tier.limits.requestsPerMinute);
      if (!rpmCheck.allowed) {
        // t/924: rate-limit rejections were silent server-side — log + record so the
        // 429 is diagnosable (which limit, pool state, retry timing).
        log.server.warn({ component: 'rate-limiter', type: 'requests_per_minute', limitKey, limit: rpmCheck.limit, current: rpmCheck.current, retryAfterMs: rpmCheck.retryAfterMs, backend }, 'AI request rate-limited (RPM)');
        getGlobalRecorder()?.record({
          type: 'ai.error', component: 'rate-limiter', level: 'warn',
          message: `RPM limit reached (${rpmCheck.current}/${rpmCheck.limit})`,
          data: { type: 'requests_per_minute', limitKey, limit: rpmCheck.limit, current: rpmCheck.current, retryAfterMs: rpmCheck.retryAfterMs, backend, tier: tier.level },
        });
        res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit exceeded', limitType: 'requests_per_minute', retryAfterMs: rpmCheck.retryAfterMs, limit: rpmCheck.limit, current: rpmCheck.current })); return;
      }
      const tokenCheck = rateLimiter.checkTokenLimit(limitKey, tier.limits.tokensPerDay);
      if (!tokenCheck.allowed) {
        log.server.warn({ component: 'rate-limiter', type: 'tokens_per_day', limitKey, limit: tokenCheck.limit, current: tokenCheck.current, backend }, 'AI request rate-limited (daily tokens)');
        getGlobalRecorder()?.record({
          type: 'ai.error', component: 'rate-limiter', level: 'warn',
          message: `Daily token limit reached (${tokenCheck.current}/${tokenCheck.limit})`,
          data: { type: 'tokens_per_day', limitKey, limit: tokenCheck.limit, current: tokenCheck.current, backend, tier: tier.level },
        });
        res.writeHead(429); res.end(JSON.stringify({ error: 'Daily token limit exceeded', limitType: 'tokens_per_day', limit: tokenCheck.limit, current: tokenCheck.current })); return;
      }

      // Key injection: free tier uses the server's FREE_TIER_GEMINI_KEY; platform
      // users get server-side keys; BYOK users provide their own.
      let explicitKey: string | string[] | undefined;
      if (tier.serverProvidedKey) {
        // t/846: FREE_TIER_GEMINI_KEY may be a comma-separated list; >1 key
        // round-robins across server keys via callWithKeyRotation in generateText.
        const freeKeys = proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY);
        if (freeKeys.length === 0) { res.writeHead(503); res.end(JSON.stringify({ error: 'Free tier is not available' })); return; }
        explicitKey = freeKeys.length === 1 ? freeKeys[0] : freeKeys;
      } else {
        explicitKey = tier.level === 'platform' ? undefined : (clientKey || undefined);
        // t/945: a BYOK user with no key for the requested backend (e.g. Claude-only,
        // hitting the Gemini-pinned BRIEF/CITE helper stages) falls back to the
        // free-tier Gemini pool instead of a 422. Per-user rate limiting (limitKey =
        // principal, not free:IP) still bounds it.
        explicitKey = explicitKey ?? proxyTiers.byokGeminiFallbackKey(tier.level, backend, explicitKey);
      }

      // t/896: fail fast with a clear, actionable error when there is no usable key
      // for the target backend — before the request reaches the AI adapter (which
      // would otherwise surface an opaque upstream 401/403). Free tier
      // (server-provided key) is exempt, and t/945 resolves a free-tier Gemini key
      // above for Claude-only BYOK users. hasApiKey() only finds a *deployed*
      // GEMINI_API_KEY/AI_API_KEY — prod sets neither (only FREE_TIER_GEMINI_KEY),
      // so env-backed Gemini does NOT save a BYOK user here.
      const haveExplicitKey = (typeof explicitKey === 'string' && explicitKey.length > 0)
        || (Array.isArray(explicitKey) && explicitKey.length > 0);
      const missingKey = missingApiKeyError({
        backend,
        displayName: BACKEND_DISPLAY[backend] ?? backend,
        serverProvidedKey: !!tier.serverProvidedKey,
        haveExplicitKey,
        hasResolvedKey: haveExplicitKey || (!tier.serverProvidedKey && await hasApiKey(backend)),
      });
      if (missingKey) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(missingKey));
        return;
      }

      // t/839: record the AI request/response on the happy path so the web-mode
      // retry timeline is visible in the flight recorder (mirrors lib/debate
      // aiAdapter). Prompt content is never recorded — only its length.
      const requestModel = effectiveModel ?? DEFAULT_MODEL;
      const t0 = Date.now();
      getGlobalRecorder()?.record({
        type: 'ai.request', component: 'ai-generate', level: 'info',
        message: `generate ${backend}/${requestModel}`,
        data: { model: requestModel, backend, tier: tier.level, promptLength: prompt?.length ?? 0, debateId },
      });

      const usageOverrides = {
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(timeout ? { timeoutMs: timeout } : {}),
      };

      if (search) {
        const result = await ai.generateTextWithSearchByUsage('server.search', { prompt }, effectiveModel ? { model: effectiveModel } : undefined, explicitKey);

        getGlobalRecorder()?.record({
          type: 'ai.response', component: 'ai-generate', level: 'info',
          duration_ms: Date.now() - t0,
          message: `generate+search success ${backend}/${requestModel}`,
          data: { model: requestModel, backend, responseLength: result.text?.length ?? 0, search: true },
        });

        json(res, result);
      } else {
        let result: Awaited<ReturnType<typeof ai.generateText>>;
        try {
          result = await ai.generateTextByUsage('server.chat-response', { prompt }, usageOverrides, undefined, explicitKey);
        } catch (genErr) {
          // t/948: paid Gemini fallback for the free tier. When the entire free pool
          // is rate-limited (upstream 429), retry once with the admin-registered paid
          // key after a deliberate 3s throttle. The paid key never enters the
          // round-robin pool; free keys recover on their own as cooldowns expire
          // (design: docs/design/paid-gemini-fallback.md).
          const paidKey = (ai.is429Error(genErr) && isFree) ? await getPaidGeminiFallbackKey() : null;
          if (!paidKey) throw genErr; // non-free, non-429, or no paid key → outer 429 mapping records it
          getGlobalRecorder()?.record({
            type: 'ai.fallback', component: 'ai-generate', level: 'info',
            message: 'Free-tier keys exhausted — waiting 3s before paid fallback',
            data: { model: requestModel, backend, fallback: 'paid', delayMs: 3000, freeKeyCount: proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY).length },
          });
          // Throttle: caps paid-key throughput (~20/min) and gives free keys time to
          // exit cooldown so the next request reverts to the free pool.
          await new Promise(r => setTimeout(r, 3000));
          try {
            result = await ai.generateTextByUsage('server.chat-response:paid-fallback', { prompt }, usageOverrides, undefined, paidKey);
            getGlobalRecorder()?.record({
              type: 'ai.response', component: 'ai-generate', level: 'info', duration_ms: Date.now() - t0,
              message: `Paid fallback succeeded for ${backend}/${requestModel}`,
              data: { model: requestModel, backend, fallback: 'paid', delayMs: 3000, responseLength: result.text?.length ?? 0 },
            });
          } catch (fallbackErr) {
            getGlobalRecorder()?.record({
              type: 'ai.error', component: 'ai-generate', level: 'warn',
              message: 'Paid fallback also failed',
              data: { model: requestModel, backend, fallback: 'paid', delayMs: 3000 },
              error: { name: (fallbackErr as Error).name ?? 'Error', message: String(fallbackErr), stack: (fallbackErr as Error).stack },
            });
            throw genErr; // both pools exhausted → outer catch maps to a 429 for the client
          }
        }

        getGlobalRecorder()?.record({
          type: 'ai.response', component: 'ai-generate', level: 'info',
          duration_ms: Date.now() - t0,
          message: `generate success ${backend}/${requestModel}`,
          data: { model: requestModel, backend, responseLength: result.text?.length ?? 0, usage: result.tokenUsage },
        });

        if (result.tokenUsage) {
          const milestone = rateLimiter.recordTokenUsage(limitKey, result.tokenUsage.inputTokens, result.tokenUsage.outputTokens, tier.limits.tokensPerDay);
          if (milestone != null) {
            // t/1132: surface the crossed daily-budget threshold (50/80/95) so the
            // renderer's web-bridge post() can show a dismissable quota banner. The
            // reset is the UTC-midnight boundary the daily token buckets key on.
            res.setHeader('X-Token-Budget-Warning', String(milestone));
            res.setHeader('X-Token-Budget-Resets', rateLimiter.nextDailyResetUtc());
          }
        }

        json(res, { text: result.text, tokenUsage: result.tokenUsage });
      }
    } catch (err) {
      // t/920: an upstream provider rate-limit (common when 3 opening statements
      // fire concurrently on a single free-tier key) was collapsing into an opaque,
      // non-retryable HTTP 500. Surface it as a retryable 429 with Retry-After so the
      // debate flow can back off + retry instead of treating it as a fatal error.
      // t/997: Gemini surfaces a too-long context window as RESOURCE_EXHAUSTED, which
      // would otherwise be misread as a 429. It's a 400-class error (retrying won't
      // help) — return context_too_long so the client shows the right message.
      if (ai.isContextTooLongError(err)) {
        log.server.warn({ component: 'ai-generate', model: model ?? 'default' }, 'AI generate input exceeds model context window');
        getGlobalRecorder()?.record({
          type: 'ai.error', component: 'ai-generate', level: 'warn',
          message: 'AI generate input too long for model context window',
          data: { model: model ?? 'default', source: 'context_overflow' },
        });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'context_too_long', message: 'Input exceeds the model context window — try a shorter prompt or a model with a larger context window' }));
        return;
      }
      if (ai.is429Error(err)) {
        const retry = ai.retryAfterMs(err);
        log.server.warn({ component: 'ai-generate', model: model ?? 'default', retryAfterMs: retry }, 'AI generate upstream rate-limited — returning 429');
        getGlobalRecorder()?.record({
          type: 'ai.error', component: 'ai-generate', level: 'warn',
          message: 'AI generate upstream rate-limited',
          data: { model: model ?? 'default', retryAfterMs: retry, source: 'upstream' },
        });
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retry / 1000))));
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream AI provider rate limit — retry shortly', limitType: 'upstream_rate_limit', retryAfterMs: retry, retryable: true }));
        return;
      }
      // t/1362: also log at error level via Pino so the 500 is visible in
      // `az containerapp logs show` — the FR record alone requires a browser-
      // triggered dump, which may be impossible if the UI is broken.
      log.server.error({ component: 'ai-generate', model: model ?? 'default', err }, 'AI generate failed');
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'ai-generate', level: 'error',
        message: `AI generate failed: ${String(err)}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        data: { model: model ?? 'default', promptLength: prompt?.length },
      });
      error(res, String(err), 500, err);
    }
  });

  post('/api/ai/search', async (_req, res, body) => {
    const { prompt, model } = body as { prompt: string; model?: string };
    try {
      json(res, await ai.generateTextWithSearchByUsage('server.search', { prompt }, model ? { model } : undefined));
    } catch (err) {
      if (ai.isContextTooLongError(err)) {
        log.server.warn({ component: 'ai-search', model: model ?? 'default' }, 'AI search input exceeds model context window');
        getGlobalRecorder()?.record({
          type: 'ai.error', component: 'ai-search', level: 'warn',
          message: 'AI search input too long for model context window',
          data: { model: model ?? 'default', source: 'context_overflow' },
        });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'context_too_long', message: 'Input exceeds the model context window — try a shorter prompt or a model with a larger context window' }));
        return;
      }
      if (ai.is429Error(err)) {
        const retry = ai.retryAfterMs(err);
        log.server.warn({ component: 'ai-search', model: model ?? 'default', retryAfterMs: retry }, 'AI search upstream rate-limited — returning 429');
        getGlobalRecorder()?.record({
          type: 'ai.error', component: 'ai-search', level: 'warn',
          message: 'AI search upstream rate-limited',
          data: { model: model ?? 'default', retryAfterMs: retry, source: 'upstream' },
        });
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retry / 1000))));
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream AI provider rate limit — retry shortly', limitType: 'upstream_rate_limit', retryAfterMs: retry, retryable: true }));
        return;
      }
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'ai-search', level: 'error',
        message: `AI search failed: ${String(err)}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        data: { model: model ?? 'default', promptLength: prompt?.length },
      });
      error(res, String(err), 500, err);
    }
  });

  // ── Proxy info endpoints ──

  // t/772: backends that are BOTH key-configured AND tier-authorized. The
  // multi-provider debate UI uses this instead of per-backend /api/keys/has, which
  // only checks key presence and let it assign models to backends that 403 at
  // generation time. Cheap: tier config is cached (proxyTiers), the model registry
  // is static, and keyStore.get is cached with bust-on-write — no new cache needed.
  get('/api/backends/available', async (_req, res) => {
    try {
      const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
      const tier = proxyTiers.resolveTier(principalName, idp);
      const registry = await fileIO.loadAIModels() as { backends?: { id: string }[]; models?: { id: string; backend: string }[] };
      const ids = (registry.backends ?? []).map(b => b.id);
      const keyPresence: Record<string, boolean> = {};
      await Promise.all(ids.map(async (id) => { keyPresence[id] = await hasApiKey(id as AIBackend); }));
      json(res, { backends: ai.computeAvailableBackends(registry, tier.allowedBackends, keyPresence) });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'server', level: 'error',
        message: 'Failed to compute backend availability',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), 500, err);
    }
  });

  get('/api/proxy/tier', (_req, res) => {
    const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
    const tier = proxyTiers.resolveTier(principalName, idp);
    json(res, { ...tier, principalName: principalName || null });
  });

  get('/api/proxy/usage', (_req, res) => {
    const { principalName, idp } = callerIdentity(); // t/848: verified context, not raw headers
    const userId = principalName || '_anonymous';
    const tier = proxyTiers.resolveTier(principalName, idp);
    const usage = rateLimiter.getUsage(userId);
    json(res, { tier: tier.level, limits: tier.limits, usage });
  });

  post('/api/ai/temperature', (_req, res, body) => {
    const { temp } = body as { temp: number | null };
    const previous = ai.getDebateTemperature();
    ai.setDebateTemperature(temp);
    log.api.info({ component: 'ai-config', previous, temp }, 'Debate temperature changed');
    getGlobalRecorder()?.record({
      type: 'lifecycle', component: 'ai-config', level: 'info',
      message: 'Debate temperature changed',
      data: { previous, temp },
    });
    json(res, { ok: true });
  });

  // ── Embeddings & NLI ──

  // t/1062 / t/1171: shared free-tier gate for the embeddings routes. For free-tier
  // callers (anonymous, server-provided key) it enforces the per-IP RPM + daily-token
  // limits — writing a 429 and returning { blocked: true } if exceeded — and resolves
  // the server free-tier key. Non-free callers pass through with no key (unchanged).
  function freeTierEmbeddingGate(req: http.IncomingMessage, res: http.ServerResponse): { blocked: boolean; key?: string } {
    const { principalName, idp } = callerIdentity();
    const tier = proxyTiers.resolveTier(principalName, idp);
    if (tier.level !== 'free') return { blocked: false };
    const limitKey = `free:${getClientIp(req)}`;
    const rpmCheck = rateLimiter.checkRate(limitKey, tier.limits.requestsPerMinute, 60_000);
    if (!rpmCheck.allowed) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'Rate limit exceeded', limitType: 'requests_per_minute', retryAfterMs: rpmCheck.retryAfterMs, limit: rpmCheck.limit, current: rpmCheck.current }));
      return { blocked: true };
    }
    const tokenCheck = rateLimiter.checkTokenLimit(limitKey, tier.limits.tokensPerDay);
    if (!tokenCheck.allowed) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'Daily token limit exceeded', limitType: 'tokens_per_day', limit: tokenCheck.limit, current: tokenCheck.current }));
      return { blocked: true };
    }
    const key = tier.serverProvidedKey ? proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY)[0] : undefined;
    return { blocked: false, key };
  }

  post('/api/embeddings/compute', (req, res, body) => withEndpointTimeout(res, 50_000, 'embeddings-compute', async () => {
    const { texts, ids } = body as { texts: string[]; ids?: string[] };
    try {
      const gate = freeTierEmbeddingGate(req, res);
      if (gate.blocked) return;
      const vectors = await ai.computeEmbeddings(texts, ids, gate.key);
      json(res, { vectors });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to compute embeddings', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  }));

  // t/1171: same free-tier exemption + rate limiting + key as /compute, so anonymous
  // semantic search finishes the cheap query-embedding step (not just the corpus one).
  post('/api/embeddings/query', (req, res, body) => withEndpointTimeout(res, 35_000, 'embeddings-query', async () => {
    const { text } = body as { text: string };
    try {
      const gate = freeTierEmbeddingGate(req, res);
      if (gate.blocked) return;
      const vector = await ai.computeQueryEmbedding(text, gate.key);
      json(res, { vector });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to compute query embedding', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  }));

  post('/api/embeddings/update-nodes', async (_req, res, body) => {
    const { nodes } = body as { nodes: { id: string; text: string; pov: string; exclusionText?: string }[] };
    try {
      await ai.updateNodeEmbeddings(nodes);
      json(res, { ok: true });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to update node embeddings', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  post('/api/nli/classify', (req, res, body) => withEndpointTimeout(res, 35_000, 'nli-classify', async () => {
    const { pairs } = body as { pairs: { text_a: string; text_b: string }[] };
    try {
      // t/1650: resolve a per-request BYOK/free-tier key (same gate as embeddings) so the
      // hosted-LLM fallback in classifyNli has a key once the local Python venv is removed
      // (t/1642). Local Python stays primary; the key is only consumed on fallback. BYOK —
      // key rides the request, never baked, never logged.
      const gate = freeTierEmbeddingGate(req, res);
      if (gate.blocked) return;
      const results = await ai.classifyNli(pairs, gate.key);
      json(res, { results });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to classify NLI pairs', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  }));
}
