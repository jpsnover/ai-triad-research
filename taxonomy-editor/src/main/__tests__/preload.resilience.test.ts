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

function makeIpcRenderer(overrides: Partial<{ on: () => void }> = {}) {
  return {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...overrides,
  };
}

function makeBuffer() {
  return { onIpc: vi.fn(), onSubscribe: vi.fn(), onUnsubscribe: vi.fn() };
}

describe('preload.cts structural resilience (t/2774)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('(a) exposeInMainWorld called when performance.now is not a function (typeof guard → Date.now fallback)', async () => {
    const exposeInMainWorld = vi.fn();
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: makeIpcRenderer(),
    }));
    vi.doMock('../preloadBuffer.cjs', () => ({
      createLatestValueBuffer: makeBuffer,
    }));

    const origNow = performance.now;
    // @ts-expect-error intentionally removing .now to trigger the typeof guard
    performance.now = undefined;
    try {
      await import('../preload.cjs');
    } finally {
      performance.now = origNow;
    }

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.objectContaining({
      preloadTimestamp: expect.any(Number),
    }));
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
    vi.doMock('../preloadBuffer.cjs', () => ({
      createLatestValueBuffer: makeBuffer,
    }));

    await import('../preload.cjs');

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.objectContaining({
      preloadTimestamp: expect.any(Number),
    }));
  });
});
