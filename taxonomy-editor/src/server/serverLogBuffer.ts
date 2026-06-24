// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Bounded ring buffer of recent server log lines, merged into flight-recorder
 * server dumps so a dump is self-contained for offline triage (no Log Analytics
 * query needed). Operator-requested.
 *
 * This is a SEPARATE, small buffer (own cap) so log lines never evict curated
 * flight-recorder events from the main ring. Pino already redacts sensitive
 * fields before the line reaches us; we re-scrub defensively and cap per-line
 * size, because dumps can be uploaded (ADR-002 — no secrets in artifacts).
 */

export const MAX_LOG_LINES = 250;
const MAX_LINE_BYTES = 4_096;

const SENSITIVE_KEY = /^(api_?key|token|password|secret|authorization|cookie|credentials?)$/i;

const buffer: Record<string, unknown>[] = [];

/** Recursively drop sensitive keys (defense-in-depth on top of pino redaction). */
function scrub(value: unknown, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const v of value) scrub(v, depth + 1); return; }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEY.test(key)) { obj[key] = '[REDACTED]'; continue; }
    scrub(obj[key], depth + 1);
  }
}

/** Record one or more newline-delimited pino log lines into the ring buffer. */
export function recordServerLog(chunk: string): void {
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      scrub(rec);
      let entry: Record<string, unknown> = rec;
      if (JSON.stringify(rec).length > MAX_LINE_BYTES) {
        // Oversized line — keep only the essentials so one chatty log can't bloat the dump.
        entry = {
          level: rec.level, time: rec.time, component: rec.component, requestId: rec.requestId,
          msg: typeof rec.msg === 'string' ? rec.msg.slice(0, 500) : rec.msg,
          _truncated: true,
        };
      }
      buffer.push(entry);
      if (buffer.length > MAX_LOG_LINES) buffer.shift();
    } catch {
      /* telemetry — silent by design: never let log buffering break logging (recursion-safe) */
    }
  }
}

/** A copy of the buffered log lines, oldest first (for inclusion in a server dump). */
export function drainServerLogLines(): Record<string, unknown>[] {
  return buffer.slice();
}

/** Test-only: clear the buffer. */
export function _resetServerLogBuffer(): void {
  buffer.length = 0;
}
