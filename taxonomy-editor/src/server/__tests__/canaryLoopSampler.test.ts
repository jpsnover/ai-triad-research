// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3206 — the canary storm-window loop-lag sampler module (Diagnostics, e/130). Covers:
//  - evaluateCanaryGate logic (synthetic windows: PASS, all-fail, margin-fail) — deterministic.
//  - lifecycle: start → active; report → {window,gate} + inactive; report-without-start / double-
//    report throw 'not started' (→ 409 at the route).
//  - real capture: a genuine sync block registers in the window and fails the gate (integration).

import { describe, it, expect, afterEach } from 'vitest';
import {
  startCanaryLoopSampler,
  reportCanaryLoopSampler,
  evaluateCanaryGate,
  isCanaryLoopSamplerActive,
  __resetCanaryLoopSamplerForTest,
  CANARY_GATE,
  type CanaryLoopWindow,
} from '../canaryLoopSampler.js';

const win = (over: Partial<CanaryLoopWindow>): CanaryLoopWindow => ({
  count: 100, minMs: 5, meanMs: 8, maxMs: 10, p50Ms: 8, p99Ms: 9, p999Ms: 10, resolutionMs: 20, ...over,
});

function blockFor(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* deliberate synchronous event-loop block */ }
}

describe('canaryLoopSampler (t/3206)', () => {
  afterEach(() => __resetCanaryLoopSamplerForTest());

  // ── gate logic (pure, deterministic) ──
  it('gate PASSES when max & p99 are under all thresholds', () => {
    const g = evaluateCanaryGate(win({ maxMs: 12, p99Ms: 9 }));
    expect(g.pass).toBe(true);
    expect(g.checks).toHaveLength(3);
  });

  it('gate FAILS all three checks on a >1s block', () => {
    const g = evaluateCanaryGate(win({ maxMs: 1502.6, p99Ms: 1502.6 }));
    expect(g.pass).toBe(false);
    expect(g.checks.every(c => !c.pass)).toBe(true);
  });

  it('gate FAILS the margin even when the hard 1s check passes (700ms max)', () => {
    const g = evaluateCanaryGate(win({ maxMs: 700, p99Ms: 400 }));
    expect(g.pass).toBe(false);
    expect(g.checks.find(c => c.name.includes('max < 1000'))!.pass).toBe(true);   // hard OK
    expect(g.checks.find(c => c.name.includes('max < 500'))!.pass).toBe(false);   // margin fails
    expect(CANARY_GATE.hardMaxMs).toBe(1000);
  });

  // ── lifecycle ──
  it('start → active; report → inactive + {window,gate}; report again throws (→409)', () => {
    expect(isCanaryLoopSamplerActive()).toBe(false);
    startCanaryLoopSampler();
    expect(isCanaryLoopSamplerActive()).toBe(true);

    const out = reportCanaryLoopSampler();
    expect(out).toHaveProperty('window');
    expect(out).toHaveProperty('gate');
    expect(out.window.resolutionMs).toBe(20);
    expect(isCanaryLoopSamplerActive()).toBe(false);

    expect(() => reportCanaryLoopSampler()).toThrow(/not started/); // double-report
  });

  it('report without start throws (route maps to 409)', () => {
    expect(() => reportCanaryLoopSampler()).toThrow(/not started/);
  });

  // ── real capture (integration; genuine sync block) ──
  it('captures a real >500ms sync block in the window and fails the gate', async () => {
    startCanaryLoopSampler();
    // Yield first so the monitor's internal libuv timer is armed + cycling BEFORE we block —
    // otherwise the synchronous block runs before sampling starts and nothing large is recorded.
    await new Promise<void>(r => setTimeout(r, 30));
    blockFor(700);                                          // stall the loop ~700ms (> 500ms margin)
    await new Promise<void>(r => setTimeout(r, 60));        // let the delayed sample record into the histogram
    const { window, gate } = reportCanaryLoopSampler();
    expect(window.count).toBeGreaterThan(0);
    expect(window.maxMs).toBeGreaterThan(500);             // the ~700ms block registered
    expect(gate.pass).toBe(false);                         // fails the max<500 (and p99<500) margin
    // (the 1s hard-cap boundary is asserted deterministically in the synthetic-window test above —
    //  not here, since a loaded CI runner could add a pause atop the 700ms block and cross 1000ms.)
  });
});
