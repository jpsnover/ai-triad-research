// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3373 — pre-shed early-warning for the embedding worker-offload pool (t/3211 arm-2's real
// trigger). The pool's own queue-shed WARN (offThreadEmbedding.ts) is flight-recorder-only and
// fires AFTER a user already ate a 503. The t/3211 alert wants to fire BEFORE the shed — when
// sustained queue depth approaches the dynamic admission cap. This periodically samples
// poolStats() (t/3374) and emits ONE stdout WARN (→ Log Analytics) on sustained-high onset,
// and an INFO on recovery. No per-tick spam; transition-throttled with hysteresis.
//
// Distinct from eventLoopMonitor.ts (loop lag): same cheap-sampler shape, different signal —
// this is embed-queue saturation, that is event-loop starvation.

import { poolStats } from '../../../lib/embeddings/offThreadEmbedding.js';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import { log } from './logger.js';

/** Depth/cap fraction at/above which the queue is "high" — the pre-shed band. */
export const QUEUE_HIGH_RATIO = 0.75;
/** Hysteresis floor: ratio must fall below this to clear a firing state (avoids threshold flapping). */
export const QUEUE_CLEAR_RATIO = 0.5;
/** Consecutive high samples required before firing — sustained pressure, not a single burst spike. */
export const SUSTAINED_HIGH_SAMPLES = 3;
const SAMPLE_INTERVAL_MS = 5000;

export interface QueueDepthSample {
  /** Resident tasks (queued + in-flight). */
  queueDepth: number;
  /** Dynamic admission cap = MAX_QUEUE_DEPTH × liveSlots. 0 when every slot is respawning. */
  cap: number;
  /** Slots currently able to serve. */
  liveSlots: number;
  /** queueDepth / cap, or 0 when cap ≤ 0 (idle / all-slots-down → never "high"). */
  ratio: number;
}

export interface GaugeState {
  consecutiveHigh: number;
  firing: boolean;
}

export const INITIAL_GAUGE_STATE: GaugeState = { consecutiveHigh: 0, firing: false };

/** Derive a sample from a poolStats() snapshot. ratio=0 when cap≤0 so idle / all-down never fires. */
export function toSample(s: { queueDepth: number; cap: number; liveSlots: number }): QueueDepthSample {
  const ratio = s.cap > 0 ? s.queueDepth / s.cap : 0;
  return { queueDepth: s.queueDepth, cap: s.cap, liveSlots: s.liveSlots, ratio };
}

/**
 * Pure transition: prior gauge state + a sample → next state and any emission.
 * - WARN once on sustained-high ONSET (≥`sustained` consecutive high samples) — the pre-shed signal.
 * - INFO once on recovery (ratio drops below `clearRatio` while firing) — hysteresis, no flap.
 * - Otherwise silent. Throttled by construction: at most one emit per state transition.
 * Extracted from the timer glue so both arms are unit-testable without fake timers.
 */
export function classifyQueueDepth(
  prev: GaugeState,
  s: QueueDepthSample,
  opts: { highRatio?: number; clearRatio?: number; sustained?: number } = {},
): { next: GaugeState; emit: { level: 'warn' | 'info'; message: string } | null } {
  const highRatio = opts.highRatio ?? QUEUE_HIGH_RATIO;
  const clearRatio = opts.clearRatio ?? QUEUE_CLEAR_RATIO;
  const sustained = opts.sustained ?? SUSTAINED_HIGH_SAMPLES;

  const high = s.cap > 0 && s.ratio >= highRatio;
  const consecutiveHigh = high ? prev.consecutiveHigh + 1 : 0;
  const gauge = `depth ${s.queueDepth}/${s.cap} (${(s.ratio * 100).toFixed(0)}%) liveSlots ${s.liveSlots}`;

  if (!prev.firing && consecutiveHigh >= sustained) {
    return {
      next: { consecutiveHigh, firing: true },
      emit: {
        level: 'warn',
        message: `embeddings worker-pool queue depth high — sustained pre-shed early-warning — ${gauge}`,
      },
    };
  }
  if (prev.firing && s.ratio < clearRatio) {
    return {
      next: { consecutiveHigh, firing: false },
      emit: { level: 'info', message: `embeddings worker-pool queue depth recovered — ${gauge}` },
    };
  }
  return { next: { consecutiveHigh, firing: prev.firing }, emit: null };
}

let timer: NodeJS.Timeout | null = null;
let state: GaugeState = { ...INITIAL_GAUGE_STATE };

/**
 * Start the periodic queue-depth gauge. Idempotent (a second call is a no-op while running).
 * The interval is `unref()`d so it never keeps the process alive. Returns the stop fn.
 */
export function startEmbedQueueDepthMonitor(intervalMs: number = SAMPLE_INTERVAL_MS): () => void {
  if (timer) return stopEmbedQueueDepthMonitor;
  state = { ...INITIAL_GAUGE_STATE };
  timer = setInterval(() => {
    const sample = toSample(poolStats());
    const { next, emit } = classifyQueueDepth(state, sample);
    state = next;
    if (!emit) return;
    if (emit.level === 'warn') {
      // Sustained-high onset — curated FR ring + stdout. `log.api` keeps component:'api' (the proven
      // Log-Analytics sink DevOps matches on, t/3110/t/3308 lesson); `subsystem` carries the label so
      // the child's component binding is NOT overridden. The FR record's own `component` is FR taxonomy.
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'embed-queue', level: 'warn',
        message: emit.message, data: { ...sample },
      });
      log.api.warn({ subsystem: 'embed-queue', ...sample }, emit.message);
    } else {
      // Recovery — Pino/stdout only; never the capacity-bounded FR ring.
      log.api.info({ subsystem: 'embed-queue', ...sample }, emit.message);
    }
  }, intervalMs);
  timer.unref();
  return stopEmbedQueueDepthMonitor;
}

/** Stop the gauge (idempotent). */
export function stopEmbedQueueDepthMonitor(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Test-only: stop and reset module state so cases don't leak into one another. */
export function __resetEmbedQueueMonitorForTest(): void {
  stopEmbedQueueDepthMonitor();
  state = { ...INITIAL_GAUGE_STATE };
}
