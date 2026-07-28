// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Parameter optimizer — reads calibration-log.json and computes optimal
 * values for the top 5 parameters. Writes results to calibration-config.json.
 *
 * No LLM calls. No human input. Pure arithmetic on logged debate data.
 *
 * Usage (CLI): npx tsx lib/debate/calibrationOptimizer.ts [data-root]
 * Usage (programmatic): import { recalibrateParameters } from './calibrationOptimizer';
 */

import type {
  CalibrationDataPoint,
  ParameterHistoryEntry,
  MetricSelector,
  ReplicationGateResult,
} from './calibrationLogger.js';
import {
  readCalibrationLog,
  captureSnapshot,
  diffSnapshots,
  appendParameterHistory,
  readParameterHistory,
  seedInitialSnapshot,
  replicationGateByConfig,
} from './calibrationLogger.js';
import { PINNED_EVALUATOR_MODEL } from './neutralEvaluator.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getGlobalRecorder } from '../flight-recorder/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Types ──────────────────────────────────────────────────

export interface OptimizationResult {
  parameter: string;
  current_value: number | Record<string, number>;
  recommended_value: number | Record<string, number>;
  confidence: 'high' | 'medium' | 'low';
  data_points_used: number;
  rationale: string;
}

export interface RecalibrationReport {
  timestamp: string;
  /** Rows eligible for optimization: stamped with the pinned evaluator id (t/1846). */
  data_points: number;
  min_required: number;
  results: OptimizationResult[];
  applied: boolean;
  /** The pinned evaluator id this run compared against (t/1846). */
  evaluator_model_id?: string;
  /** Rows excluded from the window: unstamped legacy rows or rows scored by another evaluator. Never silently dropped. */
  excluded_rows_wrong_evaluator?: number;
  /**
   * Explicit cold-start state (TL t/1846#3): set when the optimizer is held because too few
   * rows carry the pinned evaluator stamp — so "no recommendation" is never ambiguous.
   */
  cold_start_hold?: string;
  /**
   * Crux-axis recommendations computed but NOT applied — held at zero weight in the
   * config-writing objective until reference-calibrated (t/1843 ruling; re-entry via t/1847).
   */
  held_recommendations?: { parameter: string; reason: string }[];
  /**
   * Replication gate per headline quality metric (t/1668, R-1). Maps each
   * headline metric name to its per-fixed-config gate results — replication
   * count, whether a regression trigger may fire (n ≥ REPLICATION_GATE_MIN_N),
   * and the metric distribution (median + spread) over the clean replication
   * set. Additive/optional: absent in reports written before t/1668.
   */
  replication_gates?: Record<string, ReplicationGateResult[]>;
}

// ── Optimizer algorithms ────────────────────────────────────

const MIN_DATA_POINTS = 10;

/**
 * Config-writing invariant (t/1843#1, t/1846): parameters whose optimization objective
 * consumes the evaluator-sensitive crux metrics (`crux_addressed_ratio`,
 * `situation_crux_alignment`, `crux_resolution_divergence_rate`). Their recommendations
 * are still computed and reported for visibility, but carry ZERO weight in `--apply`
 * config writes until the metrics are reference-calibrated against a human-scored crux
 * set (t/1847). An unvalidated, evaluator-sensitive metric cannot move calibration-config.
 */
const CRUX_AXIS_PARAMS = new Set([
  'thresholds.argumentation_exit',   // optimizeExplorationExit: crux_addressed_ratio × engaging
  'argumentative_saturation',        // optimizeSaturationWeights: same objective
  'crux_resolution.polarity_resolved', // optimizeCruxThreshold: crux_resolution_divergence_rate
]);

/**
 * Headline quality metrics reported as replication-gated distributions (t/1668).
 * A regression on any of these may only be acted on once its fixed config has
 * n ≥ REPLICATION_GATE_MIN_N clean replications (see calibrationLogger).
 */
const HEADLINE_METRICS: Record<string, MetricSelector> = {
  crux_addressed_ratio: (d) => d.crux_addressed_ratio,
  avg_utilization_rate: (d) => d.avg_utilization_rate,
  qbaf_preference_concordance: (d) => d.qbaf_preference_concordance,
  borderline_claim_survival_rate: (d) => d.borderline_claim_survival_rate,
};

/**
 * Parameter 1: Exploration exit threshold.
 * Quadratic fit of threshold vs quality (crux_addressed_ratio × engaging flag).
 */
