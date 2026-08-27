// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callWithKeyRotation, resetRotator } from '../ai/keyRotator.js';
import { resetLimiters } from '../ai/rpmLimiter.js';
import * as rpmLimiterMod from '../ai/rpmLimiter.js';

const KEYS = ['key-pool-a', 'key-pool-b', 'key-pool-c'];
const BACKEND = 'gemini';

// Rotation/cooldown tests: put KEYS in the pool so allFree=true and rotation fires.
// Pacing acquire() resolves immediately for calls within the burst (< RPM_PER_KEY per
// key), which all tests below satisfy — no real setTimeout delays in CI.

beforeEach(() => {
  resetRotator();
  resetLimiters();
  vi.restoreAllMocks();
  process.env.FREE_TIER_GEMINI_KEY = KEYS.join(',');
});

afterEach(() => {
  delete process.env.FREE_TIER_GEMINI_KEY;
});

describe('callWithKeyRotation — round-robin distribution (t/3056)', () => {
  it('distributes successive calls across all keys in order', async () => {
    const used: string[] = [];
    const fn = async (k: string) => { used.push(k); return k; };

    await callWithKeyRotation(BACKEND, KEYS, fn);
    await callWithKeyRotation(BACKEND, KEYS, fn);
    await callWithKeyRotation(BACKEND, KEYS, fn);
    await callWithKeyRotation(BACKEND, KEYS, fn);

    // After 3 calls the cursor wraps; call 4 should reuse key[0].
    expect(used[0]).toBe(KEYS[0]);
    expect(used[1]).toBe(KEYS[1]);
    expect(used[2]).toBe(KEYS[2]);
    expect(used[3]).toBe(KEYS[0]);
  });

  it('single-key pool always returns that key', async () => {
    const used: string[] = [];
    for (let i = 0; i < 3; i++) {
      await callWithKeyRotation(BACKEND, ['only-key'], async (k) => { used.push(k); return k; });
    }
    expect(used).toEqual(['only-key', 'only-key', 'only-key']);
  });
});

describe('callWithKeyRotation — 429 cooldown skipping (t/3056)', () => {
  it('skips a key that returned 429 until its cooldown expires', async () => {
    const used: string[] = [];
    const fn = async (k: string) => { used.push(k); return k; };

    // First call: key[0] is selected and throws 429.
    const err429 = new Error('429 Too Many Requests, retry-after: 60s');
    let firstCall = true;
    const failThenSucceed = async (k: string) => {
      used.push(k);
      if (firstCall) { firstCall = false; throw err429; }
      return k;
    };

    await expect(callWithKeyRotation(BACKEND, KEYS, failThenSucceed)).rejects.toThrow('429');
    // key[0] is now cooled; next two calls should use key[1] and key[2].
    await callWithKeyRotation(BACKEND, KEYS, fn);
    await callWithKeyRotation(BACKEND, KEYS, fn);

    expect(used[0]).toBe(KEYS[0]); // original 429 attempt
    expect(used[1]).toBe(KEYS[1]); // skipped key[0]
    expect(used[2]).toBe(KEYS[2]); // skipped key[0]
  });

  it('falls through to the cooled key when all keys are cooled', async () => {
    const err429 = new Error('429 Too Many Requests');

    // Cool all 3 keys by throwing 429 on each.
    for (const _ of KEYS) {
      await expect(
        callWithKeyRotation(BACKEND, KEYS, async (_k) => { throw err429; })
      ).rejects.toThrow('429');
    }

    // All keys cooled — next call must still pick a key (no infinite loop / undefined).
    const used: string[] = [];
    await expect(
      callWithKeyRotation(BACKEND, KEYS, async (k) => { used.push(k); throw new Error('still failing'); })
    ).rejects.toThrow('still failing');
    expect(used).toHaveLength(1);
    expect(KEYS).toContain(used[0]);
  });
});

describe('callWithKeyRotation — non-429 errors', () => {
  it('does not cool the key on non-429 errors', async () => {
    const used: string[] = [];

    await expect(
      callWithKeyRotation(BACKEND, KEYS, async (k) => { used.push(k); throw new Error('network timeout'); })
    ).rejects.toThrow('network timeout');

    // key[0] should NOT be cooled; next call should advance to key[1] normally.
    await callWithKeyRotation(BACKEND, KEYS, async (k) => { used.push(k); return k; });
    expect(used[1]).toBe(KEYS[1]); // round-robin advance, key[0] not cooled
  });
});

