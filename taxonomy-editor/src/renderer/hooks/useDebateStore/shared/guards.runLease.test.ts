// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDebatePopoutCloseHandler, claimDebateDriver, releaseDebateDriver } from './guards';
import {
  acquireRunLease,
  __deliverRunLeaseMessageForTests,
  __resetRunLeasesForTests,
  __setRunLeaseTimingForTests,
} from './debateRunLease';
import { useDebateStore } from '../store';

// t/3917: how the single-driver lock (t/657) behaves around the per-debate run lease.
//   condition 4: the lease holder never reloads from storage under its own running debate;
//   condition 5: a viewer refreshes from the holder's saves (coalesced);
//   Option A: a window (including a pop-out) defers to a remote holder of its debate.
describe('driver lock × run lease (t/3917)', () => {
  let popoutClosed: ((debateId: string) => void) | null = null;
  const api = {
    onDebatePopoutClosed: (cb: (debateId: string) => void) => { popoutClosed = cb; return () => {}; },
  };

  beforeEach(() => {
    __resetRunLeasesForTests();
    __setRunLeaseTimingForTests({ settleMs: 0 });
    popoutClosed = null;
    useDebateStore.setState({
      activeDebateId: 'debate-A',
      driverIsRemote: false,
      loadDebate: vi.fn(),
    } as unknown as Partial<ReturnType<typeof useDebateStore.getState>>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    __resetRunLeasesForTests();
    releaseDebateDriver(); // don't leak this test's driver claim into the next
  });

  it('condition 4: the holder does not reload its own running debate (pop-out close path)', async () => {
    const acquired = await acquireRunLease('debate-A', 'test-holder');
    expect(acquired.ok).toBe(true);
    initDebatePopoutCloseHandler(api);

    popoutClosed?.('debate-A');
    expect(useDebateStore.getState().loadDebate).not.toHaveBeenCalled();

    if (acquired.ok) acquired.lease.release();
    popoutClosed?.('debate-A');
    expect(useDebateStore.getState().loadDebate).toHaveBeenCalledWith('debate-A'); // control: no lease → reload as before
  });

  it('the holder keeps the driver across per-turn releases until the lease is released', async () => {
    const acquired = await acquireRunLease('debate-A', 'test-holder');
    expect(claimDebateDriver()).toBe(true);
    releaseDebateDriver(); // a turn ending mid-run: pinned, a no-op
    expect(claimDebateDriver()).toBe(true);
    if (acquired.ok) acquired.lease.release();
  });

  it('Option A: a remote holder of this window\'s debate makes this window a viewer', () => {
    __deliverRunLeaseMessageForTests({ type: 'beat', debateId: 'debate-A', windowId: 'main-window', caller: 'runOpeningStatements:x', startedAt: 1 });
    expect(useDebateStore.getState().driverIsRemote).toBe(true);
    expect(claimDebateDriver()).toBe(false);
  });

  it('a remote holder of a DIFFERENT debate does not touch this window', () => {
    __deliverRunLeaseMessageForTests({ type: 'beat', debateId: 'debate-B', windowId: 'other', caller: 'x', startedAt: 1 });
    expect(useDebateStore.getState().driverIsRemote).toBe(false);
  });

  it('condition 5: a viewer reloads once per burst of holder saves', () => {
    vi.useFakeTimers();
    __deliverRunLeaseMessageForTests({ type: 'beat', debateId: 'debate-A', windowId: 'main-window', caller: 'x', startedAt: 1 });
    for (let i = 0; i < 4; i++) __deliverRunLeaseMessageForTests({ type: 'saved', debateId: 'debate-A', windowId: 'main-window' });
    expect(useDebateStore.getState().loadDebate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(useDebateStore.getState().loadDebate).toHaveBeenCalledTimes(1);
  });

  it('condition 2: an expired holder frees the driver and the viewer refreshes', () => {
    vi.useFakeTimers();
    __setRunLeaseTimingForTests({ ttlMs: 50, heartbeatMs: 20 });
    __deliverRunLeaseMessageForTests({ type: 'beat', debateId: 'debate-A', windowId: 'crashed', caller: 'x', startedAt: 1 });
    expect(useDebateStore.getState().driverIsRemote).toBe(true);

    vi.advanceTimersByTime(100); // the sweep runs on the heartbeat timer
    expect(useDebateStore.getState().driverIsRemote).toBe(false);
    expect(claimDebateDriver()).toBe(true);
    expect(useDebateStore.getState().loadDebate).toHaveBeenCalledWith('debate-A');
  });
});

describe('same-tick cross-window claims (t/3917)', () => {
  beforeEach(() => {
    __resetRunLeasesForTests();
    __setRunLeaseTimingForTests({ settleMs: 30 });
  });

  it('an earlier competing claim that arrives inside the settle window wins', async () => {
    const pending = acquireRunLease('debate-A', 'later');
    __deliverRunLeaseMessageForTests({ type: 'claim', debateId: 'debate-A', windowId: 'other', caller: 'earlier', startedAt: 1 });
    const result = await pending;
    expect(result.ok).toBe(false);
  });

  it('a later competing claim loses; we keep the lease', async () => {
    const pending = acquireRunLease('debate-A', 'earlier');
    __deliverRunLeaseMessageForTests({ type: 'claim', debateId: 'debate-A', windowId: 'other', caller: 'later', startedAt: Date.now() + 60_000 });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) result.lease.release();
  });

  it('a beat (an established holder) during the settle window always wins', async () => {
    const pending = acquireRunLease('debate-A', 'newcomer');
    __deliverRunLeaseMessageForTests({ type: 'beat', debateId: 'debate-A', windowId: 'holder', caller: 'x', startedAt: Date.now() + 60_000 });
    expect((await pending).ok).toBe(false);
  });
});
