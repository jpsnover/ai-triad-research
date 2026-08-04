// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UsageCallDeps } from './usageRegistry.js';
import type { UsageConfig } from './usageTypes.js';

// ── Mock fs (used by loadUsageRegistry and loadModelRegistry) ───────────

const mockExistsSync = vi.fn().mockReturnValue(true);
const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...actual, join: (...parts: string[]) => parts.join('/') };
});

// ── Mock callProvider ───────────────────────────────────────────────────

const mockCallProvider = vi.fn();

vi.mock('./client.js', () => ({
  callProvider: (...args: unknown[]) => mockCallProvider(...args),
}));

// ── Mock flight recorder ────────────────────────────────────────────────

const mockRecord = vi.fn();

vi.mock('../flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

// ── Test data ───────────────────────────────────────────────────────────

const TEST_USAGES: Record<string, UsageConfig> = {
  'enrichment.test': {
    description: 'Test enrichment usage',
    model: 'gemini-2.5-flash',
    temperature: 0.3,
    maxTokens: 1024,
    timeoutMs: 30000,
    systemMessage: 'You are a helpful assistant.',
    messageTemplate: 'Process: {{input_text}}',
    tags: ['enrichment', 'test'],
  },
  'debate.brief': {
    description: 'Generate debate brief',
    model: 'gemini-2.5-flash',
    temperature: 0.5,
    maxTokens: 4096,
    timeoutMs: 120000,
    systemMessageTemplate: 'You are {{speaker}}, a {{persona}} debater.',
    messageTemplate: 'Topic: {{topic}}\nHistory: {{history}}',
    tags: ['debate'],
  },
  'enrichment.simple': {
    description: 'Simple enrichment with fixed message',
    model: 'gemini-2.5-flash',
    message: 'Fixed prompt text',
    tags: ['enrichment'],
  },
  'moonshot.test': {
    description: 'Usage targeting a fixedTemperature model',
    model: 'moonshot-kimi-k3',
    message: 'Test prompt',
    temperature: 0.7,
  },
};

const TEST_MODELS = {
  backends: [{ id: 'gemini', label: 'Gemini' }, { id: 'moonshot', label: 'Moonshot' }],
  models: [
    { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Flash', backend: 'gemini' },
    { id: 'claude-sonnet-4-6', apiModelId: 'claude-sonnet-4-6', label: 'Sonnet', backend: 'claude' },
    { id: 'moonshot-kimi-k3', apiModelId: 'kimi-k3', label: 'Kimi K3', backend: 'moonshot', fixedTemperature: 1 },
  ],
};

function setupRegistryFiles() {
  mockReadFileSync.mockImplementation((filePath: string) => {
    if (String(filePath).includes('ai-usages.json')) return JSON.stringify(TEST_USAGES);
    if (String(filePath).includes('ai-models.json')) return JSON.stringify(TEST_MODELS);
    throw new Error(`Unexpected file read: ${filePath}`);
  });
}

function makeDeps(overrides?: Partial<UsageCallDeps>): UsageCallDeps {
  return {
    repoRoot: '/repo',
    fetch: vi.fn(),
    resolveApiKey: vi.fn().mockResolvedValue('test-key'),
    onUsage: vi.fn(),
    ...overrides,
  };
}

const PROVIDER_RESULT = {
  text: 'AI response text',
  usage: { promptTokens: 100, completionTokens: 50 },
};

// ── Tests ───────────────────────────────────────────────────────────────

// Dynamic import AFTER mocks are registered
const { callByUsage, getUsage, listUsages, clearUsageRegistryCache } = await import('./usageRegistry.js');

describe('getUsage', () => {
  beforeEach(() => {
    clearUsageRegistryCache();
    vi.clearAllMocks();
    setupRegistryFiles();
  });

  it('returns config for known UsageID', () => {
    const config = getUsage('enrichment.test', '/repo');
    expect(config.description).toBe('Test enrichment usage');
    expect(config.model).toBe('gemini-2.5-flash');
  });

  it('throws ActionableError for unknown UsageID', () => {
    expect(() => getUsage('nonexistent.usage', '/repo')).toThrow('Unknown UsageID "nonexistent.usage"');
  });
});

describe('listUsages', () => {
  beforeEach(() => {
    clearUsageRegistryCache();
    vi.clearAllMocks();
    setupRegistryFiles();
  });

  it('returns all entries when no tag filter', () => {
    const all = listUsages('/repo');
    expect(all).toHaveLength(4);
    expect(all.map(e => e.id)).toContain('enrichment.test');
    expect(all.map(e => e.id)).toContain('debate.brief');
  });

  it('filters by tag', () => {
    const enrichment = listUsages('/repo', 'enrichment');
    expect(enrichment).toHaveLength(2);
    expect(enrichment.map(e => e.id)).toContain('enrichment.test');
    expect(enrichment.map(e => e.id)).toContain('enrichment.simple');
  });

  it('returns empty array for unmatched tag', () => {
    const result = listUsages('/repo', 'nonexistent-tag');
    expect(result).toEqual([]);
  });
});

describe('callByUsage', () => {
  beforeEach(() => {
    clearUsageRegistryCache();
    vi.clearAllMocks();
    setupRegistryFiles();
    mockCallProvider.mockResolvedValue(PROVIDER_RESULT);
  });

  it('resolves template, model, and delegates to callProvider', async () => {
    const deps = makeDeps();
    const result = await callByUsage('enrichment.test', { input_text: 'hello world' }, deps);

    expect(result.text).toBe('AI response text');
    expect(mockCallProvider).toHaveBeenCalledOnce();

    const [fetchFn, backend, prompt, apiModelId, apiKey, opts] = mockCallProvider.mock.calls[0];
    expect(backend).toBe('gemini');
    expect(prompt).toBe('Process: hello world');
    expect(apiModelId).toBe('gemini-2.5-flash');
    expect(apiKey).toBe('test-key');
    expect(opts.systemMessage).toBe('You are a helpful assistant.');
    expect(opts.temperature).toBe(0.3);
    expect(opts.maxTokens).toBe(1024);
    expect(opts.timeoutMs).toBe(30000);
  });

  it('renders systemMessageTemplate with values', async () => {
    const deps = makeDeps();
    await callByUsage('debate.brief', {
      speaker: 'Alice',
      persona: 'accelerationist',
      topic: 'AI governance',
      history: 'Round 1 summary',
    }, deps);

    const [, , prompt, , , opts] = mockCallProvider.mock.calls[0];
    expect(opts.systemMessage).toBe('You are Alice, a accelerationist debater.');
    expect(prompt).toBe('Topic: AI governance\nHistory: Round 1 summary');
  });

  it('uses fixed message when no messageTemplate', async () => {
    const deps = makeDeps();
    await callByUsage('enrichment.simple', {}, deps);

    const [, , prompt] = mockCallProvider.mock.calls[0];
    expect(prompt).toBe('Fixed prompt text');
  });

  it('applies overrides on top of base config', async () => {
    const deps = makeDeps();
    await callByUsage('enrichment.test', { input_text: 'data' }, deps, {
      temperature: 0.9,
      maxTokens: 8192,
    });

    const [, , , , , opts] = mockCallProvider.mock.calls[0];
    expect(opts.temperature).toBe(0.9);
    expect(opts.maxTokens).toBe(8192);
    expect(opts.timeoutMs).toBe(30000);
  });

  it('model override changes resolved backend', async () => {
    const deps = makeDeps();
    await callByUsage('enrichment.test', { input_text: 'data' }, deps, {
      model: 'claude-sonnet-4-6',
    });

    const [, backend, , apiModelId] = mockCallProvider.mock.calls[0];
    expect(backend).toBe('claude');
    expect(apiModelId).toBe('claude-sonnet-4-6');
  });

  it('carries fixedTemperature from registry entry to provider opts (t/2107)', async () => {
    const deps = makeDeps();
    await callByUsage('moonshot.test', {}, deps);

    const [, backend, , apiModelId, , opts] = mockCallProvider.mock.calls[0];
    expect(backend).toBe('moonshot');
    expect(apiModelId).toBe('kimi-k3');
    expect(opts.fixedTemperature).toBe(1);
  });

  it('throws ActionableError for unknown UsageID', async () => {
    const deps = makeDeps();
    await expect(callByUsage('nonexistent', {}, deps)).rejects.toThrow('Unknown UsageID "nonexistent"');
    expect(mockCallProvider).not.toHaveBeenCalled();
  });

  it('throws ActionableError for missing template variable', async () => {
    const deps = makeDeps();
    await expect(callByUsage('enrichment.test', {}, deps)).rejects.toThrow('Missing template variable: {{input_text}}');
    expect(mockCallProvider).not.toHaveBeenCalled();
  });

  it('fires onUsage AFTER the call with latency and usage', async () => {
    const onUsage = vi.fn();
    const deps = makeDeps({ onUsage });
    await callByUsage('enrichment.test', { input_text: 'data' }, deps);

    expect(onUsage).toHaveBeenCalledOnce();
    const [backend, model, latencyMs, usage] = onUsage.mock.calls[0];
    expect(backend).toBe('gemini');
    expect(model).toBe('gemini-2.5-flash');
    expect(typeof latencyMs).toBe('number');
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    expect(usage).toEqual({ promptTokens: 100, completionTokens: 50 });
  });
});

describe('callByUsage — flight recorder', () => {
  beforeEach(() => {
    clearUsageRegistryCache();
    vi.clearAllMocks();
    setupRegistryFiles();
    mockCallProvider.mockResolvedValue(PROVIDER_RESULT);
  });

  it('records ai.call_by_usage event with value keys', async () => {
    const deps = makeDeps();
    await callByUsage('enrichment.test', { input_text: 'secret data' }, deps);

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ai.call_by_usage',
        component: 'usage-registry',
        level: 'info',
        data: expect.objectContaining({
          usageId: 'enrichment.test',
          model: 'gemini-2.5-flash',
          backend: 'gemini',
          hasOverrides: false,
          valueKeys: ['input_text'],
        }),
      }),
    );
  });

  it('does not log template values (PII safety)', async () => {
    const deps = makeDeps();
    await callByUsage('enrichment.test', { input_text: 'sensitive document text' }, deps);

    const recordedData = mockRecord.mock.calls[0][0].data;
    expect(recordedData.valueKeys).toEqual(['input_text']);
    expect(JSON.stringify(recordedData)).not.toContain('sensitive document text');
  });
});

describe('clearUsageRegistryCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupRegistryFiles();
  });

  it('forces re-read on next access after clear', () => {
    getUsage('enrichment.test', '/repo');
    const readCount1 = mockReadFileSync.mock.calls.length;

    // Cached — no additional reads
    getUsage('enrichment.test', '/repo');
    expect(mockReadFileSync.mock.calls.length).toBe(readCount1);

    // Clear and re-access — triggers new reads
    clearUsageRegistryCache();
    getUsage('enrichment.test', '/repo');
    expect(mockReadFileSync.mock.calls.length).toBeGreaterThan(readCount1);
  });
});
