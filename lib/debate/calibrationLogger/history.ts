// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Parameter snapshots & history (ADR-007 file-size split, t/1686).
 *
 * Capture the current tracked-parameter snapshot from calibration-config.json +
 * defaults, diff two snapshots, and read/append the parameter-history.json log.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TEMPERATURE } from '../../ai-client/defaults.js';
import { DEFAULT_ATTACK_WEIGHTS } from '../qbaf.js';

// ── Parameter snapshots & history ────────────────────────────

/** A point-in-time snapshot of all 15 tracked parameter values. */
export interface ParameterSnapshot {
  // Debate parameters (1-10)
  argumentation_exit: number;
  relevance_threshold: number;
  attack_weights: [number, number, number];
  draft_temperature: number;
  argumentative_saturation_weights: Record<string, number>;
  recent_window: number;
  gc_trigger: number;
  polarity_resolved: number;
  max_nodes_cap: number;
  semantic_recycling_threshold: number;
  // Upstream pipeline parameters (11-15)
  cluster_min_similarity: number;
  duplicate_similarity_threshold: number;
  fire_confidence_threshold: number;
  cohesion_clear_theme: number;
  kp_divisor: number;
  budget_hard_multiplier: number;
  situation_max_nodes: number;
}

/** A history entry recording a parameter change event. */
export interface ParameterHistoryEntry {
  timestamp: string;
  source: 'initial' | 'optimizer' | 'manual';
  /** Number of calibration data points at time of change */
  data_points: number;
  before: ParameterSnapshot;
  after: ParameterSnapshot;
  /** Per-parameter change details (only parameters that actually changed) */
  changes: {
    parameter: string;
    from: number | number[] | Record<string, number>;
    to: number | number[] | Record<string, number>;
    confidence?: 'high' | 'medium' | 'low';
    rationale?: string;
  }[];
}

/** Build the current snapshot from calibration-config.json + hardcoded defaults. */
export function captureSnapshot(weightsPath?: string): ParameterSnapshot {



  let weights: any = {};
  // Resolve relative to this file — use import.meta.url for ESM compatibility.
  // This module lives in lib/debate/calibrationLogger/, so calibration-config.json
  // (in lib/debate/) is one directory up.
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const wPath = weightsPath ?? path.resolve(thisDir, '..', 'calibration-config.json');
  try {
    weights = JSON.parse(fs.readFileSync(wPath, 'utf-8'));
  } catch { /* use defaults */ }

  return {
    argumentation_exit: weights?.thresholds?.argumentation_exit ?? 0.65,
    relevance_threshold: 0.45,
    attack_weights: [DEFAULT_ATTACK_WEIGHTS.rebut, DEFAULT_ATTACK_WEIGHTS.undercut, DEFAULT_ATTACK_WEIGHTS.undermine],
    draft_temperature: DEFAULT_TEMPERATURE,
    argumentative_saturation_weights: weights?.argumentative_saturation ?? {
      recycling_pressure: 0.30, crux_maturity: 0.25, concession_plateau: 0.15,
      engagement_fatigue: 0.15, pragmatic_convergence: 0.05, scheme_stagnation: 0.10,
    },
    recent_window: 8,
    gc_trigger: weights?.network?.gc_trigger ?? 175,
    polarity_resolved: 0.85,
    max_nodes_cap: 50,
    semantic_recycling_threshold: 0.85,
    cluster_min_similarity: 0.55,
    duplicate_similarity_threshold: 0.85,
    fire_confidence_threshold: 0.7,
    cohesion_clear_theme: 0.60,
    kp_divisor: 500,
    budget_hard_multiplier: weights?.budget?.hard_multiplier ?? 15,
    situation_max_nodes: 8,
  };
}

/** Compute the diff between two snapshots — returns only changed parameters. */
export function diffSnapshots(
  before: ParameterSnapshot,
  after: ParameterSnapshot,
): ParameterHistoryEntry['changes'] {
  const changes: ParameterHistoryEntry['changes'] = [];

  const simpleKeys: (keyof ParameterSnapshot)[] = [
    'argumentation_exit', 'relevance_threshold', 'draft_temperature',
    'recent_window', 'gc_trigger', 'polarity_resolved', 'max_nodes_cap',
    'semantic_recycling_threshold', 'cluster_min_similarity',
    'duplicate_similarity_threshold', 'fire_confidence_threshold',
    'cohesion_clear_theme', 'kp_divisor', 'budget_hard_multiplier', 'situation_max_nodes',
  ];
  for (const key of simpleKeys) {
    if (before[key] !== after[key]) {
      changes.push({ parameter: key, from: before[key] as number, to: after[key] as number });
    }
  }

  // Attack weights
  const baw = before.attack_weights, aaw = after.attack_weights;
  if (baw[0] !== aaw[0] || baw[1] !== aaw[1] || baw[2] !== aaw[2]) {
    changes.push({ parameter: 'attack_weights', from: [...baw], to: [...aaw] });
  }

  // Saturation weights
  const bsw = before.argumentative_saturation_weights, asw = after.argumentative_saturation_weights;
  const swChanged = Object.keys({ ...bsw, ...asw }).some(k => (bsw[k] ?? 0) !== (asw[k] ?? 0));
  if (swChanged) {
    changes.push({ parameter: 'argumentative_saturation_weights', from: { ...bsw }, to: { ...asw } });
  }

  return changes;
}

/** Read the parameter history log. */
export function readParameterHistory(dataRoot: string): ParameterHistoryEntry[] {



  const histPath = path.join(dataRoot, 'calibration', 'parameter-history.json');
  if (!fs.existsSync(histPath)) return [];

  try {
    return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
  } catch {
    return [];
  }
}

/** Append a history entry to the parameter history log. */
export function appendParameterHistory(
  entry: ParameterHistoryEntry,
  dataRoot: string,
): void {



  const calibDir = path.join(dataRoot, 'calibration');
  if (!fs.existsSync(calibDir)) {
    fs.mkdirSync(calibDir, { recursive: true });
  }

  const histPath = path.join(calibDir, 'parameter-history.json');
  let history: ParameterHistoryEntry[] = [];
  if (fs.existsSync(histPath)) {
    try { history = JSON.parse(fs.readFileSync(histPath, 'utf-8')); } catch { /* fresh */ }
  }

  history.push(entry);
  fs.writeFileSync(histPath, JSON.stringify(history, null, 2) + '\n', 'utf-8');
}

/**
 * Seed initial snapshot if no history exists yet.
 * Call once during setup or on first debate.
 */
export function seedInitialSnapshot(dataRoot: string, weightsPath?: string): void {
  const history = readParameterHistory(dataRoot);
  if (history.length > 0) return; // Already seeded

  const snapshot = captureSnapshot(weightsPath);
  appendParameterHistory({
    timestamp: new Date().toISOString(),
    source: 'initial',
    data_points: 0,
    before: snapshot,
    after: snapshot,
    changes: [],
  }, dataRoot);
}
