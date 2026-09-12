// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Structural resilience tests for preload.cts (t/2774, companion to t/2772).
// These run in vitest without launching Electron — contextBridge/ipcRenderer are mocked.
//
// Two failure classes covered:
//   (a) performance.now absent (typeof guard) → Date.now fallback → expose IS called
//   (b) ipcRenderer.on (listener wire) throws → expose was already called (expose-first ordering)
//
// Both assert contextBridge.exposeInMainWorld was called with 'electronAPI' despite the failure,
// locking the structural fixes from PR #1211.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted static mock (matches preloadBuffer.test.ts's pattern) so the static import below
// can safely trigger preload.cts's top-level contextBridge.exposeInMainWorld side effect.
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));

import { resolvePreloadTimestamp } from '../preload.cjs';

function makeIpcRenderer(overrides: Partial<{ on: () => void }> = {}) {
  return {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...overrides,
  };
}

describe('preload.cts structural resilience (t/2774)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // t/3439 (vitest 5 migration): this used to corrupt the REAL global performance.now
  // for the duration of a live `await import('../preload.cjs')`, to exercise the whole
  // module's typeof-guard fallback end-to-end. Under vitest 5's new Module Runner, the
  // import itself needs a working performance.now() (its own invoke/getModuleInformation
  // RPC path calls it internally) — nulling the global throws before preload.cjs's own
  // guard ever runs, unconditionally, regardless of mock/transform caching (confirmed via
  // isolated repro). resolvePreloadTimestamp() was extracted (matching this file's existing
  // createLatestValueBuffer precedent, t/2698) so the fallback is testable as a plain call
  // against a fake performance-like object, without touching the process-wide global.
  it('resolvePreloadTimestamp falls back to Date.now() when performance.now is not a function (typeof guard)', () => {
    const result = resolvePreloadTimestamp({ now: undefined });
    expect(result).toEqual(expect.any(Number));
  });

  it('resolvePreloadTimestamp falls back to Date.now() when performance itself is undefined', () => {
    const result = resolvePreloadTimestamp(undefined);
    expect(result).toEqual(expect.any(Number));
  });

  it('resolvePreloadTimestamp uses performance.now() when it is a real function', () => {
    const result = resolvePreloadTimestamp({ now: () => 42 });
    expect(result).toBe(42);
  });

  it('(b) exposeInMainWorld called even when first ipcRenderer.on (listener wire) throws', async () => {
    const exposeInMainWorld = vi.fn();
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: makeIpcRenderer({
        // First .on call (debate-window-load buffer listener) throws; expose runs before listeners.
        on: vi.fn().mockImplementationOnce(() => { throw new Error('sandbox-ipc'); }),
      }),
    }));

    await import('../preload.cjs');

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.objectContaining({
      preloadTimestamp: expect.any(Number),
    }));
  });
});
