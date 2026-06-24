// @vitest-environment node

/**
 * t/926 — runtimeConfig core module: validateAndMerge, getDefaults, getConfig,
 * forceReload. The file is optional and does not exist in the test data root,
 * so getConfig()/forceReload() exercise the ENOENT → defaults fail-safe.
 */

import { describe, it, expect } from 'vitest';
import { validateAndMerge, getDefaults, getConfig, forceReload, type RuntimeConfig } from '../runtimeConfig.js';

const defaults = (): RuntimeConfig => getDefaults();

describe('getDefaults (t/926)', () => {
  it('returns the documented defaults', () => {
    const d = getDefaults();
    expect(d.resilience.circuitThreshold).toBe(5);
    expect(d.resilience.throttleEnterFactor).toBe(2.0);
    expect(d.tiers.free.pinnedModel).toBe('gemini-flash-lite-latest');
    expect(d.tiers.platform.allowedBackends).toEqual(['gemini', 'claude', 'groq']);
    expect(d.flightRecorder.maxTotalDumpSizeBytes).toBe(52_428_800);
    expect(d.server.gitFetchTimeoutMs).toBe(600_000);
  });

  it('returns a deep copy — mutating the result does not leak into the next call', () => {
    const a = getDefaults();
    a.resilience.circuitThreshold = 999;
    a.tiers.free.allowedBackends.push('groq');
    const b = getDefaults();
    expect(b.resilience.circuitThreshold).toBe(5);
    expect(b.tiers.free.allowedBackends).toEqual(['gemini']);
  });
});

describe('validateAndMerge — happy paths (t/926 AC#4)', () => {
  it('a valid full config passes through unchanged with no errors', () => {
    const { config, errors } = validateAndMerge(getDefaults(), defaults());
    expect(errors).toEqual([]);
    expect(config).toEqual(getDefaults());
  });

  it('a partial config deep-merges over defaults', () => {
    const { config, errors } = validateAndMerge(
      { resilience: { circuitThreshold: 8 }, quotas: { defaultMaxChats: 40 } },
      defaults(),
    );
    expect(errors).toEqual([]);
    expect(config.resilience.circuitThreshold).toBe(8);
    expect(config.resilience.circuitCooldownMs).toBe(60_000); // untouched default
    expect(config.quotas.defaultMaxChats).toBe(40);
    expect(config.quotas.defaultMaxDebates).toBe(15); // untouched default
    expect(config.tiers.platform.requestsPerMinute).toBe(60); // untouched section
  });

  it('accepts a config tagged with _meta.version 1', () => {
    const { config, errors } = validateAndMerge(
      { _meta: { version: 1, updatedBy: 'jpsnover' }, feedback: { defaultPageLimit: 75 } },
      defaults(),
    );
    expect(errors).toEqual([]);
    expect(config.feedback.defaultPageLimit).toBe(75);
  });
});

describe('validateAndMerge — type & range handling', () => {
  it('falls back to default on wrong type and records an error', () => {
    const { config, errors } = validateAndMerge({ resilience: { circuitThreshold: 'five' } }, defaults());
    expect(config.resilience.circuitThreshold).toBe(5);
    expect(errors.some(e => e.includes('circuitThreshold') && e.includes('expected number'))).toBe(true);
  });

  it('clamps above-max values', () => {
    const { config, errors } = validateAndMerge({ resilience: { circuitThreshold: 99_999 } }, defaults());
    expect(config.resilience.circuitThreshold).toBe(1_000);
    expect(errors.some(e => e.includes('above max'))).toBe(true);
  });

  it('clamps below-min values', () => {
    const { config, errors } = validateAndMerge({ rateLimiting: { windowMs: -5 } }, defaults());
    expect(config.rateLimiting.windowMs).toBe(0);
    expect(errors.some(e => e.includes('below min'))).toBe(true);
  });

  it('rounds non-integer values for integer fields', () => {
    const { config } = validateAndMerge({ resilience: { circuitThreshold: 5.7 } }, defaults());
    expect(config.resilience.circuitThreshold).toBe(6);
  });

  it('caps git timeouts at 1h while general durations allow up to 24h', () => {
    const { config, errors } = validateAndMerge(
      { server: { gitFetchTimeoutMs: 7_200_000 }, sessions: { anonymousTtlMs: 7_200_000 } },
      defaults(),
    );
    expect(config.server.gitFetchTimeoutMs).toBe(3_600_000); // clamped to 1h
    expect(config.sessions.anonymousTtlMs).toBe(7_200_000);   // within 24h, untouched
    expect(errors.some(e => e.includes('gitFetchTimeoutMs') && e.includes('above max'))).toBe(true);
  });
});

