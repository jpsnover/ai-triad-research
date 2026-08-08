// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDebatePopoutCloseHandler } from './guards';
import { useDebateStore } from '../store';

// Multi-window debate popouts (t/2310): the main window may show one debate while
// other debates have their own popout windows open. When a popout closes,
// `debate-popout-closed` carries the closed debateId; the main window must only
// reclaim the driver + reload when the closed popout was driving ITS active debate —
// an unrelated debate's popout close must be a no-op for this window.
describe('initDebatePopoutCloseHandler — per-debate close gate (t/2310)', () => {
  let captured: ((debateId: string) => void) | null = null;
  const api = {
    onDebatePopoutClosed: (cb: (debateId: string) => void) => {
      captured = cb;
      return () => { /* unsubscribe */ };
    },
  };

  beforeEach(() => {
    captured = null;
    // Real store; override loadDebate with a spy so reloadActiveDebateFromStorage is observable.
    useDebateStore.setState({
      activeDebateId: 'debate-A',
      driverIsRemote: true,
      loadDebate: vi.fn(),
    } as unknown as Partial<ReturnType<typeof useDebateStore.getState>>);
  });

  it('reclaims driver + reloads when the closed popout is this window\'s active debate', () => {
    initDebatePopoutCloseHandler(api);
    captured?.('debate-A');
    expect(useDebateStore.getState().driverIsRemote).toBe(false);
    expect(useDebateStore.getState().loadDebate).toHaveBeenCalledWith('debate-A');
  });

  it('ignores a different debate\'s popout close (no clobber of the displayed debate)', () => {
    initDebatePopoutCloseHandler(api);
    captured?.('debate-B');
    expect(useDebateStore.getState().driverIsRemote).toBe(true);
    expect(useDebateStore.getState().loadDebate).not.toHaveBeenCalled();
  });
});