function optimizeExplorationExit(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d =>
    d.crux_addressed_ratio != null && d.engaging_real_disagreement != null,
  );
  if (valid.length < 5) return null;

  // Quality metric: crux resolution weighted by engagement
  const points = valid.map(d => ({
    x: d.argumentation_exit_threshold,
    y: (d.crux_addressed_ratio ?? 0) * (d.engaging_real_disagreement ? 1.0 : 0.5),
  }));

  // Simple: find the threshold that produced the best average quality
  const thresholdGroups = new Map<number, number[]>();
  for (const p of points) {
    const bucket = Math.round(p.x * 20) / 20; // 0.05 buckets
    const group = thresholdGroups.get(bucket) ?? [];
    group.push(p.y);
    thresholdGroups.set(bucket, group);
  }

  let bestThreshold = 0.65;
  let bestAvg = -1;
  for (const [threshold, values] of thresholdGroups) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestThreshold = threshold;
    }
  }

  // Clamp to reasonable range
  bestThreshold = Math.max(0.45, Math.min(0.85, bestThreshold));

  const current = valid[0].argumentation_exit_threshold;
  const delta = Math.abs(bestThreshold - current);

  return {
    parameter: 'thresholds.argumentation_exit',
    current_value: current,
    recommended_value: bestThreshold,
    confidence: valid.length >= 15 && delta > 0.05 ? 'high' : valid.length >= 8 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Best avg quality ${bestAvg.toFixed(3)} at threshold ${bestThreshold} (${valid.length} data points)`,
  };
}

/**
 * Parameter 2: Embedding relevance threshold.
 * Minimize waste (1 - utilization) while keeping primary utilization high.
 */
export function optimizeRelevanceThreshold(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.avg_utilization_rate != null);
  if (valid.length < 5) return null;

  const avgUtil = valid.reduce((s, d) => s + (d.avg_utilization_rate ?? 0), 0) / valid.length;
  const avgPrimary = valid.reduce((s, d) => s + (d.avg_primary_utilization ?? 0), 0) / valid.length;
  const current = valid[0].relevance_threshold;

  let recommended = current;
  if (avgUtil < 0.3) {
    // Waste rate > 70% — threshold too low, raise it
    recommended = Math.min(0.60, current + 0.03);
  } else if (avgPrimary < 0.5) {
    // Primary nodes underused — threshold may be too high, lower it
    recommended = Math.max(0.35, current - 0.02);
  }
  // else: utilization is healthy, don't change

  return {
    parameter: 'relevance_threshold',
    current_value: current,
    recommended_value: Math.round(recommended * 100) / 100,
    confidence: valid.length >= 15 ? 'high' : valid.length >= 8 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Avg utilization ${(avgUtil * 100).toFixed(0)}%, primary utilization ${(avgPrimary * 100).toFixed(0)}%` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended.toFixed(2)}` : ' — no change needed'),
  };
}

// ── Adaptive write-back ─────────────────────────────────────

export interface AdaptiveState {
  debates_since_last_adjustment: number;
  last_adjusted_at: string | null;
}

/**
 * Apply the relevance threshold recommendation to calibration-config.json
 * if safety rails pass. Called after each completed debate.
 */
export function applyRelevanceThresholdAdaptation(
  recommendation: OptimizationResult | null,
  state: AdaptiveState,
  weightsPath?: string,
): { applied: boolean; reason: string } {
  if (!recommendation) return { applied: false, reason: 'no recommendation' };
  if (recommendation.current_value === recommendation.recommended_value) {
    return { applied: false, reason: 'no change needed' };
  }

  // Safety rail 1: minimum 5 debates since last adjustment
  if (state.debates_since_last_adjustment < 5) {
    return { applied: false, reason: `only ${state.debates_since_last_adjustment}/5 debates since last adjustment` };
  }

  // Safety rail 2: confidence must be at least medium
  if (recommendation.confidence === 'low') {
    return { applied: false, reason: 'confidence too low (need medium+)' };
  }

  // Safety rail 3: bounds check (redundant with optimizer, but defense-in-depth)
  const newValue = recommendation.recommended_value as number;
  if (newValue < 0.35 || newValue > 0.60) {
    return { applied: false, reason: `recommended ${newValue} outside bounds [0.35, 0.60]` };
  }

  const targetPath = weightsPath ?? path.resolve(__dirname, 'calibration-config.json');

  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    const weights = JSON.parse(raw);

    // Safety rail 4: manual override
    if (weights.relevance?.adaptation_enabled === false) {
      return { applied: false, reason: 'adaptation_enabled is false (manual override)' };
    }

    const oldValue = weights.relevance?.embedding_threshold ?? 0.48;
    if (oldValue === newValue) {
      return { applied: false, reason: 'file already at recommended value' };
    }
    if (!weights.relevance) weights.relevance = {};
    weights.relevance.embedding_threshold = newValue;

    // Record adjustment metadata
    if (!weights.relevance.adaptation_history) weights.relevance.adaptation_history = [];
    weights.relevance.adaptation_history.push({
      from: oldValue,
      to: newValue,
      at: new Date().toISOString(),
      rationale: recommendation.rationale,
      data_points: recommendation.data_points_used,
    });
    // Keep only last 10 history entries
    if (weights.relevance.adaptation_history.length > 10) {
      weights.relevance.adaptation_history = weights.relevance.adaptation_history.slice(-10);
    }

    fs.writeFileSync(targetPath, JSON.stringify(weights, null, 2) + '\n', 'utf-8');
    return { applied: true, reason: `adjusted ${oldValue} → ${newValue}: ${recommendation.rationale}` };
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'calibration-optimizer',
      level: 'warn',
      message: 'Failed to write relevance threshold adaptation to calibration-config.json',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return { applied: false, reason: `write failed: ${(err as Error).message}` };
  }
}

/**
 * Parameter 3: QBAF attack type weights.
 * Grid search over small weight variations, maximize preference concordance.
 */
function optimizeAttackWeights(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.qbaf_preference_concordance != null);
  if (valid.length < 5) return null;

  const avgConcordance = valid.reduce((s, d) => s + (d.qbaf_preference_concordance ?? 0), 0) / valid.length;
  const current = valid[0].attack_weights;

  // Since we can't re-run QBAF with different weights post-hoc from the log alone,
  // we report the concordance and recommend investigation when it's low
  let recommended: [number, number, number] = [...current] as [number, number, number];
  let rationale = `Avg QBAF-preference concordance: ${(avgConcordance * 100).toFixed(0)}%`;

  if (avgConcordance < 0.5) {
    // Low concordance suggests weights need adjustment — recommend narrowing the spread
    recommended = [1.0, 1.05, 1.1];
    rationale += ' — low concordance suggests narrowing attack weight spread';
  } else if (avgConcordance > 0.8) {
    rationale += ' — healthy concordance, no change needed';
  }

  return {
    parameter: 'qbaf.attack_weights',
    current_value: current as unknown as Record<string, number>,
    recommended_value: recommended as unknown as Record<string, number>,
    confidence: avgConcordance < 0.5 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale,
  };
}

/**
 * Parameter 4: Draft temperature.
 * Minimize composite cost: structural_error_rate + repetition_rate.
 */
function optimizeDraftTemperature(data: CalibrationDataPoint[]): OptimizationResult | null {
  if (data.length < 5) return null;

  // Group by temperature (in case different debates used different temps)
  const tempGroups = new Map<number, { structural: number; repetition: number; count: number }>();
  for (const d of data) {
    const bucket = Math.round(d.draft_temperature * 20) / 20;
    const group = tempGroups.get(bucket) ?? { structural: 0, repetition: 0, count: 0 };
    group.structural += d.structural_error_rate;
    group.repetition += d.repetition_rate;
    group.count++;
    tempGroups.set(bucket, group);
  }

  // If all debates used the same temperature, use the error rates to suggest direction
  if (tempGroups.size === 1) {
    const [temp, group] = [...tempGroups.entries()][0];
    const avgStructural = group.structural / group.count;
    const avgRepetition = group.repetition / group.count;

    let recommended = temp;
    let rationale = `structural errors: ${(avgStructural * 100).toFixed(0)}%, repetition: ${(avgRepetition * 100).toFixed(0)}%`;

    if (avgStructural > avgRepetition * 2) {
      recommended = Math.max(0.4, temp - 0.05);
      rationale += ` — structural errors dominate, lower temperature to ${recommended}`;
    } else if (avgRepetition > avgStructural * 2) {
      recommended = Math.min(0.9, temp + 0.05);
      rationale += ` — repetition dominates, raise temperature to ${recommended}`;
    } else {
      rationale += ' — balanced, no change needed';
    }

    return {
      parameter: 'draft_temperature',
      current_value: temp,
      recommended_value: recommended,
      confidence: data.length >= 15 ? 'medium' : 'low',
      data_points_used: data.length,
      rationale,
    };
  }

  // Multiple temperatures — find the one with lowest composite cost
  let bestTemp = 0.7;
  let bestCost = Infinity;
  for (const [temp, group] of tempGroups) {
    const cost = (group.structural + group.repetition) / group.count;
    if (cost < bestCost) {
      bestCost = cost;
      bestTemp = temp;
    }
  }

  return {
    parameter: 'draft_temperature',
    current_value: data[0].draft_temperature,
    recommended_value: bestTemp,
    confidence: tempGroups.size >= 3 ? 'high' : 'medium',
    data_points_used: data.length,
    rationale: `Best composite cost ${bestCost.toFixed(3)} at temperature ${bestTemp}`,
  };
}

/**
 * Parameter 5: Saturation signal weights.
 * OLS regression: quality = w1*signal1 + w2*signal2 + ...
 * The regression coefficients (normalized) are the optimal weights.
 */
function optimizeSaturationWeights(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d =>
    d.argumentative_saturation_signals_at_transition != null &&
    d.crux_addressed_ratio != null &&
    d.engaging_real_disagreement != null,
  );
  if (valid.length < 8) return null;

  const signalNames = Object.keys(valid[0].argumentative_saturation_signals_at_transition!);
  if (signalNames.length === 0) return null;

  // Build X (signals) and y (quality) vectors
  const y = valid.map(d =>
    (d.crux_addressed_ratio ?? 0) * (d.engaging_real_disagreement ? 1.0 : 0.5),
  );
  const X = valid.map(d => signalNames.map(name => d.argumentative_saturation_signals_at_transition![name] ?? 0));

  // Simple OLS: w = (X^T X)^{-1} X^T y
  // For small dimensions (6 signals × N debates), this is trivial
  const k = signalNames.length;
  const n = valid.length;

  // X^T X (k×k)
  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const Xty: number[] = Array(k).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let l = 0; l < k; l++) {
        XtX[j][l] += X[i][j] * X[i][l];
      }
    }
  }

  // Solve via Gaussian elimination (k is small, ~6)
  const augmented = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < k; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) maxRow = row;
    }
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

    if (Math.abs(augmented[col][col]) < 1e-10) continue; // Singular — skip

    for (let row = col + 1; row < k; row++) {
      const factor = augmented[row][col] / augmented[col][col];
      for (let j = col; j <= k; j++) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  // Back substitution
  const w = Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    if (Math.abs(augmented[i][i]) < 1e-10) continue;
    w[i] = augmented[i][k];
    for (let j = i + 1; j < k; j++) {
      w[i] -= augmented[i][j] * w[j];
    }
    w[i] /= augmented[i][i];
  }

  // Normalize to sum to 1, clamp negatives to small positive
  const clamped = w.map(v => Math.max(0.02, v));
  const sum = clamped.reduce((a, b) => a + b, 0);
  const normalized = clamped.map(v => Math.round((v / sum) * 100) / 100);

  // Fix rounding to sum to exactly 1.0
  const roundingError = 1.0 - normalized.reduce((a, b) => a + b, 0);
  const maxIdx = normalized.indexOf(Math.max(...normalized));
  normalized[maxIdx] = Math.round((normalized[maxIdx] + roundingError) * 100) / 100;

  const recommended: Record<string, number> = {};
  signalNames.forEach((name, i) => { recommended[name] = normalized[i]; });

  return {
    parameter: 'argumentative_saturation',
    current_value: valid[0].argumentative_saturation_weights,
    recommended_value: recommended,
    confidence: valid.length >= 15 ? 'high' : valid.length >= 10 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `OLS regression on ${valid.length} data points. Weights: ${signalNames.map((n, i) => `${n}=${normalized[i]}`).join(', ')}`,
  };
}

/**
 * Parameter 6: Context compression window.
 * If claims_forgotten_rate is high, raise window. If structural errors rise, lower it.
 */
function optimizeCompressionWindow(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.claims_forgotten_rate != null);
  if (valid.length < 5) return null;

  const avgForgotten = valid.reduce((s, d) => s + (d.claims_forgotten_rate ?? 0), 0) / valid.length;
  const current = valid[0].recent_window;

  let recommended = current;
  if (avgForgotten > 0.4) {
    recommended = Math.min(14, current + 2);
  } else if (avgForgotten < 0.15) {
    recommended = Math.max(4, current - 1); // conservatively shrink
  }

  return {
    parameter: 'recent_window',
    current_value: current,
    recommended_value: recommended,
    confidence: valid.length >= 12 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Avg claims forgotten: ${(avgForgotten * 100).toFixed(0)}%` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended}` : ' — no change needed'),
  };
}

/**
 * Parameter 7: GC trigger.
 * Correlate GC occurrence with neutral evaluator quality.
 */
function optimizeGcTrigger(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.engaging_real_disagreement != null);
  if (valid.length < 5) return null;

  const gcDebates = valid.filter(d => d.gc_runs > 0);
  const noGcDebates = valid.filter(d => d.gc_runs === 0);

  if (gcDebates.length < 2 || noGcDebates.length < 2) {
    return {
      parameter: 'network.gc_trigger',
      current_value: valid[0].gc_trigger,
      recommended_value: valid[0].gc_trigger,
      confidence: 'low',
      data_points_used: valid.length,
      rationale: `Not enough split: ${gcDebates.length} GC debates, ${noGcDebates.length} non-GC — need both >= 2`,
    };
  }

  const gcQuality = gcDebates.reduce((s, d) => s + (d.engaging_real_disagreement ? 1 : 0), 0) / gcDebates.length;
  const noGcQuality = noGcDebates.reduce((s, d) => s + (d.engaging_real_disagreement ? 1 : 0), 0) / noGcDebates.length;

  const current = valid[0].gc_trigger;
  let recommended = current;
  if (gcQuality < noGcQuality - 0.2) {
    // GC debates are notably lower quality — raise trigger to avoid premature pruning
    recommended = Math.min(250, current + 25);
  } else if (gcQuality >= noGcQuality) {
    // GC doesn't hurt — keep or slightly lower
    const avgNodes = gcDebates.reduce((s, d) => s + d.an_nodes_at_synthesis, 0) / gcDebates.length;
    if (avgNodes < current * 0.6) {
      recommended = Math.max(100, current - 15);
    }
  }

  return {
    parameter: 'network.gc_trigger',
    current_value: current,
    recommended_value: recommended,
    confidence: valid.length >= 12 && Math.abs(gcQuality - noGcQuality) > 0.15 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `GC debate quality: ${(gcQuality * 100).toFixed(0)}%, non-GC: ${(noGcQuality * 100).toFixed(0)}%` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended}` : ' — no change needed'),
  };
}

