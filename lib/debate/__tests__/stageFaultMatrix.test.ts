// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, afterEach } from 'vitest';
import { StageHarness } from './stageHarness.js';
import type { FaultSpec, StageResult } from './stageHarness.js';
import type { LifecycleStage } from '../debateEngine.js';
import type { FixtureName } from './fixtures/index.js';
import { clearGlobalRecorder } from '../../flight-recorder/index.js';

// ── Matrix definition ───────────────────────────────────

interface MatrixEntry {
  label: string;
  stage: LifecycleStage;
  fault: FaultSpec;
  fixture: FixtureName;
  stopAfter: LifecycleStage;
  timeout: number;
  expected: 'success' | 'error' | 'timeout';
  assertions: (result: StageResult) => void;
}

const MATRIX: MatrixEntry[] = [
  // ── Hang faults ─────────────────────────────────────────
  {
    label: 'hang × synthesis-p1',
    stage: 'synthesis-p1',
    fault: { type: 'hang' },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p3',
    timeout: 500,
    expected: 'timeout',
    assertions: (r) => {
      expect(r.error?.message).toBe('StageHarness timeout');
      expect(r.adapterCallCount).toBe(1);
    },
  },
  {
    label: 'hang × synthesis-p2',
    stage: 'synthesis-p2',
    fault: { type: 'hang' },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p3',
    timeout: 500,
    expected: 'timeout',
    assertions: (r) => {
      expect(r.error?.message).toBe('StageHarness timeout');
    },
  },
  {
    label: 'slow (within timeout) × missing-arguments',
    stage: 'missing-arguments',
    fault: { type: 'slow', ms: 50 },
    fixture: 'post-synthesis-p3',
    stopAfter: 'extraction-coverage',
    timeout: 5000,
    expected: 'success',
    assertions: (r) => {
      expect(r.durationMs).toBeGreaterThanOrEqual(40);
      expect(r.session).toBeDefined();
    },
  },
  {
    label: 'hang × missing-arguments',
    stage: 'missing-arguments',
    fault: { type: 'hang' },
    fixture: 'post-synthesis-p3',
    stopAfter: 'extraction-coverage',
    timeout: 500,
    expected: 'timeout',
    assertions: (r) => {
      expect(r.error?.message).toBe('StageHarness timeout');
    },
  },

  // ── Slow faults ─────────────────────────────────────────
  {
    label: 'slow (exceeds timeout) × synthesis-p1',
    stage: 'synthesis-p1',
    fault: { type: 'slow', ms: 2000 },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p1',
    timeout: 200,
    expected: 'timeout',
    assertions: (r) => {
      expect(r.error?.message).toBe('StageHarness timeout');
    },
  },
  {
    label: 'slow (exceeds timeout) × missing-arguments',
    stage: 'missing-arguments',
    fault: { type: 'slow', ms: 2000 },
    fixture: 'post-synthesis-p3',
    stopAfter: 'extraction-coverage',
    timeout: 200,
    expected: 'timeout',
    assertions: (r) => {
      expect(r.error?.message).toBe('StageHarness timeout');
    },
  },
  {
    label: 'slow (within timeout) × synthesis-p2',
    stage: 'synthesis-p2',
    fault: { type: 'slow', ms: 50 },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p2',
    timeout: 5000,
    expected: 'success',
    assertions: (r) => {
      expect(r.durationMs).toBeGreaterThanOrEqual(40);
      expect(r.session).toBeDefined();
    },
  },

  // ── Malformed JSON faults ──────────────────────────────
  {
    label: 'malformed-json × synthesis-p1',
    stage: 'synthesis-p1',
    fault: { type: 'malformed-json' },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p1',
    timeout: 10_000,
    expected: 'success',
    assertions: (r) => {
      expect(r.session).toBeDefined();
    },
  },
  {
    label: 'malformed-json × synthesis-p2',
    stage: 'synthesis-p2',
    fault: { type: 'malformed-json' },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p2',
    timeout: 10_000,
    expected: 'success',
    assertions: (r) => {
      expect(r.session).toBeDefined();
    },
  },
  {
    label: 'malformed-json × extraction-coverage',
    stage: 'extraction-coverage',
    fault: { type: 'malformed-json' },
    fixture: 'pre-finalization',
    stopAfter: 'extraction-coverage',
    timeout: 10_000,
    expected: 'success',
    assertions: (r) => {
      expect(r.session).toBeDefined();
    },
  },

  // ── Throw faults ───────────────────────────────────────
  {
    label: 'throw × synthesis-p1',
    stage: 'synthesis-p1',
    fault: { type: 'throw', error: new Error('Simulated API crash') },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p3',
    timeout: 10_000,
    expected: 'error',
    assertions: (r) => {
      expect(r.error).toBeDefined();
      expect(r.session).toBeUndefined();
      expect(r.checkpoint).toBeDefined();
    },
  },
  {
    label: 'throw × taxonomy-refinement',
    stage: 'taxonomy-refinement',
    fault: { type: 'throw', error: new Error('Simulated API crash') },
    fixture: 'post-synthesis-p3',
    stopAfter: 'extraction-coverage',
    timeout: 10_000,
    expected: 'success',
    assertions: (r) => {
      // taxonomy-refinement is wrapped in try/catch in the engine — throw is swallowed
      expect(r.session).toBeDefined();
    },
  },
  {
    label: 'throw × extraction-coverage',
    stage: 'extraction-coverage',
    fault: { type: 'throw', error: new Error('Simulated API crash') },
    fixture: 'pre-finalization',
    stopAfter: 'extraction-coverage',
    timeout: 10_000,
    expected: 'success',
    assertions: (r) => {
      // extraction-coverage is wrapped in try/catch — throw is swallowed
      expect(r.session).toBeDefined();
    },
  },

  // ── Kill-mid-write fault ───────────────────────────────
  {
    label: 'kill-mid-write × synthesis-p3',
    stage: 'synthesis-p3',
    fault: { type: 'kill-mid-write' },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p3',
    timeout: 10_000,
    expected: 'error',
    assertions: (r) => {
      expect(r.error?.message).toContain('write failure');
      expect(r.checkpoint).toBeDefined();
      expect(r.checkpoint!.id).toBe('fixture-pre-synthesis');
      expect(r.session).toBeUndefined();
    },
  },

  // ── Corrupt-serialize fault ────────────────────────────
  {
    label: 'corrupt-serialize × synthesis-p3',
    stage: 'synthesis-p3',
    fault: { type: 'corrupt-serialize' },
    fixture: 'pre-synthesis',
    stopAfter: 'synthesis-p3',
    timeout: 10_000,
    expected: 'error',
    assertions: (r) => {
      expect(r.error?.message).toContain('serialization corruption');
      expect(r.checkpoint).toBeDefined();
      expect(r.checkpoint!.id).toBe('fixture-pre-synthesis');
      expect(r.session).toBeUndefined();
    },
  },

  // ── Gate-trip fault ────────────────────────────────────
  {
    label: 'gate-trip (coverage 0.33) × extraction-coverage',
    stage: 'extraction-coverage',
    fault: { type: 'gate-trip', metric: 'quality_score', value: 0.33 },
    fixture: 'pre-finalization',
    stopAfter: 'extraction-coverage',
    timeout: 10_000,
    expected: 'success',
    assertions: (r) => {
      expect(r.session).toBeDefined();
      expect(r.adapterCallCount).toBeGreaterThanOrEqual(1);
      // CL owns threshold assertions — placeholder until CL provides expected values (t/1167#1)
    },
  },
];

// ── Parameterized test runner ───────────────────────────

describe('Stage × fault matrix', () => {
  afterEach(() => {
    clearGlobalRecorder();
  });

  it.each(MATRIX.map(m => [m.label, m] as const))(
    '%s',
    async (_label, entry) => {
      const result = await new StageHarness(entry.fixture)
        .inject(entry.stage, entry.fault)
        .run({ stopAfterStage: entry.stopAfter, timeout: entry.timeout });

      // Universal assertions — every matrix cell
      expect(result.outcome).toBe(entry.expected);
      expect(result.durationMs).toBeLessThan(entry.timeout + 5000);
      expect(result.flightRecorderEvents).toBeDefined();
      expect(Array.isArray(result.flightRecorderEvents)).toBe(true);

      // Per-entry custom assertions
      entry.assertions(result);
    },
    15_000,
  );
});
