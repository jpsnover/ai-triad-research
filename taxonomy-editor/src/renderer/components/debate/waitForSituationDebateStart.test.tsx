// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscribeToSituationDebateStart } from './waitForSituationDebateStart';

type FakeSession = { id: string; source_type: string; source_ref: string } | undefined;
type FakeState = { activeDebate: FakeSession };
type Listener = (state: FakeState, prevState: FakeState) => void;

const listeners: Listener[] = [];

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: {
    subscribe: (listener: Listener) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  },
}));

function emit(state: FakeState, prevState: FakeState) {
  for (const l of [...listeners]) l(state, prevState);
}

describe('subscribeToSituationDebateStart', () => {
  beforeEach(() => {
    listeners.length = 0;
  });

  // TL review (t/3752, p/696#4): confirm the undefined-prevState case explicitly —
  // `prevState.activeDebate?.id` must resolve to `undefined`, and `id !== undefined`
  // must be true for a real id, so this fires on the very first debate ever created.
  it('fires when a matching debate becomes active with no prior activeDebate', () => {
    const onStart = vi.fn();
    subscribeToSituationDebateStart('sit-007', onStart);

    emit({ activeDebate: { id: 'd1', source_type: 'situations', source_ref: 'sit-007' } }, { activeDebate: undefined });

    expect(onStart).toHaveBeenCalledWith('d1');
  });

  it('fires on transition from a different prior debate for the same node', () => {
    const onStart = vi.fn();
    subscribeToSituationDebateStart('sit-007', onStart);

    emit(
      { activeDebate: { id: 'd2', source_type: 'situations', source_ref: 'sit-007' } },
      { activeDebate: { id: 'old-debate', source_type: 'situations', source_ref: 'sit-007' } },
    );

    expect(onStart).toHaveBeenCalledWith('d2');
  });

  // The load-bearing guard: a *past* debate for this node already sitting in
  // activeDebate (e.g. loaded via "Past Debates") must not falsely re-fire on an
  // unrelated store update just because it still matches source_type/source_ref.
  it('does not fire for a stale debate that was already active (no id transition)', () => {
    const onStart = vi.fn();
    const staleDebate = { id: 'stale-1', source_type: 'situations', source_ref: 'sit-007' };
    subscribeToSituationDebateStart('sit-007', onStart);

    emit({ activeDebate: staleDebate }, { activeDebate: staleDebate });

    expect(onStart).not.toHaveBeenCalled();
  });

  it('does not fire for a debate on a different node', () => {
    const onStart = vi.fn();
    subscribeToSituationDebateStart('sit-007', onStart);

    emit({ activeDebate: { id: 'd3', source_type: 'situations', source_ref: 'sit-999' } }, { activeDebate: undefined });

    expect(onStart).not.toHaveBeenCalled();
  });

  it('does not fire for a non-situations debate', () => {
    const onStart = vi.fn();
    subscribeToSituationDebateStart('sit-007', onStart);

    emit({ activeDebate: { id: 'd4', source_type: 'topic', source_ref: 'sit-007' } }, { activeDebate: undefined });

    expect(onStart).not.toHaveBeenCalled();
  });

  it('stops firing after unsubscribe', () => {
    const onStart = vi.fn();
    const unsubscribe = subscribeToSituationDebateStart('sit-007', onStart);
    unsubscribe();

    emit({ activeDebate: { id: 'd5', source_type: 'situations', source_ref: 'sit-007' } }, { activeDebate: undefined });

    expect(onStart).not.toHaveBeenCalled();
  });
});