/**
 * Parameter 8: Crux resolution threshold.
 * Minimize divergence between engine crux status and neutral evaluator crux status.
 */
function optimizeCruxThreshold(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.crux_resolution_divergence_rate != null);
  if (valid.length < 5) return null;

  const avgDivergence = valid.reduce((s, d) => s + (d.crux_resolution_divergence_rate ?? 0), 0) / valid.length;
  const current = valid[0].polarity_resolved_threshold;

  let recommended = current;
  // High divergence means engine and evaluator disagree on crux status
  // We can't tell direction from divergence alone, so adjust conservatively
  if (avgDivergence > 0.4) {
    // Split the difference — move threshold toward center
    recommended = current > 0.7 ? Math.max(0.65, current - 0.03) : Math.min(0.90, current + 0.03);
  }

  return {
    parameter: 'crux_resolution.polarity_resolved',
    current_value: current,
    recommended_value: Math.round(recommended * 100) / 100,
    confidence: valid.length >= 12 && avgDivergence > 0.3 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Avg crux resolution divergence: ${(avgDivergence * 100).toFixed(0)}%` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended.toFixed(2)}` : ' — no change needed'),
  };
}

/**
 * Parameter 9: Node selection caps.
 * Use relevance score variance to detect over-generous caps.
 */
