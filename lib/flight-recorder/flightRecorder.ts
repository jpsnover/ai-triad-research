// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { Dictionary } from './dictionary.js';
import { RingBuffer } from './ringBuffer.js';
import { serializeDump } from './serializer.js';
import type {
  RecordInput,
  FlightRecorderEvent,
  FlightRecorderConfig,
  DumpHeader,
  DumpTrigger,
  TriggerType,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

type ContextProvider = () => Partial<DumpHeader>;

const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * Flight recorder: continuously records the last N events in a ring buffer,
 * then serializes to self-describing NDJSON on error.
 */
export class FlightRecorder {
  readonly config: FlightRecorderConfig;
  readonly dictionary: Dictionary;
  readonly buffer: RingBuffer;
  private contextProvider: ContextProvider = () => ({});

  constructor(config?: Partial<FlightRecorderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dictionary = new Dictionary();
    this.buffer = new RingBuffer(this.config.capacity);
  }

  // ── Dictionary ───────────────────────────────────────────────────────

  /** Intern a string into the dictionary. Returns a handle or the raw string. */
  intern(category: string, value: string): number | string {
    return this.dictionary.intern(category, value);
  }

  // ── Recording ────────────────────────────────────────────────────────

  /** Record an event into the ring buffer. Hot path — no allocations beyond the event object. */
  record(input: RecordInput): void {
    const event: FlightRecorderEvent = {
      ...input,
      _seq: this.buffer.count,
      _ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      _wall: Date.now(),
    };
    this.buffer.write(event);
  }

  /**
   * Record an error event. If dumpOnError is enabled, this also returns the
   * serialized dump string (caller is responsible for persisting it).
   */
  recordError(
    err: unknown,
    context?: Record<string, unknown>,
  ): { ndjson: string; trigger: DumpTrigger } | null {
    const error = normalizeError(err);
    this.record({
      type: 'system.error',
      component: context?.component as string | number ?? 'unknown',
      level: 'error',
      message: error.message,
      error,
      data: context,
    });

    if (this.config.dumpOnError) {
      return this.buildDump('explicit', error, context);
    }
    return null;
  }

  // ── Dump ─────────────────────────────────────────────────────────────

  /**
   * Set a callback that provides dynamic context for the dump header
   * (active debate ID, phase, round, memory usage, etc.).
   */
  setContextProvider(fn: ContextProvider): void {
    this.contextProvider = fn;
  }

  /** Build a serialized NDJSON dump string with trigger metadata. */
  buildDump(
    triggerType: TriggerType,
    error?: { name: string; message: string; stack?: string },
    context?: Record<string, unknown>,
  ): { ndjson: string; trigger: DumpTrigger } {
    const events = this.buffer.drain();

    const header = this.buildHeader();
    const trigger: DumpTrigger = {
      _type: 'trigger',
      timestamp: new Date().toISOString(),
      trigger_type: triggerType,
      ...(error && { error }),
      ...(context && { context }),
    };

    const ndjson = serializeDump(header, this.dictionary, events, trigger);
    return { ndjson, trigger };
  }

  /** Take a read-only snapshot of the current state (for inspection without serializing). */
  snapshot(): { header: DumpHeader; events: FlightRecorderEvent[] } {
    return {
      header: this.buildHeader(),
      events: this.buffer.drain(),
    };
  }

  private buildHeader(): DumpHeader {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dynamicContext = this.contextProvider();

    return {
      _type: 'header',
      _version: 1,
      schema_version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime_ms: Math.round(now - startTime),
      ring_buffer_capacity: this.buffer.capacity,
      ring_buffer_events_total: this.buffer.count,
      ring_buffer_events_retained: this.buffer.retained,
      events_lost: Math.max(0, this.buffer.count - this.buffer.capacity),
      ...dynamicContext,
    };
  }
}

function normalizeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack?.slice(0, 500),
    };
  }
  return { name: 'Error', message: String(err) };
}
