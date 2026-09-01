// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveMultiProviderModels, resolveModelForPurpose, probeOllama, TaskTier } from './modelRouter.js';
import type { ModelRegistry } from './registry.js';
import type { FetchFn } from './types.js';

// ── Mocks for the Ollama-fallback logging tests (t/3178) ────────────────────
const mockIsOllamaAvailable = vi.fn();
const mockRecord = vi.fn();

vi.mock('./providers/ollama.js', () => ({
  isOllamaAvailable: (...args: unknown[]) => mockIsOllamaAvailable(...args),
}));
vi.mock('../flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

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

describe('resolveModelForPurpose — Ollama→cloud fallback logging (t/3178)', () => {
  const fakeFetch = (() => Promise.resolve(undefined)) as unknown as FetchFn;

  beforeEach(async () => {
    // Baseline every test as "Ollama available" so state + the warn-once gate start clean.
    mockRecord.mockClear();
    mockIsOllamaAvailable.mockReset().mockResolvedValue(true);
    await probeOllama(fakeFetch);
    mockRecord.mockClear();
  });

  it('emits an ai.fallback WARN with purpose + substituted model when Ollama is unavailable', async () => {
    mockIsOllamaAvailable.mockResolvedValue(false);
    await probeOllama(fakeFetch);

    const routed = await resolveModelForPurpose('summarization');
    expect(routed).toMatchObject({ model: 'gemini-3.5-flash-lite', isLocal: false, tier: TaskTier.LOCAL, purpose: 'summarization' });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const ev = mockRecord.mock.calls[0][0];
    expect(ev.type).toBe('ai.fallback');
    expect(ev.level).toBe('warn');
    expect(ev.data).toMatchObject({ purpose: 'summarization', substitutedModel: 'gemini-3.5-flash-lite', reason: 'ollama_unavailable' });
  });

  it('warns once per unavailable episode, not on every routed call', async () => {
    mockIsOllamaAvailable.mockResolvedValue(false);
    await probeOllama(fakeFetch);
    await resolveModelForPurpose('summarization');
    await resolveModelForPurpose('fallacy_analysis');
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it('does not warn when Ollama is available (local route taken)', async () => {
    const routed = await resolveModelForPurpose('summarization');
    expect(routed).toMatchObject({ model: 'ollama-gemma4-e4b', isLocal: true });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('re-arms the warning after a fresh probe (new outage episode)', async () => {
    mockIsOllamaAvailable.mockResolvedValue(false);
    await probeOllama(fakeFetch);
    await resolveModelForPurpose('summarization'); // episode 1 → warn
    mockIsOllamaAvailable.mockResolvedValue(true);
    await probeOllama(fakeFetch);                  // recovery re-arms the gate
    mockIsOllamaAvailable.mockResolvedValue(false);
    await probeOllama(fakeFetch);                  // episode 2
    await resolveModelForPurpose('summarization'); // → warn again
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });
});
