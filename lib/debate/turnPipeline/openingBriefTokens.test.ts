// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4117: briefMaxTokens must be driven from ModelEntry.thinks_by_default, not model ID substring.
// Regression: claude-haiku-5-5 debates died in openings because the substring check only
// matched 'opus'/'fable'; haiku-5-5 (adaptive thinking) was silently uncapped.
//
// t/4121: plan/draft/cite stages also need a maxTokens cap on thinking models (same class).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runOpeningPipeline } from './opening.js';
import type { OpeningPipelineInput } from './opening.js';
import type { ModelRegistry } from '../../ai-client/registry.js';
import { POVER_INFO } from '../types.js';

const STUB_JSON = JSON.stringify({
  statement: 'test', claim_sketches: [], key_assumptions: [],
  beliefs: [], values: [], reasoning: [],
  plan: [], topics: [], taxonomy_refs: [], policy_refs: [],
});

function makeInput(overrides: Partial<OpeningPipelineInput> = {}): OpeningPipelineInput {
  return {
    label: 'TestAgent',
    pov: 'acc',
    soul: POVER_INFO.accelerationist,
    personality: 'test',
    topic: 'test topic',
    taxonomyContext: '',
    priorStatements: '',
    isFirst: true,
    model: 'test-model',
    ...overrides,
  };
}

function captureMaxTokens(briefModel: string, registry?: ModelRegistry): Promise<number | undefined> {
  let capturedMaxTokens: number | undefined;
  const generate = async (
    _prompt: string,
    model: string,
    opts: { maxTokens?: number } = {},
    label?: string,
  ) => {
    if ((label as string)?.includes('brief')) capturedMaxTokens = opts.maxTokens;
    return STUB_JSON;
  };
  return runOpeningPipeline(
    makeInput({ model: briefModel, briefModel, registry }),
    generate as any,
  ).then(() => capturedMaxTokens);
}

/** Capture the maxTokens passed to the plan stage (representative of plan/draft/cite). */
function captureStageMaxTokens(model: string, registry?: ModelRegistry): Promise<number | undefined> {
  let captured: number | undefined;
  const generate = async (
    _prompt: string,
    _model: string,
    opts: { maxTokens?: number } = {},
    label?: string,
  ) => {
    if ((label as string)?.includes('plan')) captured = opts.maxTokens;
    return STUB_JSON;
  };
  return runOpeningPipeline(
    makeInput({ model, registry }),
    generate as any,
  ).then(() => captured);
}

describe('opening brief — thinks_by_default budget (t/4117)', () => {
  it('sets 32_000 for a registry model with thinks_by_default: true', async () => {
    const registry: ModelRegistry = {
      backends: [],
      models: [{ id: 'claude-haiku-5-5', apiModelId: 'claude-haiku-5-5', label: 'Haiku 5.5', backend: 'claude', thinks_by_default: true }],
    };
    const maxTokens = await captureMaxTokens('claude-haiku-5-5', registry);
    expect(maxTokens).toBe(32_000);
  });

  it('sets undefined for a registry model WITHOUT thinks_by_default', async () => {
    const registry: ModelRegistry = {
      backends: [],
      models: [{ id: 'claude-haiku-4-5', apiModelId: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', backend: 'claude' }],
    };
    const maxTokens = await captureMaxTokens('claude-haiku-4-5', registry);
    expect(maxTokens).toBeUndefined();
  });

  it('falls back to 32_000 for opus/fable when no registry is passed (legacy callers)', async () => {
    const maxTokens = await captureMaxTokens('claude-opus-5');
    expect(maxTokens).toBe(32_000);
  });

  it('falls back to undefined for non-thinking models when no registry is passed', async () => {
    const maxTokens = await captureMaxTokens('some-other-model');
    expect(maxTokens).toBeUndefined();
  });

  it('registry flag takes precedence: thinks_by_default:false overrides opus substring', async () => {
    const registry: ModelRegistry = {
      backends: [],
      models: [{ id: 'claude-opus-5', apiModelId: 'claude-opus-5', label: 'Opus 5', backend: 'claude', thinks_by_default: false }],
    };
    // The registry says no; the substring would say yes. Registry wins.
    const maxTokens = await captureMaxTokens('claude-opus-5', registry);
    expect(maxTokens).toBeUndefined();
  });

  it('every thinks_by_default model in ai-models.json resolves to 32_000', async () => {
    const repoRoot = join(import.meta.dirname, '..', '..', '..');
    const registry: ModelRegistry = JSON.parse(readFileSync(join(repoRoot, 'ai-models.json'), 'utf-8'));
    const thinkingModels = registry.models.filter(m => m.thinks_by_default);

    expect(thinkingModels.length).toBeGreaterThan(0);

    for (const model of thinkingModels) {
      const maxTokens = await captureMaxTokens(model.id, registry);
      expect(maxTokens, `${model.id} should resolve to 32_000`).toBe(32_000);
    }
  });
});

describe('opening plan/draft/cite — stageMaxTokens budget (t/4121)', () => {
  it('sets 32_000 for a registry model with thinks_by_default: true', async () => {
    const registry: ModelRegistry = {
      backends: [],
      models: [{ id: 'claude-haiku-5-5', apiModelId: 'claude-haiku-5-5', label: 'Haiku 5.5', backend: 'claude', thinks_by_default: true }],
    };
    const maxTokens = await captureStageMaxTokens('claude-haiku-5-5', registry);
    expect(maxTokens).toBe(32_000);
  });

  it('sets undefined for a registry model WITHOUT thinks_by_default', async () => {
    const registry: ModelRegistry = {
      backends: [],
      models: [{ id: 'claude-haiku-4-5', apiModelId: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', backend: 'claude' }],
    };
    const maxTokens = await captureStageMaxTokens('claude-haiku-4-5', registry);
    expect(maxTokens).toBeUndefined();
  });
});