describe('validateAndMerge — throttle factors & cross-field rule', () => {
  it('rejects a factor <= 1.0, using the default', () => {
    const { config, errors } = validateAndMerge({ resilience: { throttleEnterFactor: 0.5 } }, defaults());
    expect(config.resilience.throttleEnterFactor).toBe(2.0);
    expect(errors.some(e => e.includes('throttleEnterFactor') && e.includes('> 1.0'))).toBe(true);
  });

  it('reverts the whole resilience section when exitFactor >= enterFactor (AC#4)', () => {
    const { config, errors } = validateAndMerge(
      { resilience: { circuitThreshold: 9, throttleEnterFactor: 2.0, throttleExitFactor: 3.0 } },
      defaults(),
    );
    // Cross-field violation → resilience reverts entirely to defaults (incl. the valid circuitThreshold edit).
    expect(config.resilience).toEqual(getDefaults().resilience);
    expect(config.resilience.circuitThreshold).toBe(5);
    expect(errors.some(e => e.includes('throttleExitFactor') && e.includes('throttleEnterFactor'))).toBe(true);
  });

  it('accepts a valid factor pair (exit < enter)', () => {
    const { config, errors } = validateAndMerge(
      { resilience: { throttleEnterFactor: 4.0, throttleExitFactor: 2.5 } },
      defaults(),
    );
    expect(errors).toEqual([]);
    expect(config.resilience.throttleEnterFactor).toBe(4.0);
    expect(config.resilience.throttleExitFactor).toBe(2.5);
  });
});

describe('validateAndMerge — allowedBackends', () => {
  it('drops unknown backends and records an error', () => {
    const { config, errors } = validateAndMerge(
      { tiers: { platform: { allowedBackends: ['gemini', 'bogus', 'groq'] } } },
      defaults(),
    );
    expect(config.tiers.platform.allowedBackends).toEqual(['gemini', 'groq']);
    expect(errors.some(e => e.includes('dropped') && e.includes('platform'))).toBe(true);
  });

  it('falls back to default when no known backends remain', () => {
    const { config, errors } = validateAndMerge({ tiers: { free: { allowedBackends: ['bogus'] } } }, defaults());
    expect(config.tiers.free.allowedBackends).toEqual(['gemini']);
    expect(errors.some(e => e.includes('no known backends'))).toBe(true);
  });

  it('falls back to default on an empty array', () => {
    const { config, errors } = validateAndMerge({ tiers: { byok: { allowedBackends: [] } } }, defaults());
    expect(config.tiers.byok.allowedBackends).toEqual(['gemini', 'claude', 'groq']);
    expect(errors.some(e => e.includes('non-empty array'))).toBe(true);
  });
});

describe('validateAndMerge — malformed / forward-compat (AC#4, AC#6)', () => {
  it('returns defaults for a non-object root', () => {
    for (const bad of [null, 42, 'nope', [1, 2, 3]]) {
      const { config, errors } = validateAndMerge(bad, defaults());
      expect(config).toEqual(getDefaults());
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('refuses to merge a non-v1 config and uses defaults', () => {
    const { config, errors } = validateAndMerge(
      { _meta: { version: 2 }, quotas: { defaultMaxChats: 99 } },
      defaults(),
    );
    expect(config).toEqual(getDefaults());
    expect(config.quotas.defaultMaxChats).toBe(25); // the v2 edit is ignored
    expect(errors.some(e => e.includes('_meta.version'))).toBe(true);
  });

  it('ignores a wrong-typed section and uses its defaults', () => {
    const { config, errors } = validateAndMerge({ resilience: 'not-an-object' }, defaults());
    expect(config.resilience).toEqual(getDefaults().resilience);
    expect(errors.some(e => e.includes('resilience') && e.includes('expected object'))).toBe(true);
  });

  it('falls back to default for a wrong-typed pinnedModel', () => {
    const { config, errors } = validateAndMerge({ tiers: { free: { pinnedModel: 123 } } }, defaults());
    expect(config.tiers.free.pinnedModel).toBe('gemini-flash-lite-latest');
    expect(errors.some(e => e.includes('pinnedModel'))).toBe(true);
  });
});

describe('getConfig / forceReload — ENOENT fail-safe (t/926 AC#3, AC#6)', () => {
  it('getConfig returns the hardcoded defaults when no config file exists', () => {
    expect(getConfig()).toEqual(getDefaults());
  });

  it('forceReload reports ok:false when falling back to defaults (no file)', () => {
    const result = forceReload();
    expect(result.ok).toBe(false);
  });
});
