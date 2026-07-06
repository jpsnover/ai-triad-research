// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeDriftReport, formatDriftReport } from '../calibrationDriftReport.js';
import type { CalibrationDataPoint } from '../calibrationLogger.js';

function makeDataPoint(overrides: Partial<CalibrationDataPoint> & { rounds: number }): CalibrationDataPoint {
  return {
    schema_version: 1,
    debate_id: `test-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    origin: 'local',
    model: 'test-model',
    rounds: overrides.rounds,
    process_reward_mean: null,
    avg_utilization_rate: null,
    taxonomy_mapped_ratio: null,
    claims_forgotten_rate: null,
    crux_addressed_ratio: null,
    ...overrides,
  } as CalibrationDataPoint;
}

function makeTimeSeries(count: number, metricValue: number, timestampBase?: string): CalibrationDataPoint[] {
  const base = new Date(timestampBase ?? '2026-06-01T00:00:00Z');
  return Array.from({ length: count }, (_, i) => {
    const ts = new Date(base.getTime() + i * 3600000);
    return makeDataPoint({
      rounds: 5,
      timestamp: ts.toISOString(),
      process_reward_mean: metricValue,
      avg_utilization_rate: metricValue * 0.1,
    });
  });
}

describe('computeDriftReport', () => {
  it('returns healthy when all metrics are stable', () => {
    const data = makeTimeSeries(60, 0.5);
    const report = computeDriftReport(data);

    expect(report.summary).toBe('healthy');
    expect(report.degraded_metrics).toEqual([]);
    expect(report.total_debates_analyzed).toBe(60);
    expect(report.caveat).toContain('different debate populations');
  });

  it('detects degradation in a normal metric', () => {
    const baseline = makeTimeSeries(50, 0.80);
    const degraded = makeTimeSeries(10, 0.60);
    degraded.forEach((dp, i) => {
      dp.timestamp = new Date(new Date(baseline[49].timestamp).getTime() + (i + 1) * 3600000).toISOString();
    });
    const report = computeDriftReport([...baseline, ...degraded]);

    expect(report.summary).toBe('degraded');
    expect(report.degraded_metrics).toContain('process_reward_mean');

    const prm = report.metrics.find(m => m.metric === 'process_reward_mean')!;
    expect(prm.degraded).toBe(true);
    expect(prm.changePercent).toBeLessThan(0);
    expect(prm.longWindowStdev).toBeGreaterThanOrEqual(0);
  });

  it('detects degradation in an inverted metric (claims_forgotten_rate)', () => {
    const baseline = makeTimeSeries(50, 0.5);
    baseline.forEach(dp => { dp.claims_forgotten_rate = 0.20; });
    const worse = makeTimeSeries(10, 0.5);
    worse.forEach((dp, i) => {
      dp.claims_forgotten_rate = 0.35;
      dp.timestamp = new Date(new Date(baseline[49].timestamp).getTime() + (i + 1) * 3600000).toISOString();
    });
    const report = computeDriftReport([...baseline, ...worse]);

    const cfr = report.metrics.find(m => m.metric === 'claims_forgotten_rate')!;
    expect(cfr.degraded).toBe(true);
    expect(cfr.inverted).toBe(true);
  });

  it('skips metrics with insufficient data', () => {
    const data = makeTimeSeries(30, 0.5);
    const report = computeDriftReport(data);

    const prm = report.metrics.find(m => m.metric === 'process_reward_mean')!;
    expect(prm.skipped).toBe(true);
    expect(prm.dataPoints).toBeLessThan(50);
  });

  it('filters out low-round debates', () => {
    const lowRound = Array.from({ length: 60 }, (_, i) =>
      makeDataPoint({ rounds: 1, process_reward_mean: 0.5, timestamp: new Date(Date.now() + i * 3600000).toISOString() }),
    );
    const report = computeDriftReport(lowRound);

    expect(report.total_debates_analyzed).toBe(0);
    expect(report.metrics.every(m => m.skipped)).toBe(true);
  });

  it('respects custom options', () => {
    const data = makeTimeSeries(25, 0.5);
    const report = computeDriftReport(data, {
      minRounds: 3,
      shortWindow: 5,
      longWindow: 20,
      threshold: 0.05,
    });

    expect(report.window.short).toBe(5);
    expect(report.window.long).toBe(20);
    expect(report.threshold).toBe(0.05);
    const prm = report.metrics.find(m => m.metric === 'process_reward_mean')!;
    expect(prm.skipped).toBe(false);
  });

  it('includes stdev in metric results', () => {
    const data = makeTimeSeries(60, 0.5);
    data.forEach((dp, i) => {
      dp.process_reward_mean = 0.4 + (i % 2 === 0 ? 0.1 : -0.1);
    });
    const report = computeDriftReport(data);

    const prm = report.metrics.find(m => m.metric === 'process_reward_mean')!;
    expect(prm.longWindowStdev).toBeGreaterThan(0);
  });
});

describe('formatDriftReport', () => {
  it('produces readable output', () => {
    const data = makeTimeSeries(60, 0.5);
    const report = computeDriftReport(data);
    const formatted = formatDriftReport(report);

    expect(formatted).toContain('CALIBRATION DRIFT REPORT');
    expect(formatted).toContain('process_reward_mean');
    expect(formatted).toContain('different debate populations');
    expect(formatted).toContain('no drift detected');
  });

  it('shows alert for degraded metrics', () => {
    const baseline = makeTimeSeries(50, 0.80);
    const degraded = makeTimeSeries(10, 0.60);
    degraded.forEach((dp, i) => {
      dp.timestamp = new Date(new Date(baseline[49].timestamp).getTime() + (i + 1) * 3600000).toISOString();
    });
    const report = computeDriftReport([...baseline, ...degraded]);
    const formatted = formatDriftReport(report);

    expect(formatted).toContain('DEGRADATION DETECTED');
    expect(formatted).toContain('ALERT');
  });
});
