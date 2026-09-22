// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3521 seam test: proves that runOpeningPipelineWithRepair applies the
// brief-timeout floor before delegating to runOpeningPipeline.
// If the floor arithmetic is removed or the function bypasses it, these fail.

import { describe, it, expect } from 'vitest';
import { runOpeningPipelineWithRepair, DEFAULT_BRIEF_TIMEOUT_MS } from './turnPipeline/opening.js';
import type { OpeningPipelineInput } from './turnPipeline/opening.js';
import type { GenerateOptions } from './aiAdapter.js';

const minimalInput: OpeningPipelineInput = {
  label: 'Test',
  pov: 'acc',
  personality: 'test-personality',
  topic: 'test topic',
  taxonomyContext: '',
  priorStatements: '',
  isFirst: true,
  model: 'test-model',
};

/** Capture timeoutMs from the first generate call (the brief stage). */
async function captureFirstBriefTimeout(
  input: OpeningPipelineInput,
  getMinTimeout?: (model: string) => number,
): Promise<number | undefined> {
  let captured: number | undefined;
  const generate = async (
    _prompt: string,
    _model: string,
    opts: GenerateOptions,
    _label: string,
  ): Promise<string> => {
    if (captured === undefined) captured = opts.timeoutMs;
    return '{}';
  };
  try {
    await runOpeningPipelineWithRepair(input, generate, undefined, undefined, getMinTimeout);
  } catch {
    // pipeline throws on unparseable mock responses — we only need the call log
  }
  return captured;
}

describe('runOpeningPipelineWithRepair brief-timeout floor (t/3521)', () => {
  it('uses DEFAULT_BRIEF_TIMEOUT_MS when input has no briefTimeoutMs and getMinTimeout is absent', async () => {
    const timeout = await captureFirstBriefTimeout(minimalInput);
    expect(timeout).toBe(DEFAULT_BRIEF_TIMEOUT_MS);
  });

  it('uses getMinTimeout result when it exceeds DEFAULT_BRIEF_TIMEOUT_MS', async () => {
    const modelMin = DEFAULT_BRIEF_TIMEOUT_MS + 30_000;
    const timeout = await captureFirstBriefTimeout(minimalInput, () => modelMin);
    expect(timeout).toBe(modelMin);
  });

  it('uses DEFAULT_BRIEF_TIMEOUT_MS when getMinTimeout returns a lower value', async () => {
    const timeout = await captureFirstBriefTimeout(minimalInput, () => DEFAULT_BRIEF_TIMEOUT_MS - 1);
    expect(timeout).toBe(DEFAULT_BRIEF_TIMEOUT_MS);
  });

  it('does not override a caller-supplied briefTimeoutMs', async () => {
    const supplied = DEFAULT_BRIEF_TIMEOUT_MS * 2;
    const timeout = await captureFirstBriefTimeout(
      { ...minimalInput, briefTimeoutMs: supplied },
      () => DEFAULT_BRIEF_TIMEOUT_MS + 10_000,
    );
    expect(timeout).toBe(supplied);
  });
});
