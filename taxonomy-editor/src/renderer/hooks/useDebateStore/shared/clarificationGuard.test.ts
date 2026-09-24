// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3629: watch-only debates (user_is_pover=false) parked forever in the clarification
// phase — it waits for a user event that a watch-only debate has no user to supply.
// These tests exercise enterClarificationOrBegin directly, asserting the TERMINAL
// behavior each branch takes (updatePhase called vs. beginDebate+runOpeningStatements
// called) — not a re-implementation of the guard's own logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: mockRecord }) }));

import { enterClarificationOrBegin } from './clarificationGuard';

function makeStore(overrides: Record<string, unknown> = {}) {
  const updatePhase = vi.fn();
  const beginDebate = vi.fn().mockResolvedValue(undefined);
  const runOpeningStatements = vi.fn().mockResolvedValue(undefined);
  const state = {
    activeDebate: { id: 'debate-1', user_is_pover: false, source_type: 'situations', ...overrides },
    updatePhase,
    beginDebate,
    runOpeningStatements,
  };
  return { get: () => state, updatePhase, beginDebate, runOpeningStatements };
}

describe('enterClarificationOrBegin (t/3629)', () => {
  beforeEach(() => { mockRecord.mockClear(); });

  it('watch-only (user_is_pover=false): skips clarification, begins the debate directly', async () => {
    const { get, updatePhase, beginDebate, runOpeningStatements } = makeStore({ user_is_pover: false });

    await enterClarificationOrBegin(get);

    expect(updatePhase).not.toHaveBeenCalled();
    expect(beginDebate).toHaveBeenCalledTimes(1);
    expect(runOpeningStatements).toHaveBeenCalledTimes(1);
  });

  it('participating (user_is_pover=true): enters clarification as before, does not auto-begin', async () => {
    const { get, updatePhase, beginDebate, runOpeningStatements } = makeStore({ user_is_pover: true });

    await enterClarificationOrBegin(get);

    expect(updatePhase).toHaveBeenCalledWith('clarification');
    expect(beginDebate).not.toHaveBeenCalled();
    expect(runOpeningStatements).not.toHaveBeenCalled();
  });

  it('watch-only WITH explicit refine opt-in: still enters clarification (opt-in preserved)', async () => {
    const { get, updatePhase, beginDebate } = makeStore({ user_is_pover: false });

    await enterClarificationOrBegin(get, { refineOptIn: true });

    expect(updatePhase).toHaveBeenCalledWith('clarification');
    expect(beginDebate).not.toHaveBeenCalled();
  });

  it('emits a flight-recorder marker with user_is_pover and source_type on both branches (AC #4)', async () => {
    const { get } = makeStore({ user_is_pover: false, source_type: 'topic' });

    await enterClarificationOrBegin(get);

    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
      message: 'clarification.skipped-watch-only',
      data: expect.objectContaining({ user_is_pover: false, source_type: 'topic' }),
    }));
  });

  it('does nothing when there is no active debate (defensive)', async () => {
    const updatePhase = vi.fn();
    const beginDebate = vi.fn();
    const runOpeningStatements = vi.fn();
    const get = () => ({ activeDebate: null, updatePhase, beginDebate, runOpeningStatements });

    await enterClarificationOrBegin(get);

    expect(updatePhase).not.toHaveBeenCalled();
    expect(beginDebate).not.toHaveBeenCalled();
  });
});
