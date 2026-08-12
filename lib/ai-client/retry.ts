// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../debate/errors.js';
import type { RateLimitType, RateLimitHeaders, RetryProgress, FetchFn } from './types.js';

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
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
};

// Server-side rate limiting (429, not user quota) typically clears within 1-2 minutes.
// Apply this as a floor so we don't hammer the API with rapid retries.
const RATE_LIMIT_MIN_DELAY_S = 120;

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  label: string,
  onLog?: (msg: string) => void,
): Promise<T> {
  // NOTE (t/2492): this is the low-level per-call AI-client retry layer. The renderer's
  // user-facing debate/chat orchestration retry uses a separate, independent classifier at
  // taxonomy-editor/src/renderer/utils/retryClassifier.ts — intentionally NOT shared (different
  // layer, different budget). If you change the transient-retry set here, check whether that
  // classifier wants the same, and vice versa.
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
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
      const baseDelay = config.strategy === 'fixed'
        ? (config.fixedDelays?.[attempt - 1] ?? 45)
        : Math.min(2 ** attempt, config.maxBackoffS ?? 30);
      const delay = isRateLimit ? Math.max(baseDelay, RATE_LIMIT_MIN_DELAY_S) : baseDelay;
      const errSummary = err instanceof ActionableError ? err.problem : msg.slice(0, 300);
      onLog?.(`[retry] ${label} attempt ${attempt}/${config.maxRetries} failed (${errSummary}), waiting ${delay}s...`);
      await new Promise(r => setTimeout(r, delay * 1000));
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
}): Promise<{ response: Response; bodyText: string }> {
  const config = opts.config ?? SERVER_RETRY_CONFIG;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    let response: Response;
    try {
      response = await withTimeout(opts.fetchFn(opts.url, opts.init), opts.timeoutMs, opts.label);
    } catch (err: unknown) {
      if (attempt === config.maxRetries) throw err instanceof Error ? err : new Error(String(err));
      const backoff = config.strategy === 'fixed'
        ? (config.fixedDelays?.[attempt - 1] ?? 45)
        : Math.min(2 ** attempt, config.maxBackoffS ?? 30);
      opts.onRetry?.({ attempt, maxRetries: config.maxRetries, backoffSeconds: backoff, limitType: 'unknown', limitMessage: 'Network error. Retrying...' });
      await new Promise(r => setTimeout(r, backoff * 1000));
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
      if (attempt === config.maxRetries) {
        throw new ActionableError({
          goal: `Generate text via ${opts.label}`,
          problem: `${response.status === 429 ? 'Rate limited' : 'Service unavailable'} after ${config.maxRetries} attempts. ${limitMessage}`,
          location: `ai-client.retryableFetch(${opts.label})`,
          nextSteps: ['Wait a minute and retry', 'Switch to a different AI provider (Settings → AI Model)', 'Check the API provider status page'],
        });
      }
      const exponentialBackoff = Math.min(2 ** attempt, config.maxBackoffS ?? 30);
      const backoff = rateLimitHeaders.retryAfterSeconds != null
        ? rateLimitHeaders.retryAfterSeconds  // respect server's guidance unconditionally
        : Math.max(exponentialBackoff, RATE_LIMIT_MIN_DELAY_S);
      opts.onRetry?.({ attempt, maxRetries: config.maxRetries, backoffSeconds: backoff, limitType, limitMessage, rateLimitHeaders });
      await new Promise(r => setTimeout(r, backoff * 1000));
      continue;
    }

    const bodyText = await withTimeout(response.text(), 30_000, `Reading ${opts.label} response`);
    return { response, bodyText };
  }
  throw new ActionableError({
    goal: `Generate text via ${opts.label}`,
    problem: `Exhausted ${config.maxRetries} retry attempts`,
    location: `ai-client.retryableFetch(${opts.label})`,
    nextSteps: ['Wait and retry', 'Switch to a different AI provider (Settings → AI Model)'],
  });
}
