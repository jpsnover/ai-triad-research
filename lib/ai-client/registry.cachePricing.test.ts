// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3945: cache-read pricing completeness. The predicate is asserted on SYNTHETIC registries only.
// The real ai-models.json is checked WARN-only by verify:config (t/3945#3), so asserting it here
// would make the check blocking before the Gemini/OpenAI backfill lands. The tripwire IS blocking
// from day one (t/3945#3 cond 3): it pins code against code and has no current violations.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const record = vi.fn();
vi.mock('../flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record }) }));

import {
  findPricingMissingCacheRate, CACHE_REPORTING_BACKENDS, estimateCost, _resetCacheRateWarnMemoForTests,
  type ModelRegistry, type ModelPricing,
} from './registry.js';

function reg(models: { id: string; apiModelId?: string; backend: string }[], pricing: Record<string, ModelPricing>): ModelRegistry {
  return {
    backends: [],
    models: models.map((m) => ({ id: m.id, apiModelId: m.apiModelId ?? m.id, label: m.id, backend: m.backend })),
    pricing,
  };
}

describe('findPricingMissingCacheRate (t/3945)', () => {
  it('FLAGS a cache-reporting backend entry with no cachedInputPer1M (fail arm)', () => {
    const issues = findPricingMissingCacheRate(reg([{ id: 'claude-x', backend: 'claude' }], { 'claude-x': { inputPer1M: 5, outputPer1M: 25 } }));
    expect(issues).toHaveLength(1);
    expect(issues[0].modelId).toBe('claude-x');
    expect(issues[0].referenceSite).toBe('pricing.claude-x');
    expect(issues[0].message).toMatch(/cachedInputPer1M/);
  });

  it('PASSES an entry that declares a cache-read price', () => {
    expect(findPricingMissingCacheRate(reg([{ id: 'claude-x', backend: 'claude' }], { 'claude-x': { inputPer1M: 5, outputPer1M: 25, cachedInputPer1M: 0.5 } }))).toEqual([]);
  });

  it('PASSES the "no discount" convention: cachedInputPer1M equal to inputPer1M (t/3945#1)', () => {
    expect(findPricingMissingCacheRate(reg([{ id: 'openai-x', backend: 'openai' }], { 'openai-x': { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: 2 } }))).toEqual([]);
  });

  it('FLAGS an explicit null: the PS cost path would price cached tokens at $0 (t/3945#1)', () => {
    const p = { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: null } as unknown as ModelPricing;
    expect(findPricingMissingCacheRate(reg([{ id: 'gemini-x', backend: 'gemini' }], { 'gemini-x': p }))).toHaveLength(1);
  });

  it('IGNORES backends that report no cached tokens (groq, zai)', () => {
    const r = reg([{ id: 'groq-x', backend: 'groq' }, { id: 'zai-x', backend: 'zai' }], {
      'groq-x': { inputPer1M: 1, outputPer1M: 1 }, 'zai-x': { inputPer1M: 1, outputPer1M: 1 },
    });
    expect(findPricingMissingCacheRate(r)).toEqual([]);
  });

  it('resolves keys by models[].id only; an apiModelId key is left to findPricingKeyIssues (t/3946)', () => {
    const r = reg([{ id: 'claude-haiku', apiModelId: 'claude-haiku-20251001', backend: 'claude' }], {
      'claude-haiku-20251001': { inputPer1M: 1, outputPer1M: 5 },
    });
    expect(findPricingMissingCacheRate(r)).toEqual([]);
  });

  it('skips keys that resolve to no model, and _comment keys (unpriced/unresolved is t/3946)', () => {
    const r = reg([], { orphan: { inputPer1M: 1, outputPer1M: 1 }, _comment: 'x' as unknown as ModelPricing });
    expect(findPricingMissingCacheRate(r)).toEqual([]);
  });
});

describe('estimateCost full-rate fallback WARN (t/3945)', () => {
  beforeEach(() => { record.mockClear(); _resetCacheRateWarnMemoForTests(); });
  const r = reg([{ id: 'm', backend: 'claude' }, { id: 'n', backend: 'claude' }], {
    m: { inputPer1M: 10, outputPer1M: 0 },
    n: { inputPer1M: 10, outputPer1M: 0, cachedInputPer1M: 1 },
  });

  it('WARNs once per model when cached tokens are costed at the full rate, and still overstates (unchanged math)', () => {
    expect(estimateCost(r, 'm', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBeCloseTo(10);
    estimateCost(r, 'm', { promptTokens: 10, cachedTokens: 5 });
    expect(record).toHaveBeenCalledTimes(1);
    const evt = record.mock.calls[0][0] as { level: string; message: string };
    expect(evt.level).toBe('warn');
    expect(evt.message).toContain('"m"');
  });

  it('no WARN when the cache price is declared, or when there are no cached tokens', () => {
    expect(estimateCost(r, 'n', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBeCloseTo(1);
    estimateCost(r, 'm', { promptTokens: 100 });
    expect(record).not.toHaveBeenCalled();
  });
});

describe('CACHE_REPORTING_BACKENDS tripwire (t/3945#3 cond 3, blocking)', () => {
  // Every provider adapter that sets `cachedTokens:` on its usage must be listed, and nothing else may
  // be. A provider that starts reporting cached tokens without being added here would otherwise sit
  // outside the completeness check silently.
  const providersDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'providers');
  const reporting = new Set(
    readdirSync(providersDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /\bcachedTokens\s*:/.test(readFileSync(path.join(providersDir, f), 'utf8')))
      .map((f) => f.replace(/\.ts$/, '').split('-')[0]), // gemini-search.ts → gemini
  );

  it('found at least one reporting provider (the scan itself works)', () => {
    expect(reporting.size).toBeGreaterThan(0);
  });

  it('every provider that reports cachedTokens is in CACHE_REPORTING_BACKENDS', () => {
    const missing = [...reporting].filter((b) => !CACHE_REPORTING_BACKENDS.has(b)).sort();
    expect(missing, `providers report cachedTokens but are not in CACHE_REPORTING_BACKENDS: ${missing.join(', ')}`).toEqual([]);
  });

  it('every CACHE_REPORTING_BACKENDS entry still has a provider that reports cachedTokens', () => {
    const stale = [...CACHE_REPORTING_BACKENDS].filter((b) => !reporting.has(b)).sort();
    expect(stale, `CACHE_REPORTING_BACKENDS lists backends whose provider no longer reports cachedTokens: ${stale.join(', ')}`).toEqual([]);
  });
});
