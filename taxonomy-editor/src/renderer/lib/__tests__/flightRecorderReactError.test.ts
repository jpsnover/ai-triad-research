// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecordInput } from '@lib/flight-recorder/types';

/**
 * Regression tests for t/2297: the error boundary must emit a `system.error`
 * flight-recorder event *synchronously* — the instant the boundary fires — so a
 * dump triggered afterward (auto, or via the "Dump Log" button) can never be
 * missing the very crash that produced it.
 *
 * The bug: `dumpOnReactError` recorded the crash inside an async IIFE, behind a
 * DEV-only `await _resolveStack(...)`. The event therefore landed in the ring
 * buffer *after* a microtask (and after source-map fetches in dev), racing the
 * dump. The fix records the crash inline, then defers only the dump + enrichment.
 */

const h = vi.hoisted(() => {
  const recordCalls: RecordInput[] = [];
  return {
    recordCalls,
    fakeRecorder: {
      record: vi.fn((input: RecordInput) => { recordCalls.push(input); }),
      buildDump: vi.fn(() => ({ ndjson: '{}', droppedByCategory: {}, meta: {} })),
    },
    dumpFlightRecorder: vi.fn().mockResolvedValue({ filePath: '/tmp/dump.ndjson', filename: 'dump.ndjson' }),
    reportError: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => h.fakeRecorder,
  setGlobalRecorder: vi.fn(),
  FlightRecorder: class {},
}));

vi.mock('@bridge', () => ({
  api: {
    dumpFlightRecorder: h.dumpFlightRecorder,
    reportError: h.reportError,
    clipboardWriteText: vi.fn(),
    openFlightRecorderViewer: vi.fn(),
  },
}));

vi.mock('../dumpToast', () => ({
  showDumpToast: vi.fn(),
  showDumpErrorToast: vi.fn(),
  showDumpPendingToast: vi.fn(() => () => { /* dismiss */ }),
}));

describe('dumpOnReactError — crash event is recorded synchronously (t/2297)', () => {
  beforeEach(() => {
    h.recordCalls.length = 0;
    h.fakeRecorder.record.mockClear();
    h.dumpFlightRecorder.mockClear();
    h.reportError.mockClear();
  });

  it('records a system.error crash event synchronously, before the dump is persisted', async () => {
    const { dumpOnReactError } = await import('../flightRecorderInit');

    const err = new Error('Rendered more hooks than during the previous render');
    err.name = 'Invariant Violation';
    const componentStack = '\n    at NewsReportModal\n    at ErrorBoundary';

    dumpOnReactError(err, componentStack);

    // Synchronous: the crash is already in the buffer the instant the call returns.
    expect(h.fakeRecorder.record).toHaveBeenCalledTimes(1);
    const ev = h.recordCalls[0];
    expect(ev.type).toBe('system.error');
    expect(ev.component).toBe('react-error-boundary');
    expect(ev.level).toBe('fatal');
    expect(ev.error).toMatchObject({ name: 'Invariant Violation', message: err.message });
    expect(ev.error?.stack).toBeDefined();
    expect((ev.data as Record<string, unknown>)?.component_stack).toContain('at NewsReportModal');

    // ...but the dump has NOT been persisted yet — it is deferred to a microtask,
    // so the crash always precedes the dump in ordering.
    expect(h.dumpFlightRecorder).not.toHaveBeenCalled();

    // Flush microtasks: the dump now runs, with the crash already buffered.
    await vi.waitFor(() => expect(h.dumpFlightRecorder).toHaveBeenCalledTimes(1));
  });

  it('reports the crash to the server after recording it locally', async () => {
    const { dumpOnReactError } = await import('../flightRecorderInit');

    const err = new Error('boom');
    dumpOnReactError(err, undefined);

    // Local record is synchronous; server report is fire-and-forget on a microtask.
    expect(h.fakeRecorder.record).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(h.reportError).toHaveBeenCalledTimes(1));
    expect(h.reportError.mock.calls[0][0]).toMatchObject({ name: 'Error', message: 'boom' });
  });
});

/**
 * Observability arm for t/2551: when the crash is a Node-builtin externalization
 * throw (t/2550's child_process class), the dump must name the failing module in a
 * first-class `externalized_module` field so triage sees the import chain without a
 * human repro. Ordinary crashes must NOT carry the field.
 */
describe('dumpOnReactError — externalized-module attribution (t/2551 observability)', () => {
  beforeEach(() => {
    h.recordCalls.length = 0;
    h.fakeRecorder.record.mockClear();
    h.dumpFlightRecorder.mockClear();
    h.reportError.mockClear();
  });

  it('records externalized_module (module + accessed binding) for a Vite externalization crash', async () => {
    const { dumpOnReactError } = await import('../flightRecorderInit');

    // The exact runtime message Vite's browser-external stub throws on named-binding
    // access — the shape t/2550's child_process crash produced.
    const err = new Error(
      'Module "child_process" has been externalized for browser compatibility. ' +
      'Cannot access "child_process.execFileSync" in client code. See https://vite.dev/guide/troubleshooting.html for more details.',
    );

    dumpOnReactError(err, '\n    at useCommentStore\n    at DebateTab');

    expect(h.fakeRecorder.record).toHaveBeenCalledTimes(1);
    const data = h.recordCalls[0].data as Record<string, unknown>;
    expect(data.externalized_module).toEqual({
      module: 'child_process',
      accessed: 'child_process.execFileSync',
    });
  });

  it('omits externalized_module for an ordinary crash', async () => {
    const { dumpOnReactError } = await import('../flightRecorderInit');

    dumpOnReactError(new Error('Rendered more hooks than during the previous render'), undefined);

    expect(h.fakeRecorder.record).toHaveBeenCalledTimes(1);
    const data = (h.recordCalls[0].data ?? {}) as Record<string, unknown>;
    expect(data.externalized_module).toBeUndefined();
  });
});
