// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression test for t/2326: concurrent loadDebateSession calls must not regress
// phase/transcript during interrupted-turn recovery, and no save may emit
// caller:"unknown". Reproduces the d1c7f7b6 incident — three hooks mounting on
// debate-window open each fire loadDebate; the 2nd/3rd used to resolve with the
// stale on-disk snapshot and re-apply it over the first load's recovery.
//
// The store records via getGlobalRecorder(); we override it here (keeping the real
// module's other exports) to capture the event stream and assert on the state-guard
// and save diagnostics.

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

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('loadDebate concurrent coalescing + load-guard (t/2326)', () => {
  beforeEach(() => {
    resetStore();
    recorded.length = 0;
    // Stub auto-resume so the interrupted-turn recovery's setTimeout → crossRespond
    // does no real work if it fires; the test asserts on the synchronous recovery.
    useDebateStore.setState({ crossRespond: vi.fn().mockResolvedValue(undefined) as never });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('coalesces N concurrent loads into one IPC and one applied snapshot — no shrinkage, no regression, no caller:"unknown"', async () => {
    const disk = makeSession({
      id: 'd-race',
      phase: 'opening',
      transcript: [entry('e1', 'opening'), entry('e2')],
      interrupted_turn: { speaker: 'accelerationist', phase: 'opening', round: 1, timestamp: '2026-05-01T00:00:00.000Z' },
    });

    // Hold the load pending so we can observe coalescing before it resolves.
    let resolveLoad!: (v: unknown) => void;
    mockApi.loadDebateSession.mockImplementation(() => new Promise((r) => { resolveLoad = r; }));

    const p1 = useDebateStore.getState().loadDebate('d-race');
    const p2 = useDebateStore.getState().loadDebate('d-race');
    const p3 = useDebateStore.getState().loadDebate('d-race');

    // Only the first load fires the IPC; the other two share its in-flight promise.
    expect(mockApi.loadDebateSession).toHaveBeenCalledTimes(1);
    expect(recorded.filter((e) => e.type === 'state.load-coalesced')).toHaveLength(2);

    resolveLoad(structuredClone(disk));
    await Promise.all([p1, p2, p3]);
    await flush(); // let the recovery's void saveDebate() settle

    const st = useDebateStore.getState();
    // Recovery appended exactly one [Recovered] system entry (2 → 3); no later load
    // re-applied the 2-entry disk snapshot over it.
    expect(st.activeDebate?.id).toBe('d-race');
    expect(st.activeDebate?.transcript).toHaveLength(3);
    expect(st.activeDebate?.transcript.some((e) => e.type === 'system')).toBe(true);

    // State-guard never fired.
    const guardErrors = recorded.filter((e) =>
      e.component === 'state-guard' && /shrinkage|regression/i.test(String(e.message ?? '')));
    expect(guardErrors).toEqual([]);

    // No save emitted caller:"unknown" — and the recovery save carried its caller.
    const saveEvents = recorded.filter((e) => e.type === 'state.save');
    expect(saveEvents.length).toBeGreaterThan(0);
    for (const s of saveEvents) {
      expect((s.data as { caller?: string } | undefined)?.caller).toBeTruthy();
      expect((s.data as { caller?: string } | undefined)?.caller).not.toBe('unknown');
    }

    // The load itself was cleared from the in-flight map.
    expect(useDebateStore.getState()._loadInFlight['d-race']).toBeUndefined();
  });

  it('load-guard refuses a snapshot that is behind the in-memory state', async () => {
    // In-memory is AHEAD: phase "debate", 3 transcript entries.
    useDebateStore.setState({
      activeDebateId: 'd-guard',
      activeDebate: makeSession({
        id: 'd-guard',
        phase: 'debate',
        transcript: [entry('a'), entry('b'), entry('c')],
      }) as never,
    });

    // Disk read is BEHIND: phase "opening", 2 entries (a stale snapshot).
    mockApi.loadDebateSession.mockResolvedValue(makeSession({
      id: 'd-guard',
      phase: 'opening',
      transcript: [entry('a'), entry('b')],
    }));

    await useDebateStore.getState().loadDebate('d-guard');

    const st = useDebateStore.getState();
    // In-memory state preserved — the stale snapshot was refused.
    expect(st.activeDebate?.phase).toBe('debate');
    expect(st.activeDebate?.transcript).toHaveLength(3);
    expect(recorded.filter((e) => e.type === 'state.load-guard').length).toBeGreaterThan(0);
  });
});
