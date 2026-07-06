// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { CalibrationDataPoint } from './calibrationLogger.js';

export interface DriftMetricResult {
  metric: string;
  shortWindowMean: number;
  longWindowMean: number;
  longWindowStdev: number;
  changePercent: number;
  degraded: boolean;
  dataPoints: number;
  skipped: boolean;
  inverted: boolean;
}

export interface DriftReport {
  generated_at: string;
  caveat: string;
  filter: { min_rounds: number };
  window: { short: number; long: number };
  threshold: number;
  total_debates_analyzed: number;
  metrics: DriftMetricResult[];
  summary: 'healthy' | 'degraded';
  degraded_metrics: string[];
}

interface MetricDef {
  name: string;
  extract: (dp: CalibrationDataPoint) => number | null | undefined;
  inverted: boolean;
}

const TRACKED_METRICS: MetricDef[] = [
  { name: 'process_reward_mean', extract: dp => dp.process_reward_mean, inverted: false },
  { name: 'avg_utilization_rate', extract: dp => dp.avg_utilization_rate, inverted: false },
  { name: 'taxonomy_mapped_ratio', extract: dp => dp.taxonomy_mapped_ratio, inverted: false },
  { name: 'claims_forgotten_rate', extract: dp => dp.claims_forgotten_rate, inverted: true },
  { name: 'crux_addressed_ratio', extract: dp => dp.crux_addressed_ratio, inverted: false },
];

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

export function computeDriftReport(
  dataPoints: CalibrationDataPoint[],
  options?: {
    minRounds?: number;
    shortWindow?: number;
    longWindow?: number;
    threshold?: number;
  },
): DriftReport {
  const minRounds = options?.minRounds ?? 3;
  const shortWindow = options?.shortWindow ?? 10;
  const longWindow = options?.longWindow ?? 50;
  const threshold = options?.threshold ?? 0.10;

  const filtered = dataPoints
    .filter(dp => dp.rounds >= minRounds)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const metrics: DriftMetricResult[] = TRACKED_METRICS.map(def => {
    const values = filtered
      .map(dp => def.extract(dp))
      .filter((v): v is number => v != null && !isNaN(v));

    if (values.length < longWindow) {
      return {
        metric: def.name,
        shortWindowMean: 0,
        longWindowMean: 0,
        longWindowStdev: 0,
        changePercent: 0,
        degraded: false,
        dataPoints: values.length,
        skipped: true,
        inverted: def.inverted,
      };
    }

    const recentLong = values.slice(-longWindow);
    const recentShort = values.slice(-shortWindow);

    const longMean = mean(recentLong);
    const longStd = stdev(recentLong);
    const shortMean = mean(recentShort);

    let degraded: boolean;
    let changePercent: number;

    if (longMean === 0) {
      degraded = false;
      changePercent = 0;
    } else if (def.inverted) {
      changePercent = -((shortMean - longMean) / longMean) * 100;
      degraded = shortMean >= longMean * (1 + threshold);
    } else {
      changePercent = ((shortMean - longMean) / longMean) * 100;
      degraded = shortMean <= longMean * (1 - threshold);
    }

    return {
      metric: def.name,
      shortWindowMean: Math.round(shortMean * 10000) / 10000,
      longWindowMean: Math.round(longMean * 10000) / 10000,
      longWindowStdev: Math.round(longStd * 10000) / 10000,
      changePercent: Math.round(changePercent * 100) / 100,
      degraded,
      dataPoints: values.length,
      skipped: false,
      inverted: def.inverted,
    };
  });

  const degradedMetrics = metrics.filter(m => m.degraded).map(m => m.metric);

  return {
    generated_at: new Date().toISOString(),
    caveat: 'Windows compare different debate populations; check topic mix before acting.',
    filter: { min_rounds: minRounds },
    window: { short: shortWindow, long: longWindow },
    threshold,
    total_debates_analyzed: filtered.length,
    metrics,
    summary: degradedMetrics.length > 0 ? 'degraded' : 'healthy',
    degraded_metrics: degradedMetrics,
  };
}

export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════╗');
  lines.push('║           CALIBRATION DRIFT REPORT                  ║');
  lines.push('╚══════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Filter: rounds ≥ ${report.filter.min_rounds}`);
  lines.push(`Debates analyzed: ${report.total_debates_analyzed}`);
  lines.push(`Windows: short=${report.window.short}, long=${report.window.long}`);
  lines.push(`Threshold: ${(report.threshold * 100).toFixed(0)}% relative change`);
  lines.push('');
  lines.push(`⚠  ${report.caveat}`);
  lines.push('');

  lines.push('┌─────────────────────────┬───────────┬───────────┬──────────┬─────────┬────────┐');
  lines.push('│ Metric                  │ Short Avg │ Long  Avg │ Long σ   │ Change  │ Status │');
  lines.push('├─────────────────────────┼───────────┼───────────┼──────────┼─────────┼────────┤');

  for (const m of report.metrics) {
    if (m.skipped) {
      lines.push(`│ ${m.metric.padEnd(23)} │ ${'(skipped — < ' + report.window.long + ' pts)'.padEnd(49)} │`);
      continue;
    }
    const status = m.degraded ? '🔴 ALERT' : '✅ OK   ';
    const sign = m.changePercent >= 0 ? '+' : '';
    const dir = m.inverted ? ' (inv)' : '';
    lines.push(
      `│ ${(m.metric + dir).padEnd(23)} │ ${m.shortWindowMean.toFixed(4).padStart(9)} │ ${m.longWindowMean.toFixed(4).padStart(9)} │ ${m.longWindowStdev.toFixed(4).padStart(8)} │ ${(sign + m.changePercent.toFixed(1) + '%').padStart(7)} │ ${status} │`,
    );
  }

  lines.push('└─────────────────────────┴───────────┴───────────┴──────────┴─────────┴────────┘');
  lines.push('');

  if (report.summary === 'degraded') {
    lines.push(`SUMMARY: DEGRADATION DETECTED in ${report.degraded_metrics.length} metric(s): ${report.degraded_metrics.join(', ')}`);
  } else {
    lines.push('SUMMARY: All tracked metrics within threshold — no drift detected.');
  }

  return lines.join('\n');
}
