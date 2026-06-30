// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { getModelCapabilities, filterByCapabilities, estimateCost } from './registry.js';
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
