// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3946 (binding design t/3946#5, after SO e/248): `pricing` is keyed by models[].id. Synthetic
// registries only: the real file is checked WARN-only by verify:config, so asserting it here would
// make the gate blocking before Root Main's backfill lands.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { findPricingKeyIssues, resolvePricingKey, estimateCost, type ModelRegistry, type ModelPricing } from './registry.js';
import { createAIClient } from './client.js';
import type { FetchFn } from './types.js';

type M = { id: string; apiModelId?: string; backend: string; picker?: boolean };
function reg(models: M[], pricing: Record<string, ModelPricing>, extra: Partial<ModelRegistry> = {}): ModelRegistry {
  return {
    backends: [],
    models: models.map((m) => ({
      id: m.id, apiModelId: m.apiModelId ?? m.id, label: m.id, backend: m.backend,
      ...(m.picker ? { picker: { label: m.id, order: 1 } } : {}),
    })),
    pricing,
    ...extra,
  };
}
const P = (inputPer1M: number): ModelPricing => ({ inputPer1M, outputPer1M: 0, cachedInputPer1M: inputPer1M });

// The four apiModelIds azure and openai share on origin/main, priced DIFFERENTLY per backend. Today's
// real data leaves them unpriced, so only a fixture exercises the case that can diverge (SO e/248#2).
const DUP_APIS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'];
const dupModels: M[] = DUP_APIS.flatMap((a) => [
  { id: `azure-${a}`, apiModelId: a, backend: 'azure', picker: true },
  { id: `openai-${a}`, apiModelId: a, backend: 'openai', picker: true },
]);
const dupPricing: Record<string, ModelPricing> = Object.fromEntries(
  DUP_APIS.flatMap((a, i) => [[`azure-${a}`, P(10 + i)], [`openai-${a}`, P(20 + i)]]),
);

describe('findPricingKeyIssues (t/3946)', () => {
  const warnings = (r: ModelRegistry) => findPricingKeyIssues(r).filter((i) => i.severity === 'warning');

  it('CLEAN: every key is an id, every reachable model is priced, pairs are unique', () => {
    expect(warnings(reg([{ id: 'claude-x', backend: 'claude', picker: true }], { 'claude-x': P(1) }))).toEqual([]);
  });

  it('WARNS on a pricing key that is not a models[].id, and suggests the id when it is an apiModelId', () => {
    const w = warnings(reg([{ id: 'claude-haiku', apiModelId: 'claude-haiku-20251001', backend: 'claude' }],
      { 'claude-haiku-20251001': P(1), orphan: P(1) }));
    expect(w.map((i) => i.modelId).sort()).toEqual(['claude-haiku-20251001', 'orphan']);
    expect(w.find((i) => i.modelId === 'claude-haiku-20251001')!.message).toContain('re-key it to that id');
  });

  it('WARNS on a reachable model with no pricing entry, once per model', () => {
    const r = reg([{ id: 'claude-x', backend: 'claude', picker: true }], {}, { defaults: { claude: 'claude-x' } });
    const w = warnings(r);
    expect(w).toHaveLength(1);
    expect(w[0].modelId).toBe('claude-x');
    expect(w[0].message).toMatch(/no pricing entry/);
  });

  it('does NOT warn on an unreachable unpriced model (unreachable is out of scope)', () => {
    expect(warnings(reg([{ id: 'claude-hidden', backend: 'claude' }], {}))).toEqual([]);
  });

  it('WARNS when two models share a (backend, apiModelId) pair (the PS map would not be a function)', () => {
    const r = reg([{ id: 'a', apiModelId: 'same', backend: 'openai' }, { id: 'b', apiModelId: 'same', backend: 'openai' }],
      { a: P(1), b: P(2) });
    const w = warnings(r);
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('(openai, same)');
  });

  it('reports an apiModelId shared ACROSS backends as INFO only, never a warning (SO e/248#2)', () => {
    const all = findPricingKeyIssues(reg(dupModels, dupPricing));
    expect(all.filter((i) => i.severity === 'warning')).toEqual([]);
    expect(all.filter((i) => i.severity === 'info').map((i) => i.modelId).sort()).toEqual([...DUP_APIS].sort());
  });

  it('skips _-prefixed keys explicitly (pricing._comment is not an orphan)', () => {
    const r = reg([{ id: 'claude-x', backend: 'claude' }], { 'claude-x': P(1), _comment: 'note' as unknown as ModelPricing });
    expect(warnings(r)).toEqual([]);
  });
});

describe('resolvePricingKey (t/3946): by id, never by bare apiModelId', () => {
  it('resolves each duplicated pair to its OWN backend price', () => {
    const r = reg(dupModels, dupPricing);
    for (const [i, a] of DUP_APIS.entries()) {
      expect(estimateCost(r, `azure-${a}`, { promptTokens: 1_000_000 })).toBeCloseTo(10 + i);
      expect(estimateCost(r, `openai-${a}`, { promptTokens: 1_000_000 })).toBeCloseTo(20 + i);
    }
  });

  it('does NOT resolve a bare apiModelId to a price', () => {
    expect(resolvePricingKey(reg(dupModels, dupPricing), 'gpt-4o')).toBeUndefined();
  });

  it('resolves a -latest alias to its concrete entry', () => {
    const r = reg([{ id: 'claude-opus-4', backend: 'claude' }, { id: 'claude-opus-5', backend: 'claude' }], { 'claude-opus-5': P(5) });
    expect(resolvePricingKey(r, 'claude-opus-latest')).toBe('claude-opus-5');
  });

  it('returns undefined for an unpriced model and for a _-prefixed key', () => {
    const r = reg([{ id: 'x', backend: 'claude' }], { _comment: 'n' as unknown as ModelPricing });
    expect(resolvePricingKey(r, 'x')).toBeUndefined();
    expect(resolvePricingKey(r, '_comment')).toBeUndefined();
  });
});

describe('createAIClient cost summary (t/3946#5 item 5: TS fails closed)', () => {
  function okFetch(): FetchFn {
    return (async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    }), { status: 200 })) as unknown as FetchFn;
  }
  // apiModelId differs from id (a dated wire id, like Haiku 4.5), so the test fails if the client
  // ever goes back to pricing by apiModelId.
  const r = reg([
    { id: 'claude-priced', apiModelId: 'claude-priced-20260101', backend: 'claude' },
    { id: 'claude-unpriced', backend: 'claude' },
  ], { 'claude-priced': P(3) });

  it('prices by the friendly id and counts unpriced calls instead of silently leaving them out', async () => {
    const client = createAIClient({ fetch: okFetch(), resolveApiKey: () => 'k' }, r);
    await client.generateText('p', 'claude-priced', { timeoutMs: 5000 });
    await client.generateText('p', 'claude-unpriced', { timeoutMs: 5000 });
    await client.generateText('p', 'claude-unpriced', { timeoutMs: 5000 });
    const s = client.getCostSummary();
    expect(s.accumulatedCostUsd).toBeCloseTo(3);
    expect(s.pricedCalls).toBe(1);
    expect(s.unpricedCalls).toBe(2);
  });
});
