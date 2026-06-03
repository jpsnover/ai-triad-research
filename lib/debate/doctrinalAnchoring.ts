// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Doctrinal boundary embedding and confidence floor for Belief nodes.
 *
 * Each POV has 4 doctrinal boundary strings (from POVER_INFO). At debate setup,
 * these are embedded once. Belief nodes whose embeddings are cosine-similar to
 * their POV's boundaries are marked doctrinally_anchored and receive a confidence floor.
 *
 * See docs/weighted-bdi-proposal.md §"Doctrinal Boundary Integration"
 */

import { cosineSimilarity } from './taxonomyRelevance.js';
import type { PovNode } from './taxonomyTypes.js';

// ── Configuration ───────────────────────────────────────

export interface DoctrinalAnchoringConfig {
  /** Cosine similarity threshold for anchoring (default 0.55). */
  threshold: number;
  /** Confidence floor for anchored Beliefs (default 0.60). */
  confidenceFloor: number;
}

export const DEFAULT_ANCHORING_CONFIG: DoctrinalAnchoringConfig = {
  threshold: 0.55,
  confidenceFloor: 0.60,
};

// ── Boundary embeddings ─────────────────────────────────

export interface BoundaryEmbeddings {
  /** POV key → array of 4 boundary embedding vectors. */
  [pov: string]: number[][];
}

/**
 * Embed doctrinal boundary strings for all POVs.
 * Returns a map of POV → boundary vectors.
 *
 * @param boundaries - Map of POV key → boundary strings (from POVER_INFO)
 * @param embedFn - Embedding function (async, returns 384-dim vector)
 */
export async function embedDoctrinalBoundaries(
  boundaries: Record<string, string[]>,
  embedFn: (text: string) => Promise<number[]>,
): Promise<BoundaryEmbeddings> {
  const result: BoundaryEmbeddings = {};

  for (const [pov, strings] of Object.entries(boundaries)) {
    const vectors: number[][] = [];
    for (const s of strings) {
      try {
        const vec = await embedFn(s.replace(/^REJECT:\s*/i, ''));
        if (vec && vec.length > 0) vectors.push(vec);
      } catch { /* embedding failure silently skipped */ }
    }
    result[pov] = vectors;
  }

  return result;
}

// ── Anchoring computation ───────────────────────────────

export interface AnchoringResult {
  nodeId: string;
  anchored: boolean;
  maxSimilarity: number;
  /** Which boundary string index produced the max similarity. */
  bestBoundaryIndex: number;
  /** Whether confidence floor was applied. */
  floorApplied: boolean;
  /** Original evidential confidence (before floor). */
  evidentialConfidence?: number;
}

/**
 * Compute doctrinal anchoring for a set of Belief nodes against their POV's boundary embeddings.
 * Mutates nodes in place: sets doctrinally_anchored, evidential_confidence, and adjusts confidence.
 *
 * @param nodes - Belief nodes from a single POV
 * @param boundaryVectors - Boundary embeddings for this POV
 * @param nodeEmbeddings - Taxonomy node embeddings (keyed by node ID)
 * @param boundaryWeights - Per-boundary weight (hardcoded=1.0, softcoded=0.7). Scales similarity.
 * @param config - Threshold and floor configuration
 */
