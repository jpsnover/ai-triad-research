// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Trace channel — renderer-side telemetry that routes diagnostic events to
 * the container's stdout (where Log Analytics ingests them in the cloud
 * deployment) so debate-flow failures can be diagnosed remotely.
 *
 * Design notes:
 * - Events are buffered and flushed on a short timer (FLUSH_INTERVAL_MS) or
 *   when the buffer crosses FLUSH_THRESHOLD. This keeps request rates low
 *   during rapid cross-respond bursts.
 * - On page unload, the buffer is flushed via navigator.sendBeacon so events
 *   are not lost if the user closes the tab mid-debate.
 * - In Electron mode (window.electronAPI present) there is no HTTP server to
 *   POST to, so events fall back to a structured console.log. This preserves
 *   parity with the pre-trace behavior; wiring into main-process logging is a
 *   follow-up.
 *
 * See docs/debate-observability-proposal.md for the full rationale.
 */

// ── Event schema ──────────────────────────────────────────────────────────

/**
 * Structured trace event. All fields beyond `ts` and `event` are optional so
 * call sites can populate whichever correlation IDs they have in hand.
 */
export interface TraceEvent {
  /** ISO 8601 timestamp of the event on the client. */
  ts: string;
  /** Dotted event name, e.g. 'an.extract.failed'. See TraceEventName. */
  event: string;
  /** Debate session ID when the event is tied to a specific debate. */
  debate_id?: string;
  /** Transcript entry ID when the event is tied to a specific turn. */
  turn_id?: string;
  /** Per-AI-call UUID when the event is tied to a specific model call. */
  call_id?: string;
  /** POV speaker label ('prometheus' | 'sentinel' | 'cassandra' | 'user' | 'system'). */
  speaker?: string;
  /** Event-specific payload. Keep small — this lands in log storage. */
  data?: Record<string, unknown>;
}

/**
 * Canonical event names for the first wave. Adding new events is fine; these
 * constants exist so typos fail at compile time for the common ones.
 */
export const TraceEventName = {
  // Argument network extraction
  AN_EXTRACT_START: 'an.extract.start',
  AN_EXTRACT_COMPLETE: 'an.extract.complete',
  AN_EXTRACT_FAILED: 'an.extract.failed',
  AN_EXTRACT_REJECTED_CLAIM: 'an.extract.rejected_claim',
  // AI model calls
  AI_CALL_START: 'ai.call.start',
  AI_CALL_COMPLETE: 'ai.call.complete',
  AI_CALL_FAILED: 'ai.call.failed',
} as const;

// ── Flight recorder bridge ────────────────────────────────────────────────

import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { EventType, EventLevel } from '@lib/flight-recorder/types';

/** Map trace event dotted names to flight recorder EventType values. */
function mapEventType(eventName: string): EventType {
  if (eventName.startsWith('an.extract')) return 'an.extract';
  if (eventName.startsWith('ai.call.start')) return 'ai.request';
  if (eventName.startsWith('ai.call.complete')) return 'ai.response';
  if (eventName.startsWith('ai.call.failed')) return 'ai.error';
  return 'lifecycle';
}

function inferComponent(eventName: string): string {
  if (eventName.startsWith('an.')) return 'argument-network-extraction';
  if (eventName.startsWith('ai.')) return 'ai-adapter';
  if (eventName.startsWith('turn.')) return 'turn-pipeline';
  if (eventName.startsWith('debate.')) return 'debate-engine';
  return 'unknown';
}

function inferLevel(eventName: string): EventLevel {
  if (eventName.endsWith('.failed')) return 'error';
  if (eventName.includes('rejected') || eventName.includes('retry')) return 'warn';
  return 'info';
}

// ── Runtime ───────────────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 20;
const MAX_BUFFER = 500; // hard cap to avoid runaway memory if the server is down
const ENDPOINT = '/debug/events';

const buffer: TraceEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

/** True when running inside Electron — renderer has `window.electronAPI`. */
function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI;
}

/** Generate a short random ID suitable for correlating events within a call. */
export function newCallId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Emit a trace event. Non-blocking, never throws. Safe to call from hot paths.
 *
 * @param event  Dotted event name (prefer TraceEventName constants)
 * @param fields Correlation IDs + event-specific data. `debate_id`, `turn_id`,
 *               `call_id`, `speaker` are hoisted to top-level; everything else
 *               goes into `data`.
 */
export function trace(
  event: string,
  fields: {
    debate_id?: string;
    turn_id?: string;
    call_id?: string;
    speaker?: string;
    [key: string]: unknown;
  } = {},
): void {
  try {
    const { debate_id, turn_id, call_id, speaker, ...rest } = fields;
    const ev: TraceEvent = {
      ts: new Date().toISOString(),
      event,
      ...(debate_id !== undefined && { debate_id }),
      ...(turn_id !== undefined && { turn_id }),
      ...(call_id !== undefined && { call_id }),
      ...(speaker !== undefined && { speaker }),
      ...(Object.keys(rest).length > 0 && { data: rest }),
    };

    // Feed the flight recorder (if initialized) — zero call-site changes needed.
    const recorder = getGlobalRecorder();
    if (recorder) {
      recorder.record({
        type: mapEventType(event),
        component: recorder.intern('component', inferComponent(event)) as string | number,
        level: inferLevel(event),
        debate_id: ev.debate_id,
        turn_id: ev.turn_id,
        call_id: ev.call_id,
        speaker: ev.speaker,
        message: event,
        data: ev.data,
      });
    }

    // Electron mode: there's no HTTP server on the same origin. Fall back to
    // a structured console.log so the event is at least present in devtools
    // output. Future work: route via IPC to the main process.
    if (isElectron()) {
      // eslint-disable-next-line no-console
      console.log('[trace]', JSON.stringify(ev));
      return;
    }

    buffer.push(ev);
    // Protect against unbounded growth if the server is unreachable for a long time.
    if (buffer.length > MAX_BUFFER) {
      buffer.splice(0, buffer.length - MAX_BUFFER);
    }

    if (buffer.length >= FLUSH_THRESHOLD) {
      void flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => { void flush(); }, FLUSH_INTERVAL_MS);
    }
  } catch {
    // Telemetry must never break the caller.
  }
}

/**
 * Force an immediate flush. Returns a promise that resolves when the current
 * batch has been sent (or failed). Safe to call from shutdown paths.
 */
export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0 || flushInFlight) return;

  const batch = buffer.splice(0, buffer.length);
  flushInFlight = true;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      // keepalive lets the fetch survive brief navigation; small batches only.
      keepalive: batch.length <= 50,
    });
    if (!res.ok) {
      // On server error, log once and drop the batch — never retry indefinitely.
      // eslint-disable-next-line no-console
      console.warn('[trace] server rejected batch:', res.status);
    }
  } catch {
    // Network failure: drop the batch and continue. Trace loss is acceptable;
    // blocking the UI on telemetry delivery is not.
  } finally {
    flushInFlight = false;
  }
}

/**
 * Flush on page unload via sendBeacon, which is designed for exactly this
 * case (fires even after the page has started tearing down).
 */
if (typeof window !== 'undefined' && !isElectron()) {
  window.addEventListener('pagehide', () => {
    if (buffer.length === 0) return;
    try {
      const batch = buffer.splice(0, buffer.length);
      const body = JSON.stringify({ events: batch });
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
    } catch {
      // Best effort.
    }
  });
}
