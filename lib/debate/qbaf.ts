// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * QBAF — Quantitative Bipolar Argumentation Framework.
 * Implements DF-QuAD (Discontinuity-Free Quantitative Argumentation Debate)
 * gradual semantics for computing argument acceptability strengths.
 */

// ── Types ─────────────────────────────────────────────────

export interface QbafNode {
  id: string;
  base_strength: number;
}

export interface QbafEdge {
  source: string;
  target: string;
  type: 'supports' | 'attacks';
  weight: number;
  attack_type?: 'rebut' | 'undercut' | 'undermine';
}

export interface QbafOptions {
  /** Maximum iterations before forced termination. Default: 100. */
  maxIterations?: number;
  /** Convergence threshold — max delta between iterations. Default: 0.001. */
  convergenceThreshold?: number;
  /** Weight multipliers by attack type. Default: rebut=1.0, undercut=1.1, undermine=1.2. */
  attackWeights?: Partial<Record<'rebut' | 'undercut' | 'undermine', number>>;
}

export interface QbafResult {
  strengths: Map<string, number>;
  iterations: number;
  converged: boolean;
  oscillationDetected?: boolean;
}

// ── Default attack type weights ───────────────────────────

const DEFAULT_ATTACK_WEIGHTS: Record<string, number> = {
  rebut: 1.0,
  undercut: 1.05,
  undermine: 1.1,
};

// ── DF-QuAD Engine ────────────────────────────────────────

/**
 * Compute QBAF acceptability strengths using DF-QuAD gradual semantics.
 *
 * For each node v:
 *   σ(v) = τ(v) × (1 - aggAtt) × (1 + aggSup)
 *   clamped to [0, 1]
 *
 * where:
 *   τ(v) = base strength
 *   aggAtt = Σ (σ(attacker) × edge_weight × attack_type_multiplier), clamped to [0, 1]
 *   aggSup = Σ (σ(supporter) × edge_weight), clamped to [0, 1]
 *
 * Iterates until convergence or maxIterations.
 */
export function computeQbafStrengths(
  nodes: QbafNode[],
  edges: QbafEdge[],
  options?: QbafOptions,
): QbafResult {
  const maxIter = options?.maxIterations ?? 100;
  const threshold = options?.convergenceThreshold ?? 0.001;
  const atkWeights = { ...DEFAULT_ATTACK_WEIGHTS, ...options?.attackWeights };

  if (nodes.length === 0) {
    return { strengths: new Map(), iterations: 0, converged: true };
  }

  // Initialize strengths to base_strength
  const strengths = new Map<string, number>();
  for (const n of nodes) {
    strengths.set(n.id, clamp(n.base_strength));
  }

  // Build adjacency: target → incoming edges
  const attacks = new Map<string, { sourceId: string; weight: number }[]>();
  const supports = new Map<string, { sourceId: string; weight: number }[]>();

  for (const e of edges) {
    // Skip edges referencing unknown nodes
    if (!strengths.has(e.source) || !strengths.has(e.target)) continue;

    const effectiveWeight = e.type === 'attacks'
      ? e.weight * (atkWeights[e.attack_type ?? 'rebut'] ?? 1.0)
      : e.weight;

    const map = e.type === 'attacks' ? attacks : supports;
    if (!map.has(e.target)) map.set(e.target, []);
    map.get(e.target)!.push({ sourceId: e.source, weight: effectiveWeight });
  }

  // Iterate until convergence (Jacobi-style: all nodes read from previous iteration)
  let converged = false;
  let iterations = 0;
  let priorDelta = Infinity;
  let oscillationCount = 0;
  let damping = 0; // 0 = no damping, activates on oscillation

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    let maxDelta = 0;
    const nextStrengths = new Map<string, number>();

    for (const n of nodes) {
      const base = clamp(n.base_strength);

      // Aggregate attack influence (reads from previous iteration)
      const attackEdges = attacks.get(n.id) ?? [];
      let aggAtt = 0;
      for (const a of attackEdges) {
        aggAtt += (strengths.get(a.sourceId) ?? 0) * a.weight;
      }
      aggAtt = clamp(aggAtt);

      // Aggregate support influence (reads from previous iteration)
      const supportEdges = supports.get(n.id) ?? [];
      let aggSup = 0;
      for (const s of supportEdges) {
        aggSup += (strengths.get(s.sourceId) ?? 0) * s.weight;
      }
      aggSup = clamp(aggSup);

      // DF-QuAD update rule
      let newStrength = clamp(base * (1 - aggAtt) * (1 + aggSup));

      // Apply damping if oscillation detected
      if (damping > 0) {
        const prev = strengths.get(n.id) ?? 0;
        newStrength = (1 - damping) * newStrength + damping * prev;
      }

      const delta = Math.abs(newStrength - (strengths.get(n.id) ?? 0));
      if (delta > maxDelta) maxDelta = delta;
      nextStrengths.set(n.id, newStrength);
    }

    // Bulk update (Jacobi: apply all changes after computing all nodes)
    for (const [id, val] of nextStrengths) strengths.set(id, val);

    if (maxDelta < threshold) {
      converged = true;
      break;
    }

    // Oscillation detection: if max_delta isn't decreasing, count it
    if (maxDelta > priorDelta * 0.95) {
      oscillationCount++;
    } else {
      oscillationCount = 0;
    }
    priorDelta = maxDelta;

    // Activate damping after 3 consecutive non-decreasing iterations
    if (oscillationCount >= 3 && damping === 0) {
      damping = 0.3;
    }
  }

  return { strengths, iterations, converged, oscillationDetected: damping > 0 };
}

