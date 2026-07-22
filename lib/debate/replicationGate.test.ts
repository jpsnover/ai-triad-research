// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Tests for the replication gate + metric distribution primitives (t/1668, R-1).
 * A regression trigger may fire on a fixed config only after n ≥ 10 clean-tree
 * replications; the metric is reported as a distribution (median + spread), never
 * a single draw.
 */

import { describe, it, expect } from 'vitest';
import {
  REPLICATION_GATE_MIN_N,
  fixedConfigKey,
  medianSorted,
  quantileSorted,
  computeDistribution,
  replicationSet,
  evaluateReplicationGate,
  replicationGateByConfig,
  type CalibrationDataPoint,
  type MetricSelector,
} from './calibrationLogger.js';

/**
 * Build a minimal CalibrationDataPoint carrying only the fields the gate reads
 * (the provenance triple, working_tree_state, and one metric). The gate is a set
 * of pure functions over these fields, so the rest of the schema is irrelevant here.
 */
function makeEntry(opts: {
  config_revision?: string;
  prompt_version?: string;
  model?: string;
  working_tree_state?: 'clean' | 'dirty' | 'unknown';
  metric?: number | null;
}): CalibrationDataPoint {
  return {
    config_revision: opts.config_revision ?? 'cfgA',
    prompt_version: opts.prompt_version ?? '2026-07-22.1',
    model: opts.model ?? 'modelX',
    working_tree_state: opts.working_tree_state ?? 'clean',
    crux_addressed_ratio: opts.metric === undefined ? 0.5 : opts.metric,
  } as unknown as CalibrationDataPoint;
}

const metric: MetricSelector = (d) => d.crux_addressed_ratio;

describe('fixedConfigKey', () => {
  it('joins the t/1672 provenance triple: config_revision | prompt_version | model', () => {
    expect(fixedConfigKey(makeEntry({ config_revision: 'r1', prompt_version: 'p2', model: 'm3' })))
      .toBe('r1|p2|m3');
  });

  it('distinguishes configs that differ in any one component', () => {
    const base = makeEntry({ config_revision: 'r1', prompt_version: 'p1', model: 'm1' });
    expect(fixedConfigKey(base)).not.toBe(fixedConfigKey(makeEntry({ config_revision: 'r2', prompt_version: 'p1', model: 'm1' })));
    expect(fixedConfigKey(base)).not.toBe(fixedConfigKey(makeEntry({ config_revision: 'r1', prompt_version: 'p2', model: 'm1' })));
    expect(fixedConfigKey(base)).not.toBe(fixedConfigKey(makeEntry({ config_revision: 'r1', prompt_version: 'p1', model: 'm2' })));
  });
});

