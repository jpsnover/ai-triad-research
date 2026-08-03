// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  getModelCapabilities,
  filterByCapabilities,
  estimateCost,
  validateModelConfig,
  assertModelConfigValid,
  resolveBackend,
  resolveModel,
  getDefaultTimeout,
  buildModelEntryMap,
  buildModelIdMap,
} from './registry.js';
import type { ModelRegistry } from './registry.js';

const TEST_REGISTRY: ModelRegistry = {
  backends: [
    { id: 'gemini', label: 'Gemini' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'ollama', label: 'Ollama' },
  ],
  models: [
    { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
    { id: 'openai-gpt-4o', apiModelId: 'gpt-4o', label: 'GPT-4o', backend: 'openai' },
    { id: 'openai-gpt-image-1', apiModelId: 'gpt-image-1', label: 'GPT Image 1', backend: 'openai' },
    { id: 'ollama-gemma', apiModelId: 'gemma:7b', label: 'Gemma 7B', backend: 'ollama' },
  ],
  capabilityDefaults: {
    gemini: { supportsTools: true, supportsVision: true, supportsStreaming: true, maxContextTokens: 1048576 },
    openai: { supportsTools: true, supportsVision: true, supportsStreaming: true, maxContextTokens: 128000 },
    ollama: { supportsTools: false, supportsVision: false, supportsStreaming: true, maxContextTokens: 131072 },
  },
  modelCapabilities: {
    'openai-gpt-image-1': { supportsTools: false, supportsVision: false, supportsStreaming: false },
  },
  pricing: {
    'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5, cachedInputPer1M: 0.075 },
    'gpt-4o': { inputPer1M: 5, outputPer1M: 15 },
  },
};

describe('resolveModel — fixedTemperature (t/2068)', () => {
  const reg: ModelRegistry = {
    backends: [{ id: 'moonshot', label: 'Moonshot' }, { id: 'gemini', label: 'Gemini' }],
    models: [
      { id: 'moonshot-kimi-k3', apiModelId: 'kimi-k3', label: 'Kimi K3', backend: 'moonshot', fixedTemperature: 1 },
      { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
    ],
  };

  it('surfaces fixedTemperature from a registry entry', () => {
    expect(resolveModel(reg, 'moonshot-kimi-k3')).toMatchObject({
      apiModelId: 'kimi-k3', backend: 'moonshot', fixedTemperature: 1,
    });
  });

  it('leaves fixedTemperature undefined for an entry without it', () => {
    expect(resolveModel(reg, 'gemini-2.5-flash').fixedTemperature).toBeUndefined();
  });
});

describe('buildModelEntryMap (t/2107)', () => {
  const reg: ModelRegistry = {
    backends: [{ id: 'moonshot', label: 'Moonshot' }, { id: 'gemini', label: 'Gemini' }],
    models: [
      { id: 'moonshot-kimi-k3', apiModelId: 'kimi-k3', label: 'Kimi K3', backend: 'moonshot', fixedTemperature: 1 },
      { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
      { id: 'gemini-2.0-flash', apiModelId: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', backend: 'gemini' },
    ],
  };

  it('returns full ModelEntry including fixedTemperature', () => {
    const map = buildModelEntryMap(reg);
    expect(map['moonshot-kimi-k3']).toMatchObject({
      apiModelId: 'kimi-k3', backend: 'moonshot', fixedTemperature: 1,
    });
  });

  it('returns entry without fixedTemperature for standard models', () => {
    const map = buildModelEntryMap(reg);
    expect(map['gemini-2.5-flash']?.fixedTemperature).toBeUndefined();
    expect(map['gemini-2.5-flash']?.apiModelId).toBe('gemini-2.5-flash');
  });

  it('synthesized -latest alias points at the highest-versioned entry', () => {
    // gemini-2.5-flash and gemini-2.0-flash both parse to family gemini-flash;
    // 2.5 > 2.0, so gemini-flash-latest should point at the 2.5 entry.
    const map = buildModelEntryMap(reg);
    expect(map['gemini-flash-latest']?.apiModelId).toBe('gemini-2.5-flash');
    expect(map['gemini-flash-latest']?.id).toBe('gemini-2.5-flash');
  });

  it('synthesized -latest alias carries fixedTemperature from the source entry', () => {
    // Use gemini-format IDs which parseVersionedModelId matches.
    // gemini-2.5-flash (fixedTemperature: 1) wins over 2.0; alias must carry the constraint.
    const reg2: ModelRegistry = {
      backends: [{ id: 'gemini', label: 'Gemini' }],
      models: [
        { id: 'gemini-2.0-flash', apiModelId: 'gemini-2.0-flash', label: 'Flash 2.0', backend: 'gemini' },
        { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Flash 2.5', backend: 'gemini', fixedTemperature: 1 },
      ],
    };
    const map = buildModelEntryMap(reg2);
    expect(map['gemini-flash-latest']?.apiModelId).toBe('gemini-2.5-flash');
    expect(map['gemini-flash-latest']?.fixedTemperature).toBe(1);
  });

  it('explicit *-latest in models[] wins over synthesized alias (collision guard)', () => {
    const reg3: ModelRegistry = {
      backends: [{ id: 'gemini', label: 'Gemini' }],
      models: [
        { id: 'gemini-flash-latest', apiModelId: 'gemini-2.5-flash-pinned', label: 'Pinned', backend: 'gemini' },
        { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Flash 2.5', backend: 'gemini' },
        { id: 'gemini-2.0-flash', apiModelId: 'gemini-2.0-flash', label: 'Flash 2.0', backend: 'gemini' },
      ],
    };
    const map = buildModelEntryMap(reg3);
    expect(map['gemini-flash-latest']?.apiModelId).toBe('gemini-2.5-flash-pinned');
  });

  it('key set matches buildModelIdMap exactly (parity contract)', () => {
    const entryKeys = new Set(Object.keys(buildModelEntryMap(reg)));
    const idKeys = new Set(Object.keys(buildModelIdMap(reg)));
    expect(entryKeys).toEqual(idKeys);
  });
});

describe('getModelCapabilities', () => {
  it('returns backend defaults for a model with no overrides', () => {
    const caps = getModelCapabilities(TEST_REGISTRY, 'gemini-2.5-flash');
    expect(caps.supportsTools).toBe(true);
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsStreaming).toBe(true);
    expect(caps.maxContextTokens).toBe(1048576);
  });

  it('applies model-specific overrides on top of backend defaults', () => {
    const caps = getModelCapabilities(TEST_REGISTRY, 'openai-gpt-image-1');
    expect(caps.supportsTools).toBe(false);
    expect(caps.supportsVision).toBe(false);
    expect(caps.supportsStreaming).toBe(false);
    expect(caps.maxContextTokens).toBe(128000);
  });

  it('falls back to gemini defaults for unknown models (resolveBackend default)', () => {
    const caps = getModelCapabilities(TEST_REGISTRY, 'unknown-model');
    expect(caps.supportsTools).toBe(true);
    expect(caps.supportsVision).toBe(true);
    expect(caps.supportsStreaming).toBe(true);
    expect(caps.maxContextTokens).toBe(1048576);
  });

  it('returns ollama defaults (no tools, no vision) for ollama models', () => {
    const caps = getModelCapabilities(TEST_REGISTRY, 'ollama-gemma');
    expect(caps.supportsTools).toBe(false);
    expect(caps.supportsVision).toBe(false);
    expect(caps.supportsStreaming).toBe(true);
  });
});

describe('filterByCapabilities', () => {
  const ALL_MODELS = ['gemini-2.5-flash', 'openai-gpt-4o', 'openai-gpt-image-1', 'ollama-gemma'];

  it('filters out models that lack supportsTools', () => {
    const result = filterByCapabilities(TEST_REGISTRY, ALL_MODELS, { supportsTools: true });
    expect(result).toContain('gemini-2.5-flash');
    expect(result).toContain('openai-gpt-4o');
    expect(result).not.toContain('openai-gpt-image-1');
    expect(result).not.toContain('ollama-gemma');
  });

  it('filters out models that lack supportsStreaming', () => {
    const result = filterByCapabilities(TEST_REGISTRY, ALL_MODELS, { supportsStreaming: true });
    expect(result).toContain('gemini-2.5-flash');
    expect(result).toContain('openai-gpt-4o');
    expect(result).toContain('ollama-gemma');
    expect(result).not.toContain('openai-gpt-image-1');
  });

  it('filters by multiple capabilities at once', () => {
    const result = filterByCapabilities(TEST_REGISTRY, ALL_MODELS, {
      supportsTools: true,
      supportsVision: true,
    });
    expect(result).toContain('gemini-2.5-flash');
    expect(result).toContain('openai-gpt-4o');
    expect(result).not.toContain('openai-gpt-image-1');
    expect(result).not.toContain('ollama-gemma');
  });

  it('returns all models when no capabilities are required', () => {
    const result = filterByCapabilities(TEST_REGISTRY, ALL_MODELS, {});
    expect(result).toEqual(ALL_MODELS);
  });

  it('returns empty array when no models match', () => {
    const result = filterByCapabilities(TEST_REGISTRY, ['ollama-gemma'], { supportsTools: true });
    expect(result).toEqual([]);
  });
});

describe('estimateCost', () => {
  it('calculates cost from input and output tokens', () => {
    const cost = estimateCost(TEST_REGISTRY, 'gpt-4o', {
      promptTokens: 1000,
      completionTokens: 500,
    });
    // (1000/1M)*5 + (500/1M)*15 = 0.005 + 0.0075 = 0.0125
    expect(cost).toBeCloseTo(0.0125, 6);
  });

  it('uses cachedInputPer1M rate for cached tokens when available', () => {
    const cost = estimateCost(TEST_REGISTRY, 'gemini-2.5-flash', {
      promptTokens: 10000,
      completionTokens: 2000,
      cachedTokens: 8000,
    });
    // nonCached: (2000/1M)*0.3 = 0.0006
    // cached: (8000/1M)*0.075 = 0.0006
    // output: (2000/1M)*2.5 = 0.005
    // total = 0.0062
    expect(cost).toBeCloseTo(0.0062, 6);
  });

  it('uses full input rate for cached tokens when cachedInputPer1M is absent', () => {
    const cost = estimateCost(TEST_REGISTRY, 'gpt-4o', {
      promptTokens: 1000,
      completionTokens: 0,
      cachedTokens: 500,
    });
    // nonCached: (500/1M)*5 = 0.0025
    // cached: (500/1M)*5 = 0.0025 (no cachedInputPer1M, uses inputPer1M)
    // output: 0
    // total = 0.005
    expect(cost).toBeCloseTo(0.005, 6);
  });

  it('returns undefined for unknown model', () => {
    const cost = estimateCost(TEST_REGISTRY, 'unknown-model', {
      promptTokens: 1000,
      completionTokens: 500,
    });
    expect(cost).toBeUndefined();
  });

  it('returns undefined when registry has no pricing', () => {
    const noPricingRegistry: ModelRegistry = { ...TEST_REGISTRY, pricing: undefined };
    const cost = estimateCost(noPricingRegistry, 'gpt-4o', {
      promptTokens: 1000,
      completionTokens: 500,
    });
    expect(cost).toBeUndefined();
  });

  it('handles zero tokens gracefully', () => {
    const cost = estimateCost(TEST_REGISTRY, 'gpt-4o', {
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(cost).toBe(0);
  });

  it('handles missing token counts as zero', () => {
    const cost = estimateCost(TEST_REGISTRY, 'gpt-4o', {});
    expect(cost).toBe(0);
  });
});

describe('validateModelConfig', () => {
  // Base registry whose models[] synthesizes a `gemini-flash-latest` alias
  // (via buildModelIdMap parsing `gemini-2.5-flash` → family gemini-flash, v2.5).
  const BASE: ModelRegistry = {
    backends: [
      { id: 'gemini', label: 'Gemini' },
      { id: 'openai', label: 'OpenAI' },
    ],
    models: [
      { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', backend: 'gemini' },
      { id: 'openai-gpt-4o', apiModelId: 'gpt-4o', label: 'GPT-4o', backend: 'openai' },
    ],
  };

  it('flags a typo\'d defaults value as a warning naming the id and site', () => {
    const registry: ModelRegistry = { ...BASE, defaults: { gemini: 'gemini-2.5-flahs' } };
    const issues = validateModelConfig(registry);
    const warnings = issues.filter(i => i.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].modelId).toBe('gemini-2.5-flahs');
    expect(warnings[0].referenceSite).toBe('defaults.gemini');
    expect(warnings[0].message).toContain('gemini-2.5-flahs');
  });

  it('does not warn on a synthesized -latest alias in defaults', () => {
    const registry: ModelRegistry = { ...BASE, defaults: { gemini: 'gemini-flash-latest' } };
    expect(validateModelConfig(registry).filter(i => i.severity === 'warning')).toHaveLength(0);
  });

  it('does not warn on a real model id in defaults', () => {
    const registry: ModelRegistry = { ...BASE, defaults: { openai: 'openai-gpt-4o' } };
    expect(validateModelConfig(registry).filter(i => i.severity === 'warning')).toHaveLength(0);
  });

  it('returns no warnings for a coherent config (defaults + debateTiers)', () => {
    const registry: ModelRegistry = {
      ...BASE,
      defaults: { gemini: 'gemini-2.5-flash', openai: 'openai-gpt-4o' },
      debateTiers: {
        basic: { gemini: 'gemini-2.5-flash' },
        advanced: { openai: 'openai-gpt-4o' },
      },
    };
    expect(validateModelConfig(registry).filter(i => i.severity === 'warning')).toHaveLength(0);
  });

  it('flags an unmapped debateTiers value with the dotted tier.backend site', () => {
    const registry: ModelRegistry = {
      ...BASE,
      debateTiers: { advanced: { openai: 'openai-gpt-4o-does-not-exist' } },
    };
    const warnings = validateModelConfig(registry).filter(i => i.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].referenceSite).toBe('debateTiers.advanced.openai');
  });

  it('flags a pricing superset key as info (not a warning)', () => {
    const registry: ModelRegistry = {
      ...BASE,
      pricing: {
        'gpt-4o': { inputPer1M: 5, outputPer1M: 15 },       // matches models[].apiModelId
        'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 }, // superset, no matching model
      },
    };
    const issues = validateModelConfig(registry);
    expect(issues.filter(i => i.severity === 'warning')).toHaveLength(0);
    const infos = issues.filter(i => i.severity === 'info');
    expect(infos).toHaveLength(1);
    expect(infos[0].modelId).toBe('gemini-2.5-pro');
    expect(infos[0].referenceSite).toBe('pricing.gemini-2.5-pro');
  });

  it('skips underscore-prefixed keys (_comment) in defaults, tiers, and pricing', () => {
    const registry: ModelRegistry = {
      ...BASE,
      defaults: { _comment: 'a note', gemini: 'gemini-2.5-flash' } as Record<string, string>,
      debateTiers: {
        _comment: 'tier note' as unknown as Record<string, string>,
        advanced: { _comment: 'inner note', openai: 'openai-gpt-4o' } as Record<string, string>,
      },
      pricing: { _comment: { inputPer1M: 0, outputPer1M: 0 } },
    };
    expect(validateModelConfig(registry)).toHaveLength(0);
  });
});

describe('assertModelConfigValid', () => {
  const BASE: ModelRegistry = {
    backends: [{ id: 'openai', label: 'OpenAI' }],
    models: [{ id: 'openai-gpt-4o', apiModelId: 'gpt-4o', label: 'GPT-4o', backend: 'openai' }],
  };

  it('throws when a warning-severity issue exists', () => {
    const registry: ModelRegistry = { ...BASE, defaults: { openai: 'openai-typo' } };
    expect(() => assertModelConfigValid(registry)).toThrow(/openai-typo/);
  });

  it('does not throw for info-only issues (pricing superset)', () => {
    const registry: ModelRegistry = {
      ...BASE,
      pricing: { 'unmatched-model': { inputPer1M: 1, outputPer1M: 1 } },
    };
    expect(() => assertModelConfigValid(registry)).not.toThrow();
  });

  it('does not throw for a coherent config', () => {
    const registry: ModelRegistry = { ...BASE, defaults: { openai: 'openai-gpt-4o' } };
    expect(() => assertModelConfigValid(registry)).not.toThrow();
  });
});

describe('moonshot backend routing (t/1945)', () => {
  // The server path (aiBackends.ts generateText) uses the prefix-based
  // resolveBackend(model); without the moonshot branch it fell through to gemini.
  it('resolveBackend maps the moonshot prefix to moonshot, not gemini', () => {
    expect(resolveBackend('moonshot-kimi-k3')).toBe('moonshot');
    expect(resolveBackend('moonshot')).toBe('moonshot');
  });

  it('resolveModel resolves the moonshot prefix as a verbatim passthrough', () => {
    const registry: ModelRegistry = { ...TEST_REGISTRY, models: [] };
    expect(resolveModel(registry, 'moonshot-kimi-k3')).toEqual({
      apiModelId: 'moonshot-kimi-k3',
      backend: 'moonshot',
    });
  });

  it('getDefaultTimeout uses the moonshot (240s) budget, mirroring zai', () => {
    expect(getDefaultTimeout('moonshot-kimi-k3')).toBe(240_000);
  });
});
