// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4120: the community load path (loadDebateFromData) must run the same view setup as loadDebate.
// It used to skip the dictionary load, so Analysis → Terms showed raw sense IDs with no definitions.
// The harness is imported FIRST so its hoisted mocks register before the store import resolves.
import { describe, it, expect } from 'vitest';
import { makeSession, mockApi, mockPromptConfigState } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';

const DICT = {
  standardized: [{ term: 'alignment', definition: 'test definition' }],
  colloquial: [{ term: 'safety', senses: [] }],
  lintViolations: [],
};

/** loadDictionary resolves on a microtask; let the .then() run. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('loadDebateFromData — shared view setup (t/4120)', () => {
  it('loads the dictionary so Terms can resolve sense IDs', async () => {
    mockApi.loadDictionary.mockResolvedValueOnce(DICT);
    useDebateStore.getState().loadDebateFromData(makeSession(), { readOnly: true });
    await flush();
    expect(mockApi.loadDictionary).toHaveBeenCalledTimes(1);
    expect(useDebateStore.getState().vocabularyTerms?.standardized).toHaveLength(1);
    expect(useDebateStore.getState().vocabularyTerms?.colloquial).toHaveLength(1);
  });

  it('applies the session prompt config and broadcasts to the diagnostics popout', () => {
    const session = { ...makeSession(), prompt_config: { temperature_bias: 0.5 } };
    useDebateStore.getState().loadDebateFromData(session, { readOnly: true });
    expect(mockPromptConfigState.loadSessionConfig).toHaveBeenCalledWith({ temperature_bias: 0.5 });
    expect(mockApi.sendDiagnosticsState).toHaveBeenCalledWith(expect.objectContaining({ selectedEntry: null }));
  });

  it('does not touch write-side state: backend temperature is left alone for a read-only view', () => {
    useDebateStore.getState().loadDebateFromData(makeSession(), { readOnly: true });
    expect(mockApi.setDebateTemperature).not.toHaveBeenCalled();
  });

  it('skips the dictionary fetch when terms are already loaded', () => {
    useDebateStore.setState({ vocabularyTerms: { standardized: [], colloquial: [] } });
    useDebateStore.getState().loadDebateFromData(makeSession(), { readOnly: true });
    expect(mockApi.loadDictionary).not.toHaveBeenCalled();
  });

  it('a dictionary failure is non-fatal: the debate still loads', async () => {
    mockApi.loadDictionary.mockRejectedValueOnce(new Error('dict unavailable'));
    const session = makeSession();
    useDebateStore.getState().loadDebateFromData(session, { readOnly: true });
    await flush();
    expect(useDebateStore.getState().activeDebateId).toBe(session.id);
    expect(useDebateStore.getState().vocabularyTerms).toBeNull();
  });
});
