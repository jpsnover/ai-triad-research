// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../debate/errors.js';
import type { RateLimitType, RateLimitHeaders, RetryProgress, FetchFn } from './types.js';

// t/2719: hard ceiling on a single AI-response body before we buffer + JSON.parse it.
// This is the shared text-generation fetch path (op-ed voices, debate, NLI, chat);
// embeddings run through a separate Python-subprocess path with its own maxBuffer, so
// nothing legitimate here is more than KB-range. 25 MiB is far above any real response
// yet well under what would OOM the process — a runaway payload is rejected, not parsed.
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

/**
 * Creates a per-attempt AbortSignal that fires on whichever comes first:
 * the caller's signal or the per-attempt timeout. Replacing Promise.race
 * (withTimeout on fetch) ensures the losing fetch is actually cancelled
 * rather than left running in the background (t/2507).
 */
export function makeFetchSignal(timeoutMs: number, callerSignal?: AbortSignal): AbortSignal {
  return callerSignal
    ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}

/** Sleeps for ms, but wakes early and throws AbortError when signal fires. */
async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise<void>((resolve, reject) => {
    const tid = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(tid);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function parseRateLimitType(bodyText: string): { limitType: RateLimitType; limitMessage: string } {
  try {
    const json = JSON.parse(bodyText);
    const msg: string = json?.error?.message ?? '';
    const lower = msg.toLowerCase();
    if (lower.includes('per minute') || lower.includes('rpm'))
      return { limitType: 'RPM', limitMessage: 'Requests per minute quota exceeded. Retry should succeed in under a minute.' };
    if (lower.includes('tokens per minute') || lower.includes('tpm'))
      return { limitType: 'TPM', limitMessage: 'Tokens per minute quota exceeded. Retry should succeed in under a minute.' };
    if (lower.includes('per day') || lower.includes('rpd'))
      return { limitType: 'RPD', limitMessage: 'Daily request quota exceeded. Try a lighter model, or wait until quota resets (usually midnight PT).' };
    if (msg) return { limitType: 'unknown', limitMessage: msg };
  } catch { /* not JSON */ }
  return { limitType: 'unknown', limitMessage: 'Rate limited by API. Retrying with exponential backoff.' };
}

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
  const result: RateLimitHeaders = {};

  const retryAfter = headers.get('retry-after');
  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      result.retryAfterSeconds = seconds;
    } else {
      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        result.retryAfterSeconds = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
      }
    }
  }

  const remaining = headers.get('x-ratelimit-remaining');
  if (remaining != null) {
    const n = Number(remaining);
    if (!Number.isNaN(n)) result.remaining = n;
  }

  const reset = headers.get('x-ratelimit-reset');
  if (reset != null) {
    const n = Number(reset);
    if (!Number.isNaN(n)) result.resetAtEpochSeconds = n;
  }

  return result;
}

export interface RetryConfig {
  maxRetries: number;
  strategy: 'fixed' | 'exponential';
  fixedDelays?: number[];
  maxBackoffS?: number;
  /** Separate, LOW cap on RATE-LIMIT (429) attempts (t/3232). On the ingress-bound SERVER path a
   *  rate-limited generate must surface a retryable 429 FAST (routes/ai.ts maps it) rather than sleep
   *  through ~480s of 120s-floor retries and blow the ACA ingress timeout into an opaque 500. Unset →
   *  falls back to `maxRetries` (CLI keeps its full "wait for quota" budget, unchanged). */
  rateLimitMaxAttempts?: number;
  /** Cap (seconds) on each rate-limit sleep AND on a respected server `Retry-After` (t/3232). Unset →
   *  the `RATE_LIMIT_MIN_DELAY_S` floor. The SERVER sets this low so neither the floor nor a long
   *  provider Retry-After can hold ingress — the 429 surfaces and is converted to a fast 429. */
  rateLimitMaxSleepS?: number;
}

export const CLI_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  strategy: 'exponential',
  maxBackoffS: 60,
};

export const SERVER_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  strategy: 'exponential',
  maxBackoffS: 30,
  // t/3232: the server path is ACA-ingress-bound. Cap rate-limit retries so a 429 surfaces as a
  // retryable 429 in ≤~30s (routes/ai.ts → fast 429 + Retry-After), not ~480s of 120s-floor sleeps
  // that exceed the ingress timeout → opaque 500. Transient (network) retries keep maxRetries=5.
  rateLimitMaxAttempts: 2,
  rateLimitMaxSleepS: 30,
};

