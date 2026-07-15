// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRetry, parseRateLimitHeaders, parseRateLimitType, retryableFetch } from './retry.js';
import type { RetryConfig } from './retry.js';

const FAST_CONFIG: RetryConfig = {
  maxRetries: 3,
  strategy: 'fixed',
  fixedDelays: [0, 0, 0],
};

describe('withRetry — auth error fast-fail', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not retry HTTP 401 errors', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('API error 401: Invalid API key');
    }, FAST_CONFIG, 'test')).rejects.toThrow('401');
    expect(calls).toBe(1);
  });

  it('does not retry HTTP 403 errors', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('API error 403: Permission denied. The service is currently unavailable for this key.');
    }, FAST_CONFIG, 'test')).rejects.toThrow('403');
    expect(calls).toBe(1);
  });

  it('does not retry 403 even when message contains "unavailable"', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('DeepSeek API error 403: This resource is unavailable');
    }, FAST_CONFIG, 'test')).rejects.toThrow('403');
    expect(calls).toBe(1);
  });

  it('does not retry status 401 format', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('Gemini status 401: Unauthorized');
    }, FAST_CONFIG, 'test')).rejects.toThrow('401');
    expect(calls).toBe(1);
  });

  it('still retries 429 rate limit errors', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: Function) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('API error 429: Rate limited');
    }, FAST_CONFIG, 'test')).rejects.toThrow('429');
    expect(calls).toBe(3);
  });

  it('still retries 503 unavailable errors', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('API error 503: Service unavailable');
    }, FAST_CONFIG, 'test')).rejects.toThrow('503');
    expect(calls).toBe(3);
  });

  it('still retries network errors', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('fetch failed: ECONNRESET');
    }, FAST_CONFIG, 'test')).rejects.toThrow('ECONNRESET');
    expect(calls).toBe(3);
  });

  it('still retries "rate limit" errors', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: Function) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('rate limit exceeded');
    }, FAST_CONFIG, 'test')).rejects.toThrow('rate limit');
    expect(calls).toBe(3);
  });

  it('still retries "rate_limit" errors', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: Function) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('rate_limit: too many requests');
    }, FAST_CONFIG, 'test')).rejects.toThrow('rate_limit');
    expect(calls).toBe(3);
  });

  it('does NOT retry errors that merely contain "generate" (rate substring bug)', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('Failed to generate text: invalid schema');
    }, FAST_CONFIG, 'test')).rejects.toThrow('generate');
    expect(calls).toBe(1);
  });

  it('does NOT retry generic errors without retryable keywords', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('JSON parse error: unexpected token');
    }, FAST_CONFIG, 'test')).rejects.toThrow('JSON parse');
    expect(calls).toBe(1);
  });
});

describe('parseRateLimitHeaders', () => {
  it('returns empty object when no rate-limit headers present', () => {
    const headers = new Headers();
    expect(parseRateLimitHeaders(headers)).toEqual({});
  });

  it('parses Retry-After as integer seconds', () => {
    const headers = new Headers({ 'retry-after': '30' });
    expect(parseRateLimitHeaders(headers).retryAfterSeconds).toBe(30);
  });

  it('parses Retry-After as zero', () => {
    const headers = new Headers({ 'retry-after': '0' });
    expect(parseRateLimitHeaders(headers).retryAfterSeconds).toBe(0);
  });

  it('parses Retry-After as HTTP-date', () => {
    const futureDate = new Date(Date.now() + 45_000);
    const headers = new Headers({ 'retry-after': futureDate.toUTCString() });
    const result = parseRateLimitHeaders(headers);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(44);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(46);
  });

  it('clamps Retry-After HTTP-date in the past to 0', () => {
    const pastDate = new Date(Date.now() - 10_000);
    const headers = new Headers({ 'retry-after': pastDate.toUTCString() });
    expect(parseRateLimitHeaders(headers).retryAfterSeconds).toBe(0);
  });

  it('ignores non-numeric non-date Retry-After values', () => {
    const headers = new Headers({ 'retry-after': 'not-a-number-or-date' });
    expect(parseRateLimitHeaders(headers).retryAfterSeconds).toBeUndefined();
  });

  it('parses X-RateLimit-Remaining', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '12' });
    expect(parseRateLimitHeaders(headers).remaining).toBe(12);
  });

  it('parses X-RateLimit-Reset as epoch seconds', () => {
    const headers = new Headers({ 'x-ratelimit-reset': '1719792000' });
    expect(parseRateLimitHeaders(headers).resetAtEpochSeconds).toBe(1719792000);
  });

  it('parses all three headers together', () => {
    const headers = new Headers({
      'retry-after': '10',
      'x-ratelimit-remaining': '5',
      'x-ratelimit-reset': '1719792000',
    });
    expect(parseRateLimitHeaders(headers)).toEqual({
      retryAfterSeconds: 10,
      remaining: 5,
      resetAtEpochSeconds: 1719792000,
    });
  });

  it('ignores non-numeric X-RateLimit-Remaining', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': 'abc' });
    expect(parseRateLimitHeaders(headers).remaining).toBeUndefined();
  });

  it('ignores non-numeric X-RateLimit-Reset', () => {
    const headers = new Headers({ 'x-ratelimit-reset': 'tomorrow' });
    expect(parseRateLimitHeaders(headers).resetAtEpochSeconds).toBeUndefined();
  });
});

