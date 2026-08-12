// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression guard for t/2539 (Q5 of t/2536): interrupted-turn recovery in
// loadDebate must NOT auto-resume via crossRespond for a socratic debate. Socratic
// has a single AI debater, so crossRespond bails ("Need at least 2 AI debaters")
// and leaves an error toast on resume. The fix skips the auto-resume for
// protocol_id === 'socratic' (the user drives the next turn). This test loads a
// socratic session carrying an interrupted_turn, lets the recovery's 100ms timer
// fire, and asserts crossRespond was never called — with a non-socratic control
// arm proving the assertion is non-vacuous.
//
// The store records via getGlobalRecorder(); override it (keeping the real module's
// other exports) to capture the event stream and assert on the skip lifecycle event.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { recorded } = vi.hoisted(() => ({ recorded: [] as Array<Record<string, unknown>> }));

vi.mock('@lib/flight-recorder/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lib/flight-recorder/index')>();
  return {
    ...actual,
    getGlobalRecorder: () => ({ record: (e: Record<string, unknown>) => { recorded.push(e); }, setEventContext: () => {} }),
  };
});

// Harness FIRST so its hoisted vi.mock registrations run before the store imports.
import { resetStore, makeSession, mockApi } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';

type Entry = { id: string; timestamp: string; type: string; speaker: string; content: string; taxonomy_refs: string[] };
function entry(id: string, type = 'statement', speaker = 'accelerationist'): Entry {
  return { id, timestamp: '2026-05-01T00:00:00.000Z', type, speaker, content: `content-${id}`, taxonomy_refs: [] };
}

// The recovery auto-resume is scheduled on a 100ms setTimeout; wait past it (real timers).
const afterRecoveryTimer = () => new Promise((r) => setTimeout(r, 150));

describe('interrupted-turn recovery — socratic protocol guard (t/2539)', () => {
  beforeEach(() => {
    resetStore();
    recorded.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT auto-resume crossRespond for a socratic debate with an interrupted_turn', async () => {
    const crossRespond = vi.fn().mockResolvedValue(undefined);
    useDebateStore.setState({ crossRespond: crossRespond as never });

    mockApi.loadDebateSession.mockResolvedValue(makeSession({
      id: 'd-socratic',
      phase: 'debate',
      protocol_id: 'socratic',
      active_povers: ['skeptic'],
      transcript: [entry('e1', 'opening', 'skeptic')],
      interrupted_turn: { speaker: 'skeptic', phase: 'debate', round: 1, timestamp: '2026-05-01T00:00:00.000Z' },
    }));

    await useDebateStore.getState().loadDebate('d-socratic');
    await afterRecoveryTimer();

    // The auto-resume must have been skipped — crossRespond never fired…
    expect(crossRespond).not.toHaveBeenCalled();
    // …the skip was recorded…
    expect(recorded.some(e => e.message === 'Interrupted-turn auto-resume skipped for socratic protocol')).toBe(true);
    // …no "Need at least 2 AI debaters" error leaked, and the generating indicator
    // was never left stuck on the resume speaker.
    const st = useDebateStore.getState();
    expect(st.debateError ?? '').not.toContain('at least 2');
    expect(st.debateGenerating).toBeNull();

    // Witness that the recovery path actually ran (not a vacuous pass): the
    // [Recovered] system entry was appended and interrupted_turn was cleared.
    expect(st.activeDebate?.transcript.some(e => e.type === 'system' && e.content.includes('[Recovered]'))).toBe(true);
    expect(st.activeDebate?.interrupted_turn).toBeUndefined();
  });

  it('control: a non-socratic debate with an interrupted_turn DOES auto-resume via crossRespond', async () => {
    const crossRespond = vi.fn().mockResolvedValue(undefined);
    useDebateStore.setState({ crossRespond: crossRespond as never });

    mockApi.loadDebateSession.mockResolvedValue(makeSession({
      id: 'd-standard',
      phase: 'debate',
      protocol_id: 'structured',
      active_povers: ['accelerationist', 'safetyist', 'skeptic'],
      transcript: [entry('e1', 'opening', 'accelerationist'), entry('e2', 'opening', 'safetyist')],
      interrupted_turn: { speaker: 'accelerationist', phase: 'debate', round: 1, timestamp: '2026-05-01T00:00:00.000Z' },
    }));

    await useDebateStore.getState().loadDebate('d-standard');
    await afterRecoveryTimer();

    expect(crossRespond).toHaveBeenCalled();
  });
});