// Server-side rate limiting (429, not user quota) typically clears within 1-2 minutes.
// Apply this as a floor so we don't hammer the API with rapid retries.
const RATE_LIMIT_MIN_DELAY_S = 120;

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  label: string,
  onLog?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  // NOTE (t/2492): this is the low-level per-call AI-client retry layer. The renderer's
  // user-facing debate/chat orchestration retry uses a separate, independent classifier at
  // taxonomy-editor/src/renderer/utils/retryClassifier.ts — intentionally NOT shared (different
  // layer, different budget). If you change the transient-retry set here, check whether that
  // classifier wants the same, and vice versa.
  let rateLimitAttempts = 0; // t/3232: rate-limit attempts are budgeted separately from transient retries
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fn();
    } catch (err: unknown) {
      // AbortError is non-retryable — rethrow immediately (t/2507).
      // Use name-check rather than instanceof so DOMException works in all environments.
      if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes('error 401') || lower.includes('error 403') ||
          lower.includes('status 401') || lower.includes('status 403') ||
          lower.includes(' 401:') || lower.includes(' 403:')) throw err;
      const isRetryable =
        msg.includes('429') || msg.includes('503') ||
        /rate[_ -]?limit/.test(lower) || lower.includes('unavailable') ||
        lower.includes('fetch failed') || lower.includes('econnreset') ||
        lower.includes('etimedout') || lower.includes('enotfound') ||
        lower.includes('socket hang up') || lower.includes('network') ||
        lower.includes('timed out');
      if (!isRetryable || attempt === config.maxRetries) throw err;
      if (lower.includes('per day') || lower.includes('rpd') || lower.includes('daily')) throw err;
      const isRateLimit = msg.includes('429') || /rate[_ -]?limit/.test(lower);
      // t/3232: an EXHAUSTED key pool won't clear by sleeping — surface the 429 immediately.
      if (isRateLimit && (lower.includes('api_key_exhausted') || lower.includes('all keys') || lower.includes('key pool exhausted'))) throw err;
      // t/3232: rate-limit attempts are capped SEPARATELY (low, on the server) so a 429 surfaces fast
      // instead of sleeping past the ingress timeout. CLI leaves rateLimitMaxAttempts unset → full budget.
      if (isRateLimit) {
        rateLimitAttempts++;
        if (config.rateLimitMaxAttempts != null && rateLimitAttempts >= config.rateLimitMaxAttempts) throw err;
      }
      const baseDelay = config.strategy === 'fixed'
        ? (config.fixedDelays?.[attempt - 1] ?? 45)
        : Math.min(2 ** attempt, config.maxBackoffS ?? 30);
      // t/3232: rate-limit sleep is capped at rateLimitMaxSleepS on the server (ingress-safe); unset
      // (CLI) keeps the RATE_LIMIT_MIN_DELAY_S "wait for quota" floor.
      const delay = isRateLimit
        ? (config.rateLimitMaxSleepS != null
            ? Math.min(baseDelay, config.rateLimitMaxSleepS)
            : Math.max(baseDelay, RATE_LIMIT_MIN_DELAY_S))
        : baseDelay;
      const errSummary = err instanceof ActionableError ? err.problem : msg.slice(0, 300);
      onLog?.(`[retry] ${label} attempt ${attempt}/${config.maxRetries} failed (${errSummary}), waiting ${delay}s...`);
      await abortableSleep(delay * 1000, signal);
    }
  }
  throw new ActionableError({
    goal: `Complete ${label}`,
    problem: `${label} failed after ${config.maxRetries} retries`,
    location: 'ai-client.withRetry',
    nextSteps: ['Wait a minute and retry', 'Switch to a different AI provider (Settings → AI Model)', 'Check API quota'],
  });
}

