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

// t/2552: pino error/fatal level. A 500's error line (level 50) was evicted from
// the 250-entry main ring by info-level (level 30) access-log traffic — one entry
// per request — before the dump triggered, so the 500 was invisible offline.
export const MAX_ERROR_LOG_LINES = 50;
const PINO_ERROR_LEVEL = 50;

const SENSITIVE_KEY = /^(api_?key|token|password|secret|authorization|cookie|credentials?)$/i;

const buffer: Record<string, unknown>[] = [];
// t/2552: a secondary, smaller ring that pins error/fatal (level ≥ 50) entries so
// they survive info-level flooding of the main ring. Entries here are the SAME
// object references pushed into `buffer`, so drain dedups by reference identity.
const errorBuffer: Record<string, unknown>[] = [];

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
      // t/2552: also pin error/fatal into the secondary ring (same object ref) so
      // a burst of info-level requests can't evict the one line that explains a 500.
      if (typeof entry.level === 'number' && entry.level >= PINO_ERROR_LEVEL) {
        errorBuffer.push(entry);
        if (errorBuffer.length > MAX_ERROR_LOG_LINES) errorBuffer.shift();
      }
    } catch {
      /* telemetry — silent by design: never let log buffering break logging (recursion-safe) */
    }
  }
}

/**
 * A copy of the buffered log lines, oldest first (for inclusion in a server dump).
 *
 * t/2552: returns the main ring PLUS any pinned error/fatal entries that the main
 * ring has already evicted, so a 500's error line survives info-level flooding.
 * Dedup is by object-reference identity — a pinned error is the SAME object that
 * was pushed into `buffer`, so one still in the main window is filtered out of the
 * error tail (never duplicated). Evicted errors are, by construction, older than
 * every entry left in the main ring (they were pushed out by newer traffic), so
 * they are prepended to keep the result chronological without sorting.
 */
export function drainServerLogLines(): Record<string, unknown>[] {
  const main = buffer.slice();
  if (errorBuffer.length === 0) return main;
  const inMain = new Set(main);
  const evictedErrors = errorBuffer.filter(e => !inMain.has(e));
  return evictedErrors.length === 0 ? main : [...evictedErrors, ...main];
}

/** Test-only: clear both buffers. */
export function _resetServerLogBuffer(): void {
  buffer.length = 0;
  errorBuffer.length = 0;
}