function optimizeNodeCaps(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.avg_utilization_rate != null && d.relevance_score_variance != null);
  if (valid.length < 5) return null;

  const avgUtil = valid.reduce((s, d) => s + (d.avg_utilization_rate ?? 0), 0) / valid.length;
  const avgVariance = valid.reduce((s, d) => s + (d.relevance_score_variance ?? 0), 0) / valid.length;
  const current = valid[0].max_nodes_cap;

  let recommended = current;
  if (avgUtil < 0.3 && avgVariance < 0.02) {
    // Low utilization + low variance = narrow topic getting too many nodes
    recommended = Math.max(20, current - 10);
  } else if (avgUtil > 0.6 && avgVariance > 0.05) {
    // High utilization + high variance = broad topic needing more nodes
    recommended = Math.min(80, current + 10);
  }

  return {
    parameter: 'max_nodes_cap',
    current_value: current,
    recommended_value: recommended,
    confidence: valid.length >= 12 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Avg utilization: ${(avgUtil * 100).toFixed(0)}%, relevance variance: ${avgVariance.toFixed(3)}` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended}` : ' — no change needed'),
  };
}

/**
 * Parameter 10: Semantic recycling threshold.
 * Maximize agreement between recycling detector and turn validator novelty signal.
 */
function optimizeRecyclingThreshold(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.recycling_novelty_agreement != null);
  if (valid.length < 5) return null;

  const avgAgreement = valid.reduce((s, d) => s + (d.recycling_novelty_agreement ?? 0), 0) / valid.length;
  const current = valid[0].semantic_recycling_threshold;

  let recommended = current;
  if (avgAgreement < 0.6) {
    // Poor agreement — the two signals diverge. Since recycling uses embeddings and
    // novelty uses taxonomy refs, push recycling toward the middle.
    recommended = current > 0.85 ? Math.max(0.75, current - 0.03) : Math.min(0.92, current + 0.02);
  }

  return {
    parameter: 'semantic_recycling_threshold',
    current_value: current,
    recommended_value: Math.round(recommended * 100) / 100,
    confidence: valid.length >= 12 && avgAgreement < 0.5 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Recycling-novelty agreement: ${(avgAgreement * 100).toFixed(0)}%` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended.toFixed(2)}` : ' — no change needed'),
  };
}

