// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Unit tests for the flight recorder core library:
 *   - Dictionary (string interning / constant pool)
 *   - RingBuffer (fixed-capacity circular buffer)
 *   - serializeDump (NDJSON serialization)
 *   - FlightRecorder (integration / orchestration)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dictionary } from './dictionary';
import { RingBuffer } from './ringBuffer';
import { serializeDump } from './serializer';
import { FlightRecorder } from './flightRecorder';
import type {
  RecordInput,
  FlightRecorderEvent,
  DumpHeader,
  DumpTrigger,
} from './types';

// ── Helpers ─────────────────────────────────────────────────────

/** Build a minimal RecordInput for testing. */
function makeInput(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    type: 'lifecycle',
    component: 'test-component',
    level: 'info',
    message: 'test event',
    ...overrides,
  };
}

/** Build a minimal FlightRecorderEvent (as if stamped by record()). */
function makeEvent(seq: number, overrides: Partial<FlightRecorderEvent> = {}): FlightRecorderEvent {
  return {
    _seq: seq,
    _ts: 1000 + seq,
    _wall: Date.now(),
    type: 'lifecycle',
    component: 'test-component',
    level: 'info',
    message: `event-${seq}`,
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<DumpTrigger> = {}): DumpTrigger {
  return {
    _type: 'trigger',
    timestamp: new Date().toISOString(),
    trigger_type: 'explicit',
    ...overrides,
  };
}

function makeHeader(overrides: Partial<DumpHeader> = {}): DumpHeader {
  return {
    _type: 'header',
    _version: 1,
    schema_version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime_ms: 5000,
    ring_buffer_capacity: 100,
    ring_buffer_events_total: 3,
    ring_buffer_events_retained: 3,
    events_lost: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Dictionary
// ═══════════════════════════════════════════════════════════════════

describe('Dictionary', () => {
  let dict: Dictionary;

  beforeEach(() => {
    dict = new Dictionary();
  });

  it('intern() returns a numeric handle for strings > 8 chars', () => {
    const handle = dict.intern('component', 'long-component-name');
    expect(typeof handle).toBe('number');
  });

  it('intern() returns the raw string for strings <= 8 chars', () => {
    const result = dict.intern('component', 'short');
    expect(result).toBe('short');

    // Exactly 8 chars — still returned raw
    const result8 = dict.intern('component', '12345678');
    expect(result8).toBe('12345678');
  });

  it('intern() is idempotent — same (category, value) returns same handle', () => {
    const h1 = dict.intern('component', 'my-long-component');
    const h2 = dict.intern('component', 'my-long-component');
    expect(h1).toBe(h2);
    expect(dict.size).toBe(1);
  });

  it('intern() different categories with same value get different handles', () => {
    const h1 = dict.intern('component', 'shared-long-value');
    const h2 = dict.intern('speaker', 'shared-long-value');
    expect(h1).not.toBe(h2);
    expect(typeof h1).toBe('number');
    expect(typeof h2).toBe('number');
    expect(dict.size).toBe(2);
  });

  it('resolve() expands a handle to the full string', () => {
    const handle = dict.intern('component', 'debate-engine-core');
    expect(typeof handle).toBe('number');
    const resolved = dict.resolve(handle as number);
    expect(resolved).toBe('debate-engine-core');
  });

  it('resolve() returns the string unchanged if passed a string', () => {
    expect(dict.resolve('already-a-string')).toBe('already-a-string');
  });

  it('resolve() returns "<unknown:N>" for an invalid handle', () => {
    expect(dict.resolve(9999)).toBe('<unknown:9999>');
  });

  it('enforces 4096 entry cap — after cap, intern() returns raw string', () => {
    // Fill dictionary to capacity
    for (let i = 0; i < 4096; i++) {
      const result = dict.intern('cat', `value-that-is-long-enough-${i}`);
      expect(typeof result).toBe('number');
    }
    expect(dict.size).toBe(4096);

    // Next intern should return raw string (not a handle)
    const overflow = dict.intern('cat', 'value-that-is-long-enough-overflow');
    expect(typeof overflow).toBe('string');
    expect(overflow).toBe('value-that-is-long-enough-overflow');
    expect(dict.size).toBe(4096);
  });

  it('getEntries() returns all registered entries', () => {
    dict.intern('component', 'prometheus-agent');
    dict.intern('speaker', 'sentinel-agent');
    const entries = dict.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].category).toBe('component');
    expect(entries[0].value).toBe('prometheus-agent');
    expect(entries[1].category).toBe('speaker');
    expect(entries[1].value).toBe('sentinel-agent');
  });

  it('clear() resets the dictionary', () => {
    dict.intern('component', 'some-long-value-here');
    expect(dict.size).toBe(1);

    dict.clear();
    expect(dict.size).toBe(0);
    expect(dict.getEntries()).toHaveLength(0);

    // Can re-intern after clear
    const handle = dict.intern('component', 'some-long-value-here');
    expect(typeof handle).toBe('number');
    expect(handle).toBe(0); // Starts from 0 again
  });
});

// ═══════════════════════════════════════════════════════════════════
// RingBuffer
// ═══════════════════════════════════════════════════════════════════

describe('RingBuffer', () => {
  let buf: RingBuffer;

  beforeEach(() => {
    buf = new RingBuffer(5);
  });

  it('write() stores an event and drain() returns it', () => {
    const event = makeEvent(0);
    buf.write(event);

    const drained = buf.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toBe(event);
  });

  it('drain() returns events in sequence order (oldest first)', () => {
    const e0 = makeEvent(0);
    const e1 = makeEvent(1);
    const e2 = makeEvent(2);
    buf.write(e0);
    buf.write(e1);
    buf.write(e2);

    const drained = buf.drain();
    expect(drained).toHaveLength(3);
    expect(drained[0]._seq).toBe(0);
    expect(drained[1]._seq).toBe(1);
    expect(drained[2]._seq).toBe(2);
  });

  it('overwrites oldest events when full (capacity 3, write 5)', () => {
    const small = new RingBuffer(3);
    for (let i = 0; i < 5; i++) {
      small.write(makeEvent(i));
    }

    const drained = small.drain();
    expect(drained).toHaveLength(3);
    // Should retain the last 3 events (seq 2, 3, 4)
    expect(drained[0]._seq).toBe(2);
    expect(drained[1]._seq).toBe(3);
    expect(drained[2]._seq).toBe(4);
  });

  it('oldestSeq tracks correctly before and after wrap', () => {
    const small = new RingBuffer(3);

    // Before wrap
    expect(small.oldestSeq).toBe(0);
    small.write(makeEvent(0));
    expect(small.oldestSeq).toBe(0);
    small.write(makeEvent(1));
    small.write(makeEvent(2));
    expect(small.oldestSeq).toBe(0); // 3 events, capacity 3, no loss yet

    // After wrap — 4th event overwrites slot 0
    small.write(makeEvent(3));
    expect(small.oldestSeq).toBe(1); // count=4, capacity=3 => 4-3=1

    small.write(makeEvent(4));
    expect(small.oldestSeq).toBe(2); // count=5, capacity=3 => 5-3=2
  });

  it('retained count is min(count, capacity)', () => {
    expect(buf.retained).toBe(0);

    buf.write(makeEvent(0));
    expect(buf.retained).toBe(1);

    buf.write(makeEvent(1));
    buf.write(makeEvent(2));
    expect(buf.retained).toBe(3);

    // Fill to capacity (5)
    buf.write(makeEvent(3));
    buf.write(makeEvent(4));
    expect(buf.retained).toBe(5);

    // Overflow — retained stays at capacity
    buf.write(makeEvent(5));
    buf.write(makeEvent(6));
    expect(buf.retained).toBe(5);
    expect(buf.count).toBe(7);
  });

  it('clear() resets the buffer', () => {
    buf.write(makeEvent(0));
    buf.write(makeEvent(1));
    expect(buf.count).toBe(2);
    expect(buf.retained).toBe(2);

    buf.clear();
    expect(buf.count).toBe(0);
    expect(buf.retained).toBe(0);
    expect(buf.oldestSeq).toBe(0);
    expect(buf.drain()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Serializer
// ═══════════════════════════════════════════════════════════════════

describe('serializeDump', () => {
  let dict: Dictionary;

  beforeEach(() => {
    dict = new Dictionary();
  });

  it('produces valid NDJSON (each line parses as JSON)', () => {
    const header = makeHeader();
    const events = [makeEvent(0), makeEvent(1)];
    const trigger = makeTrigger();

    const ndjson = serializeDump(header, dict, events, trigger);
    const lines = ndjson.trim().split('\n');

    // 1 header + 1 dictionary + 2 events + 1 trigger = 5 lines
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('first line is header with _type: "header"', () => {
    const header = makeHeader();
    const ndjson = serializeDump(header, dict, [], makeTrigger());
    const lines = ndjson.trim().split('\n');
    const parsed = JSON.parse(lines[0]);
    expect(parsed._type).toBe('header');
    expect(parsed._version).toBe(1);
    expect(parsed.schema_version).toBe('1.0.0');
  });

  it('second line is dictionary with _type: "dictionary"', () => {
    dict.intern('component', 'long-component-name');
    const ndjson = serializeDump(makeHeader(), dict, [], makeTrigger());
    const lines = ndjson.trim().split('\n');
    const parsed = JSON.parse(lines[1]);
    expect(parsed._type).toBe('dictionary');
    expect(parsed.entries).toBeInstanceOf(Array);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].value).toBe('long-component-name');
  });

  it('event lines have _type: "event"', () => {
    const events = [makeEvent(0), makeEvent(1)];
    const ndjson = serializeDump(makeHeader(), dict, events, makeTrigger());
    const lines = ndjson.trim().split('\n');

    // Lines 2 and 3 are events (0-indexed)
    const event0 = JSON.parse(lines[2]);
    const event1 = JSON.parse(lines[3]);
    expect(event0._type).toBe('event');
    expect(event1._type).toBe('event');
  });

  it('last line is trigger with _type: "trigger"', () => {
    const trigger = makeTrigger({ trigger_type: 'uncaught_error' });
    const ndjson = serializeDump(makeHeader(), dict, [makeEvent(0)], trigger);
    const lines = ndjson.trim().split('\n');
    const lastLine = JSON.parse(lines[lines.length - 1]);
    expect(lastLine._type).toBe('trigger');
    expect(lastLine.trigger_type).toBe('uncaught_error');
  });

  it('dictionary handles in events are expanded to full strings', () => {
    const handle = dict.intern('component', 'debate-engine-core');
    expect(typeof handle).toBe('number');

    const event = makeEvent(0, { component: handle as number });
    const ndjson = serializeDump(makeHeader(), dict, [event], makeTrigger());
    const lines = ndjson.trim().split('\n');
    const eventLine = JSON.parse(lines[2]);

    expect(eventLine.component).toBe('debate-engine-core');
  });

  it('speaker handles in events are expanded to full strings', () => {
    const speakerHandle = dict.intern('speaker', 'prometheus-character');
    expect(typeof speakerHandle).toBe('number');

    const event = makeEvent(0, { speaker: speakerHandle as number });
    const ndjson = serializeDump(makeHeader(), dict, [event], makeTrigger());
    const lines = ndjson.trim().split('\n');
    const eventLine = JSON.parse(lines[2]);

    expect(eventLine.speaker).toBe('prometheus-character');
  });

  it('events are in sequence order', () => {
    const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
    const ndjson = serializeDump(makeHeader(), dict, events, makeTrigger());
    const lines = ndjson.trim().split('\n');

    const seq0 = JSON.parse(lines[2])._seq;
    const seq1 = JSON.parse(lines[3])._seq;
    const seq2 = JSON.parse(lines[4])._seq;

    expect(seq0).toBe(0);
    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// FlightRecorder (integration)
// ═══════════════════════════════════════════════════════════════════

describe('FlightRecorder', () => {
  let recorder: FlightRecorder;

  beforeEach(() => {
    recorder = new FlightRecorder({ capacity: 10, dumpOnError: true });
  });

  it('record() stamps _seq, _ts, and _wall on events', () => {
    recorder.record(makeInput({ message: 'first' }));
    recorder.record(makeInput({ message: 'second' }));

    const events = recorder.buffer.drain();
    expect(events).toHaveLength(2);

    // _seq is monotonically increasing starting at 0
    expect(events[0]._seq).toBe(0);
    expect(events[1]._seq).toBe(1);

    // _ts should be a number (performance.now())
    expect(typeof events[0]._ts).toBe('number');
    expect(typeof events[1]._ts).toBe('number');

    // _wall should be a number (Date.now())
    expect(typeof events[0]._wall).toBe('number');
    expect(typeof events[1]._wall).toBe('number');

    // _wall should be a reasonable epoch timestamp
    expect(events[0]._wall).toBeGreaterThan(1_000_000_000_000);
  });

  it('recordError() creates a system.error event and returns dump when dumpOnError=true', () => {
    const err = new Error('something broke');
    const result = recorder.recordError(err, { component: 'test-component' });

    expect(result).not.toBeNull();
    expect(result!.ndjson).toBeTruthy();
    expect(result!.trigger._type).toBe('trigger');
    expect(result!.trigger.trigger_type).toBe('explicit');
    expect(result!.trigger.error).toBeDefined();
    expect(result!.trigger.error!.message).toBe('something broke');

    // Verify the system.error event was recorded
    const events = recorder.buffer.drain();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system.error');
    expect(events[0].level).toBe('error');
    expect(events[0].error!.message).toBe('something broke');
  });

  it('recordError() returns null when dumpOnError=false', () => {
    const noDump = new FlightRecorder({ capacity: 10, dumpOnError: false });
    const err = new Error('ignored dump');
    const result = noDump.recordError(err);

    expect(result).toBeNull();

    // But the event is still recorded
    const events = noDump.buffer.drain();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system.error');
  });

  it('recordError() normalizes non-Error values', () => {
    recorder.recordError('a string error');

    const events = recorder.buffer.drain();
    expect(events[0].error!.name).toBe('Error');
    expect(events[0].error!.message).toBe('a string error');
  });

  it('buildDump() produces valid NDJSON with all 4 sections', () => {
    recorder.record(makeInput({ message: 'event-a' }));
    recorder.record(makeInput({ message: 'event-b' }));

    const { ndjson, trigger } = recorder.buildDump('manual');
    const lines = ndjson.trim().split('\n');

    // header + dictionary + 2 events + trigger = 5 lines
    expect(lines).toHaveLength(5);

    const header = JSON.parse(lines[0]);
    expect(header._type).toBe('header');
    expect(header.ring_buffer_events_total).toBe(2);
    expect(header.ring_buffer_events_retained).toBe(2);
    expect(header.events_lost).toBe(0);

    const dictionary = JSON.parse(lines[1]);
    expect(dictionary._type).toBe('dictionary');

    const event0 = JSON.parse(lines[2]);
    expect(event0._type).toBe('event');
    expect(event0.message).toBe('event-a');

    const event1 = JSON.parse(lines[3]);
    expect(event1._type).toBe('event');
    expect(event1.message).toBe('event-b');

    const triggerLine = JSON.parse(lines[4]);
    expect(triggerLine._type).toBe('trigger');
    expect(triggerLine.trigger_type).toBe('manual');

    expect(trigger._type).toBe('trigger');
  });

  it('buildDump() includes error and context in trigger when provided', () => {
    const error = { name: 'TypeError', message: 'null ref' };
    const context = { debateId: 'debate-123' };

    const { trigger } = recorder.buildDump('uncaught_error', error, context);

    expect(trigger.trigger_type).toBe('uncaught_error');
    expect(trigger.error).toEqual(error);
    expect(trigger.context).toEqual(context);
  });

  it('buildDump() reports events_lost when buffer has overflowed', () => {
    const small = new FlightRecorder({ capacity: 3 });
    for (let i = 0; i < 10; i++) {
      small.record(makeInput({ message: `event-${i}` }));
    }

    const { ndjson } = small.buildDump('explicit');
    const header = JSON.parse(ndjson.split('\n')[0]);

    expect(header.ring_buffer_capacity).toBe(3);
    expect(header.ring_buffer_events_total).toBe(10);
    expect(header.ring_buffer_events_retained).toBe(3);
    expect(header.events_lost).toBe(7);
  });

  it('setContextProvider() data appears as separate context record', () => {
    recorder.setContextProvider(() => ({
      active_debate_id: 'debate-xyz',
      active_debate_phase: 'opening',
      active_debate_round: 2,
      memory_usage_mb: 128,
    }));

    const { ndjson } = recorder.buildDump('manual');
    const lines = ndjson.trim().split('\n');
    const context = JSON.parse(lines[2]);

    expect(context._type).toBe('context');
    expect(context.active_debate_id).toBe('debate-xyz');
    expect(context.active_debate_phase).toBe('opening');
    expect(context.active_debate_round).toBe(2);
    expect(context.memory_usage_mb).toBe(128);
  });

  it('intern() delegates to the dictionary', () => {
    const handle = recorder.intern('component', 'debate-engine-module');
    expect(typeof handle).toBe('number');

    // Verify it's in the underlying dictionary
    const resolved = recorder.dictionary.resolve(handle as number);
    expect(resolved).toBe('debate-engine-module');
  });

  it('intern() returns raw string for short values', () => {
    const result = recorder.intern('component', 'short');
    expect(result).toBe('short');
  });

  it('snapshot() returns header + events', () => {
    recorder.record(makeInput({ message: 'snap-event-1' }));
    recorder.record(makeInput({ message: 'snap-event-2' }));

    const snap = recorder.snapshot();

    expect(snap.header._type).toBe('header');
    expect(snap.header._version).toBe(1);
    expect(snap.header.ring_buffer_events_total).toBe(2);
    expect(snap.header.ring_buffer_events_retained).toBe(2);

    expect(snap.events).toHaveLength(2);
    expect(snap.events[0].message).toBe('snap-event-1');
    expect(snap.events[1].message).toBe('snap-event-2');
  });

  it('uses default config values when none provided', () => {
    const defaultRecorder = new FlightRecorder();
    expect(defaultRecorder.config.capacity).toBe(1000);
    expect(defaultRecorder.config.dumpOnError).toBe(true);
    expect(defaultRecorder.config.maxDumpFiles).toBe(10);
    expect(defaultRecorder.config.maxDumpBytes).toBe(50 * 1024 * 1024);
  });

  it('record() with interned component handle preserves the handle in events', () => {
    const handle = recorder.intern('component', 'long-component-name');
    expect(typeof handle).toBe('number');

    recorder.record(makeInput({ component: handle as number }));

    const events = recorder.buffer.drain();
    expect(events[0].component).toBe(handle);
  });

  it('interned handles are expanded in buildDump() output', () => {
    const handle = recorder.intern('component', 'argument-network');
    recorder.record(makeInput({ component: handle as number }));

    const { ndjson } = recorder.buildDump('manual');
    const lines = ndjson.trim().split('\n');
    const eventLine = JSON.parse(lines[2]);

    expect(eventLine.component).toBe('argument-network');
  });
});
