// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3545: the neutral evaluator's renderer adapter dropped maxTokens when forwarding to
// api.generateText, silently falling back to the provider default and truncating the
// evaluator's JSON response mid-string (FR dump flight-recorder-2026-09-21T21-40-10.492Z).
// This test exercises the ACTUAL adapter closure inside runNeutralCheckpoint — not a
// reimplementation — by capturing the adapter runNeutralEvaluation is called with and
// invoking its generateText itself, so a future regression here fails loudly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateText = vi.fn().mockResolvedValue({ text: '{}' });
vi.mock('@bridge', () => ({ api: { generateText: (...args: unknown[]) => mockGenerateText(...args) } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => undefined }));
vi.mock('./modelConfig', () => ({ getConfiguredModel: () => 'gemini-flash-lite-latest' }));
vi.mock('./generation', () => ({ phaseGuardedSet: vi.fn() }));

const mockRunNeutralEvaluation = vi.fn();
vi.mock('@lib/debate/neutralEvaluator', () => ({
  buildSpeakerMapping: vi.fn().mockReturnValue({}),
  runNeutralEvaluation: (...args: unknown[]) => mockRunNeutralEvaluation(...args),
}));

import { runNeutralCheckpoint } from './neutralCheckpoint';

describe('runNeutralCheckpoint adapter — maxTokens forwarding (t/3545)', () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
    mockRunNeutralEvaluation.mockReset();
  });

  it('forwards opts.maxTokens from runNeutralEvaluation through to api.generateText', async () => {
    mockRunNeutralEvaluation.mockImplementation(async (_checkpoint, deps: { adapter: { generateText: (p: string, m: string, opts?: { maxTokens?: number }) => Promise<string> } }) => {
      await deps.adapter.generateText('prompt', 'gemini-flash-lite-latest', { maxTokens: 16_384 });
      return { cruxes: [], claims: [], overall_assessment: { notes: '' } };
    });

    const get = () => ({
      activeDebate: {
        active_povers: ['skeptic'],
        topic: { final: 'topic', original: 'topic' },
        transcript: [],
        context_summaries: [],
        neutral_evaluations: [],
      },
    }) as never;

    await runNeutralCheckpoint('baseline', get, vi.fn(), vi.fn());

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const [, , , , opts] = mockGenerateText.mock.calls[0];
    expect(opts).toEqual({ maxTokens: 16_384 });
  });

  it('passes maxTokens: undefined through (not silently dropped) when the evaluator omits it', async () => {
    mockRunNeutralEvaluation.mockImplementation(async (_checkpoint, deps: { adapter: { generateText: (p: string, m: string, opts?: { maxTokens?: number }) => Promise<string> } }) => {
      await deps.adapter.generateText('prompt', 'gemini-flash-lite-latest');
      return { cruxes: [], claims: [], overall_assessment: { notes: '' } };
    });

    const get = () => ({
      activeDebate: {
        active_povers: ['skeptic'],
        topic: { final: 'topic', original: 'topic' },
        transcript: [],
        context_summaries: [],
        neutral_evaluations: [],
      },
    }) as never;

    await runNeutralCheckpoint('baseline', get, vi.fn(), vi.fn());

    const [, , , , opts] = mockGenerateText.mock.calls[0];
    expect(opts).toEqual({ maxTokens: undefined });
  });
});