// ── Upstream pipeline optimizers (11-15) ────────────────────

/**
 * Parameter 11: Cluster MinSimilarity.
 * If taxonomy_mapped_ratio is low, clusters may be too tight (orphaning nodes).
 * If high, clusters are working well.
 */
function optimizeClusterSimilarity(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.taxonomy_mapped_ratio != null);
  if (valid.length < 5) return null;

  const avgMapped = valid.reduce((s, d) => s + (d.taxonomy_mapped_ratio ?? 0), 0) / valid.length;
  const current = valid[0].cluster_min_similarity;

  let recommended = current;
  if (avgMapped < 0.5) {
    // Many AN nodes aren't mapping to taxonomy — clusters may be too tight
    recommended = Math.max(0.35, current - 0.03);
  } else if (avgMapped > 0.85) {
    // Very high mapping — could tighten clusters for better precision
    recommended = Math.min(0.70, current + 0.02);
  }

  return {
    parameter: 'cluster_min_similarity',
    current_value: current,
    recommended_value: Math.round(recommended * 100) / 100,
    confidence: valid.length >= 12 && Math.abs(avgMapped - 0.7) > 0.15 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Avg taxonomy mapping ratio: ${(avgMapped * 100).toFixed(0)}%` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended.toFixed(2)}` : ' — no change needed'),
  };
}

/**
 * Parameter 12: Duplicate claim similarity threshold.
 * High near-miss count suggests threshold is too high (redundant claims surviving).
 */
function optimizeDuplicateThreshold(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.near_miss_duplicate_count != null);
  if (valid.length < 5) return null;

  const avgNearMiss = valid.reduce((s, d) => s + (d.near_miss_duplicate_count ?? 0), 0) / valid.length;
  const avgNodes = valid.reduce((s, d) => s + (d.an_nodes_at_synthesis ?? 0), 0) / valid.length;
  const current = valid[0].duplicate_similarity_threshold;

  // Near-miss rate: near-miss pairs as fraction of total node pairs
  const nearMissRate = avgNodes > 1 ? avgNearMiss / (avgNodes * (avgNodes - 1) / 2) : 0;

  let recommended = current;
  if (nearMissRate > 0.05) {
    // >5% of pairs are near-misses — lower threshold to catch them
    recommended = Math.max(0.75, current - 0.03);
  }

  return {
    parameter: 'duplicate_similarity_threshold',
    current_value: current,
    recommended_value: Math.round(recommended * 100) / 100,
    confidence: valid.length >= 12 && nearMissRate > 0.05 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Avg near-miss duplicates: ${avgNearMiss.toFixed(1)} per debate (rate: ${(nearMissRate * 100).toFixed(1)}%)` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended.toFixed(2)}` : ' — no change needed'),
  };
}

/**
 * Parameter 13: FIRE confidence threshold.
 * If borderline claims (barely accepted) survive debate well, threshold is right or too high.
 * If they're frequently refuted, threshold is too low.
 */