export async function retryableFetch(opts: {
  label: string;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  fetchFn: FetchFn;
  config?: RetryConfig;
  onRetry?: (p: RetryProgress) => void;
  signal?: AbortSignal;
}): Promise<{ response: Response; bodyText: string }> {
  const config = opts.config ?? SERVER_RETRY_CONFIG;
  let rateLimitAttempts = 0; // t/3232: rate-limit (429/503) attempts budgeted separately from network retries
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let response: Response;
    try {
      response = await opts.fetchFn(opts.url, {
        ...opts.init,
        signal: makeFetchSignal(opts.timeoutMs, opts.signal),
      });
    } catch (err: unknown) {
      // AbortError is non-retryable (t/2507). Name-check works for both Error and DOMException.
      if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err;
      if (attempt === config.maxRetries) {
        if (err instanceof Error) throw err;
        // Preserve non-Error throwables (e.g. DOMException where instanceof varies by environment)
        if (err != null && typeof err === 'object') throw err as Error;
        throw new Error(String(err));
      }
      const backoff = config.strategy === 'fixed'
        ? (config.fixedDelays?.[attempt - 1] ?? 45)
        : Math.min(2 ** attempt, config.maxBackoffS ?? 30);
      opts.onRetry?.({ attempt, maxRetries: config.maxRetries, backoffSeconds: backoff, limitType: 'unknown', limitMessage: 'Network error. Retrying...' });
      await abortableSleep(backoff * 1000, opts.signal);
      continue;
    }

    if (response.status === 429 || response.status === 503) {
      let retryBody = '';
      try { retryBody = await response.text(); } catch { /* ignore */ }
      const { limitType, limitMessage } = parseRateLimitType(retryBody);
      const rateLimitHeaders = parseRateLimitHeaders(response.headers);
      if (limitType === 'RPD') {
        throw new ActionableError({
          goal: `Generate text via ${opts.label}`,
          problem: `Daily API quota exhausted. ${limitMessage}`,
          location: `ai-client.retryableFetch(${opts.label})`,
          nextSteps: [
            'Switch to a different AI provider (Settings → AI Model)',
            'Wait until quota resets (midnight PT)',
            'Upgrade to a paid API tier',
          ],
        });
      }
      // t/3232: an EXHAUSTED key pool won't clear by sleeping — surface the 429 immediately.
      const rlLower = `${retryBody} ${limitMessage}`.toLowerCase();
      if (response.status === 429 && (rlLower.includes('api_key_exhausted') || rlLower.includes('all keys') || rlLower.includes('key pool exhausted'))) {
        throw new ActionableError({
          goal: `Generate text via ${opts.label}`,
          problem: `Rate limited (HTTP 429) — the API key pool is exhausted. ${limitMessage}`,
          location: `ai-client.retryableFetch(${opts.label})`,
          nextSteps: ['Retry shortly — the rate limit clears within ~1-2 minutes', 'Switch to a different AI provider (Settings → AI Model)'],
        });
      }
      // t/3232: cap rate-limit attempts on the server so a 429 surfaces FAST (≪ ingress timeout)
      // rather than ~480s of 120s-floor sleeps. CLI leaves rateLimitMaxAttempts unset → full budget.
      rateLimitAttempts++;
      const rateLimitCapHit = config.rateLimitMaxAttempts != null && rateLimitAttempts >= config.rateLimitMaxAttempts;
      if (attempt === config.maxRetries || rateLimitCapHit) {
        throw new ActionableError({
          goal: `Generate text via ${opts.label}`,
          problem: `${response.status === 429 ? 'Rate limited' : 'Service unavailable'} after ${rateLimitAttempts} rate-limit attempt(s). ${limitMessage}`,
          location: `ai-client.retryableFetch(${opts.label})`,
          nextSteps: ['Wait a minute and retry', 'Switch to a different AI provider (Settings → AI Model)', 'Check the API provider status page'],
        });
      }
      const exponentialBackoff = Math.min(2 ** attempt, config.maxBackoffS ?? 30);
      let backoff = rateLimitHeaders.retryAfterSeconds != null
        ? rateLimitHeaders.retryAfterSeconds  // respect server's guidance...
        : Math.max(exponentialBackoff, RATE_LIMIT_MIN_DELAY_S);
      // t/3232: ...but CAP it (incl. a long provider Retry-After) on the server so a rate-limit can't
      // hold ingress past the timeout. Unset (CLI) leaves the guidance/floor intact.
      if (config.rateLimitMaxSleepS != null) backoff = Math.min(backoff, config.rateLimitMaxSleepS);
      opts.onRetry?.({ attempt, maxRetries: config.maxRetries, backoffSeconds: backoff, limitType, limitMessage, rateLimitHeaders });
      await abortableSleep(backoff * 1000, opts.signal);
      continue;
    }

    // t/2719: reject an over-cap body BEFORE buffering it, using the declared
    // Content-Length when the provider sends one — this avoids even reading a
    // pathologically large payload into memory.
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new ActionableError({
        goal: `Generate text via ${opts.label}`,
        problem: `Response body is ${contentLength} bytes, over the ${MAX_RESPONSE_BYTES}-byte safety cap. Refusing to buffer it to avoid an out-of-memory crash.`,
        location: `ai-client.retryableFetch(${opts.label})`,
        nextSteps: ['Retry — an oversized/malformed response is usually transient', 'Switch to a different AI provider (Settings → AI Model)', 'If this recurs, the provider or proxy is returning an unexpected payload'],
      });
    }
    const bodyText = await withTimeout(response.text(), 30_000, `Reading ${opts.label} response`);
    // t/2719: chunked / no-Content-Length responses slip past the pre-check, so cap the
    // buffered string before it reaches JSON.parse — the OOM was in JsonParser::ParseJson.
    if (bodyText.length > MAX_RESPONSE_BYTES) {
      throw new ActionableError({
        goal: `Generate text via ${opts.label}`,
        problem: `Response body is ${bodyText.length} chars, over the ${MAX_RESPONSE_BYTES}-char safety cap. Refusing to parse it to avoid an out-of-memory crash.`,
        location: `ai-client.retryableFetch(${opts.label})`,
        nextSteps: ['Retry — an oversized/malformed response is usually transient', 'Switch to a different AI provider (Settings → AI Model)', 'If this recurs, the provider or proxy is returning an unexpected payload'],
      });
    }
    return { response, bodyText };
  }
  throw new ActionableError({
    goal: `Generate text via ${opts.label}`,
    problem: `Exhausted ${config.maxRetries} retry attempts`,
    location: `ai-client.retryableFetch(${opts.label})`,
    nextSteps: ['Wait and retry', 'Switch to a different AI provider (Settings → AI Model)'],
  });
}
