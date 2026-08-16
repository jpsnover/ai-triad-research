// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2692 — `sendDiagnosticsState` is a sync ipcRenderer.send, so instrumentBridge
// (which wraps only async methods) skips it. The electron-bridge impl records a manual
// flight-recorder event so the IPC state push is confirmable from the FR. This test
// pins that instrumentation: the delegation still happens, and the record carries the
// minimal debate_id / transcript_length / selected_entry payload at debug level.

import { describe, it, expect, vi, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: h.record, intern: (_ns: string, v: string) => v }),
}));

const origWindow = (globalThis as Record<string, unknown>).window;

afterEach(() => {
  (globalThis as Record<string, unknown>).window = origWindow;
  h.record.mockReset();
  vi.resetModules();
});

describe('electron-bridge sendDiagnosticsState instrumentation (t/2692)', () => {
  it('delegates to window.electronAPI and records the IPC push with a minimal payload', async () => {
    const sendDiagnosticsState = vi.fn();
    (globalThis as Record<string, unknown>).window = { electronAPI: { sendDiagnosticsState } };
    const state = { debate: { id: 'debate-1', transcript: [{ id: 'e0' }, { id: 'e1' }, { id: 'e2' }] }, selectedEntry: 'e2' };

    const mod = await import('../electron-bridge');
    mod.api.sendDiagnosticsState(state as never);

    expect(sendDiagnosticsState).toHaveBeenCalledWith(state);
    expect(h.record).toHaveBeenCalledTimes(1);
    const rec = h.record.mock.calls[0][0];
    expect(rec.message).toBe('bridge.sendDiagnosticsState');
    expect(rec.level).toBe('debug');
    expect(rec.data).toEqual({ debate_id: 'debate-1', transcript_length: 3, selected_entry: 'e2' });
  });

  it('tolerates a null/partial state (no throw; null fields)', async () => {
    const sendDiagnosticsState = vi.fn();
    (globalThis as Record<string, unknown>).window = { electronAPI: { sendDiagnosticsState } };

    const mod = await import('../electron-bridge');
    mod.api.sendDiagnosticsState({ debate: null, selectedEntry: null } as never);

    expect(sendDiagnosticsState).toHaveBeenCalledTimes(1);
    expect(h.record.mock.calls[0][0].data).toEqual({ debate_id: null, transcript_length: null, selected_entry: null });
  });
});
