import { describe, it, expect } from 'vitest';
import { checkUsageCurrency } from '../usageTypes.js';
import type { UsageRegistry } from '../usageTypes.js';
import type { ModelRegistry } from '../registry.js';

function makeRegistry(models: string[]): ModelRegistry {
  return {
    backends: [],
    models: models.map((id) => ({ id, apiModelId: id, label: id, backend: 'test' })),
  };
}

describe('checkUsageCurrency', () => {
  it('returns a result when usage pins an older model in a family', () => {
    const registry: UsageRegistry = {
      myUsage: { description: 'test', model: 'gemini-2.0-flash' },
    };
    const modelReg = makeRegistry(['gemini-2.0-flash', 'gemini-2.5-flash']);
    const results = checkUsageCurrency(registry, modelReg);
    expect(results).toHaveLength(1);
    expect(results[0].usageId).toBe('myUsage');
    expect(results[0].currentModel).toBe('gemini-2.0-flash');
    expect(results[0].newerModel).toBe('gemini-2.5-flash');
    expect(results[0].family).toBe('gemini-flash');
  });

  it('returns no results when usage already pins the newest model', () => {
    const registry: UsageRegistry = {
      myUsage: { description: 'test', model: 'gemini-2.5-flash' },
    };
    const modelReg = makeRegistry(['gemini-2.0-flash', 'gemini-2.5-flash']);
    expect(checkUsageCurrency(registry, modelReg)).toHaveLength(0);
  });

  it('skips usages with _intent: comparability', () => {
    const registry: UsageRegistry = {
      frozenUsage: { description: 'frozen', model: 'gemini-2.0-flash', _intent: 'comparability', comparabilityCorpus: 'batch-2024' },
    };
    const modelReg = makeRegistry(['gemini-2.0-flash', 'gemini-2.5-flash']);
    expect(checkUsageCurrency(registry, modelReg)).toHaveLength(0);
  });

  it('treats unannotated usages as current (flags drift)', () => {
    const registry: UsageRegistry = {
      unannotated: { description: 'no intent', model: 'claude-sonnet-4' },
    };
    const modelReg = makeRegistry(['claude-sonnet-4', 'claude-sonnet-5']);
    const results = checkUsageCurrency(registry, modelReg);
    expect(results).toHaveLength(1);
    expect(results[0].usageId).toBe('unannotated');
  });

  it('treats _intent: current usages the same as unannotated', () => {
    const registry: UsageRegistry = {
      explicitCurrent: { description: 'explicit', model: 'claude-opus-4', _intent: 'current' },
    };
    const modelReg = makeRegistry(['claude-opus-4', 'claude-opus-5']);
    const results = checkUsageCurrency(registry, modelReg);
    expect(results).toHaveLength(1);
    expect(results[0].family).toBe('claude-opus');
  });

  it('silently skips backends not covered by parseVersionedModelId', () => {
    const registry: UsageRegistry = {
      groqUsage: { description: 'groq', model: 'llama-3.1-70b' },
    };
    const modelReg = makeRegistry(['llama-3.1-70b', 'llama-3.2-70b']);
    // groq model ids are not parseable — should produce no results
    expect(checkUsageCurrency(registry, modelReg)).toHaveLength(0);
  });

  it('returns empty list when no usages exist', () => {
    const modelReg = makeRegistry(['gemini-2.5-flash']);
    expect(checkUsageCurrency({}, modelReg)).toHaveLength(0);
  });

  it('returns empty list when model registry has no parseable models', () => {
    const registry: UsageRegistry = {
      myUsage: { description: 'test', model: 'gemini-2.0-flash' },
    };
    expect(checkUsageCurrency(registry, makeRegistry([]))).toHaveLength(0);
  });
});
