// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { callWithKeyRotation, resetRotator } from '../ai/keyRotator.js';
import { resetLimiters } from '../ai/rpmLimiter.js';

const KEYS = ['key-pool-a', 'key-pool-b', 'key-pool-c'];
const BACKEND = 'gemini';

// Disable per-key pacing in all tests (isServerFreeTier=false) unless the test
// explicitly checks pacing — avoids real setTimeout delays in the test suite.
const NO_PACE = false;

beforeEach(() => {
  resetRotator();
  resetLimiters();
  vi.restoreAllMocks();
});

describe('callWithKeyRotation — round-robin distribution (t/3056)', () => {
  it('distributes successive calls across all keys in order', async () => {
    const used: string[] = [];
    const fn = async (k: string) => { used.push(k); return k; };

    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, fn);
    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, fn);
    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, fn);
    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, fn);

    // After 3 calls the cursor wraps; call 4 should reuse key[0].
    expect(used[0]).toBe(KEYS[0]);
    expect(used[1]).toBe(KEYS[1]);
    expect(used[2]).toBe(KEYS[2]);
    expect(used[3]).toBe(KEYS[0]);
  });

  it('single-key pool always returns that key', async () => {
    const used: string[] = [];
    for (let i = 0; i < 3; i++) {
      await callWithKeyRotation(BACKEND, ['only-key'], NO_PACE, async (k) => { used.push(k); return k; });
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

    await expect(callWithKeyRotation(BACKEND, KEYS, NO_PACE, failThenSucceed)).rejects.toThrow('429');
    // key[0] is now cooled; next two calls should use key[1] and key[2].
    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, fn);
    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, fn);

    expect(used[0]).toBe(KEYS[0]); // original 429 attempt
    expect(used[1]).toBe(KEYS[1]); // skipped key[0]
    expect(used[2]).toBe(KEYS[2]); // skipped key[0]
  });

  it('falls through to the cooled key when all keys are cooled', async () => {
    const err429 = new Error('429 Too Many Requests');

    // Cool all 3 keys by throwing 429 on each.
    for (const _ of KEYS) {
      await expect(
        callWithKeyRotation(BACKEND, KEYS, NO_PACE, async (k) => { throw err429; })
      ).rejects.toThrow('429');
    }

    // All keys cooled — next call must still pick a key (no infinite loop / undefined).
    const used: string[] = [];
    await expect(
      callWithKeyRotation(BACKEND, KEYS, NO_PACE, async (k) => { used.push(k); throw new Error('still failing'); })
    ).rejects.toThrow('still failing');
    expect(used).toHaveLength(1);
    expect(KEYS).toContain(used[0]);
  });
});

describe('callWithKeyRotation — non-429 errors', () => {
  it('does not cool the key on non-429 errors', async () => {
    const used: string[] = [];

    await expect(
      callWithKeyRotation(BACKEND, KEYS, NO_PACE, async (k) => { used.push(k); throw new Error('network timeout'); })
    ).rejects.toThrow('network timeout');

    // key[0] should NOT be cooled; next call should advance to key[1] normally.
    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, async (k) => { used.push(k); return k; });
    expect(used[1]).toBe(KEYS[1]); // round-robin advance, key[0] not cooled
  });
});

describe('callWithKeyRotation — backend isolation', () => {
  it('maintains independent cursors for different backends', async () => {
    const usedGemini: string[] = [];
    const usedGroq: string[] = [];
    const fn = (store: string[]) => async (k: string) => { store.push(k); return k; };

    await callWithKeyRotation('gemini', KEYS, NO_PACE, fn(usedGemini));
    await callWithKeyRotation('groq', KEYS, NO_PACE, fn(usedGroq));
    await callWithKeyRotation('gemini', KEYS, NO_PACE, fn(usedGemini));
    await callWithKeyRotation('groq', KEYS, NO_PACE, fn(usedGroq));

    // Both backends start from key[0] independently, then advance to key[1].
    expect(usedGemini).toEqual([KEYS[0], KEYS[1]]);
    expect(usedGroq).toEqual([KEYS[0], KEYS[1]]);
  });
});

describe('resetRotator', () => {
  it('clears cursor and cooldown so rotation starts fresh', async () => {
    const used: string[] = [];

    // Advance cursor.
    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, async (k) => { used.push(k); return k; });
    expect(used[0]).toBe(KEYS[0]);

    resetRotator();

    // After reset, cursor is back at 0.
    await callWithKeyRotation(BACKEND, KEYS, NO_PACE, async (k) => { used.push(k); return k; });
    expect(used[1]).toBe(KEYS[0]);
  });
});