function optimizeFireThreshold(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.borderline_claim_survival_rate != null);
  if (valid.length < 5) return null;

  const avgSurvival = valid.reduce((s, d) => s + (d.borderline_claim_survival_rate ?? 0), 0) / valid.length;
  const current = valid[0].fire_confidence_threshold;

  let recommended = current;
  if (avgSurvival < 0.5) {
    // Borderline claims are frequently refuted — raise threshold
    recommended = Math.min(0.85, current + 0.05);
  } else if (avgSurvival > 0.85) {
    // Borderline claims survive well — threshold might be too high (blocking good claims)
    recommended = Math.max(0.5, current - 0.03);
  }

  return {
    parameter: 'fire_confidence_threshold',
    current_value: current,
    recommended_value: Math.round(recommended * 100) / 100,
    confidence: valid.length >= 10 && (avgSurvival < 0.4 || avgSurvival > 0.9) ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Borderline claim survival rate: ${(avgSurvival * 100).toFixed(0)}%` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended.toFixed(2)}` : ' — no change needed'),
  };
}

/**
 * Parameter 14: Hierarchy cohesion "clear theme" threshold.
 * Uses avg_branch_cohesion as proxy — if debate-referenced branches have low cohesion,
 * the grouping threshold may be too permissive.
 */
function optimizeCohesionThreshold(data: CalibrationDataPoint[]): OptimizationResult | null {
  const valid = data.filter(d => d.avg_branch_cohesion != null);
  if (valid.length < 5) return null;

  const avgCohesion = valid.reduce((s, d) => s + (d.avg_branch_cohesion ?? 0), 0) / valid.length;
  const current = valid[0].cohesion_clear_theme;

  let recommended = current;
  if (avgCohesion < 0.45) {
    // Low cohesion in debated branches — tighten the grouping threshold
    recommended = Math.min(0.75, current + 0.03);
  } else if (avgCohesion > 0.75) {
    // High cohesion — could relax threshold slightly for broader grouping
    recommended = Math.max(0.45, current - 0.02);
  }

  return {
    parameter: 'cohesion_clear_theme',
    current_value: current,
    recommended_value: Math.round(recommended * 100) / 100,
    confidence: valid.length >= 10 ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Avg branch cohesion in debates: ${avgCohesion.toFixed(3)}` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended.toFixed(2)}` : ' — no change needed'),
  };
}

/**
 * Parameter 15: Extraction density (KP divisor).
 * If claims_per_1k_words is very high, extraction may be noisy. If very low, under-extracting.
 */
function optimizeExtractionDensity(data: CalibrationDataPoint[]): OptimizationResult | null {
  // Only use document-sourced debates — topic-sourced debates measure transcript density
  // which is naturally 10-100x higher than source document density (the parameter's target).
  const valid = data.filter(d => d.claims_per_1k_words != null && d.claims_per_1k_words < 20);
  if (valid.length < 5) return null;

  const avgDensity = valid.reduce((s, d) => s + (d.claims_per_1k_words ?? 0), 0) / valid.length;
  const current = valid[0].kp_divisor;

  let recommended = current;
  // Target density: 2-5 claims per 1k words
  if (avgDensity > 6) {
    // Over-extracting — increase divisor to reduce quotas
    recommended = Math.min(1000, current + 50);
  } else if (avgDensity < 1.5) {
    // Under-extracting — decrease divisor to increase quotas
    recommended = Math.max(200, current - 50);
  }

  return {
    parameter: 'kp_divisor',
    current_value: current,
    recommended_value: recommended,
    confidence: valid.length >= 10 && (avgDensity > 7 || avgDensity < 1) ? 'medium' : 'low',
    data_points_used: valid.length,
    rationale: `Avg claims per 1k words: ${avgDensity.toFixed(1)} (target: 2-5)` +
      (recommended !== current ? ` — adjusting divisor ${current} → ${recommended}` : ' — no change needed'),
  };
}

/**
 * Parameter 16: API budget hard multiplier.
 * If debates are hitting the ceiling, the multiplier is too low.
 */
function optimizeBudgetMultiplier(data: CalibrationDataPoint[]): OptimizationResult | null {
  if (data.length < 5) return null;

  const valid = data.filter(d => d.budget_hard_multiplier != null && d.budget_hard_multiplier > 0);
  if (valid.length < 5) return null;

  const hitCount = valid.filter(d => d.hit_api_ceiling).length;
  const hitRate = hitCount / valid.length;
  const current = valid[0].budget_hard_multiplier;
  const avgCalls = valid.reduce((s, d) => s + (d.total_api_calls ?? 0), 0) / valid.length;

  let recommended = current;
  if (hitRate > 0.1) {
    // >10% of debates hit the ceiling — raise multiplier
    recommended = Math.min(20, current + 2);
  } else if (hitRate === 0 && avgCalls < current * 5 * 0.5) {
    // Never hits ceiling and avg calls well below soft limit — could lower
    recommended = Math.max(6, current - 1);
  }

  return {
    parameter: 'budget.hard_multiplier',
    current_value: current,
    recommended_value: recommended,
    confidence: data.length >= 10 && hitRate > 0.15 ? 'high' : hitRate > 0.05 ? 'medium' : 'low',
    data_points_used: data.length,
    rationale: `Ceiling hit rate: ${(hitRate * 100).toFixed(0)}% (${hitCount}/${data.length}), avg calls: ${avgCalls.toFixed(0)}` +
      (recommended !== current ? ` — adjusting ${current} → ${recommended}` : ' — no change needed'),
  };
}