// ── Convergence integration ───────────────────────────────

/**
 * Compute QBAF-based convergence for a set of claim IDs.
 * Returns the average computed_strength of the claims.
 * Higher = stronger disagreement (claims are well-supported on both sides).
 * Returns undefined if no claim has a computed strength.
 */
export function computeQbafConvergence(
  claimIds: string[],
  strengths: Map<string, number>,
): number | undefined {
  const scores = claimIds
    .map(id => strengths.get(id))
    .filter((s): s is number => s !== undefined);
  if (scores.length === 0) return undefined;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

// ── Fact-check QBAF integration ───────────────────────────

export interface WebEvidenceItem {
  id: string;
  text: string;
  /** Does this evidence support or contradict the checked claim? */
  relation: 'supports' | 'attacks';
  /** Source reliability (0-1). Higher for authoritative sources. */
  source_reliability: number;
  /** How relevant this evidence is to the claim (0-1). */
  relevance: number;
}

export interface FactCheckQbafResult {
  /** Final claim strength after incorporating web evidence (0-1). */
  adjusted_strength: number;
  /** Original claim strength before web evidence. */
  original_strength: number;
  /** Number of supporting vs attacking evidence items. */
  support_count: number;
  attack_count: number;
  /** QBAF computation details. */
  qbaf: QbafResult;
}

/**
 * Compute QBAF-adjusted claim strength incorporating web evidence.
 * Models the claim as a QBAF node, web evidence as supporting/attacking nodes,
 * and runs DF-QuAD to get the adjusted strength.
 */
export function computeFactCheckStrength(
  claimBaseStrength: number,
  evidence: WebEvidenceItem[],
): FactCheckQbafResult {
  const claimNode: QbafNode = { id: 'claim', base_strength: claimBaseStrength };
  const nodes: QbafNode[] = [claimNode];
  const edges: QbafEdge[] = [];

  for (const e of evidence) {
    // Evidence node strength = source_reliability × relevance
    const evidenceStrength = clamp(e.source_reliability * e.relevance);
    nodes.push({ id: e.id, base_strength: evidenceStrength });
    edges.push({
      source: e.id,
      target: 'claim',
      type: e.relation,
      weight: e.relevance,
    });
  }

  const qbaf = computeQbafStrengths(nodes, edges);

  return {
    adjusted_strength: qbaf.strengths.get('claim') ?? claimBaseStrength,
    original_strength: claimBaseStrength,
    support_count: evidence.filter(e => e.relation === 'supports').length,
    attack_count: evidence.filter(e => e.relation === 'attacks').length,
    qbaf,
  };
}

// ── Helpers ───────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
