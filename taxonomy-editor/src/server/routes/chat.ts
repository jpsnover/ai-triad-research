// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2457 — POST /api/ai/chat-stream: multi-turn SSE chat with optional Gemini
// url_context grounding (t/2455 Stage 1). Depends on t/2456 for UrlContextMetadata
// type and the url_context tool contract.

import http from 'http';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { error, getClientIp } from '../httpKit.js';
import { callerTierIdentity, missingApiKeyError, clientSafeMessage } from '../security/accessControl.js';
import { getCurrentUser } from '../security/userContext.js';
import { log } from '../logger.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { DEFAULT_MODEL, generateViaGeminiStream } from '../../../../lib/ai-client/index.js';
import type { UrlContextMetadata, GeminiContent } from '../../../../lib/ai-client/index.js';
import * as proxyTiers from '../ai/proxyTiers.js';
import * as rateLimiter from '../security/rateLimiter.js';
import * as ai from '../ai/aiBackends.js';
import { getApiKeys, hasApiKey, type AIBackend } from '../config.js';

type ResolvedTier = ReturnType<typeof proxyTiers.resolveTier>;
type ChatMessage = { role: 'user' | 'model'; content: string };

/** Pure mirror of routes/ai.ts callerIdentity — ALS-verified context, not raw headers (t/848). */
function callerIdentity(): { principalName: string; idp: string } {
  return callerTierIdentity(getCurrentUser());
}

/** Pure mirror of routes/ai.ts resolveGenerationContext. */
function resolveGenerationContext(req: http.IncomingMessage, model: string | undefined): {
  tier: ResolvedTier; isFree: boolean; limitKey: string; effectiveModel: string | undefined; backend: AIBackend;
} {
  const { principalName, idp } = callerIdentity();
  const tier = proxyTiers.resolveTier(principalName, idp);
  const isFree = tier.level === 'free';
  const limitKey = isFree ? `free:${getClientIp(req)}` : (principalName || '_anonymous');
  const effectiveModel = isFree ? (tier.pinnedModel ?? model) : model;
  const backend = ai.resolveBackend(effectiveModel || DEFAULT_MODEL);
  return { tier, isFree, limitKey, effectiveModel, backend };
}

/** Pure mirror of routes/ai.ts resolveExplicitAiKey. */
function resolveExplicitAiKey(
  res: http.ServerResponse, tier: ResolvedTier, clientKey: string | undefined, backend: AIBackend,
): { ok: true; key: string | string[] | undefined } | { ok: false } {
  if (tier.serverProvidedKey) {
    const freeKeys = proxyTiers.parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY);
    if (freeKeys.length === 0) { res.writeHead(503); res.end(JSON.stringify({ error: 'Free tier is not available' })); return { ok: false }; }
    return { ok: true, key: freeKeys.length === 1 ? freeKeys[0] : freeKeys };
  }
  let explicitKey: string | string[] | undefined = tier.level === 'platform' ? undefined : (clientKey || undefined);
  explicitKey = explicitKey ?? proxyTiers.byokGeminiFallbackKey(tier.level, backend, explicitKey);
  return { ok: true, key: explicitKey };
}

/** Write one SSE event. No-op when the response is already closed (client disconnect). */
function writeSse(res: http.ServerResponse, payload: Record<string, unknown>): void {
  if (res.writableEnded) return;
  try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* client disconnected */ }
}