/**
 * Evaluator-change hard cutover (t/1846, t/1670 discipline): when the pinned evaluator
 * differs from the one on the latest parameter-history entry — including history that
 * predates the pin entirely — append an 'evaluator-cutover' entry. Everything before it
 * was earned under a different (or unknown, per-debate) evaluator and is not comparable
 * across the boundary. Idempotent: no-ops when the latest entry already carries the pin.
 */
function ensureEvaluatorBaseline(
  dataRoot: string,
  pinnedEvaluator: string,
  dataPoints: number,
  weightsPath?: string,
): void {
  try {
    seedInitialSnapshot(dataRoot, weightsPath);
    const history = readParameterHistory(dataRoot);
    const latest = history[history.length - 1];
    if (latest?.evaluator_id === pinnedEvaluator) return;

    const snapshot = captureSnapshot(weightsPath);
    appendParameterHistory({
      timestamp: new Date().toISOString(),
      source: 'evaluator-cutover',
      data_points: dataPoints,
      evaluator_id: pinnedEvaluator,
      before: snapshot,
      after: snapshot,
      changes: [],
    }, dataRoot);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'calibration-optimizer', level: 'warn',
      message: 'Failed to record evaluator-cutover baseline in parameter history',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}

// ── Main orchestrator ───────────────────────────────────────

/**
 * Run all 16 optimization algorithms on the calibration log.
 * Returns a report with recommendations. Optionally writes to calibration-config.json.
 */
export function recalibrateParameters(
  dataRoot: string,
  options: { apply?: boolean; weightsPath?: string } = {},
): RecalibrationReport {
  const allData = readCalibrationLog(dataRoot);

  // Same-evaluator comparison window (t/1846): the optimizer only compares rows
  // scored by the pinned evaluator. Unstamped legacy rows are permanently ineligible —
  // their evaluator was the debate's own model (evaluator-mixed by construction).
  const weightsPathForPin = options.weightsPath ?? path.resolve(__dirname, 'calibration-config.json');
  let pinnedEvaluator = PINNED_EVALUATOR_MODEL;
  try {
    const cfg = JSON.parse(fs.readFileSync(weightsPathForPin, 'utf-8'));
    if (typeof cfg?.evaluator?.model === 'string' && cfg.evaluator.model) {
      pinnedEvaluator = cfg.evaluator.model;
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'calibration-optimizer', level: 'warn',
      message: `calibration-config.json unreadable for evaluator pin — using mirror fallback '${PINNED_EVALUATOR_MODEL}'`,
      error: { name: (err as Error).name ?? 'Error', message: String(err) },
    });
  }
  const data = allData.filter(d => d.evaluator_model_id === pinnedEvaluator);
  const excluded = allData.length - data.length;
  if (excluded > 0) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'calibration-optimizer', level: 'info',
      message: `Evaluator window: ${excluded}/${allData.length} calibration rows excluded (not stamped '${pinnedEvaluator}') — reported, not silently dropped (t/1846)`,
    });
  }

  // Replication gate (t/1668): compute BEFORE the min-data-points guard — a
  // fixed config with fewer than REPLICATION_GATE_MIN_N clean replications is
  // exactly the case the gate must surface (regression trigger not yet permitted),
  // so the gates belong in the report even when the overall log is still sparse.
  // Gates run on the same-evaluator window: a distribution pooled across evaluators
  // would re-import exactly the mixing the window exists to prevent.
  const replication_gates: Record<string, ReplicationGateResult[]> = {};
  for (const [name, selector] of Object.entries(HEADLINE_METRICS)) {
    replication_gates[name] = replicationGateByConfig(data, selector);
  }

  const report: RecalibrationReport = {
    timestamp: new Date().toISOString(),
    data_points: data.length,
    min_required: MIN_DATA_POINTS,
    results: [],
    applied: false,
    evaluator_model_id: pinnedEvaluator,
    excluded_rows_wrong_evaluator: excluded,
    replication_gates,
  };

  // Evaluator cutover baseline (t/1846): if the pinned evaluator differs from the one on
  // the latest history entry (or history predates the pin), mark a hard baseline reset.
  ensureEvaluatorBaseline(dataRoot, pinnedEvaluator, data.length, options.weightsPath);

  if (data.length < MIN_DATA_POINTS) {
    // Explicit cold-start state (TL t/1846#3) — "no recommendation" must never be ambiguous.
    report.cold_start_hold =
      `optimizer held: ${data.length}/${MIN_DATA_POINTS} rows stamped with pinned evaluator ` +
      `'${pinnedEvaluator}' (${excluded} excluded as unstamped/other-evaluator). ` +
      `Accumulates as new debates run under the pin.`;
    return report;
  }

  // Run all 15 optimizers
  const optimizers = [
    // Debate parameters (1-10)
    optimizeExplorationExit,
    optimizeRelevanceThreshold,
    optimizeAttackWeights,
    optimizeDraftTemperature,
    optimizeSaturationWeights,
    optimizeCompressionWindow,
    optimizeGcTrigger,
    optimizeCruxThreshold,
    optimizeNodeCaps,
    optimizeRecyclingThreshold,
    // Upstream pipeline parameters (11-15)
    optimizeClusterSimilarity,
    optimizeDuplicateThreshold,
    optimizeFireThreshold,
    optimizeCohesionThreshold,
    optimizeExtractionDensity,
    // Budget (16)
    optimizeBudgetMultiplier,
  ];

  for (const optimizer of optimizers) {
    const result = optimizer(data);
    if (result) report.results.push(result);
  }

  // Apply to calibration-config.json if requested
  if (options.apply && report.results.length > 0) {


    const weightsPath = options.weightsPath ??
      path.resolve(__dirname, 'calibration-config.json');

    try {
      const beforeSnapshot = captureSnapshot(weightsPath);
      const raw = fs.readFileSync(weightsPath, 'utf-8');
      const weights = JSON.parse(raw);
      let anyApplied = false;

      for (const result of report.results) {
        // Config-writing invariant (t/1843#1): crux-axis recommendations are computed
        // and reported, but never write config until reference-calibrated (t/1847).
        if (CRUX_AXIS_PARAMS.has(result.parameter)) {
          (report.held_recommendations ??= []).push({
            parameter: result.parameter,
            reason: 'crux axis held at zero weight pending reference calibration (t/1843 ruling; t/1847)',
          });
          continue;
        }
        if (result.confidence === 'low') continue; // Only apply medium/high confidence

        switch (result.parameter) {
          case 'network.gc_trigger':
            if (weights.network) { weights.network.gc_trigger = result.recommended_value as number; anyApplied = true; }
            break;
          case 'budget.hard_multiplier':
            if (weights.budget) { weights.budget.hard_multiplier = result.recommended_value as number; anyApplied = true; }
            break;
          case 'relevance_threshold':
            if (weights.relevance) { weights.relevance.embedding_threshold = result.recommended_value as number; anyApplied = true; }
            break;
          // draft_temperature, attack_weights, recent_window,
          // crux thresholds, node caps, and recycling threshold are not yet in
          // calibration-config.json — logged for manual review until externalized
        }
      }

      if (anyApplied) {
        fs.writeFileSync(weightsPath, JSON.stringify(weights, null, 2) + '\n', 'utf-8');
      }
      report.applied = anyApplied;

      // Record history entry with before/after snapshots
      const afterSnapshot = captureSnapshot(weightsPath);
      const changes = diffSnapshots(beforeSnapshot, afterSnapshot);
      // Enrich changes with confidence and rationale from optimization results
      for (const change of changes) {
        const result = report.results.find(r => r.parameter.includes(change.parameter) || change.parameter.includes(r.parameter.split('.').pop()!));
        if (result) {
          change.confidence = result.confidence;
          change.rationale = result.rationale;
        }
      }
      if (changes.length > 0) {
        appendParameterHistory({
          timestamp: new Date().toISOString(),
          source: 'optimizer',
          data_points: data.length,
          evaluator_id: pinnedEvaluator,
          before: beforeSnapshot,
          after: afterSnapshot,
          changes,
        }, dataRoot);
      }
    } catch (err) {
      // Failed to apply — report still has recommendations
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'calibration-optimizer',
        level: 'warn',
        message: 'Failed to apply calibration parameter recommendations to calibration-config.json',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
  }

  // Write report to calibration directory
  try {

    const reportPath = path.join(dataRoot, 'calibration', 'last-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  } catch (err) {
    /* non-critical */
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'calibration-optimizer',
      level: 'warn',
      message: 'Failed to write calibration report to last-report.json',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }

  return report;
}

// ── CLI entry point ─────────────────────────────────────────

// ESM-compatible entry point detection
const isMain = typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^.*\//, ''));
if (isMain) {
  const dataRoot = process.argv[2] || process.env.AI_TRIAD_DATA_ROOT;
  if (!dataRoot) {
    console.error('Usage: npx tsx lib/debate/calibrationOptimizer.ts <data-root>');
    console.error('  or set AI_TRIAD_DATA_ROOT environment variable');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  const report = recalibrateParameters(dataRoot, { apply });

  console.log(`\nCalibration Report — ${report.data_points} data points (min: ${report.min_required})`);
  console.log(`Evaluator window: '${report.evaluator_model_id}' (${report.excluded_rows_wrong_evaluator ?? 0} rows excluded as unstamped/other-evaluator)\n`);

  if (report.cold_start_hold) {
    console.log(`${report.cold_start_hold}\n`);
    process.exit(0);
  }
  if (report.data_points < report.min_required) {
    console.log(`Not enough data. Run ${report.min_required - report.data_points} more debates.\n`);
    process.exit(0);
  }

  for (const r of report.results) {
    const arrow = JSON.stringify(r.current_value) === JSON.stringify(r.recommended_value)
      ? '(no change)' : `→ ${JSON.stringify(r.recommended_value)}`;
    console.log(`[${r.confidence}] ${r.parameter}: ${JSON.stringify(r.current_value)} ${arrow}`);
    console.log(`       ${r.rationale}`);
    console.log(`       (${r.data_points_used} data points)\n`);
  }

  for (const held of report.held_recommendations ?? []) {
    console.log(`[HELD] ${held.parameter}: ${held.reason}`);
  }

  if (apply && report.applied) {
    console.log('Applied changes to calibration-config.json');
  } else if (apply && !report.applied) {
    console.log('--apply requested but no changes met confidence threshold (crux-axis recommendations are held — see [HELD] lines)');
  } else {
    console.log('Dry run. Use --apply to write changes to calibration-config.json');
  }
}
