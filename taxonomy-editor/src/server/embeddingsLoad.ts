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

// Separate RECENT-WINDOW histogram for the load-shed decision (t/2914 item 1).
// `loopDelay` above is lifetime — good for the t/2904 trend log, but a weak freeze
// *trigger*: a current freeze barely moves a mean taken since process start. The
// shed decision reads THIS histogram's max and resets it on every read, so each
// decision sees only the delay accrued since the previous embedding request, and
// gates on the max (a freeze spikes the max, not the average). Kept separate so
// resetting it never perturbs the obs snapshot.
let shedLoopDelay: IntervalHistogram | undefined;
function getShedLoopDelay(): IntervalHistogram {
  if (!shedLoopDelay) {
    shedLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    shedLoopDelay.enable();
  }
  return shedLoopDelay;
}

/**
 * Max event-loop delay (ms) since the previous call, then reset the window.
 * Recent-window signal for the shed decision (t/2914 item 1) — distinct from the
 * lifetime obs value in `embeddingLoadSnapshot()`. NaN before the first sample → 0.
 */
export function readRecentLoopDelayMaxMs(): number {
  const d = getShedLoopDelay();
  const maxMs = Number.isFinite(d.max) ? d.max / NS_PER_MS : 0;
  d.reset();
  return maxMs;
}

let inFlight = 0;

/** Increment the in-flight embedding-compute counter (call before the compute). */
export function beginEmbeddingCompute(): void { inFlight++; }
/** Decrement it (call in a `finally` after the compute). Never drops below 0. */
export function endEmbeddingCompute(): void { inFlight = Math.max(0, inFlight - 1); }
/** Current number of in-flight embedding computes on this replica. */
export function inFlightEmbeddingComputes(): number { return inFlight; }

// t/3046: tracks whether the embedding model has been warmed (first successful
// computeEmbeddings call per container). Used to split cold-start vs compute
// latency in the FR event — drives the async-vs-keep-warm architecture decision.
let embeddingModelWarm = false;
export function isEmbeddingModelWarm(): boolean { return embeddingModelWarm; }
export function markEmbeddingModelWarm(): void { embeddingModelWarm = true; }
/** Reset the warm flag — test isolation only. */
export function resetEmbeddingModelWarm(): void { embeddingModelWarm = false; }

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

// ── t/2905: load-shed decision (concurrency cap + event-loop-delay backstop) ──
//
// The primary fix for the liveness-probe SIGKILL: bound the peak SIMULTANEOUS
// embedding load so V8 GC can't thrash the event loop into a missed health check.
// Two signals, either trips the shed:
//   - in-flight embedding-compute count >= a concurrency cap (the trigger was 3
//     parallel 702-item computes), OR
//   - recent-window MAX event-loop delay > a threshold (the DIRECT pre-liveness-
//     miss signal, robust regardless of count — the mechanism this incident hit).
//     Windowed max, reset each read, NOT the lifetime mean — a current freeze
//     barely moves a since-process-start mean, so it would rarely trip (t/2914 item 1).
//
// Gate promotion (warn-first): ships in WARN mode — the route LOGS "would shed"
// but proceeds, so the real concurrency + loop-delay distribution can be observed
// (via the t/2904 snapshot logs) and the cap/threshold tuned from data BEFORE
// promotion to BLOCK (503). Mode via EMBEDDINGS_LOAD_SHED_MODE = warn|block|off.

export type LoadShedMode = 'warn' | 'block' | 'off';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve the load-shed mode: EMBEDDINGS_LOAD_SHED_MODE = warn|block|off (default warn). */
export function embeddingLoadShedMode(): LoadShedMode {
  const raw = (process.env.EMBEDDINGS_LOAD_SHED_MODE ?? '').trim().toLowerCase();
  if (raw === 'block') return 'block';
  if (raw === 'off') return 'off';
  return 'warn'; // warn-first default (Gate Promotion)
}

export interface LoadShedDecision {
  /** True when the current load exceeds a shed threshold. */
  shed: boolean;
  /** Active mode. In 'warn' the caller logs and proceeds; in 'block' it 503s. */
  mode: LoadShedMode;
  /** Which signal tripped (for the log / response). */
  reason?: 'concurrency' | 'event_loop_delay';
  /** Suggested Retry-After for a 503, in ms. */
  retryAfterMs: number;
  /** Signals at decision time (for the log). */
  in_flight: number;
  /** Recent-window MAX event-loop delay (ms) the decision gated on (t/2914 item 1). */
  event_loop_delay_max_ms: number;
}

/** Already-read signals for a shed decision. */
export interface LoadShedInput {
  mode: LoadShedMode;
  /** In-flight OTHER embedding computes at decision time. */
  inFlight: number;
  /** Recent-window MAX event-loop delay (ms) since the last decision. */
  loopMaxMs: number;
  /** Shed when inFlight >= this. */
  cap: number;
  /** Shed when loopMaxMs > this. */
  loopShedMs: number;
  retryAfterMs: number;
}

/**
 * Pure shed decision from already-read signals (t/2914 item 1). Split out from the
 * signal reads so the `event_loop_delay` branch is deterministically testable — a
 * real test-env loop sits at ~0 delay and can't exercise it. Concurrency takes
 * precedence over loop delay (it's the cheaper, more direct trigger).
 */
export function decideLoadShed(input: LoadShedInput): LoadShedDecision {
  const { mode, inFlight, loopMaxMs, cap, loopShedMs, retryAfterMs } = input;
  let shed = false;
  let reason: LoadShedDecision['reason'];
  if (mode !== 'off') {
    if (inFlight >= cap) { shed = true; reason = 'concurrency'; }
    else if (loopMaxMs > loopShedMs) { shed = true; reason = 'event_loop_delay'; }
  }
  return {
    shed,
    mode,
    reason,
    retryAfterMs,
    in_flight: inFlight,
    event_loop_delay_max_ms: Math.round(loopMaxMs * 10) / 10,
  };
}

/**
 * Decide whether to shed a NEW embedding compute. Call at route entry BEFORE
 * accepting the compute (so `inFlight` is the count of OTHER computes running).
 * Reads the live signals and delegates to `decideLoadShed`. Env-tunable (warn-first):
 *   EMBEDDINGS_MAX_CONCURRENT  (default 2)   — shed when in-flight >= this.
 *   EMBEDDINGS_LOOP_SHED_MS    (default 250) — shed when recent-window MAX loop delay > this.
 *   EMBEDDINGS_RETRY_AFTER_MS  (default 2000)
 *   EMBEDDINGS_LOAD_SHED_MODE  (default warn)
 * Defaults are conservative starting points; tune from the t/2904 curve before
 * promoting to block. Reading the shed signal RESETS its recent window.
 */
export function evaluateEmbeddingLoadShed(): LoadShedDecision {
  return decideLoadShed({
    mode: embeddingLoadShedMode(),
    inFlight,
    loopMaxMs: readRecentLoopDelayMaxMs(),
    cap: intFromEnv('EMBEDDINGS_MAX_CONCURRENT', 2),
    loopShedMs: intFromEnv('EMBEDDINGS_LOOP_SHED_MS', 250),
    retryAfterMs: intFromEnv('EMBEDDINGS_RETRY_AFTER_MS', 2000),
  });
}
