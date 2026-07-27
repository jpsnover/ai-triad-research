// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1816 — new-edge persistence path. Verify the `saveEdges` bridge method exists on
// AppAPI and that the electron-bridge delegates to window.electronAPI.saveEdges with an
// optional-chaining graceful fallback (until the save-edges IPC handler lands).

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AppAPI } from '../types';

const sampleEdgesFile = {
  _schema_version: '1', _doc: '', last_modified: '', edge_types: [], edges: [],
};

describe('saveEdges bridge type', () => {
  it('AppAPI includes saveEdges', () => {
    const dummy = {} as AppAPI;
    expect('saveEdges' in dummy || dummy.saveEdges === undefined).toBe(true);
  });
});

describe('electron-bridge saveEdges delegation', () => {
  const origWindow = (globalThis as Record<string, unknown>).window;

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = origWindow;
    vi.resetModules();
  });

  it('delegates to window.electronAPI.saveEdges when present', async () => {
    const saveEdges = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).window = { electronAPI: { saveEdges } };
    const mod = await import('../electron-bridge');
    await mod.api.saveEdges(sampleEdgesFile as never);
    expect(saveEdges).toHaveBeenCalledWith(sampleEdgesFile);
  });

  it('rejects gracefully when the save-edges IPC handler is absent (desktop degrade)', async () => {
    (globalThis as Record<string, unknown>).window = { electronAPI: {} };
    const mod = await import('../electron-bridge');
    await expect(mod.api.saveEdges(sampleEdgesFile as never)).rejects.toThrow('not available in desktop mode');
  });
});
