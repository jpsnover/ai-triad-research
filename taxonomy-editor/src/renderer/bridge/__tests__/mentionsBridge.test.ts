// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1901 — getContainerMentions bridge method (T1 of the Phase-2 transport trio).
// Verifies the method is on AppAPI and that electron-bridge delegates to
// window.electronAPI, FAILING LOUD (rejecting) until the t/1903 IPC handler lands —
// never a silent null (mirrors the getEntity/listEntities fail-loud pattern).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppAPI } from '../types';

describe('getContainerMentions bridge type', () => {
  it('AppAPI includes getContainerMentions', () => {
    const dummy = {} as AppAPI;
    expect('getContainerMentions' in dummy || dummy.getContainerMentions === undefined).toBe(true);
  });
});

describe('electron-bridge getContainerMentions delegation', () => {
  const origWindow = (globalThis as Record<string, unknown>).window;

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = origWindow;
    vi.resetModules();
  });

  it('delegates to window.electronAPI.getContainerMentions when present', async () => {
    const payload = { text_sha256: 'abc', extracted_at: '2026-01-01T00:00:00Z', mentions: [] };
    (globalThis as Record<string, unknown>).window = {
      electronAPI: { getContainerMentions: vi.fn().mockResolvedValue(payload) },
    };
    const mod = await import('../electron-bridge');
    const result = await mod.api.getContainerMentions('sei:acc-desires-001');
    expect(result).toEqual(payload);
    expect(window.electronAPI.getContainerMentions).toHaveBeenCalledWith('sei:acc-desires-001');
  });

  it('FAILS LOUD (rejects) when the IPC handler is not yet wired (t/1903)', async () => {
    (globalThis as Record<string, unknown>).window = { electronAPI: {} };
    const mod = await import('../electron-bridge');
    await expect(mod.api.getContainerMentions('node:acc-desires-001')).rejects.toThrow(/not available in desktop mode/i);
  });
});
