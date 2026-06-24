// @vitest-environment node

/**
 * t/920 — /api/ai/generate was collapsing upstream provider rate-limits into an
 * opaque, non-retryable HTTP 500 (debate openings fire 3 concurrent calls on one
 * free-tier key → provider 429). These cover the detection that now routes such
 * errors to a retryable 429 + Retry-After instead. The handler wiring lives in
 * server.ts (not import-testable); is429Error/retryAfterMs are the decision points.
 */

import { describe, it, expect } from 'vitest';
import { is429Error, retryAfterMs } from '../aiBackends.js';

describe('is429Error — upstream rate-limit detection (t/920)', () => {
  it('detects the provider rate-limit signals that should yield a retryable 429', () => {
    expect(is429Error(new Error('Request failed with status 429'))).toBe(true);
    expect(is429Error(new Error('429 Too Many Requests'))).toBe(true);
    expect(is429Error(new Error('google.api: RESOURCE_EXHAUSTED'))).toBe(true);
    expect(is429Error(new Error('Rate limit exceeded for this key'))).toBe(true);
    expect(is429Error(new Error('You have exceeded your quota'))).toBe(true);
    expect(is429Error('Too Many Requests')).toBe(true);
  });

  it('does NOT misclassify genuine server/transport errors as rate-limits', () => {
    expect(is429Error(new Error('HTTP 500 internal server error'))).toBe(false);
    expect(is429Error(new Error('ECONNRESET'))).toBe(false);
    expect(is429Error(new Error('socket hang up'))).toBe(false);
    expect(is429Error(new Error('Invalid API key'))).toBe(false);
    expect(is429Error(undefined)).toBe(false);
    expect(is429Error(null)).toBe(false);
  });
});

describe('retryAfterMs — backoff hint parsing (t/920)', () => {
  it('parses explicit retry-after hints, normalizing to ms', () => {
    expect(retryAfterMs(new Error('Retry after 12 seconds'))).toBe(12_000);
    expect(retryAfterMs(new Error('retry-after: 500ms'))).toBe(500);
    expect(retryAfterMs(new Error('please wait 30s before retrying'))).toBe(30_000);
  });

  it('defaults to 30s when no hint is present', () => {
    expect(retryAfterMs(new Error('RESOURCE_EXHAUSTED'))).toBe(30_000);
    expect(retryAfterMs(undefined)).toBe(30_000);
  });
});
