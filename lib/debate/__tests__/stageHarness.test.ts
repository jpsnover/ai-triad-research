// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, afterEach } from 'vitest';
import { StageHarness, STAGE_ORDER } from './stageHarness.js';
import type { FaultSpec, StageResult } from './stageHarness.js';
import { clearGlobalRecorder } from '../../flight-recorder/index.js';

describe('StageHarness', () => {
  afterEach(() => {
    clearGlobalRecorder();
  });
  describe('clean runs (no faults)', () => {
    it('pre-synthesis fixture resumes to synthesis-p1 successfully', async () => {
      const result = await new StageHarness('pre-synthesis')
        .run({ stopAfterStage: 'synthesis-p1' });

      expect(result.outcome).toBe('success');
      expect(result.session).toBeDefined();
      expect(result.checkpoint).toBeDefined();
      expect(result.adapterCallCount).toBeGreaterThanOrEqual(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('post-synthesis-p3 fixture resumes with synthesis-p3 stop (already synthesized)', async () => {
      const result = await new StageHarness('post-synthesis-p3')
        .run({ stopAfterStage: 'synthesis-p3' });

      expect(result.outcome).toBe('success');
      expect(result.adapterCallCount).toBe(0);
    });

    it('returns checkpoint as a separate snapshot from session', async () => {
      const result = await new StageHarness('pre-synthesis')
        .run({ stopAfterStage: 'synthesis-p1' });

      expect(result.checkpoint).toBeDefined();
      expect(result.session).toBeDefined();
      expect(result.checkpoint!.id).toBe(result.session!.id);
      expect(result.checkpoint).not.toBe(result.session);
    });
  });

  describe('flight recorder integration', () => {
    it('captures flight recorder events during run', async () => {
      const result = await new StageHarness('pre-synthesis')
        .run({ stopAfterStage: 'synthesis-p1' });

      expect(result.flightRecorderEvents).toBeDefined();
      expect(Array.isArray(result.flightRecorderEvents)).toBe(true);
      expect(result.flightRecorderEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('captures recorder events even on error', async () => {
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'throw', error: new Error('test fault') })
        .run({ stopAfterStage: 'synthesis-p1' });

      expect(result.flightRecorderEvents).toBeDefined();
      expect(Array.isArray(result.flightRecorderEvents)).toBe(true);
    });
  });

  describe('fault: throw', () => {
    it('returns error outcome with the injected error', async () => {
      const injectedError = new Error('Simulated API failure');
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'throw', error: injectedError })
        .run({ stopAfterStage: 'synthesis-p3' });

      expect(result.outcome).toBe('error');
      expect(result.error).toBeDefined();
      expect(result.session).toBeUndefined();
      expect(result.checkpoint).toBeDefined();
    });
  });

  describe('fault: malformed-json', () => {
    it('engine handles malformed JSON gracefully (warns, does not crash)', async () => {
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'malformed-json' })
        .run({ stopAfterStage: 'synthesis-p1' });

      // Engine's parsePhaseResponse has fallback parsing — may succeed with partial data
      expect(['success', 'error']).toContain(result.outcome);
    });
  });

  describe('fault: hang', () => {
    it('returns timeout outcome when adapter hangs', async () => {
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'hang' })
        .run({ stopAfterStage: 'synthesis-p3', timeout: 500 });

      expect(result.outcome).toBe('timeout');
      expect(result.error?.message).toBe('StageHarness timeout');
      expect(result.adapterCallCount).toBe(1);
    });
  });

  describe('fault: slow', () => {
    it('slow fault completes within timeout', async () => {
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'slow', ms: 50 })
        .run({ stopAfterStage: 'synthesis-p1', timeout: 5000 });

      expect(result.outcome).toBe('success');
      expect(result.durationMs).toBeGreaterThanOrEqual(40);
    });

    it('slow fault exceeding timeout returns timeout', async () => {
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'slow', ms: 2000 })
        .run({ stopAfterStage: 'synthesis-p1', timeout: 200 });

      expect(result.outcome).toBe('timeout');
    });
  });

  describe('fault: kill-mid-write', () => {
    it('returns error outcome with checkpoint preserved', async () => {
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'kill-mid-write' })
        .run({ stopAfterStage: 'synthesis-p1' });

      expect(result.outcome).toBe('error');
      expect(result.error?.message).toContain('write failure');
      expect(result.checkpoint).toBeDefined();
      expect(result.session).toBeUndefined();
    });
  });

  describe('fault: corrupt-serialize', () => {
    it('returns error outcome with original checkpoint', async () => {
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'corrupt-serialize' })
        .run({ stopAfterStage: 'synthesis-p1' });

      expect(result.outcome).toBe('error');
      expect(result.error?.message).toContain('serialization corruption');
      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint!.id).toBe('fixture-pre-synthesis');
    });
  });

  describe('fault: gate-trip', () => {
    it('injects custom metric into adapter response', async () => {
      const result = await new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'gate-trip', metric: 'quality_score', value: 0.1 })
        .run({ stopAfterStage: 'synthesis-p1' });

      // gate-trip returns valid JSON so engine should succeed
      expect(result.outcome).toBe('success');
      expect(result.adapterCallCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('fluent API', () => {
    it('supports chaining multiple inject calls', async () => {
      const harness = new StageHarness('pre-synthesis')
        .inject('synthesis-p1', { type: 'slow', ms: 10 })
        .inject('synthesis-p2', { type: 'malformed-json' });

      expect(harness).toBeInstanceOf(StageHarness);

      const result = await harness.run({ stopAfterStage: 'synthesis-p3' });
      expect(result.adapterCallCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('STAGE_ORDER export', () => {
    it('exports 6 injectable lifecycle stages in pipeline order (finalization omitted — no adapter calls)', () => {
      expect(STAGE_ORDER).toHaveLength(6);
      expect(STAGE_ORDER[0]).toBe('synthesis-p1');
      expect(STAGE_ORDER[5]).toBe('extraction-coverage');
    });
  });
});
