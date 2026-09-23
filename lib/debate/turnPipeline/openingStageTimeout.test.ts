// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3612 seam tests: proves stageTimeoutMs reaches plan/draft/cite generate calls.
// Test plan from t/3612#5 — tests use getMinTimeout=>0 (stub) and direct input.stageTimeoutMs
// to avoid the t/3568 shape (injecting a working impl that hides the broken path).

import { describe, it, expect } from 'vitest';
import { runOpeningPipelineWithRepair, runOpeningPipeline } from './opening.js';
import type { OpeningPipelineInput } from './opening.js';

const STUB_JSON = JSON.stringify({
  statement: 'test', claim_sketches: [], key_assumptions: [],
  beliefs: [], values: [], reasoning: [],
  plan: [], topics: [], taxonomy_refs: [], policy_refs: [],
});

function makeInput(overrides: Partial<OpeningPipelineInput> = {}): OpeningPipelineInput {
  return {
    label: 'TestAgent',
    pov: 'acc',
    personality: 'test',
    topic: 'test topic',
    taxonomyContext: '',
    priorStatements: '',
    isFirst: true,
    model: 'test-model',
    ...overrides,
  };
}

describe('opening pipeline — stageTimeoutMs threading (t/3612)', () => {
  it('passes stageTimeoutMs to plan/draft/cite when set on input', async () => {
    const captured: Record<string, number | undefined>[] = [];
    const generate = async (
      _prompt: string,
      _model: string,
      opts: { temperature?: number; timeoutMs?: number } = {},
      label?: string,
    ) => {
      captured.push({ label: label as string, timeoutMs: opts.timeoutMs });
      return STUB_JSON;
    };

    await runOpeningPipeline(
      makeInput({ stageTimeoutMs: 400_000 }),
      generate as any,
    );

    const planCapture = captured.find(c => c.label?.includes('plan'));
    const draftCapture = captured.find(c => c.label?.includes('draft'));
    const citeCapture = captured.find(c => c.label?.includes('cite'));

    expect(planCapture?.timeoutMs).toBe(400_000);
    expect(draftCapture?.timeoutMs).toBe(400_000);
    expect(citeCapture?.timeoutMs).toBe(400_000);
  });

  it('passes undefined to plan/draft/cite when stageTimeoutMs is 0 (stub path)', async () => {
    const captured: Record<string, number | undefined>[] = [];
    const generate = async (
      _prompt: string,
      _model: string,
      opts: { temperature?: number; timeoutMs?: number } = {},
      label?: string,
    ) => {
      captured.push({ label: label as string, timeoutMs: opts.timeoutMs });
      return STUB_JSON;
    };

    await runOpeningPipeline(
      makeInput({ stageTimeoutMs: 0 }),
      generate as any,
    );

    const planCapture = captured.find(c => c.label?.includes('plan'));
    const draftCapture = captured.find(c => c.label?.includes('draft'));
    const citeCapture = captured.find(c => c.label?.includes('cite'));

    // 0 || undefined = undefined → adapter default applies, no regression
    expect(planCapture?.timeoutMs).toBeUndefined();
    expect(draftCapture?.timeoutMs).toBeUndefined();
    expect(citeCapture?.timeoutMs).toBeUndefined();
  });

  it('runOpeningPipelineWithRepair with stub getMinTimeout leaves stages unrestricted', async () => {
    const captured: Record<string, number | undefined>[] = [];
    const generate = async (
      _prompt: string,
      _model: string,
      opts: { temperature?: number; timeoutMs?: number } = {},
      label?: string,
    ) => {
      captured.push({ label: label as string, timeoutMs: opts.timeoutMs });
      return STUB_JSON;
    };

    await runOpeningPipelineWithRepair(
      makeInput(),
      generate as any,
      undefined,
      undefined,
      (_model) => 0, // the electron stub
    );

    const planCapture = captured.find(c => c.label?.includes('plan'));
    expect(planCapture?.timeoutMs).toBeUndefined();
  });

  it('runOpeningPipelineWithRepair with real getMinTimeout threads value to stages', async () => {
    const captured: Record<string, number | undefined>[] = [];
    const generate = async (
      _prompt: string,
      _model: string,
      opts: { temperature?: number; timeoutMs?: number } = {},
      label?: string,
    ) => {
      captured.push({ label: label as string, timeoutMs: opts.timeoutMs });
      return STUB_JSON;
    };

    await runOpeningPipelineWithRepair(
      makeInput(),
      generate as any,
      undefined,
      undefined,
      (_model) => 400_000,
    );

    const planCapture = captured.find(c => c.label?.includes('plan'));
    const draftCapture = captured.find(c => c.label?.includes('draft'));
    const citeCapture = captured.find(c => c.label?.includes('cite'));

    expect(planCapture?.timeoutMs).toBe(400_000);
    expect(draftCapture?.timeoutMs).toBe(400_000);
    expect(citeCapture?.timeoutMs).toBe(400_000);
  });
});