export function registerChatRoutes(r: Router, _ctx: ServerCtx): void {
  const { post } = r;

  // Multi-turn SSE chat streaming. Accepts `urlContext: true` to enable Gemini's
  // url_context tool (t/2456). Non-Gemini backends fall back to a non-streaming
  // single-chunk SSE response. Auth guards mirror /api/ai/generate (t/848).
  post('/api/ai/chat-stream', async (req, res, body) => {
    const {
      systemInstruction = '',
      messages = [],
      model,
      temperature,
      apiKey: clientKey,
      urlContext = false,
    } = body as {
      systemInstruction?: string;
      messages?: ChatMessage[];
      model?: string;
      temperature?: number;
      apiKey?: string;
      urlContext?: boolean;
    };

    try {
      const { tier, isFree, limitKey, effectiveModel, backend } = resolveGenerationContext(req, model);

      if (!proxyTiers.isBackendAllowed(tier, backend)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Backend '${backend}' not available on your tier`, tier_level: tier.level }));
        return;
      }

      // Rate limits: RPM + daily token budget (mirrors /api/ai/generate).
      const rpmCheck = isFree
        ? rateLimiter.checkRate(limitKey, tier.limits.requestsPerMinute, 60_000)
        : rateLimiter.checkRequestRate(limitKey, tier.limits.requestsPerMinute);
      if (!rpmCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded', limitType: 'requests_per_minute', retryAfterMs: rpmCheck.retryAfterMs }));
        return;
      }
      const tokenCheck = rateLimiter.checkTokenLimit(limitKey, tier.limits.tokensPerDay);
      if (!tokenCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Daily token limit exceeded', limitType: 'tokens_per_day' }));
        return;
      }

      const keyResult = resolveExplicitAiKey(res, tier, clientKey, backend);
      if (!keyResult.ok) return;
      const explicitKey = keyResult.key;

      // 422 fast-fail when there is no usable key for the backend (t/896 pattern).
      const haveExplicitKey = (typeof explicitKey === 'string' && explicitKey.length > 0)
        || (Array.isArray(explicitKey) && explicitKey.length > 0);
      const missingKey = missingApiKeyError({
        backend,
        displayName: backend,
        serverProvidedKey: !!tier.serverProvidedKey,
        haveExplicitKey,
        hasResolvedKey: haveExplicitKey || (!tier.serverProvidedKey && await hasApiKey(backend)),
      });
      if (missingKey) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(missingKey));
        return;
      }

      // Resolve concrete API key string(s). Platform tier uses server-configured keys.
      const rawKeys: string[] = typeof explicitKey === 'string'
        ? [explicitKey]
        : Array.isArray(explicitKey) ? explicitKey : await getApiKeys(backend);
      const apiKey = rawKeys[0];
      if (!apiKey) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No API key available for backend' }));
        return;
      }

      const requestModel = effectiveModel || DEFAULT_MODEL;
      const t0 = Date.now();
      getGlobalRecorder()?.record({
        type: 'ai.request', component: 'ai-chat-stream', level: 'info',
        message: `chat-stream ${backend}/${requestModel}`,
        data: { model: requestModel, backend, tier: tier.level, urlContext, messageCount: messages.length },
      });

      // Commit SSE headers — no JSON error responses after this point.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const effectiveTemperature = temperature ?? 0.7;

      if (backend === 'gemini') {
        await streamGeminiChat(res, {
          messages: messages as ChatMessage[],
          systemInstruction: systemInstruction as string,
          apiModelId: ai.getResolvedApiModelId(requestModel),
          apiKey,
          temperature: effectiveTemperature,
          urlContext: urlContext as boolean,
        });
      } else {
        // Non-Gemini: non-streaming fallback — stream as single synthetic chunk.
        const combinedPrompt = [
          systemInstruction && `System: ${systemInstruction}`,
          ...(messages as ChatMessage[]).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`),
        ].filter(Boolean).join('\n\n');
        const result = await ai.generateTextByUsage(
          'server.chat-stream', { prompt: combinedPrompt },
          { ...(effectiveModel ? { model: effectiveModel } : {}), temperature: effectiveTemperature },
          undefined, explicitKey,
        );
        writeSse(res, { type: 'chunk', text: result.text });
        writeSse(res, { type: 'done', fullText: result.text });
      }

      getGlobalRecorder()?.record({
        type: 'ai.response', component: 'ai-chat-stream', level: 'info',
        duration_ms: Date.now() - t0,
        message: `chat-stream success ${backend}/${requestModel}`,
        data: { model: requestModel, backend, urlContext },
      });

    } catch (err) {
      log.server.error({ component: 'ai-chat-stream', err }, 'chat-stream failed');
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'ai-chat-stream', level: 'error',
        message: `chat-stream failed: ${String(err)}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      if (res.headersSent) {
        writeSse(res, { type: 'error', message: clientSafeMessage(String(err)), code: 'SERVER_ERROR' });
      } else {
        error(res, String(err), 500, err);
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
}

/** Multi-turn Gemini SSE streaming with optional url_context grounding (t/2457).
 *  Delegates SSE parsing to generateViaGeminiStream (t/2456) via geminiContents option
 *  (t/2456#3). Emits chunk→chat-stream-url-metadata→done per t/2458#2 contract. */
async function streamGeminiChat(
  res: http.ServerResponse,
  opts: {
    messages: ChatMessage[];
    systemInstruction: string;
    apiModelId: string;
    apiKey: string;
    temperature: number;
    urlContext: boolean;
  },
): Promise<void> {
  const { messages, systemInstruction, apiModelId, apiKey, temperature, urlContext } = opts;
  const geminiContents: GeminiContent[] = messages.map(m => ({ role: m.role, parts: [{ text: m.content }] }));

  let fullText = '';
  let urlContextMetadata: UrlContextMetadata | undefined;

  try {
    const result = await generateViaGeminiStream(
      fetch,
      '',
      apiModelId,
      apiKey,
      {
        timeoutMs: 120_000,
        temperature,
        urlContext,
        geminiContents,
        systemMessage: systemInstruction || undefined,
      },
      (chunk) => {
        fullText += chunk;
        writeSse(res, { type: 'chunk', text: chunk });
      },
    );
    urlContextMetadata = result.urlContextMetadata;
  } catch (streamErr) {
    writeSse(res, { type: 'error', message: clientSafeMessage(String(streamErr)), code: 'STREAM_ERROR' });
    return;
  }

  if (urlContextMetadata) {
    writeSse(res, { type: 'chat-stream-url-metadata', urlContextMetadata });
  }
  writeSse(res, { type: 'done', fullText });
}
