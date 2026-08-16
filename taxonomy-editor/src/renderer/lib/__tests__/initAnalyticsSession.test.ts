// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/2707 — the App.tsx copy-status-complete init path started analytics WITHOUT
 * the dwell tracker, so those sessions emitted no `view.dwell` events. All init
 * paths now route through `initAnalyticsSession()`, which guarantees the ordering:
 * the dwell tracker starts first, then analytics once it resolves. This test locks
 * that contract (the failure class is a missing/out-of-order init sequence).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  initAnalytics: vi.fn(),
  initDwellTracker: vi.fn(() => Promise.resolve()),
}));

vi.mock('../analyticsEmitter', () => ({ initAnalytics: h.initAnalytics }));
vi.mock('../dwellTracker', () => ({ initDwellTracker: h.initDwellTracker }));

import { initAnalyticsSession } from '../initAnalyticsSession';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('initAnalyticsSession (t/2707)', () => {
  beforeEach(() => {
    h.initAnalytics.mockClear();
    h.initDwellTracker.mockClear();
    h.initDwellTracker.mockImplementation(() => Promise.resolve());
  });

  it('starts the dwell tracker before analytics (dwell is what emits view.dwell)', async () => {
    initAnalyticsSession();
    // Dwell tracker starts synchronously; analytics must wait for it to resolve.
    expect(h.initDwellTracker).toHaveBeenCalledTimes(1);
    expect(h.initAnalytics).not.toHaveBeenCalled();

    await flush();
    expect(h.initAnalytics).toHaveBeenCalledTimes(1);
  });

  it('does not start analytics until the dwell tracker promise resolves', async () => {
    let resolveDwell!: () => void;
    h.initDwellTracker.mockImplementation(() => new Promise<void>(r => { resolveDwell = r; }));

    initAnalyticsSession();
    await flush();
    expect(h.initAnalytics).not.toHaveBeenCalled(); // dwell still pending

    resolveDwell();
    await flush();
    expect(h.initAnalytics).toHaveBeenCalledTimes(1);
  });
});
