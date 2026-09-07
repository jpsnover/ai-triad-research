// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3373 — the pre-shed queue-depth gauge's decision core. The timer glue is thin; the risk is in
// the state machine: fire ONCE on sustained-high onset, clear ONCE on recovery (hysteresis), and
// stay silent when idle / all-slots-down. Those are exercised here as pure transitions — no fake
// timers, no live worker pool.

import { describe, it, expect } from 'vitest';
import {
  classifyQueueDepth,
  toSample,
  INITIAL_GAUGE_STATE,
  QUEUE_HIGH_RATIO,
  QUEUE_CLEAR_RATIO,
  SUSTAINED_HIGH_SAMPLES,
  type GaugeState,
} from '../embedQueueDepthMonitor.js';

/** Drive a sequence of poolStats snapshots through the state machine, collecting every emission. */
function run(
  snapshots: Array<{ queueDepth: number; cap: number; liveSlots: number }>,
  opts?: { highRatio?: number; clearRatio?: number; sustained?: number },
): { emits: Array<{ level: 'warn' | 'info'; message: string }>; final: GaugeState } {
  let state: GaugeState = { ...INITIAL_GAUGE_STATE };
  const emits: Array<{ level: 'warn' | 'info'; message: string }> = [];
  for (const snap of snapshots) {
    const { next, emit } = classifyQueueDepth(state, toSample(snap), opts);
    state = next;
    if (emit) emits.push(emit);
  }
  return { emits, final: state };
}

describe('toSample', () => {
  it('computes ratio = depth/cap', () => {
    expect(toSample({ queueDepth: 12, cap: 16, liveSlots: 1 }).ratio).toBe(12 / 16);
  });
  it('ratio is 0 when cap is 0 (all slots down) — never dividing by zero', () => {
    expect(toSample({ queueDepth: 5, cap: 0, liveSlots: 0 }).ratio).toBe(0);
  });
  it('ratio is 0 at idle (depth 0)', () => {
    expect(toSample({ queueDepth: 0, cap: 16, liveSlots: 1 }).ratio).toBe(0);
  });
});

describe('classifyQueueDepth — sustained-high onset', () => {
  const high = { queueDepth: 14, cap: 16, liveSlots: 1 }; // 87.5% ≥ 75%

  it('does NOT fire before SUSTAINED_HIGH_SAMPLES consecutive high samples', () => {
    const snaps = Array.from({ length: SUSTAINED_HIGH_SAMPLES - 1 }, () => high);
    const { emits } = run(snaps);
    expect(emits).toHaveLength(0);
  });

  it('fires exactly one WARN on the Nth consecutive high sample', () => {
    const snaps = Array.from({ length: SUSTAINED_HIGH_SAMPLES }, () => high);
    const { emits, final } = run(snaps);
    expect(emits).toHaveLength(1);
    expect(emits[0].level).toBe('warn');
    expect(emits[0].message).toContain('worker-pool queue depth high');
    expect(final.firing).toBe(true);
  });

  it('does NOT re-fire while it stays high (throttled — one emit per transition)', () => {
    const snaps = Array.from({ length: SUSTAINED_HIGH_SAMPLES + 5 }, () => high);
    const { emits } = run(snaps);
    expect(emits.filter(e => e.level === 'warn')).toHaveLength(1);
  });

  it('a single high spike interrupted by a low sample resets the counter — no fire', () => {
    const low = { queueDepth: 2, cap: 16, liveSlots: 1 };
    const snaps = [high, high, low, high]; // never 3 in a row
    const { emits, final } = run(snaps);
    expect(emits).toHaveLength(0);
    expect(final.firing).toBe(false);
  });
});

describe('classifyQueueDepth — recovery / hysteresis', () => {
  const high = { queueDepth: 14, cap: 16, liveSlots: 1 };  // 87.5%
  const mid = { queueDepth: 10, cap: 16, liveSlots: 1 };   // 62.5% — below high, ABOVE clear
  const low = { queueDepth: 6, cap: 16, liveSlots: 1 };    // 37.5% — below clear (0.5)

  it('stays firing in the hysteresis band (below high, above clear) — no recovery emit yet', () => {
    const snaps = [...Array(SUSTAINED_HIGH_SAMPLES).fill(high), mid, mid];
    const { emits, final } = run(snaps);
    expect(emits.filter(e => e.level === 'info')).toHaveLength(0);
    expect(final.firing).toBe(true);
  });

  it('emits one INFO recovery when ratio drops below the clear floor', () => {
    const snaps = [...Array(SUSTAINED_HIGH_SAMPLES).fill(high), low];
    const { emits, final } = run(snaps);
    expect(emits.filter(e => e.level === 'warn')).toHaveLength(1);
    const infos = emits.filter(e => e.level === 'info');
    expect(infos).toHaveLength(1);
    expect(infos[0].message).toContain('queue depth recovered');
    expect(final.firing).toBe(false);
  });

  it('can re-arm after a recover→high cycle (fires a second WARN)', () => {
    const snaps = [
      ...Array(SUSTAINED_HIGH_SAMPLES).fill(high), // warn #1
      low,                                          // recover
      ...Array(SUSTAINED_HIGH_SAMPLES).fill(high), // warn #2
    ];
    const { emits } = run(snaps);
    expect(emits.filter(e => e.level === 'warn')).toHaveLength(2);
    expect(emits.filter(e => e.level === 'info')).toHaveLength(1);
  });
});

describe('classifyQueueDepth — inert states', () => {
  it('idle pool (depth 0) never fires', () => {
    const snaps = Array.from({ length: 10 }, () => ({ queueDepth: 0, cap: 16, liveSlots: 1 }));
    expect(run(snaps).emits).toHaveLength(0);
  });

  it('all-slots-down (cap 0) never fires — that hard-shed is the shed-token path, not the gauge', () => {
    const snaps = Array.from({ length: 10 }, () => ({ queueDepth: 8, cap: 0, liveSlots: 0 }));
    expect(run(snaps).emits).toHaveLength(0);
  });

  it('exactly at the high ratio boundary counts as high', () => {
    const cap = 16;
    const atBoundary = { queueDepth: Math.ceil(QUEUE_HIGH_RATIO * cap), cap, liveSlots: 1 };
    expect(toSample(atBoundary).ratio).toBeGreaterThanOrEqual(QUEUE_HIGH_RATIO);
    const { emits } = run(Array.from({ length: SUSTAINED_HIGH_SAMPLES }, () => atBoundary));
    expect(emits.filter(e => e.level === 'warn')).toHaveLength(1);
  });

  it('clear floor is below the high band (hysteresis gap is non-empty)', () => {
    expect(QUEUE_CLEAR_RATIO).toBeLessThan(QUEUE_HIGH_RATIO);
  });
});
