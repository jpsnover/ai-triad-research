// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { resolveMultiProviderModels } from './modelRouter.js';
import type { ModelRegistry } from './registry.js';

const TEST_REGISTRY: ModelRegistry = {
  backends: [],
  models: [],
  debateTiers: {
    basic: {
      gemini: 'gemini-3.5-flash-lite',
      claude: 'claude-haiku-4-5',
      groq: 'groq-llama-3.1-8b-instant',
    },
    advanced: {
      gemini: 'gemini-2.5-pro',
      claude: 'claude-sonnet-4-6',
      groq: 'groq-llama-3.3-70b-versatile',
    },
  },
};

const SPEAKERS = ['accelerationist', 'safetyist', 'skeptic'];

describe('resolveMultiProviderModels', () => {
  it('assigns unique backends when 3+ are available', () => {
    const result = resolveMultiProviderModels('basic', ['gemini', 'claude', 'groq'], SPEAKERS, TEST_REGISTRY);
    const models = Object.values(result);
    expect(models).toHaveLength(3);
    const backends = new Set(models);
    expect(backends.size).toBe(3);
    for (const model of models) {
      expect(TEST_REGISTRY.debateTiers!.basic).toHaveProperty(
        Object.entries(TEST_REGISTRY.debateTiers!.basic).find(([, v]) => v === model)![0],
      );
    }
  });

  it('doubles one backend when only 2 are available', () => {
    const result = resolveMultiProviderModels('basic', ['gemini', 'claude'], SPEAKERS, TEST_REGISTRY);
    const models = Object.values(result);
    expect(models).toHaveLength(3);
    const unique = new Set(models);
    expect(unique.size).toBe(2);
  });

  it('assigns all speakers the same model when only 1 backend is available', () => {
    const result = resolveMultiProviderModels('advanced', ['claude'], SPEAKERS, TEST_REGISTRY);
    const models = Object.values(result);
    expect(models).toHaveLength(3);
    expect(new Set(models).size).toBe(1);
    expect(models[0]).toBe('claude-sonnet-4-6');
  });

  it('throws ActionableError when 0 backends are available', () => {
    expect(() => resolveMultiProviderModels('basic', [], SPEAKERS, TEST_REGISTRY))
      .toThrow(/No available backends/);
  });

  it('throws ActionableError when no backends overlap with tier', () => {
    expect(() => resolveMultiProviderModels('basic', ['openai', 'deepseek'], SPEAKERS, TEST_REGISTRY))
      .toThrow(/No available backends/);
  });

  it('throws ActionableError for unknown tier', () => {
    expect(() => resolveMultiProviderModels('ultra' as any, ['gemini'], SPEAKERS, TEST_REGISTRY))
      .toThrow(/Unknown debate tier/);
  });

  it('uses correct tier models (basic vs advanced)', () => {
    const basic = resolveMultiProviderModels('basic', ['gemini'], SPEAKERS, TEST_REGISTRY);
    expect(Object.values(basic).every(m => m === 'gemini-3.5-flash-lite')).toBe(true);

    const advanced = resolveMultiProviderModels('advanced', ['gemini'], SPEAKERS, TEST_REGISTRY);
    expect(Object.values(advanced).every(m => m === 'gemini-2.5-pro')).toBe(true);
  });

  it('assigns to all requested speakers', () => {
    const result = resolveMultiProviderModels('basic', ['gemini', 'claude', 'groq'], SPEAKERS, TEST_REGISTRY);
    expect(Object.keys(result).sort()).toEqual(['accelerationist', 'safetyist', 'skeptic']);
  });

  it('distributes without systematic bias over many iterations', () => {
    const counts: Record<string, number> = { gemini: 0, claude: 0, groq: 0 };
    const backends = ['gemini', 'claude', 'groq'];
    for (let i = 0; i < 300; i++) {
      const result = resolveMultiProviderModels('basic', backends, SPEAKERS, TEST_REGISTRY);
      for (const model of Object.values(result)) {
        const backend = Object.entries(TEST_REGISTRY.debateTiers!.basic).find(([, v]) => v === model)![0];
        counts[backend]++;
      }
    }
    // 900 total assignments across 3 backends → expected ~300 each.
    // With Fisher-Yates, each backend should appear at least 200 times.
    for (const b of backends) {
      expect(counts[b]).toBeGreaterThan(200);
    }
  });

  it('filters unavailable backends from assignment', () => {
    const result = resolveMultiProviderModels('basic', ['gemini', 'groq'], SPEAKERS, TEST_REGISTRY);
    const models = Object.values(result);
    for (const m of models) {
      expect(m).not.toBe('claude-haiku-4-5');
    }
  });
});
