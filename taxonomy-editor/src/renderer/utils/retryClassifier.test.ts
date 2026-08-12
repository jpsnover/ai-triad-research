// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { classifyAiRetry, retryReasonLabel } from './retryClassifier';

// Helper: build an error carrying an httpStatus (as the bridge attaches it).
function httpErr(status: number, message = 'boom'): Error & { httpStatus: number } {
  return Object.assign(new Error(message), { httpStatus: status });
}

describe('classifyAiRetry (t/2492) — transient failures retry, terminal ones do not', () => {
  it('429 rate-limit is retryable (reason: rate_limit)', () => {
    expect(classifyAiRetry(httpErr(429))).toEqual({ retryable: true, reason: 'rate_limit' });
  });

  it('daily-limit is NOT retryable even though it surfaces as 429', () => {
    const err = Object.assign(new Error('Daily limit'), { httpStatus: 429, limitType: 'tokens_per_day' });
    expect(classifyAiRetry(err)).toEqual({ retryable: false, reason: 'non_retryable' });
  });

  it.each([502, 503, 504, 529])('transient 5xx %i is retryable (reason: server)', (status) => {
    expect(classifyAiRetry(httpErr(status))).toEqual({ retryable: true, reason: 'server' });
  });

  it.each([400, 401, 403, 422, 500])('terminal HTTP %i is NOT retryable', (status) => {
    expect(classifyAiRetry(httpErr(status))).toEqual({ retryable: false, reason: 'non_retryable' });
  });

  // The PI-reported case: a ~3-minute failure with no httpStatus.
  it('AbortError (request timeout) is retryable (reason: timeout)', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(classifyAiRetry(err)).toEqual({ retryable: true, reason: 'timeout' });
  });

  it.each([
    'Request timed out after 180s',
    'ETIMEDOUT',
    'deadline exceeded',
  ])('timeout message %j is retryable (reason: timeout)', (message) => {
    expect(classifyAiRetry(new Error(message))).toEqual({ retryable: true, reason: 'timeout' });
  });

  it.each([
    'TypeError: Failed to fetch',
    'fetch failed',
    'ECONNRESET',
    'socket hang up',
  ])('network message %j is retryable (reason: network)', (message) => {
    expect(classifyAiRetry(new Error(message))).toEqual({ retryable: true, reason: 'network' });
  });

  it('content/schema errors (no httpStatus, not timeout/network) are NOT retryable', () => {
    expect(classifyAiRetry(new Error('Cannot parse JSON after all repair attempts'))).toEqual({
      retryable: false, reason: 'non_retryable',
    });
  });

  it('an unrecognized bare error is NOT retryable (fail closed)', () => {
    expect(classifyAiRetry('something odd')).toEqual({ retryable: false, reason: 'non_retryable' });
    expect(classifyAiRetry(undefined)).toEqual({ retryable: false, reason: 'non_retryable' });
  });
});

describe('retryReasonLabel (t/2492)', () => {
  it('produces distinct human labels per reason', () => {
    expect(retryReasonLabel('rate_limit')).toMatch(/rate limited/i);
    expect(retryReasonLabel('server')).toMatch(/server error/i);
    expect(retryReasonLabel('timeout')).toMatch(/timed out/i);
    expect(retryReasonLabel('network')).toMatch(/network/i);
    expect(retryReasonLabel('non_retryable')).toMatch(/failed/i);
  });
});
