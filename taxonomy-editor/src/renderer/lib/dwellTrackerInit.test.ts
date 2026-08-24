// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment jsdom

// t/2705 — initDwellTracker emits a lifecycle FR event recording its init outcome so a
// session's dwell-tracking state is diagnosable from the flight recorder (t/2699 had no
// signal to distinguish "tracker skipped" from "tracking on but no events"). `view.dwell`
// — what feeds the engagement dashboard — exists only when outcome === 'activated'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: h.record }) }));
// Stub the store so the activated path's dynamic import stays light and deterministic.
vi.mock('../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: {
    getState: () => ({ activeTab: 'skeptic', selectedNodeId: null, toolbarPanel: null }),
    subscribe: () => () => {},
  },
}));

function initEvent(): { outcome: string; target: string } | undefined {
  const call = h.record.mock.calls.map(c => c[0]).find(e => e.message === 'dwell_tracker_init');
  return call?.data as { outcome: string; target: string } | undefined;
}

beforeEach(() => { h.record.mockClear(); vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('initDwellTracker init-outcome FR event (t/2705)', () => {
  it('records skipped_electron when the target is not web (no-op path)', async () => {
    vi.stubEnv('VITE_TARGET', 'electron');
    const mod = await import('./dwellTracker');
    await mod.initDwellTracker();
    const ev = h.record.mock.calls.map(c => c[0]).find(e => e.message === 'dwell_tracker_init');
    expect(ev?.type).toBe('lifecycle');
    expect(ev?.level).toBe('info');
    expect(initEvent()).toEqual({ outcome: 'skipped_electron', target: 'electron' });
  });

  it('records activated on the first web init, then skipped_already_initialized on re-init', async () => {
    vi.stubEnv('VITE_TARGET', 'web');
    const mod = await import('./dwellTracker');

    await mod.initDwellTracker();
    expect(initEvent()).toEqual({ outcome: 'activated', target: 'web' });

    h.record.mockClear();
    await mod.initDwellTracker();
    expect(initEvent()).toEqual({ outcome: 'skipped_already_initialized', target: 'web' });

    mod.stopDwellTracker();
  });
});
