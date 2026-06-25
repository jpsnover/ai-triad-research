// @vitest-environment node

/**
 * t/835 — in-memory round-robin key rotator with 429 cooldowns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getNextKey, markRateLimited, isRateLimited, clearExpiredLimits, _resetRotatorState,
} from '../security/keyRotator.js';

const KEYS = ['k0', 'k1', 'k2'];

describe('keyRotator (t/835)', () => {
  beforeEach(() => { _resetRotatorState(); });

  it('round-robins evenly: 3 keys, 9 calls → 3 each (AC#1)', () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 9; i++) {
      const sel = getNextKey('gemini', KEYS);
      expect(sel).not.toBeNull();
      counts[sel!.index]++;
    }
    expect(counts).toEqual([3, 3, 3]);
  });

  it('skips a rate-limited key and uses the next immediately (AC#2)', () => {
    markRateLimited('gemini', 1, 10_000);
    const seen = new Set<number>();
    for (let i = 0; i < 6; i++) seen.add(getNextKey('gemini', KEYS)!.index);
    expect(seen.has(1)).toBe(false);
    expect(seen.has(0)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });

  it('returns null only for an empty key list', () => {
    expect(getNextKey('gemini', [])).toBeNull();
    expect(getNextKey('gemini', ['only'])).toEqual({ key: 'only', index: 0 });
  });

  describe('with fake timers', () => {
    beforeEach(() => { vi.useFakeTimers(); _resetRotatorState(); });
    afterEach(() => { vi.useRealTimers(); });

    it('a key re-enters rotation once its cooldown expires (AC#3)', () => {
      markRateLimited('gemini', 0, 1000);
      expect(isRateLimited('gemini', 0)).toBe(true);
      vi.advanceTimersByTime(1001);
      expect(isRateLimited('gemini', 0)).toBe(false);
      // round-robin again includes index 0
      const seen = new Set<number>();
      for (let i = 0; i < 6; i++) seen.add(getNextKey('gemini', KEYS)!.index);
      expect(seen.has(0)).toBe(true);
    });

    it('when all keys are limited, returns the soonest-to-recover one', () => {
      markRateLimited('gemini', 0, 5000);
      markRateLimited('gemini', 1, 1000);
      markRateLimited('gemini', 2, 9000);
      expect(getNextKey('gemini', KEYS)!.index).toBe(1);
    });

    it('clearExpiredLimits drops only expired entries', () => {
      markRateLimited('gemini', 0, 1000);
      markRateLimited('gemini', 1, 5000);
      vi.advanceTimersByTime(2000);
      clearExpiredLimits();
      expect(isRateLimited('gemini', 0)).toBe(false);
      expect(isRateLimited('gemini', 1)).toBe(true);
    });
  });

  it('tracks cooldowns per backend independently', () => {
    markRateLimited('gemini', 0, 10_000);
    expect(isRateLimited('gemini', 0)).toBe(true);
    expect(isRateLimited('groq', 0)).toBe(false);
  });
});
