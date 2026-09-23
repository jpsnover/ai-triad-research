// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Per-run trust projection for inquiry calibration entries (t/3576).
// Pure function: no I/O, no side effects.

import type { CalibrationEntry, TrustState } from '../../inquiry/index.js';
import type { DebateSession } from '../types.js';
import { extractCalibrationData } from './extract.js';

/** A scored metric before trust state is projected onto it. */
export interface RawMetric {
  metric: string;
  value: number;
  displayValue?: string;
}

// Mirrors CENSORED_REASONS in extract-metrics.ts (t/1671). A truncated run produced
// unreliable convergence measurements — trust only metrics that were immune to early exit.
const CENSORED_TERMINATION_REASONS: ReadonlySet<string> = new Set([
  'max_iterations', 'situation_cap', 'api_ceiling',
]);

// Metric families that are always trustworthy regardless of termination (t/3576).
// These measure properties observable at any point in the debate, not just at natural conclusion.
const IMMUNE_METRIC_PATTERNS: readonly string[] = [
  'situation_crux_alignment',
  'repetition_rate',
  'claim_acceptance',
];

/** Return true when a metric name belongs to the convergence family (contains 'convergence'). */
function isConvergenceMetric(metricName: string): boolean {
  return metricName.includes('convergence');
}

/** Return true when a metric is immune to truncation — always trustworthy regardless of run completeness. */
function isImmuneMetric(metricName: string): boolean {
  return IMMUNE_METRIC_PATTERNS.some(p => metricName.includes(p));
}

/**
 * Project trust verdicts onto a flat array of scored metrics.
 *
 * Trust rules:
 * - Run truncated (terminationReason ∈ CENSORED_TERMINATION_REASONS) AND metric is in the
 *   convergence family AND metric is NOT immune → `censored`, reason records the family + termination.
 * - All other cases → `trust`, reason records either "natural conclusion" or the metric's immunity.
 *
 * Produces one CalibrationEntry per input metric with TrustState.reason populated (ADR §6 — mandatory).
 */
export function projectTrust(
  metrics: RawMetric[],
  terminationReason: string | undefined,
): CalibrationEntry[] {
  const isTruncated = terminationReason !== undefined && CENSORED_TERMINATION_REASONS.has(terminationReason);

  return metrics.map(raw => {
    let trust: TrustState;

    if (isTruncated && isConvergenceMetric(raw.metric) && !isImmuneMetric(raw.metric)) {
      trust = {
        verdict: 'censored',
        reason: `convergence metric unreliable on truncated run (termination: ${terminationReason})`,
        terminationReason,
        metricFamily: 'convergence',
      };
    } else if (isImmuneMetric(raw.metric)) {
      trust = {
        verdict: 'trust',
        reason: `immune metric — reliable regardless of run completeness`,
        terminationReason,
      };
    } else {
      trust = {
        verdict: 'trust',
        reason: isTruncated
          ? `non-convergence metric — reliable on truncated run (termination: ${terminationReason})`
          : `natural conclusion run`,
        terminationReason,
      };
    }

    const entry: CalibrationEntry = {
      metric: raw.metric,
      value: raw.value,
      trust,
    };
    if (raw.displayValue !== undefined) {
      entry.displayValue = raw.displayValue;
    }
    return entry;
  });
}

/**
 * Extract scored RawMetrics from a completed DebateSession for trust projection.
 *
 * Wraps extractCalibrationData and maps numeric fields to the flat RawMetric shape
 * that projectTrust consumes. Metric names follow CalibrationDataPoint field names
 * so the convergence-family check in projectTrust fires on the right metrics.
 *
 * Imported directly by runInquiryPipeline (t/3585) — not injected — so trust
 * projection is identical between Electron and server runners.
 */
export function getRawMetrics(session: DebateSession): RawMetric[] {
  const data = extractCalibrationData(session, 'inquiry');
  const metrics: RawMetric[] = [];

  if (data.convergence_score_at_termination != null) {
    metrics.push({ metric: 'convergence_score', value: data.convergence_score_at_termination });
  }
  if (data.argumentative_saturation_at_transition != null) {
    metrics.push({ metric: 'argumentative_saturation', value: data.argumentative_saturation_at_transition });
  }
  if (data.crux_addressed_ratio != null) {
    metrics.push({ metric: 'crux_addressed_ratio', value: data.crux_addressed_ratio });
  }
  if (data.engaging_real_disagreement != null) {
    metrics.push({
      metric: 'engaging_real_disagreement',
      value: data.engaging_real_disagreement ? 1 : 0,
      displayValue: data.engaging_real_disagreement ? 'true' : 'false',
    });
  }
  if (data.qbaf_preference_concordance != null) {
    metrics.push({ metric: 'qbaf_preference_concordance', value: data.qbaf_preference_concordance });
  }

  return metrics;
}