describe('callWithKeyRotation — free-tier pool discriminator (t/3052)', () => {
  it('paces a key that is in the FREE_TIER_GEMINI_KEY pool (getLimiter called)', async () => {
    process.env.FREE_TIER_GEMINI_KEY = 'pool-key-a,pool-key-b';
    const getLimiterSpy = vi.spyOn(rpmLimiterMod, 'getLimiter').mockReturnValue({
      acquire: vi.fn().mockResolvedValue(undefined),
      reserve: vi.fn().mockReturnValue(0),
    } as unknown as rpmLimiterMod.RpmLimiter);

    await callWithKeyRotation(BACKEND, ['pool-key-a'], async (k) => k);
    expect(getLimiterSpy).toHaveBeenCalledWith('pool-key-a', expect.any(Number));
  });

  it('does NOT pace a key that is NOT in the pool (BYOK/paid key bypasses limiter)', async () => {
    process.env.FREE_TIER_GEMINI_KEY = 'pool-key-a,pool-key-b';
    const getLimiterSpy = vi.spyOn(rpmLimiterMod, 'getLimiter');

    await callWithKeyRotation(BACKEND, ['byok-paid-key-xyz'], async (k) => k);
    expect(getLimiterSpy).not.toHaveBeenCalled();
  });
});

describe('callWithKeyRotation — BYOK cursor isolation (t/3057)', () => {
  it('BYOK call does not reset the free-tier pool cursor', async () => {
    process.env.FREE_TIER_GEMINI_KEY = KEYS.join(',');
    const poolUsed: string[] = [];
    const byokUsed: string[] = [];
    const fn = (store: string[]) => async (k: string) => { store.push(k); return k; };

    // First free-tier call: cursor advances pool[0] → pool[1]
    await callWithKeyRotation(BACKEND, KEYS, fn(poolUsed));
    // Interleaved BYOK call (single non-pool key): must NOT reset the cursor
    await callWithKeyRotation(BACKEND, ['byok-key-xyz'], fn(byokUsed));
    // Second free-tier call: cursor should pick pool[1], not pool[0]
    await callWithKeyRotation(BACKEND, KEYS, fn(poolUsed));

    expect(poolUsed[0]).toBe(KEYS[0]);   // first free-tier call
    expect(byokUsed[0]).toBe('byok-key-xyz'); // BYOK always gets its own key
    expect(poolUsed[1]).toBe(KEYS[1]);   // cursor not reset — pool[0] would mean it was
  });

  it('BYOK call always returns keys[0] regardless of cursor position', async () => {
    const used: string[] = [];
    await callWithKeyRotation(BACKEND, ['byok-only'], async (k) => { used.push(k); return k; });
    await callWithKeyRotation(BACKEND, ['byok-only'], async (k) => { used.push(k); return k; });
    expect(used).toEqual(['byok-only', 'byok-only']);
  });
});

describe('callWithKeyRotation — backend isolation', () => {
  it('maintains independent cursors for different backends', async () => {
    const usedGemini: string[] = [];
    const usedGroq: string[] = [];
    const fn = (store: string[]) => async (k: string) => { store.push(k); return k; };

    await callWithKeyRotation('gemini', KEYS, fn(usedGemini));
    await callWithKeyRotation('groq', KEYS, fn(usedGroq));
    await callWithKeyRotation('gemini', KEYS, fn(usedGemini));
    await callWithKeyRotation('groq', KEYS, fn(usedGroq));

    // Both backends start from key[0] independently, then advance to key[1].
    expect(usedGemini).toEqual([KEYS[0], KEYS[1]]);
    expect(usedGroq).toEqual([KEYS[0], KEYS[1]]);
  });
});

describe('resetRotator', () => {
  it('clears cursor and cooldown so rotation starts fresh', async () => {
    const used: string[] = [];

    // Advance cursor.
    await callWithKeyRotation(BACKEND, KEYS, async (k) => { used.push(k); return k; });
    expect(used[0]).toBe(KEYS[0]);

    resetRotator();

    // After reset, cursor is back at 0.
    await callWithKeyRotation(BACKEND, KEYS, async (k) => { used.push(k); return k; });
    expect(used[1]).toBe(KEYS[0]);
  });
});
