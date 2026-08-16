// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for t/2690: "Dump Log" clicked inside a diagnostics *popup*
 * window must write the MAIN window's recorder (capacity 5000) via IPC — not the
 * popup's capacity-1 forwarding shim.
 *
 * The bug: DiagnosticsWindow.tsx / OverviewTabRouter.tsx import `triggerManualDump`
 * directly from this module. In a popup, `getGlobalRecorder()` returns the shim, so
 * `persistDump(shim, …)` wrote a useless 1-capacity buffer (0 events). The popup's
 * real dump path (IPC → main window) lived only on `globalThis.__triggerManualDump`
 * and was never invoked by the buttons.
 *
 * The fix: a module-level `_popupDumpHandler`, set in the popup init path and checked
 * at the top of `triggerManualDump()`, so the direct-import callers delegate to the
 * IPC forwarder instead of persisting the empty shim.
 */

const h = vi.hoisted(() => {
  let current: unknown = null;
  return {
    getCurrent: () => current,
    setCurrent: (r: unknown) => { current = r; },
    dumpFlightRecorder: vi.fn().mockResolvedValue({ filePath: '/tmp/main-dump.ndjson', filename: 'main-dump.ndjson' }),
    clipboardWriteText: vi.fn(),
    openFlightRecorderViewer: vi.fn(),
    reportError: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@lib/flight-recorder/index', () => ({
  // Minimal recorder: the popup shim reassigns .record/.intern; the main path calls
  // .intern (dictionary seeding) and .buildDump (dump). All backed by vi.fn spies.
  FlightRecorder: class {
    record = vi.fn();
    intern = vi.fn((_category: string, value: string) => ({ id: value }));
    buildDump = vi.fn(() => ({ ndjson: '{"event":1}', droppedByCategory: {}, meta: {} }));
  },
  getGlobalRecorder: () => h.getCurrent(),
  setGlobalRecorder: (r: unknown) => { h.setCurrent(r); },
}));

vi.mock('@bridge', () => ({
  api: {
    dumpFlightRecorder: h.dumpFlightRecorder,
    clipboardWriteText: h.clipboardWriteText,
    openFlightRecorderViewer: h.openFlightRecorderViewer,
    reportError: h.reportError,
  },
}));

vi.mock('../dumpToast', () => ({
  showDumpToast: vi.fn(),
  showDumpErrorToast: vi.fn(),
  showDumpPendingToast: vi.fn(() => () => { /* dismiss */ }),
}));

describe('triggerManualDump — popup delegates to main recorder, not the local shim (t/2690)', () => {
  beforeEach(() => {
    vi.resetModules();
    h.setCurrent(null);
    h.dumpFlightRecorder.mockClear();
    h.clipboardWriteText.mockClear();
  });

  it('in a diagnostics popup, "Dump Log" triggers the MAIN window dump via IPC and never persists the shim', async () => {
    window.location.hash = '#diagnostics-window';
    const triggerMainDump = vi.fn().mockResolvedValue({ filePath: '/tmp/main-dump.ndjson' });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      forwardFlightEvent: vi.fn(),
      triggerMainDump,
      // onTriggerDump omitted — main-window relay hook is not registered in a popup
    };

    const mod = await import('../flightRecorderInit');
    mod.initFlightRecorder();

    await mod.triggerManualDump();

    // Delegated to the popup's IPC forwarder → main window writes its full recorder.
    expect(triggerMainDump).toHaveBeenCalledTimes(1);
    // The empty capacity-1 shim is NEVER persisted (the t/2690 bug).
    expect(h.dumpFlightRecorder).not.toHaveBeenCalled();
  });

  it('in the main window (no popup handler), "Dump Log" persists the real recorder as before', async () => {
    window.location.hash = '';
    // electronAPI present but NOT a popup (hash is main) → isWeb=false.
    (window as unknown as { electronAPI: unknown }).electronAPI = { forwardFlightEvent: vi.fn() };

    const mod = await import('../flightRecorderInit');
    // Fresh module → _popupDumpHandler is null (popup init never ran). Register a
    // normal main-window recorder as the global, mirroring what initFlightRecorder
    // does on the main path, and confirm triggerManualDump persists IT.
    h.setCurrent({
      record: vi.fn(),
      buildDump: vi.fn(() => ({ ndjson: '{"event":1}', droppedByCategory: {}, meta: {} })),
    });

    await mod.triggerManualDump();

    // Main window persists its own recorder directly (no popup delegation).
    expect(h.dumpFlightRecorder).toHaveBeenCalledTimes(1);
  });
});
