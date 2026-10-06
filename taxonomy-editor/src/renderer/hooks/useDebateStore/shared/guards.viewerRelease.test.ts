// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { claimDebateDriver, isDebatePopoutWindow, markAsPopout, releaseDebateDriver } from './guards';
import { __deliverRunLeaseMessageForTests, __resetRunLeasesForTests, __setRunLeaseTimingForTests } from './debateRunLease';
import { useDebateStore } from '../store';

// t/3967: a pop-out opened while the main window held the run lease became a viewer
// (t/3917 Option A) and never unlocked. The lease emitted 'remote-released' when the
// holder finished, but guards.ts had no case for it, so the viewer depended on the
// driver-channel 'release', which the holder sends only if its own bookkeeping still
// points at itself. Own file: markAsPopout() sets module state for the whole file.
describe('pop-out viewer unlocks when the holder releases its run lease (t/3967)', () => {
  const HOLDER = 'main-window';
  const beat = () => __deliverRunLeaseMessageForTests({ type: 'beat', debateId: 'debate-A', windowId: HOLDER, caller: 'runOpeningStatements:enterClarificationOrBegin', startedAt: 1 });
  const leaseRelease = () => __deliverRunLeaseMessageForTests({ type: 'release', debateId: 'debate-A', windowId: HOLDER });

  beforeEach(() => {
    __resetRunLeasesForTests();
    __setRunLeaseTimingForTests({ settleMs: 0 });
    useDebateStore.setState({
      activeDebateId: 'debate-A',
      driverIsRemote: false,
      loadDebate: vi.fn(),
    } as unknown as Partial<ReturnType<typeof useDebateStore.getState>>);
    markAsPopout();
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetRunLeasesForTests();
    releaseDebateDriver();
  });

  it('(a) the lease release alone unlocks the viewer and refreshes it', () => {
    beat();
    expect(useDebateStore.getState().driverIsRemote).toBe(true);
    expect(claimDebateDriver()).toBe(false);

    leaseRelease(); // no driver-channel 'release' follows: the 10-06 dump's shape

    expect(useDebateStore.getState().driverIsRemote).toBe(false);
    expect(useDebateStore.getState().loadDebate).toHaveBeenCalledWith('debate-A');
    expect(claimDebateDriver()).toBe(true);
  });

  it('(b) still unlocks after another window\'s claim moved this window\'s driver bookkeeping', async () => {
    beat();
    // A third window's bare driver claim arrives first and moves _activeDriverWindow off the holder.
    const other = new BroadcastChannel('aitriad-debate-driver');
    other.postMessage({ type: 'claim', windowId: 'third-window' });
    await new Promise(resolve => setTimeout(resolve, 50));
    other.close();
    expect(useDebateStore.getState().driverIsRemote).toBe(true);

    leaseRelease();

    expect(useDebateStore.getState().driverIsRemote).toBe(false);
    expect(useDebateStore.getState().loadDebate).toHaveBeenCalledWith('debate-A');
  });

  it('a release from a window this one never deferred to changes nothing', () => {
    beat();
    __deliverRunLeaseMessageForTests({ type: 'beat', debateId: 'debate-A', windowId: 'someone-else', caller: 'x', startedAt: 2 });
    __deliverRunLeaseMessageForTests({ type: 'release', debateId: 'debate-A', windowId: 'nobody' });
    expect(useDebateStore.getState().driverIsRemote).toBe(true);
  });

  it('reports that it is a pop-out, so the banner can say the main window is driving', () => {
    expect(isDebatePopoutWindow()).toBe(true);
  });
});
