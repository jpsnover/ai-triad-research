// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the two generation helpers from the debate-store graph — only their real deps
// (the bridge `api`, the flight recorder, and the real `guards` live-binding for
// `_abortController`) run; everything else generation.ts imports is stubbed (t/2508).
const generateText = vi.fn();
vi.mock('@bridge', () => ({
  api: {
    generateText: (...args: unknown[]) => generateText(...args),
    onGenerateTextProgress: () => () => {},
  },
}));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../store', () => ({ useDebateStore: { getState: () => ({ debateWarnings: [] }), setState: vi.fn() } }));
vi.mock('@lib/debate/helpers', () => ({ parseAIJson: () => null }));
vi.mock('../../../prompts/debate', () => ({ entrySummarizationPrompt: () => 'prompt' }));
vi.mock('./taxonomyContext', () => ({ findNodeMetaInStore: () => undefined }));
vi.mock('./docTitles', () => ({ getDocTitles: () => ({}) }));

import { generateTextWithProgress, makeStageGenerate } from './generation';
import { newAbortController, cancelAndResetAbort, makeCancellationError } from './guards';

describe('generation helpers thread the abort signal (t/2508)', () => {
  beforeEach(() => {
    generateText.mockReset();
    cancelAndResetAbort(); // reset the module-level controller between cases
  });

  it('generateTextWithProgress passes the live abort signal to api.generateText', async () => {
    const ctrl = newAbortController();
    generateText.mockResolvedValue({ text: 'hi' });
    await generateTextWithProgress('prompt', 'model-x', 'activity', vi.fn());
    expect(generateText).toHaveBeenCalledWith('prompt', 'model-x', undefined, undefined, { signal: ctrl.signal });
  });

  it('generateTextWithProgress re-throws a tagged cancellation (does not swallow)', async () => {
    newAbortController();
    generateText.mockRejectedValue(makeCancellationError());
    await expect(generateTextWithProgress('p', 'm', 'a', vi.fn())).rejects.toMatchObject({ cancelled: true });
  });

  it('makeStageGenerate threads the live signal alongside model/temperature/timeout', async () => {
    const ctrl = newAbortController();
    generateText.mockResolvedValue({ text: 'out' });
    const gen = makeStageGenerate(vi.fn(), 'base-model');
    await gen('prompt', 'call-model', { temperature: 0.4, timeoutMs: 1234 }, 'label');
    expect(generateText).toHaveBeenCalledWith('prompt', 'call-model', 1234, 0.4, { signal: ctrl.signal });
  });

  it('with no active controller the signal is undefined (no-signal callers unchanged)', async () => {
    cancelAndResetAbort(); // _abortController = null
    generateText.mockResolvedValue({ text: 'hi' });
    await generateTextWithProgress('p', 'm', 'a', vi.fn());
    expect(generateText).toHaveBeenCalledWith('p', 'm', undefined, undefined, { signal: undefined });
  });
});
