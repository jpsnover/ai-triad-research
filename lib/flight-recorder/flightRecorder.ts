// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { Dictionary } from './dictionary.js';
import { RingBuffer } from './ringBuffer.js';
import { serializeDump } from './serializer.js';
import type {
  RecordInput,
  FlightRecorderEvent,
  FlightRecorderConfig,
  DumpHeader,
  DumpContext,
  DumpTrigger,
  DumpResult,
  RecorderSummary,
  TriggerType,
  ErrorCategory,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

type ContextProvider = () => Record<string, unknown>;

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
  private eventContext: Partial<RecordInput> = {};

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

  /**
   * Set fields auto-merged into every record() call. Caller-supplied fields
   * take precedence. Use for ambient context like active debate_id / run_id.
   */
  setEventContext(ctx: Partial<RecordInput>): void {
    this.eventContext = ctx;
  }

  /** Record an event into the ring buffer. Hot path — no allocations beyond the event object. */
  record(input: RecordInput): void {
    const event: FlightRecorderEvent = {
      ...this.eventContext,
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
    error_category?: ErrorCategory,
  ): { ndjson: string; trigger: DumpTrigger } | null {
    const error = normalizeError(err);
    this.record({
      type: 'system.error',
      component: context?.component as string | number ?? 'unknown',
      level: 'error',
      message: error.message,
      error,
      data: context,
      error_category,
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

    // Context record — captures app state at dump time
    let dumpContext: DumpContext | undefined;
    const ctx = this.contextProvider();
    if (ctx && Object.keys(ctx).length > 0) {
      dumpContext = { _type: 'context', ...ctx };
    }

    const ndjson = serializeDump(header, this.dictionary, events, trigger, dumpContext);
    return { ndjson, trigger };
  }

  // ── On-demand dump to file ───────────────────────────────────────

  dumpToFile(filePath?: string): DumpResult {
    const events = this.buffer.drain();
    const resolvedPath = filePath ?? path.join(
      this.config.dumpDir || '.',
      `dump-${process.pid}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
    );

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const { ndjson } = this.buildDump('explicit');
    fs.writeFileSync(resolvedPath, ndjson, 'utf-8');

    const ctx = this.contextProvider();
    const firstWall = events.length > 0 ? events[0]._wall : Date.now();
    const lastWall = events.length > 0 ? events[events.length - 1]._wall : Date.now();

    return {
      path: resolvedPath,
      event_count: events.length,
      first_event_ts: new Date(firstWall).toISOString(),
      last_event_ts: new Date(lastWall).toISOString(),
      debate_id: ctx.active_debate_id as string | undefined,
      size_bytes: Buffer.byteLength(ndjson, 'utf-8'),
    };
  }

  // ── Summary (no I/O) ───────────────────────────────────────────

  getSummary(): RecorderSummary {
    const events = this.buffer.drain();
    const ctx = this.contextProvider();

    const firstWall = events.length > 0 ? events[0]._wall : undefined;
    const lastWall = events.length > 0 ? events[events.length - 1]._wall : undefined;

    let sizeEstimate = 0;
    for (const e of events) {
      sizeEstimate += 200;
      if (e.message) sizeEstimate += e.message.length;
      if (e.data) sizeEstimate += JSON.stringify(e.data).length;
    }

    return {
      event_count: events.length,
      first_event_ts: firstWall != null ? new Date(firstWall).toISOString() : undefined,
      last_event_ts: lastWall != null ? new Date(lastWall).toISOString() : undefined,
      debate_id: ctx.active_debate_id as string | undefined,
      buffer_size_bytes: sizeEstimate,
    };
  }

  // ── Named pipe listener ────────────────────────────────────────

  private _pipeServer: net.Server | null = null;

  startPipeListener(pid?: number): void {
    if (this._pipeServer) return;

    const pipeName = `\\\\.\\pipe\\taxonomy-flight-recorder-${pid ?? process.pid}`;
    const server = net.createServer((conn) => {
      let data = '';
      conn.on('data', (chunk) => { data += chunk.toString(); });
      conn.on('end', () => {
        try {
          const req = JSON.parse(data) as { action?: string };
          if (req.action === 'dump') {
            const result = this.dumpToFile();
            conn.end(JSON.stringify(result) + '\n');
          } else if (req.action === 'summary') {
            const result = this.getSummary();
            conn.end(JSON.stringify(result) + '\n');
          } else {
            conn.end(JSON.stringify({ error: `Unknown action: ${req.action}` }) + '\n');
          }
        } catch (err) {
          conn.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) + '\n');
        }
      });
    });

    server.on('error', (err) => {
      console.warn(`[flight-recorder] Pipe listener error: ${err.message}`);
    });

    server.listen(pipeName);
    this._pipeServer = server;

    const cleanup = () => {
      if (this._pipeServer) {
        this._pipeServer.close();
        this._pipeServer = null;
      }
    };
    process.on('exit', cleanup);
    process.on('SIGTERM', cleanup);
  }

  stopPipeListener(): void {
    if (this._pipeServer) {
      this._pipeServer.close();
      this._pipeServer = null;
    }
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
