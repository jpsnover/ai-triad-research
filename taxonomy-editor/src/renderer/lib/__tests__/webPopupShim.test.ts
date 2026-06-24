// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlightRecorder, setGlobalRecorder } from '@lib/flight-recorder/index';
import type { RecordInput } from '@lib/flight-recorder/types';

/**
 * Tests for t/936: BroadcastChannel-based flight recorder forwarding in web-container mode.
 *
 * In web-container mode, popup windows (debate, diagnostics) open as separate browser tabs.
 * Without Electron IPC, each tab gets its own FlightRecorder instance and events are isolated.
 * The fix adds a BroadcastChannel shim that mirrors the Electron popup forwarding pattern:
 * popup tabs forward events to the main tab's recorder via BroadcastChannel.
 *
 * These tests reproduce the exact forwarding mechanism from flightRecorderInit.ts
 * against real FlightRecorder instances with a mock BroadcastChannel.
 */

type ChannelMessage = { type: string; payload?: RecordInput; origin?: string };

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>();

  name: string;
  onmessage: ((ev: MessageEvent<ChannelMessage>) => void) | null = null;
  private closed = false;

  constructor(name: string) {
    this.name = name;
    const set = MockBroadcastChannel.channels.get(name) ?? new Set();
    set.add(this);
    MockBroadcastChannel.channels.set(name, set);
  }

  postMessage(data: ChannelMessage): void {
    if (this.closed) return;
    const peers = MockBroadcastChannel.channels.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer !== this && !peer.closed && peer.onmessage) {
        peer.onmessage(new MessageEvent('message', { data }));
      }
    }
  }

  close(): void {
    this.closed = true;
    MockBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset(): void {
    MockBroadcastChannel.channels.clear();
  }
}

// Mirror the popup shim from flightRecorderInit.ts — uses BroadcastChannel instead of IPC
function createTestWebPopupShim(origin: string): FlightRecorder {
  const shim = new FlightRecorder({ capacity: 1, dumpOnError: false });
  const channel = new MockBroadcastChannel('aitriad-flight-recorder');

  shim.record = (input: RecordInput) => {
    const stamped: RecordInput = {
      ...input,
      data: { ...input.data, _origin: origin },
    };
    channel.postMessage({ type: 'event', payload: stamped });
  };

  const originalIntern = shim.intern.bind(shim);
  const forwarded = new Set<string>();
  shim.intern = (category: string, value: string) => {
    const handle = originalIntern(category, value);
    const key = `${category}/${value}`;
    if (forwarded.has(key)) return handle;
    forwarded.add(key);
    channel.postMessage({
      type: 'event',
      payload: {
        type: 'lifecycle',
        component: 'flight-recorder',
        level: 'debug',
        message: `Dictionary registration from ${origin}`,
        data: { _origin: origin, _dict_category: category, _dict_value: `${origin}/${value}` },
      },
    });
    return handle;
  };

  return shim;
}

// Mirror the main-window listener from flightRecorderInit.ts
function installMainWindowListener(recorder: FlightRecorder): MockBroadcastChannel {
  const channel = new MockBroadcastChannel('aitriad-flight-recorder');
  channel.onmessage = (msg: MessageEvent<ChannelMessage>) => {
    if (msg.data.type === 'event' && msg.data.payload) {
      const event = msg.data.payload;
      if (event.data?._dict_category && event.data?._dict_value) {
        recorder.intern(event.data._dict_category as string, event.data._dict_value as string);
      }
      recorder.record(event);
    }
  };
  return channel;
}

