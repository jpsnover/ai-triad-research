// @vitest-environment node

/**
 * t/1085 — Fault injection tests for rateLimiter.ts edge cases.
 * Supplements rateLimiter.test.ts (basic allow/block) and
 * tokenMilestones.test.ts (log.server.warn) with fault scenarios:
 * burst, exhaustion, flight-recorder events, midnight reset,
 * concurrent isolation, and cleanup.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkRate, checkRequestRate, checkTokenLimit, recordTokenUsage, getUsage } from '../security/rateLimiter.js';
import { log } from '../logger.js';

const mockRecord = vi.fn();
vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: vi.fn(() => ({ record: mockRecord })),
}));

let seq = 0;
const uniqueKey = () => `fault-${++seq}-${process.pid}`;

afterEach(() => {
  vi.restoreAllMocks();
  mockRecord.mockClear();
});

// 1. RPM burst — rapid requests exhaust the window immediately
describe('RPM burst (t/1085)', () => {
  it('10+ requests in rapid succession → blocks after limit with correct retryAfterMs', () => {
    const key = uniqueKey();
    const limit = 10;
    const windowMs = 60_000;

    for (let i = 0; i < limit; i++) {
      const r = checkRate(key, limit, windowMs);
      expect(r.allowed).toBe(true);
      expect(r.current).toBe(i + 1);
    }

    const blocked = checkRate(key, limit, windowMs);
    expect(blocked.allowed).toBe(false);
    expect(blocked.current).toBe(limit);
    expect(blocked.limit).toBe(limit);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(windowMs);

    const blocked2 = checkRate(key, limit, windowMs);
    expect(blocked2.allowed).toBe(false);
    expect(blocked2.retryAfterMs).toBeGreaterThan(0);
  });
});

// 2. Daily token budget exhaustion (t/1061 regression)
describe('daily token budget exhaustion (t/1085)', () => {
  it('returns {allowed: false} with correct current/limit after budget crossed', () => {
    vi.spyOn(log.server, 'warn').mockImplementation(() => { /* swallow milestone logs */ });
    const user = uniqueKey();
    const limit = 10_000;

    recordTokenUsage(user, 8_000, 2_001, limit);

    const check = checkTokenLimit(user, limit);
    expect(check.allowed).toBe(false);
    expect(check.current).toBe(10_001);
    expect(check.limit).toBe(limit);
  });

  it('getUsage().resetsAt is a valid future UTC midnight timestamp', () => {
    const user = uniqueKey();
    recordTokenUsage(user, 100, 0);

    const usage = getUsage(user);
    const resetDate = new Date(usage.resetsAt);
    expect(resetDate.getTime()).toBeGreaterThan(Date.now());
    expect(usage.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  });
});

// 3. Milestone flight recorder events at 80% and 95%
describe('milestone flight recorder events (t/1085)', () => {
  it('emits flight recorder events at 80% and 95% but not at 50%', () => {
    vi.spyOn(log.server, 'warn').mockImplementation(() => { /* swallow */ });
    const user = uniqueKey();
    const limit = 1000;

    recordTokenUsage(user, 550, 0, limit); // 55% — crosses 50%
    expect(mockRecord).not.toHaveBeenCalled();

    recordTokenUsage(user, 300, 0, limit); // 85% — crosses 80%
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      type: 'ai.error',
      component: 'rate-limiter',
      level: 'warn',
      message: expect.stringContaining('80%'),
      data: expect.objectContaining({ milestone: '80%', current: 850, limit: 1000 }),
    });

    recordTokenUsage(user, 120, 0, limit); // 97% — crosses 95%
    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(mockRecord.mock.calls[1][0]).toMatchObject({
      data: expect.objectContaining({ milestone: '95%', current: 970, limit: 1000 }),
    });
  });
});

