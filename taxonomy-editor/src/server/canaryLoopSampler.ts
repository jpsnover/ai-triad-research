// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Canary storm-window event-loop-lag sampler (t/3206; module authored by Diagnostics, e/130).
 *
 * A SINGLE non-resetting perf_hooks histogram spanning a whole storm-replay window, so the canary
 * can compute a true window p99 (the t/3165 close gate). Distinct from eventLoopMonitor.ts, which
 * resets every 5s for the live warn signal — per-interval p99 can't be merged into a window p99
 * (percentile-of-percentiles is biased by #bad-intervals, not #bad-samples). Same "distinct
 * lifecycle → distinct histogram" rationale eventLoopMonitor.ts documents for staying separate from
 * embeddingsLoad.ts. MUST run in the server process (the ONNX loop), never the driver.
 *
 * Lifecycle: start → (driver drives the storm) → report (snapshot + gate, then disable+null). The
 * histogram is a module-level singleton, so RUNS ARE SERIAL — a second start() resets the first's
 * window. That's fine for the staging canary (one driver, one run at a time); the route layer 404s
 * unless the CANARY_LOOP_SAMPLER flag is on, so it's never exposed in normal prod.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';

const NS_PER_MS = 1e6;

/** Gate thresholds (locked p/168#19). Frozen so the pass criteria live in ONE place — the driver
 *  just asserts gate.pass, so server and harness can't drift. */
export const CANARY_GATE = Object.freeze({ hardMaxMs: 1000, marginP99Ms: 500, marginMaxMs: 500 });

export interface CanaryLoopWindow {
  count: number; minMs: number; meanMs: number; maxMs: number;
  p50Ms: number; p99Ms: number; p999Ms: number; resolutionMs: number;
}
export interface CanaryGateResult { pass: boolean; checks: Array<{ name: string; pass: boolean; actualMs: number }> }

let hist: IntervalHistogram | null = null;
const RESOLUTION_MS = 20; // matches eventLoopMonitor.ts; fine for multi-sec blocks (floor ~20ms, 25× under margin)

/** Start (or restart) the storm-window sampler. Idempotent-ish: a second call resets the window. */
export function startCanaryLoopSampler(): void {
  if (hist) { hist.reset(); hist.enable(); return; }
  hist = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  hist.enable();
}

/** Read the window. Throws 'canary loop sampler not started' if start() was never called (or after
 *  a prior report already disabled it) — the route maps that to a 409, not a 500. */
function snapshot(): CanaryLoopWindow {
  if (!hist) throw new Error('canary loop sampler not started');
  return {
    count: hist.count,
    minMs: hist.min / NS_PER_MS,
    meanMs: (Number.isFinite(hist.mean) ? hist.mean : 0) / NS_PER_MS,
    maxMs: hist.max / NS_PER_MS,
    p50Ms: hist.percentile(50) / NS_PER_MS,
    p99Ms: hist.percentile(99) / NS_PER_MS,
    p999Ms: hist.percentile(99.9) / NS_PER_MS,
    resolutionMs: RESOLUTION_MS,
  };
}

export function evaluateCanaryGate(w: CanaryLoopWindow): CanaryGateResult {
  const checks = [
    { name: 'max < 1000ms (hard: no sample > 1s liveness timeout)', pass: w.maxMs < CANARY_GATE.hardMaxMs, actualMs: w.maxMs },
    { name: 'p99 < 500ms (margin)', pass: w.p99Ms < CANARY_GATE.marginP99Ms, actualMs: w.p99Ms },
    { name: 'max < 500ms (margin)', pass: w.maxMs < CANARY_GATE.marginMaxMs, actualMs: w.maxMs },
  ];
  return { pass: checks.every(c => c.pass), checks };
}

/** Snapshot + gate, then disable+null the histogram (so a double-report → 'not started' → 409). */
export function reportCanaryLoopSampler(): { window: CanaryLoopWindow; gate: CanaryGateResult } {
  const window = snapshot();
  const gate = evaluateCanaryGate(window);
  if (hist) { hist.disable(); hist = null; }
  return { window, gate };
}

/** True once start() has run and no report() has consumed it yet. */
export function isCanaryLoopSamplerActive(): boolean { return hist !== null; }

/** Test-only: force-clear the singleton between tests. */
export function __resetCanaryLoopSamplerForTest(): void {
  if (hist) { hist.disable(); hist = null; }
}
