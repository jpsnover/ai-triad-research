// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { FlightRecorder } from '../../../../lib/flight-recorder/index.js';

/**
 * Regression test for t/766: the main process forwards its flight-recorder events
 * to the main window's renderer recorder so the unified timeline includes
 * main-process events (e.g. AI model-resolution failures recorded in embeddings.ts),
 * which otherwise live only in the separate main-process buffer and are invisible
 * to a renderer dump.
 *
 * `main.ts` installs this wrap inside `app.whenReady()` and can't be imported here
 * (it loads Electron's `app` at module init), so this reproduces the exact wrap
 * against a real FlightRecorder with a mock `webContents.send`.
 */

// Mirrors the forwarding wrap installed in main.ts after setGlobalRecorder(mainRecorder).
function installForwarding(
  recorder: FlightRecorder,
  send: (channel: string, payload: unknown) => void,
): void {
  const original = recorder.record.bind(recorder);
  recorder.record = (input: Parameters<typeof recorder.record>[0]) => {
    original(input);
    send('flight-event-from-popup', { ...input, data: { ...input.data, _origin: 'main-process' } });
  };
}

describe('main-process flight-recorder forwarding (t/766)', () => {
  it('forwards each event to the renderer channel tagged _origin=main-process, and still buffers locally', () => {
    const recorder = new FlightRecorder({ capacity: 100, dumpOnError: false });
    const sent: Array<{ channel: string; payload: Record<string, unknown> }> = [];
    installForwarding(recorder, (channel, payload) => sent.push({ channel, payload: payload as Record<string, unknown> }));

    recorder.record({ type: 'system.error', component: 'ai-adapter', level: 'error', message: 'model resolution failed' });

    // AC1/AC2: forwarded to the same IPC channel the renderer already listens on, with origin tag.
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('flight-event-from-popup');
    const payload = sent[0].payload as { message?: string; data?: { _origin?: string } };
    expect(payload.data?._origin).toBe('main-process');
    expect(payload.message).toBe('model resolution failed');

    // Local buffer preserved — the main process keeps its own dump-on-error timeline.
    const { ndjson } = recorder.buildDump('explicit');
    expect(ndjson).toContain('model resolution failed');
  });

  it('AC3: a single record() yields exactly one forwarded event (no duplication)', () => {
    const recorder = new FlightRecorder({ capacity: 100, dumpOnError: false });
    let count = 0;
    installForwarding(recorder, () => { count++; });

    recorder.record({ type: 'system.error', component: 'x', level: 'error', message: 'one' });

    expect(count).toBe(1);
  });

  it('merges _origin into existing event data without clobbering it', () => {
    const recorder = new FlightRecorder({ capacity: 100, dumpOnError: false });
    const sent: Array<Record<string, unknown>> = [];
    installForwarding(recorder, (_c, payload) => sent.push(payload as Record<string, unknown>));

    recorder.record({ type: 'state.change', component: 'modelDiscovery', level: 'info', message: 'm', data: { backend: 'gemini' } });

    const data = (sent[0] as { data?: Record<string, unknown> }).data!;
    expect(data.backend).toBe('gemini');
    expect(data._origin).toBe('main-process');
  });
});
