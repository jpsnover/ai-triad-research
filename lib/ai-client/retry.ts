// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../debate/errors';
import type { RateLimitType, RetryProgress, FetchFn } from './types';

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

export interface RetryConfig {
  maxRetries: number;
  strategy: 'fixed' | 'exponential';
  fixedDelays?: number[];
  maxBackoffS?: number;
}

export const CLI_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  strategy: 'fixed',
  fixedDelays: [5, 15, 45],
};

export const SERVER_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  strategy: 'exponential',
  maxBackoffS: 30,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  label: string,
  onLog?: (msg: string) => void,
): Promise<T> {
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      const isRetryable =
        msg.includes('429') || msg.includes('503') ||
        lower.includes('rate') || lower.includes('unavailable') ||
        lower.includes('fetch failed') || lower.includes('econnreset') ||
        lower.includes('etimedout') || lower.includes('enotfound') ||
        lower.includes('socket hang up') || lower.includes('network') ||
        lower.includes('timed out');
      if (!isRetryable || attempt === config.maxRetries) throw err;
      const delay = config.strategy === 'fixed'
        ? (config.fixedDelays?.[attempt - 1] ?? 45)
        : Math.min(2 ** attempt, config.maxBackoffS ?? 30);
      onLog?.(`[retry] ${label} attempt ${attempt}/${config.maxRetries} failed (${msg.slice(0, 80)}), waiting ${delay}s...`);
      await new Promise(r => setTimeout(r, delay * 1000));
    }
  }
  throw new ActionableError({
    goal: `Complete ${label}`,
    problem: `${label} failed after ${config.maxRetries} retries`,
    location: 'ai-client.withRetry',
    nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
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
      if (attempt === config.maxRetries) {
        throw new ActionableError({
          goal: `Generate text via ${opts.label}`,
          problem: `${response.status === 429 ? 'Rate limited' : 'Service unavailable'} after ${config.maxRetries} attempts. ${limitMessage}`,
          location: `ai-client.retryableFetch(${opts.label})`,
          nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check the API provider status page'],
        });
      }
      const backoff = limitType === 'RPD' ? Math.min(2 ** (attempt + 2), 60) : Math.min(2 ** attempt, config.maxBackoffS ?? 30);
      opts.onRetry?.({ attempt, maxRetries: config.maxRetries, backoffSeconds: backoff, limitType, limitMessage });
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
    nextSteps: ['Wait and retry', 'Switch to a different backend'],
  });
}
