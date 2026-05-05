// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Parameter optimizer — reads calibration-log.json and computes optimal
 * values for the top 5 parameters. Writes results to provisional-weights.json.
 *
 * No LLM calls. No human input. Pure arithmetic on logged debate data.
 *
 * Usage (CLI): npx tsx lib/debate/calibrationOptimizer.ts [data-root]
 * Usage (programmatic): import { recalibrateParameters } from './calibrationOptimizer';
 */

import type { CalibrationDataPoint, ParameterHistoryEntry } from './calibrationLogger';
import {
  readCalibrationLog,
  captureSnapshot,
  diffSnapshots,
  appendParameterHistory,
  seedInitialSnapshot,
} from './calibrationLogger';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

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
  data_points: number;
  min_required: number;
  results: OptimizationResult[];
  applied: boolean;
}

// ── Optimizer algorithms ────────────────────────────────────

const MIN_DATA_POINTS = 10;

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
    x: d.exploration_exit_threshold,
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

  const current = valid[0].exploration_exit_threshold;
  const delta = Math.abs(bestThreshold - current);

  return {
    parameter: 'thresholds.exploration_exit',
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
 * Apply the relevance threshold recommendation to provisional-weights.json
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

  const targetPath = weightsPath ?? path.resolve(__dirname, 'provisional-weights.json');

  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    const weights = JSON.parse(raw);

    // Safety rail 4: manual override
    if (weights.relevance?.adaptation_enabled === false) {
      return { applied: false, reason: 'adaptation_enabled is false (manual override)' };
    }

    const oldValue = weights.relevance?.embedding_threshold ?? 0.48;
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
    current_value: current,
    recommended_value: recommended,
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
    d.saturation_signals_at_transition != null &&
    d.crux_addressed_ratio != null &&
    d.engaging_real_disagreement != null,
  );
  if (valid.length < 8) return null;

  const signalNames = Object.keys(valid[0].saturation_signals_at_transition!);
  if (signalNames.length === 0) return null;

  // Build X (signals) and y (quality) vectors
  const y = valid.map(d =>
    (d.crux_addressed_ratio ?? 0) * (d.engaging_real_disagreement ? 1.0 : 0.5),
  );
  const X = valid.map(d => signalNames.map(name => d.saturation_signals_at_transition![name] ?? 0));

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
    parameter: 'saturation',
    current_value: valid[0].saturation_weights,
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

// ── Main orchestrator ───────────────────────────────────────

/**
 * Run all 16 optimization algorithms on the calibration log.
 * Returns a report with recommendations. Optionally writes to provisional-weights.json.
 */
export function recalibrateParameters(
  dataRoot: string,
  options: { apply?: boolean; weightsPath?: string } = {},
): RecalibrationReport {
  const data = readCalibrationLog(dataRoot);
  const report: RecalibrationReport = {
    timestamp: new Date().toISOString(),
    data_points: data.length,
    min_required: MIN_DATA_POINTS,
    results: [],
    applied: false,
  };

  if (data.length < MIN_DATA_POINTS) {
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

  // Ensure initial snapshot exists
  seedInitialSnapshot(dataRoot);

  // Apply to provisional-weights.json if requested
  if (options.apply && report.results.length > 0) {


    const weightsPath = options.weightsPath ??
      path.resolve(__dirname, 'provisional-weights.json');

    try {
      const beforeSnapshot = captureSnapshot(weightsPath);
      const raw = fs.readFileSync(weightsPath, 'utf-8');
      const weights = JSON.parse(raw);

      for (const result of report.results) {
        if (result.confidence === 'low') continue; // Only apply medium/high confidence

        switch (result.parameter) {
          case 'thresholds.exploration_exit':
            weights.thresholds.exploration_exit = result.recommended_value;
            break;
          case 'saturation':
            if (typeof result.recommended_value === 'object') {
              weights.saturation = result.recommended_value;
            }
            break;
          case 'network.gc_trigger':
            if (weights.network) weights.network.gc_trigger = result.recommended_value as number;
            break;
          case 'budget.hard_multiplier':
            if (weights.budget) weights.budget.hard_multiplier = result.recommended_value as number;
            break;
          case 'relevance_threshold':
            if (weights.relevance) weights.relevance.embedding_threshold = result.recommended_value as number;
            break;
          // draft_temperature, attack_weights, recent_window,
          // crux thresholds, node caps, and recycling threshold are not yet in
          // provisional-weights.json — logged for manual review until externalized
        }
      }

      fs.writeFileSync(weightsPath, JSON.stringify(weights, null, 2) + '\n', 'utf-8');
      report.applied = true;

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
          before: beforeSnapshot,
          after: afterSnapshot,
          changes,
        }, dataRoot);
      }
    } catch {
      // Failed to apply — report still has recommendations
    }
  }

  // Write report to calibration directory
  try {

    const reportPath = path.join(dataRoot, 'calibration', 'last-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  } catch { /* non-critical */ }

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

  console.log(`\nCalibration Report — ${report.data_points} data points (min: ${report.min_required})\n`);

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

  if (apply && report.applied) {
    console.log('Applied changes to provisional-weights.json');
  } else if (apply && !report.applied) {
    console.log('--apply requested but no changes met confidence threshold');
  } else {
    console.log('Dry run. Use --apply to write changes to provisional-weights.json');
  }
}