describe('parseRateLimitType', () => {
  it('detects RPM from error message', () => {
    const body = JSON.stringify({ error: { message: 'Rate limit exceeded: 10 requests per minute' } });
    expect(parseRateLimitType(body).limitType).toBe('RPM');
  });

  it('detects RPD from error message', () => {
    const body = JSON.stringify({ error: { message: 'Exceeded daily quota (RPD)' } });
    expect(parseRateLimitType(body).limitType).toBe('RPD');
  });

  it('returns unknown for non-JSON body', () => {
    expect(parseRateLimitType('not json').limitType).toBe('unknown');
  });
});

describe('retryableFetch — Retry-After header integration', () => {
  const RETRY_CONFIG: RetryConfig = { maxRetries: 2, strategy: 'exponential', maxBackoffS: 60 };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Retry-After header for backoff delay on 429', async () => {
    const retryProgress: { backoffSeconds: number; rateLimitHeaders?: unknown }[] = [];
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 429,
          headers: new Headers({ 'retry-after': '5' }),
          text: () => Promise.resolve(JSON.stringify({ error: { message: 'rate limit per minute' } })),
        });
      }
      return Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        text: () => Promise.resolve('{"result":"ok"}'),
      });
    });

    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: Function) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    await retryableFetch({
      label: 'test', url: 'https://example.com/api', init: { method: 'POST' },
      timeoutMs: 5000, fetchFn, config: RETRY_CONFIG,
      onRetry: (p) => retryProgress.push({ backoffSeconds: p.backoffSeconds, rateLimitHeaders: p.rateLimitHeaders }),
    });

    expect(retryProgress).toHaveLength(1);
    expect(retryProgress[0].backoffSeconds).toBe(5);
    expect(retryProgress[0].rateLimitHeaders).toEqual({ retryAfterSeconds: 5 });
  });

  it('respects Retry-After unconditionally (no maxBackoffS cap)', async () => {
    const retryProgress: { backoffSeconds: number }[] = [];
    let callCount = 0;
    const cappedConfig: RetryConfig = { maxRetries: 2, strategy: 'exponential', maxBackoffS: 10 };
    const fetchFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 429,
          headers: new Headers({ 'retry-after': '60' }),
          text: () => Promise.resolve('{}'),
        });
      }
      return Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    });

    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: Function) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    await retryableFetch({
      label: 'test', url: 'https://example.com/api', init: { method: 'POST' },
      timeoutMs: 5000, fetchFn, config: cappedConfig,
      onRetry: (p) => retryProgress.push({ backoffSeconds: p.backoffSeconds }),
    });

    expect(retryProgress[0].backoffSeconds).toBe(60);
  });

  it('applies 120s rate-limit floor when no Retry-After header on 503', async () => {
    const retryProgress: { backoffSeconds: number; rateLimitHeaders?: unknown }[] = [];
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 503, headers: new Headers(),
          text: () => Promise.resolve('Service unavailable'),
        });
      }
      return Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    });

    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: Function) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    await retryableFetch({
      label: 'test', url: 'https://example.com/api', init: { method: 'POST' },
      timeoutMs: 5000, fetchFn, config: RETRY_CONFIG,
      onRetry: (p) => retryProgress.push({ backoffSeconds: p.backoffSeconds, rateLimitHeaders: p.rateLimitHeaders }),
    });

    expect(retryProgress[0].backoffSeconds).toBe(120);
    expect(retryProgress[0].rateLimitHeaders).toEqual({});
  });

  it('surfaces rateLimitHeaders with remaining and reset in onRetry', async () => {
    const retryProgress: { rateLimitHeaders?: unknown }[] = [];
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 429,
          headers: new Headers({
            'retry-after': '3',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1719792000',
          }),
          text: () => Promise.resolve('{}'),
        });
      }
      return Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    });

    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: Function) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    await retryableFetch({
      label: 'test', url: 'https://example.com/api', init: { method: 'POST' },
      timeoutMs: 5000, fetchFn, config: RETRY_CONFIG,
      onRetry: (p) => retryProgress.push({ rateLimitHeaders: p.rateLimitHeaders }),
    });

    expect(retryProgress[0].rateLimitHeaders).toEqual({
      retryAfterSeconds: 3,
      remaining: 0,
      resetAtEpochSeconds: 1719792000,
    });
  });
});
