// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { getModelCapabilities, filterByCapabilities } from './registry.js';
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