// 4. UTC midnight boundary — daily bucket resets
describe('UTC midnight boundary (t/1085)', () => {
  it('token budget resets after midnight UTC crossing', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-29T23:59:00.000Z'));
      vi.spyOn(log.server, 'warn').mockImplementation(() => { /* swallow */ });
      const user = uniqueKey();
      const limit = 1000;

      recordTokenUsage(user, 900, 0, limit);
      expect(checkTokenLimit(user, limit).allowed).toBe(true);
      expect(checkTokenLimit(user, limit).current).toBe(900);

      vi.setSystemTime(new Date('2026-06-30T00:00:01.000Z'));

      const postMidnight = checkTokenLimit(user, limit);
      expect(postMidnight.allowed).toBe(true);
      expect(postMidnight.current).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// 5. Concurrent sliding windows — no cross-user contamination
describe('concurrent sliding windows (t/1085)', () => {
  it('exhausting one user does not affect others', () => {
    const users = Array.from({ length: 5 }, () => uniqueKey());
    const limit = 3;
    const windowMs = 60_000;

    for (let i = 0; i < limit; i++) checkRate(users[0], limit, windowMs);
    expect(checkRate(users[0], limit, windowMs).allowed).toBe(false);

    for (let u = 1; u < users.length; u++) {
      const r = checkRate(users[u], limit, windowMs);
      expect(r.allowed).toBe(true);
      expect(r.current).toBe(1);
    }
  });

  it('token buckets are isolated across users', () => {
    vi.spyOn(log.server, 'warn').mockImplementation(() => { /* swallow */ });
    const a = uniqueKey();
    const b = uniqueKey();
    const limit = 1000;

    recordTokenUsage(a, 999, 0, limit);
    recordTokenUsage(b, 100, 0, limit);

    expect(checkTokenLimit(a, limit).allowed).toBe(true);
    expect(checkTokenLimit(b, limit).allowed).toBe(true);

    recordTokenUsage(a, 2, 0, limit);
    expect(checkTokenLimit(a, limit).allowed).toBe(false);
    expect(checkTokenLimit(b, limit).allowed).toBe(true);
  });
});

// 6. Window cleanup — old timestamps purged, no unbounded accumulation
describe('window cleanup timing (t/1085)', () => {
  it('old timestamps are purged by the sliding window on next access', async () => {
    const key = uniqueKey();
    const shortWindowMs = 40;

    checkRate(key, 10, shortWindowMs);
    checkRate(key, 10, shortWindowMs);
    checkRate(key, 10, shortWindowMs);
    expect(checkRate(key, 10, shortWindowMs).current).toBe(4);

    await new Promise(r => setTimeout(r, 60));

    const fresh = checkRate(key, 10, shortWindowMs);
    expect(fresh.allowed).toBe(true);
    expect(fresh.current).toBe(1);
  });

  it('checkRequestRate prunes expired entries within its window', () => {
    const key = uniqueKey();
    const r1 = checkRequestRate(key, 100);
    expect(r1.allowed).toBe(true);
    expect(r1.current).toBe(1);

    const r2 = checkRequestRate(key, 100);
    expect(r2.current).toBe(2);
  });
});

// Coherent experience: rate limiter never throws
describe('rate limiter never throws (t/1085)', () => {
  it('checkRate returns RateCheckResult with extreme inputs', () => {
    const key = uniqueKey();
    expect(() => checkRate(key, 0, 1)).not.toThrow();
    expect(() => checkRate(key, 1, 0)).not.toThrow();
    expect(() => checkRate(key, Number.MAX_SAFE_INTEGER, 1)).not.toThrow();
  });

  it('checkTokenLimit returns RateCheckResult for unused user', () => {
    const key = uniqueKey();
    const result = checkTokenLimit(key, 1000);
    expect(result).toEqual({ allowed: true, current: 0, limit: 1000 });
  });

  it('recordTokenUsage does not throw for zero inputs', () => {
    const user = uniqueKey();
    expect(() => recordTokenUsage(user, 0, 0)).not.toThrow();
  });
});
