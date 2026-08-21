// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2904 / t/2905 — embedding-compute load instrumentation.
//
// The 2026-08-21 prod crash was NOT an OOM. Three concurrent 702-item embedding
// computes drove V8 into GC mark-compact thrash that froze the Node event loop
// long enough to miss ACA's liveness-probe deadline → the container was SIGKILL'd
// and restarted (RSS never hit the limit; no FATAL ERROR in stderr). See t/2905.
//
// This module exposes the pre-freeze signals — event-loop delay (the DIRECT
// predictor of a liveness miss), heap/rss, and the in-flight embedding-compute
// count (the trigger was concurrency) — plus the in-flight counter that the
// t/2905 concurrency cap builds on. Per-process by design (maxReplicas: 1).

import v8 from 'v8';
import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';

const BYTES_PER_MB = 1024 * 1024;
const NS_PER_MS = 1e6;

// Event-loop delay histogram, enabled once on first use. `.mean`/`.max` are in
// NANOSECONDS since process start; a sustained high value means the loop is
// starved — the state that precedes a liveness-probe miss under embedding load.
let loopDelay: IntervalHistogram | undefined;
function getLoopDelay(): IntervalHistogram {
  if (!loopDelay) {
    loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
  }
  return loopDelay;
}

let inFlight = 0;

/** Increment the in-flight embedding-compute counter (call before the compute). */
export function beginEmbeddingCompute(): void { inFlight++; }
/** Decrement it (call in a `finally` after the compute). Never drops below 0. */
export function endEmbeddingCompute(): void { inFlight = Math.max(0, inFlight - 1); }
/** Current number of in-flight embedding computes on this replica. */
export function inFlightEmbeddingComputes(): number { return inFlight; }

export interface EmbeddingLoadSnapshot {
  heap_used_mb: number;
  heap_total_mb: number;
  heap_limit_mb: number;
  rss_mb: number;
  event_loop_delay_mean_ms: number;
  event_loop_delay_max_ms: number;
  in_flight_embedding_computes: number;
}

/**
 * Point-in-time snapshot of the signals that precede an embedding-load
 * liveness-probe kill. Cheap; safe to call per request.
 */
export function embeddingLoadSnapshot(): EmbeddingLoadSnapshot {
  const mem = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  const d = getLoopDelay();
  // `.mean`/`.max` can be NaN before the first sampling interval elapses.
  const toMs = (ns: number): number => (Number.isFinite(ns) ? Math.round((ns / NS_PER_MS) * 10) / 10 : 0);
  return {
    heap_used_mb: Math.round(mem.heapUsed / BYTES_PER_MB),
    heap_total_mb: Math.round(mem.heapTotal / BYTES_PER_MB),
    heap_limit_mb: Math.round(heapLimit / BYTES_PER_MB),
    rss_mb: Math.round(mem.rss / BYTES_PER_MB),
    event_loop_delay_mean_ms: toMs(d.mean),
    event_loop_delay_max_ms: toMs(d.max),
    in_flight_embedding_computes: inFlight,
  };
}