export function computeDoctrinalAnchoring(
  nodes: PovNode[],
  boundaryVectors: number[][],
  nodeEmbeddings: Record<string, { pov: string; vector: number[] }>,
  boundaryWeights?: number[],
  config: DoctrinalAnchoringConfig = DEFAULT_ANCHORING_CONFIG,
): AnchoringResult[] {
  const results: AnchoringResult[] = [];

  if (boundaryVectors.length === 0) return results;

  for (const node of nodes) {
    if (node.category !== 'Beliefs') continue;

    const nodeEmb = nodeEmbeddings[node.id];
    if (!nodeEmb?.vector || nodeEmb.vector.length === 0) {
      results.push({
        nodeId: node.id, anchored: false, maxSimilarity: 0,
        bestBoundaryIndex: -1, floorApplied: false,
      });
      continue;
    }

    // Find max weighted cosine similarity against all boundary embeddings
    let maxSim = -1;
    let bestIdx = -1;
    for (let i = 0; i < boundaryVectors.length; i++) {
      const raw = cosineSimilarity(nodeEmb.vector, boundaryVectors[i]);
      const weight = boundaryWeights?.[i] ?? 1.0;
      const sim = raw * weight;
      if (sim > maxSim) {
        maxSim = sim;
        bestIdx = i;
      }
    }

    const anchored = maxSim >= config.threshold;
    node.doctrinally_anchored = anchored || undefined; // only set if true

    let floorApplied = false;
    if (anchored && node.confidence !== undefined && node.confidence < config.confidenceFloor) {
      node.evidential_confidence = node.confidence;
      node.confidence = config.confidenceFloor;
      floorApplied = true;
    }

    results.push({
      nodeId: node.id,
      anchored,
      maxSimilarity: maxSim,
      bestBoundaryIndex: bestIdx,
      floorApplied,
      evidentialConfidence: floorApplied ? node.evidential_confidence : undefined,
    });
  }

  return results;
}

// ── Calibration report ──────────────────────────────────

export interface CalibrationRow {
  threshold: number;
  counts: Record<string, number>; // POV → anchored count
  totalBeliefs: Record<string, number>; // POV → total Beliefs
  percentages: Record<string, number>; // POV → percentage anchored
}

/**
 * Run a calibration dry-run at multiple thresholds.
 * Reports how many Beliefs per POV would be anchored at each threshold.
 */
export function calibrateDoctrinalThresholds(
  povNodes: Record<string, PovNode[]>,
  boundaryEmbeddings: BoundaryEmbeddings,
  nodeEmbeddings: Record<string, { pov: string; vector: number[] }>,
  thresholds: number[] = [0.45, 0.50, 0.55, 0.60],
): CalibrationRow[] {
  const rows: CalibrationRow[] = [];

  for (const threshold of thresholds) {
    const counts: Record<string, number> = {};
    const totalBeliefs: Record<string, number> = {};
    const percentages: Record<string, number> = {};

    for (const [pov, nodes] of Object.entries(povNodes)) {
      const beliefs = nodes.filter(n => n.category === 'Beliefs');
      totalBeliefs[pov] = beliefs.length;

      const boundaryVecs = boundaryEmbeddings[pov] ?? [];
      if (boundaryVecs.length === 0) {
        counts[pov] = 0;
        percentages[pov] = 0;
        continue;
      }

      let anchoredCount = 0;
      for (const node of beliefs) {
        const nodeEmb = nodeEmbeddings[node.id];
        if (!nodeEmb?.vector || nodeEmb.vector.length === 0) continue;

        let maxSim = -1;
        for (const bVec of boundaryVecs) {
          const sim = cosineSimilarity(nodeEmb.vector, bVec);
          if (sim > maxSim) maxSim = sim;
        }
        if (maxSim >= threshold) anchoredCount++;
      }

      counts[pov] = anchoredCount;
      percentages[pov] = beliefs.length > 0 ? Math.round((anchoredCount / beliefs.length) * 100) : 0;
    }

    rows.push({ threshold, counts, totalBeliefs, percentages });
  }

  return rows;
}

/**
 * Check for threshold anomalies: warn if <3 or >30% anchored per POV.
 */
export function checkThresholdAnomalies(
  results: AnchoringResult[],
  totalBeliefs: number,
): { warning: string } | null {
  const anchoredCount = results.filter(r => r.anchored).length;
  const pct = totalBeliefs > 0 ? anchoredCount / totalBeliefs : 0;

  if (anchoredCount < 3) {
    return { warning: `[doctrinal.threshold-anomaly] Only ${anchoredCount} Beliefs anchored (<3) — threshold may be too high` };
  }
  if (pct > 0.30) {
    return { warning: `[doctrinal.threshold-anomaly] ${anchoredCount}/${totalBeliefs} (${(pct * 100).toFixed(0)}%) Beliefs anchored (>30%) — threshold may be too low` };
  }
  return null;
}
