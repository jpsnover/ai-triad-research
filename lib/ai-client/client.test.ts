// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { createAIClient } from './client.js';
import type { ModelRegistry } from './registry.js';
import type { AIClientDeps } from './client.js';

const TEST_REGISTRY: ModelRegistry = {
  backends: [{ id: 'gemini', label: 'Gemini' }],
  models: [
    { id: 'gemini-2.5-flash', apiModelId: 'gemini-2.5-flash', label: 'Flash', backend: 'gemini' },
  ],
  pricing: {
    'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5 },
  },
};

function mockDeps(responseText: string, usage?: { promptTokens?: number; completionTokens?: number }): AIClientDeps {
  return {
    fetch: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        candidates: [{ content: { parts: [{ text: responseText }] } }],
        usageMetadata: usage ? {
          promptTokenCount: usage.promptTokens ?? 0,
          candidatesTokenCount: usage.completionTokens ?? 0,
          totalTokenCount: (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
        } : undefined,
      })),
    }),
    resolveApiKey: vi.fn().mockResolvedValue('test-key'),
    onUsage: vi.fn(),
  };
}

const FAST_RETRY = { maxRetries: 1, strategy: 'exponential' as const, maxBackoffS: 0 };

describe('createAIClient — cost calculation', () => {
  it('attaches estimatedCostUsd to ProviderResult', async () => {
    const deps = mockDeps('Hello', { promptTokens: 1000, completionTokens: 500 });
    const client = createAIClient(deps, TEST_REGISTRY, FAST_RETRY);

    const result = await client.generateText('test', 'gemini-2.5-flash');

    // (1000/1M)*0.3 + (500/1M)*2.5 = 0.0003 + 0.00125 = 0.00155
    expect(result.estimatedCostUsd).toBeCloseTo(0.00155, 6);
  });

  it('leaves estimatedCostUsd undefined when no pricing data', async () => {
    const noPricingRegistry: ModelRegistry = { ...TEST_REGISTRY, pricing: undefined };
    const deps = mockDeps('Hello', { promptTokens: 1000, completionTokens: 500 });
    const client = createAIClient(deps, noPricingRegistry, FAST_RETRY);

    const result = await client.generateText('test', 'gemini-2.5-flash');

    expect(result.estimatedCostUsd).toBeUndefined();
  });
});

describe('createAIClient — budget caps', () => {
  it('throws when accumulated cost exceeds maxCostUsd', async () => {
    const deps = mockDeps('Hello', { promptTokens: 100_000, completionTokens: 50_000 });
    const client = createAIClient(deps, TEST_REGISTRY, FAST_RETRY);

    // First call: (100k/1M)*0.3 + (50k/1M)*2.5 = 0.03 + 0.125 = 0.155
    await client.generateText('first call', 'gemini-2.5-flash', { maxCostUsd: 1.0 });

    // Second call with low cap should fail because accumulated > 0.10
    await expect(
      client.generateText('second call', 'gemini-2.5-flash', { maxCostUsd: 0.10 }),
    ).rejects.toThrow('Budget exceeded');
  });

  it('allows calls when under budget', async () => {
    const deps = mockDeps('Hello', { promptTokens: 1000, completionTokens: 500 });
    const client = createAIClient(deps, TEST_REGISTRY, FAST_RETRY);

    // Cost per call: ~0.00155 — well under 1.0
    const result1 = await client.generateText('call 1', 'gemini-2.5-flash', { maxCostUsd: 1.0 });
    const result2 = await client.generateText('call 2', 'gemini-2.5-flash', { maxCostUsd: 1.0 });

    expect(result1.text).toBe('Hello');
    expect(result2.text).toBe('Hello');
  });

  it('blocks immediately when maxCostUsd is 0', async () => {
    const deps = mockDeps('Hello', { promptTokens: 1000, completionTokens: 500 });
    const client = createAIClient(deps, TEST_REGISTRY, FAST_RETRY);

    await expect(
      client.generateText('dry run', 'gemini-2.5-flash', { maxCostUsd: 0 }),
    ).rejects.toThrow('Budget exceeded');

    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('does not track cost when pricing data is missing', async () => {
    const noPricingRegistry: ModelRegistry = { ...TEST_REGISTRY, pricing: undefined };
    const deps = mockDeps('Hello', { promptTokens: 1_000_000, completionTokens: 1_000_000 });
    const client = createAIClient(deps, noPricingRegistry, FAST_RETRY);

    // Even huge token counts shouldn't trigger budget since no pricing = no cost tracking
    await client.generateText('call 1', 'gemini-2.5-flash', { maxCostUsd: 0.001 });
    await client.generateText('call 2', 'gemini-2.5-flash', { maxCostUsd: 0.001 });
    // Both succeed — accumulated stays at 0
  });

  it('budget resets with new client instance', async () => {
    const deps = mockDeps('Hello', { promptTokens: 100_000, completionTokens: 50_000 });
    const client1 = createAIClient(deps, TEST_REGISTRY, FAST_RETRY);

    await client1.generateText('call', 'gemini-2.5-flash', { maxCostUsd: 1.0 });

    // New client — fresh budget
    const client2 = createAIClient(deps, TEST_REGISTRY, FAST_RETRY);
    const result = await client2.generateText('call', 'gemini-2.5-flash', { maxCostUsd: 0.20 });
    expect(result.text).toBe('Hello');
  });
});