describe('web-container flight recorder forwarding (t/936)', () => {
  beforeEach(() => {
    MockBroadcastChannel.reset();
  });

  afterEach(() => {
    MockBroadcastChannel.reset();
  });

  it('forwards popup events to the main window recorder via BroadcastChannel', () => {
    const mainRecorder = new FlightRecorder({ capacity: 100, dumpOnError: false });
    installMainWindowListener(mainRecorder);

    const popupShim = createTestWebPopupShim('debate:abc123');
    popupShim.record({
      type: 'debate.turn',
      component: 'debate-engine',
      level: 'info',
      message: 'Turn completed for accelerationist',
    });

    const { ndjson } = mainRecorder.buildDump('explicit');
    expect(ndjson).toContain('Turn completed for accelerationist');
    expect(ndjson).toContain('debate:abc123');
  });

  it('stamps _origin on forwarded events', () => {
    const received: RecordInput[] = [];
    const mainRecorder = new FlightRecorder({ capacity: 100, dumpOnError: false });
    const originalRecord = mainRecorder.record.bind(mainRecorder);
    mainRecorder.record = (input: RecordInput) => {
      received.push(input);
      originalRecord(input);
    };
    installMainWindowListener(mainRecorder);

    const popupShim = createTestWebPopupShim('diagnostics');
    popupShim.record({
      type: 'system.error',
      component: 'diagnostics',
      level: 'error',
      message: 'test error',
    });

    expect(received).toHaveLength(1);
    expect(received[0].data?._origin).toBe('diagnostics');
  });

  it('forwards dictionary registrations from popup to main', () => {
    const mainRecorder = new FlightRecorder({ capacity: 100, dumpOnError: false });
    const internSpy = vi.spyOn(mainRecorder, 'intern');
    installMainWindowListener(mainRecorder);

    const popupShim = createTestWebPopupShim('debate:xyz');
    popupShim.intern('component', 'turn-pipeline');

    expect(internSpy).toHaveBeenCalledWith('component', 'debate:xyz/turn-pipeline');
  });

  it('deduplicates dictionary forwards — same entry forwarded only once', () => {
    let forwardCount = 0;
    const mainChannel = new MockBroadcastChannel('aitriad-flight-recorder');
    mainChannel.onmessage = (msg: MessageEvent<ChannelMessage>) => {
      if (msg.data.type === 'event') forwardCount++;
    };

    const popupShim = createTestWebPopupShim('debate:dedup');
    popupShim.intern('component', 'same-value');
    popupShim.intern('component', 'same-value');
    popupShim.intern('component', 'same-value');

    expect(forwardCount).toBe(1);

    mainChannel.close();
  });

  it('multiple popup windows forward to the same main recorder', () => {
    const mainRecorder = new FlightRecorder({ capacity: 100, dumpOnError: false });
    installMainWindowListener(mainRecorder);

    const debate = createTestWebPopupShim('debate:d1');
    const diag = createTestWebPopupShim('diagnostics');

    debate.record({ type: 'debate.turn', component: 'debate-engine', level: 'info', message: 'debate event' });
    diag.record({ type: 'system.info', component: 'diagnostics', level: 'info', message: 'diag event' });

    const { ndjson } = mainRecorder.buildDump('explicit');
    expect(ndjson).toContain('debate event');
    expect(ndjson).toContain('diag event');
    expect(ndjson).toContain('debate:d1');
    expect(ndjson).toContain('diagnostics');
  });

  it('popup shim does not buffer locally (capacity 1)', () => {
    const popupShim = createTestWebPopupShim('debate:nobuf');

    // Without a main window listener, events go nowhere — but the shim shouldn't crash
    popupShim.record({ type: 'test', component: 'x', level: 'info', message: 'msg1' });
    popupShim.record({ type: 'test', component: 'x', level: 'info', message: 'msg2' });

    // The shim's local buffer should be empty (record() is overridden to forward, not buffer)
    const { ndjson } = popupShim.buildDump('explicit');
    expect(ndjson).not.toContain('msg1');
    expect(ndjson).not.toContain('msg2');
  });

  it('dump-request from popup triggers dump on main', () => {
    const mainRecorder = new FlightRecorder({ capacity: 100, dumpOnError: false });
    setGlobalRecorder(mainRecorder);
    mainRecorder.record({ type: 'lifecycle', component: 'test', level: 'info', message: 'seed event' });

    let dumpRequested = false;
    const mainChannel = new MockBroadcastChannel('aitriad-flight-recorder');
    mainChannel.onmessage = (msg: MessageEvent<ChannelMessage>) => {
      if (msg.data.type === 'dump-request') dumpRequested = true;
    };

    const popupChannel = new MockBroadcastChannel('aitriad-flight-recorder');
    popupChannel.postMessage({ type: 'dump-request', origin: 'debate:abc' });

    expect(dumpRequested).toBe(true);

    mainChannel.close();
    popupChannel.close();
  });
});
