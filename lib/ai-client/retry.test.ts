// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry.js';
import type { RetryConfig } from './retry.js';

const FAST_CONFIG: RetryConfig = {
  maxRetries: 3,
  strategy: 'fixed',
  fixedDelays: [0, 0, 0],
};

describe('withRetry — auth error fast-fail', () => {
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
});
