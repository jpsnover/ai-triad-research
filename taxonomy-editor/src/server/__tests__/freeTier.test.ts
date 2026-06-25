// @vitest-environment node

/**
 * t/793 — free tier: keyless web users get limited Gemini access via a
 * server-provided key, gated on FREE_TIER_GEMINI_KEY. Covers tier resolution;
 * the per-IP limits / model pin / key injection live in the /api/ai/generate
 * handler (server.ts isn't import-testable) and are exercised by deploy
 * acceptance (t/795).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveTier, freeTierEnabled, isBackendAllowed, parseFreeTierKeys, scaledFreeTierRpm, byokGeminiFallbackKey } from '../ai/proxyTiers.js';

describe('free-tier RPM scales with key-pool size (t/906)', () => {
  afterEach(() => { delete process.env.FREE_TIER_GEMINI_KEY; });

  it('scaledFreeTierRpm = 6 per key, capped at 30 (AC#1, #3)', () => {
    expect(scaledFreeTierRpm(1)).toBe(6);
    expect(scaledFreeTierRpm(2)).toBe(12);
    expect(scaledFreeTierRpm(5)).toBe(30);
    expect(scaledFreeTierRpm(6)).toBe(30); // capped
    expect(scaledFreeTierRpm(0)).toBe(0);
  });

  it('resolveTier applies the scaled RPM for keyless free-tier users', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'k1,k2';
    expect(resolveTier('', 'github').limits.requestsPerMinute).toBe(12);
    process.env.FREE_TIER_GEMINI_KEY = 'k1';
    expect(resolveTier('', 'github').limits.requestsPerMinute).toBe(6);
    process.env.FREE_TIER_GEMINI_KEY = 'k1,k2,k3,k4,k5,k6,k7';
    expect(resolveTier('', 'github').limits.requestsPerMinute).toBe(30); // capped
  });
});

describe('parseFreeTierKeys (t/846)', () => {
  it('returns [] for unset/blank', () => {
    expect(parseFreeTierKeys(undefined)).toEqual([]);
    expect(parseFreeTierKeys('')).toEqual([]);
    expect(parseFreeTierKeys('  ,  ,')).toEqual([]);
  });
  it('parses a single key (no commas) — backward compatible (AC#2)', () => {
    expect(parseFreeTierKeys('only-key')).toEqual(['only-key']);
  });
  it('parses a comma-separated list, trimming blanks (AC#1)', () => {
    expect(parseFreeTierKeys('k1,k2,k3')).toEqual(['k1', 'k2', 'k3']);
    expect(parseFreeTierKeys(' k1 , ,k2 ')).toEqual(['k1', 'k2']);
  });
});

describe('freeTierEnabled with multi-key (t/846)', () => {
  afterEach(() => { delete process.env.FREE_TIER_GEMINI_KEY; });
  it('is true for a CSV value and false for a blank one', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'k1,k2';
    expect(freeTierEnabled()).toBe(true);
    process.env.FREE_TIER_GEMINI_KEY = ' , ';
    expect(freeTierEnabled()).toBe(false);
  });
});

describe('free tier (t/793)', () => {
  afterEach(() => { delete process.env.FREE_TIER_GEMINI_KEY; });

  it('keyless users get the free tier when FREE_TIER_GEMINI_KEY is set', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'server-key';
    const tier = resolveTier('', 'github');
    expect(tier.level).toBe('free');
    expect(tier.serverProvidedKey).toBe(true);
    expect(tier.pinnedModel).toBe('gemini-flash-lite-latest');
    // t/812: no per-prompt char cap — cost is bounded by tokensPerDay + per-IP RPM.
    expect(tier.maxPromptChars).toBeUndefined();
    expect(tier.limits).toEqual({ requestsPerMinute: 6, tokensPerDay: 50_000 });
    expect(tier.allowedBackends).toEqual(['gemini']);
  });

  it('keyless users stay anonymous (no AI) when the free key is absent', () => {
    expect(freeTierEnabled()).toBe(false);
    const tier = resolveTier('', 'github');
    expect(tier.level).toBe('anonymous');
    expect(tier.serverProvidedKey).toBeUndefined();
  });

  it('does not apply the free tier to local single-user (_local)', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'server-key';
    expect(resolveTier('_local', '_local').level).toBe('anonymous');
  });

  it('signed-in users are unaffected by the free tier', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'server-key';
    const tier = resolveTier('alice', 'github');
    expect(['byok', 'platform']).toContain(tier.level);
    expect(tier.serverProvidedKey).toBeUndefined();
  });

  it('restricts the free tier to gemini', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'server-key';
    const tier = resolveTier('', 'github');
    expect(isBackendAllowed(tier, 'gemini')).toBe(true);
    expect(isBackendAllowed(tier, 'openai')).toBe(false);
    expect(isBackendAllowed(tier, 'groq')).toBe(false);
  });
});

describe('byokGeminiFallbackKey (t/945)', () => {
  afterEach(() => { delete process.env.FREE_TIER_GEMINI_KEY; });

  it('gives a Claude-only BYOK user the free-tier Gemini pool on Gemini stages (AC#1/#2)', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'k1,k2';
    expect(byokGeminiFallbackKey('byok', 'gemini', undefined)).toEqual(['k1', 'k2']);
    process.env.FREE_TIER_GEMINI_KEY = 'only';
    expect(byokGeminiFallbackKey('byok', 'gemini', undefined)).toBe('only');
  });

  it('does NOT override a key the BYOK user already has', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'k1';
    expect(byokGeminiFallbackKey('byok', 'gemini', 'user-gemini-key')).toBeUndefined();
    expect(byokGeminiFallbackKey('byok', 'gemini', ['a', 'b'])).toBeUndefined();
  });

  it('only applies to BYOK + gemini (AC#5: platform/free/other backends unchanged)', () => {
    process.env.FREE_TIER_GEMINI_KEY = 'k1';
    expect(byokGeminiFallbackKey('byok', 'claude', undefined)).toBeUndefined(); // non-gemini backend
    expect(byokGeminiFallbackKey('platform', 'gemini', undefined)).toBeUndefined();
    expect(byokGeminiFallbackKey('anonymous', 'gemini', undefined)).toBeUndefined();
    expect(byokGeminiFallbackKey('free', 'gemini', undefined)).toBeUndefined();
  });

  it('returns undefined when the free-tier pool is unset (still 422s, as before)', () => {
    expect(byokGeminiFallbackKey('byok', 'gemini', undefined)).toBeUndefined();
  });
});