describe('medianSorted', () => {
  it('returns the middle element for odd length', () => {
    expect(medianSorted([1, 2, 3])).toBe(2);
  });
  it('averages the two middle elements for even length', () => {
    expect(medianSorted([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns the sole element for length 1', () => {
    expect(medianSorted([7])).toBe(7);
  });
});

describe('quantileSorted (type-7 linear interpolation)', () => {
  it('returns the sole element for any q on a singleton', () => {
    expect(quantileSorted([7], 0)).toBe(7);
    expect(quantileSorted([7], 0.25)).toBe(7);
    expect(quantileSorted([7], 1)).toBe(7);
  });
  it('interpolates Q1/Q3 of [2,4,6,8]', () => {
    expect(quantileSorted([2, 4, 6, 8], 0.25)).toBeCloseTo(3.5, 10);
    expect(quantileSorted([2, 4, 6, 8], 0.75)).toBeCloseTo(6.5, 10);
  });
  it('returns the exact element when the position is integral', () => {
    expect(quantileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

describe('computeDistribution', () => {
  it('summarises a known even-length vector', () => {
    const d = computeDistribution([2, 4, 6, 8]);
    expect(d).not.toBeNull();
    expect(d!.n).toBe(4);
    expect(d!.median).toBe(5);
    expect(d!.iqr).toBeCloseTo(3, 10);   // 6.5 − 3.5
    expect(d!.mad).toBe(2);               // absDev from 5 = [3,1,1,3] → median 2
    expect(d!.min).toBe(2);
    expect(d!.max).toBe(8);
  });

  it('summarises a known odd-length vector', () => {
    const d = computeDistribution([5, 1, 3, 2, 4]); // unsorted input
    expect(d!.n).toBe(5);
    expect(d!.median).toBe(3);
    expect(d!.min).toBe(1);
    expect(d!.max).toBe(5);
  });

  it('yields zero spread for a single value', () => {
    const d = computeDistribution([0.42]);
    expect(d).toEqual({ n: 1, median: 0.42, iqr: 0, mad: 0, min: 0.42, max: 0.42 });
  });

  it('handles ties (all identical) as zero spread', () => {
    const d = computeDistribution([0.3, 0.3, 0.3, 0.3]);
    expect(d).toEqual({ n: 4, median: 0.3, iqr: 0, mad: 0, min: 0.3, max: 0.3 });
  });

  it('drops null/undefined/NaN before computing', () => {
    const d = computeDistribution([1, null, 2, undefined, 3, NaN]);
    expect(d!.n).toBe(3);
    expect(d!.median).toBe(2);
  });

  it('returns null when nothing finite remains (never fabricates a point)', () => {
    expect(computeDistribution([])).toBeNull();
    expect(computeDistribution([null, undefined, NaN])).toBeNull();
  });
});

describe('replicationSet', () => {
  it('includes only clean-tree runs matching the key', () => {
    const key = 'cfgA|2026-07-22.1|modelX';
    const entries = [
      makeEntry({ working_tree_state: 'clean' }),                       // in
      makeEntry({ working_tree_state: 'dirty' }),                       // out — dirty
      makeEntry({ working_tree_state: 'unknown' }),                     // out — unknown
      makeEntry({ working_tree_state: 'clean', model: 'other' }),       // out — different key
    ];
    const set = replicationSet(entries, key);
    expect(set.length).toBe(1);
  });
});

describe('evaluateReplicationGate', () => {
  const key = 'cfgA|2026-07-22.1|modelX';

  it('forbids firing below the threshold', () => {
    const entries = Array.from({ length: REPLICATION_GATE_MIN_N - 1 }, () => makeEntry({ metric: 0.5 }));
    const r = evaluateReplicationGate(entries, key, metric);
    expect(r.replication_count).toBe(REPLICATION_GATE_MIN_N - 1);
    expect(r.fire_permitted).toBe(false);
    expect(r.distribution!.n).toBe(REPLICATION_GATE_MIN_N - 1);
  });

  it('permits firing at exactly the threshold', () => {
    const entries = Array.from({ length: REPLICATION_GATE_MIN_N }, () => makeEntry({ metric: 0.5 }));
    const r = evaluateReplicationGate(entries, key, metric);
    expect(r.replication_count).toBe(REPLICATION_GATE_MIN_N);
    expect(r.fire_permitted).toBe(true);
  });

  it('does not count dirty/unknown runs toward n even when they would reach the threshold', () => {
    const entries = [
      ...Array.from({ length: 5 }, () => makeEntry({ working_tree_state: 'clean', metric: 0.5 })),
      ...Array.from({ length: 8 }, () => makeEntry({ working_tree_state: 'dirty', metric: 0.5 })),
    ];
    const r = evaluateReplicationGate(entries, key, metric);
    expect(r.replication_count).toBe(5);   // only the clean runs
    expect(r.fire_permitted).toBe(false);
  });

  it('gates on replication count even when the metric is all-null (distribution null)', () => {
    const entries = Array.from({ length: REPLICATION_GATE_MIN_N }, () => makeEntry({ metric: null }));
    const r = evaluateReplicationGate(entries, key, metric);
    expect(r.replication_count).toBe(REPLICATION_GATE_MIN_N);
    expect(r.fire_permitted).toBe(true);   // n gates, not metric availability
    expect(r.distribution).toBeNull();
  });

  it('reports an empty gate for a config with no clean replications', () => {
    const r = evaluateReplicationGate([makeEntry({ working_tree_state: 'dirty' })], key, metric);
    expect(r.replication_count).toBe(0);
    expect(r.fire_permitted).toBe(false);
    expect(r.distribution).toBeNull();
  });
});

describe('replicationGateByConfig', () => {
  it('produces one result per distinct clean config, sorted by descending count', () => {
    const entries = [
      ...Array.from({ length: 3 }, () => makeEntry({ config_revision: 'A', metric: 0.4 })),
      ...Array.from({ length: 12 }, () => makeEntry({ config_revision: 'B', metric: 0.6 })),
      makeEntry({ config_revision: 'C', working_tree_state: 'dirty' }), // excluded — no clean run
    ];
    const gates = replicationGateByConfig(entries, metric);
    expect(gates.map(g => g.fixed_config_key)).toEqual([
      'B|2026-07-22.1|modelX',
      'A|2026-07-22.1|modelX',
    ]);
    expect(gates[0].replication_count).toBe(12);
    expect(gates[0].fire_permitted).toBe(true);
    expect(gates[1].replication_count).toBe(3);
    expect(gates[1].fire_permitted).toBe(false);
  });

  it('returns an empty array when there are no clean entries', () => {
    expect(replicationGateByConfig([makeEntry({ working_tree_state: 'unknown' })], metric)).toEqual([]);
  });
});
