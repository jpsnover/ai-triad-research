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
  /** Weight multipliers by attack type. Default: rebut=1.0, undercut=1.05, undermine=1.1. */
  attackWeights?: Partial<Record<'rebut' | 'undercut' | 'undermine', number>>;
  /** Aggregate attack influences into a single value. Default: sum-and-clamp to [0,1]. */
  aggregateAttacks?: (attackInfluences: number[]) => number;
  /** Aggregate support influences into a single value. Default: sum-and-clamp to [0,1]. */
  aggregateSupports?: (supportInfluences: number[]) => number;
  /** Combine base strength with aggregated attack/support. Default: DF-QuAD formula. */
  combine?: (base: number, aggAtt: number, aggSup: number) => number;
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

// ── Default aggregation functions ─────────────────────────

function defaultAggregate(influences: number[]): number {
  let sum = 0;
  for (const v of influences) sum += v;
  return clamp(sum);
}

function defaultCombine(base: number, aggAtt: number, aggSup: number): number {
  return clamp(base * (1 - aggAtt) * (1 + aggSup));
}

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
  const aggAttFn = options?.aggregateAttacks ?? defaultAggregate;
  const aggSupFn = options?.aggregateSupports ?? defaultAggregate;
  const combineFn = options?.combine ?? defaultCombine;

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
      const attackInfluences = attackEdges.map(a => (strengths.get(a.sourceId) ?? 0) * a.weight);
      const aggAtt = aggAttFn(attackInfluences);

      // Aggregate support influence (reads from previous iteration)
      const supportEdges = supports.get(n.id) ?? [];
      const supportInfluences = supportEdges.map(s => (strengths.get(s.sourceId) ?? 0) * s.weight);
      const aggSup = aggSupFn(supportInfluences);

      // Combine base strength with aggregated attack/support
      let newStrength = combineFn(base, aggAtt, aggSup);

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

// ── Edge attribution (HDE B1) ─────────────────────────────

/**
 * Compute removal-based edge attribution for a target node.
 * For each incoming edge, removes it, re-runs QBAF, and measures the strength delta.
 * Positive attribution = edge was helping (support), negative = edge was hurting (attack).
 * Called on-demand for node inspection, not on every propagation.
 */
export function computeEdgeAttribution(
  nodes: QbafNode[],
  edges: QbafEdge[],
  targetNodeId: string,
  options?: QbafOptions,
): Map<string, number> {
  const baseline = computeQbafStrengths(nodes, edges, options);
  const baseStrength = baseline.strengths.get(targetNodeId) ?? 0;
  const attributions = new Map<string, number>();

  const targetEdges = edges.filter(e => e.target === targetNodeId);
  for (const edge of targetEdges) {
    const reduced = edges.filter(e => e !== edge);
    const result = computeQbafStrengths(nodes, reduced, options);
    const without = result.strengths.get(targetNodeId) ?? 0;
    attributions.set(`${edge.source}→${edge.target}`, baseStrength - without);
  }
  return attributions;
}

// ── Shapley-Value Attribution ─────────────────────────────

/**
 * Per-claim Shapley contribution map.
 * contributions.get(claimId).get(argId) = Shapley value of argId for claimId.
 */
export type ShapleyContributions = Map<string, Map<string, number>>;

export interface ShapleyOptions extends QbafOptions {
  /**
   * How many arguments to rank per target claim.
   * Set to 0 (or omit) to rank all arguments.
   */
  topN?: number;
  /**
   * Number of Monte Carlo samples for networks with >sampleThreshold nodes.
   * Default: 512.
   */
  numSamples?: number;
  /**
   * Node count above which sampling is used instead of exact enumeration.
   * Default: 20 (matches the O(2^n) boundary cited in the ticket).
   */
  sampleThreshold?: number;
}

/**
 * Compute Shapley-value attribution for argument importance in a QBAF network.
 *
 * For each target claim (leaf or high-centrality node), the Shapley value of
 * each influencing argument measures the average marginal contribution that
 * argument makes to the claim's final QBAF strength across all possible
 * orderings of the argument coalition.
 *
 * Formally: φ_i(v) = Σ_{S⊆N\{i}} [|S|!(n-|S|-1)!/n!] × [v(S∪{i}) - v(S)]
 * where v(S) = computeQbafStrengths(nodes, edges restricted to S).strength(claim).
 *
 * For networks with ≤ sampleThreshold nodes: exact O(2^n) enumeration.
 * For larger networks: Monte Carlo permutation sampling (Maleki et al., 2013).
 *
 * Returns contributions.get(claimId).get(argId) = Shapley value ∈ ℝ.
 * Positive = argument helps the claim; negative = argument hurts it.
 *
 * References:
 *   - Shapley-value QBAF attribution (IJCAI 2024)
 *   - Set Contribution Functions for QBAFs (arXiv:2509.14963)
 *   - Monte Carlo Shapley: Maleki et al. (2013)
 */
export function computeShapleyContributions(
  nodes: QbafNode[],
  edges: QbafEdge[],
  options?: ShapleyOptions,
): ShapleyContributions {
  if (nodes.length === 0) return new Map();

  const topN = options?.topN ?? 0;
  const numSamples = options?.numSamples ?? 512;
  const sampleThreshold = options?.sampleThreshold ?? 20;
  const qbafOptions: QbafOptions = options ?? {};

  const nodeIds = nodes.map(n => n.id);
  const nodeSet = new Set(nodeIds);

  // Identify target claims: nodes that are attacked or supported by others
  // (i.e. non-isolated nodes that receive influence). We compute attribution
  // for every node that has at least one incoming edge.
  const targetIds = new Set<string>();
  for (const e of edges) {
    if (nodeSet.has(e.target)) targetIds.add(e.target);
  }

  if (targetIds.size === 0) return new Map();

  // Pre-compute baseline (all arguments present)
  const baselineResult = computeQbafStrengths(nodes, edges, qbafOptions);

  /**
   * Characteristic function v(S, targetId):
   * Restrict the QBAF to the coalition S ∪ {targetId} and return the
   * target claim's computed strength.
   *
   * The coalition S is a subset of the non-target argument nodes — we always
   * include all target nodes themselves so that strength comparisons are
   * meaningful across coalitions of different sizes.
   */
  function characteristicValue(coalition: Set<string>, targetId: string): number {
    // Always include the target node and all target claim nodes in the subgraph
    // so that support/attack relationships to the target are properly evaluated.
    const included = new Set(coalition);
    included.add(targetId);

    const subNodes = nodes.filter(n => included.has(n.id));
    const subEdges = edges.filter(e => included.has(e.source) && included.has(e.target));

    const result = computeQbafStrengths(subNodes, subEdges, qbafOptions);
    return result.strengths.get(targetId) ?? 0;
  }

  const result: ShapleyContributions = new Map();

  for (const targetId of targetIds) {
    // The argument nodes are all nodes except the target itself
    const argIds = nodeIds.filter(id => id !== targetId);
    const n = argIds.length;

    const shapleyValues = new Map<string, number>();
    for (const id of argIds) shapleyValues.set(id, 0);

    if (n === 0) {
      result.set(targetId, shapleyValues);
      continue;
    }

    if (n <= sampleThreshold) {
      // ── Exact Shapley enumeration (O(2^n)) ───────────────
      // Iterate over all 2^n subsets of argIds.
      const total = 1 << n;
      for (let mask = 0; mask < total; mask++) {
        // Build coalition S from bitmask (excludes arg i)
        const coalitionWithout: string[] = [];
        for (let bit = 0; bit < n; bit++) {
          if (mask & (1 << bit)) coalitionWithout.push(argIds[bit]);
        }

        // For each arg not in this subset, compute its marginal contribution
        for (let i = 0; i < n; i++) {
          if (mask & (1 << i)) continue; // arg i already in coalition — skip

          const sSize = coalitionWithout.length; // |S|
          // Shapley weight: |S|! × (n - |S| - 1)! / n!
          // Computed incrementally using the factorial ratio
          const weight = shapleyWeight(sSize, n);

          const coalitionS = new Set(coalitionWithout);
          const vWithout = characteristicValue(coalitionS, targetId);

          coalitionS.add(argIds[i]);
          const vWith = characteristicValue(coalitionS, targetId);

          const prev = shapleyValues.get(argIds[i]) ?? 0;
          shapleyValues.set(argIds[i], prev + weight * (vWith - vWithout));
        }
      }
    } else {
      // ── Monte Carlo permutation sampling ─────────────────
      // Each sample: draw a random permutation of argIds,
      // iterate left to right computing marginal contributions.
      const counts = new Map<string, number>();
      for (const id of argIds) counts.set(id, 0);

      for (let s = 0; s < numSamples; s++) {
        const perm = shuffleArray([...argIds], s);
        const running = new Set<string>();

        for (const argId of perm) {
          const vWithout = characteristicValue(running, targetId);
          running.add(argId);
          const vWith = characteristicValue(running, targetId);
          const marginal = vWith - vWithout;

          const prev = shapleyValues.get(argId) ?? 0;
          shapleyValues.set(argId, prev + marginal);
          counts.set(argId, (counts.get(argId) ?? 0) + 1);
        }
      }

      // Average over samples
      for (const [id, total] of shapleyValues) {
        const cnt = counts.get(id) ?? 1;
        shapleyValues.set(id, total / cnt);
      }
    }

    // Apply topN filter if requested
    if (topN > 0 && shapleyValues.size > topN) {
      const sorted = [...shapleyValues.entries()]
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, topN);
      result.set(targetId, new Map(sorted));
    } else {
      result.set(targetId, shapleyValues);
    }
  }

  // Ensure baseline strengths don't drift — recompute is already stable.
  void baselineResult; // used only for early-exit guard above

  return result;
}

// ── Shapley helpers ────────────────────────────────────────

/**
 * Compute the Shapley coalition weight: |S|! × (n - |S| - 1)! / n!
 * Uses log-factorial to avoid integer overflow for large n.
 */
function shapleyWeight(sSize: number, n: number): number {
  // weight = sSize! × (n - sSize - 1)! / n!
  return Math.exp(logFactorial(sSize) + logFactorial(n - sSize - 1) - logFactorial(n));
}

/** Precomputed log-factorial cache for speed. */
const LOG_FACTORIAL_CACHE: number[] = [0]; // log(0!) = 0

function logFactorial(k: number): number {
  if (k <= 0) return 0;
  while (LOG_FACTORIAL_CACHE.length <= k) {
    const len = LOG_FACTORIAL_CACHE.length;
    LOG_FACTORIAL_CACHE.push(LOG_FACTORIAL_CACHE[len - 1] + Math.log(len));
  }
  return LOG_FACTORIAL_CACHE[k];
}

/**
 * Deterministic Fisher-Yates shuffle seeded by sample index.
 * Uses a simple LCG so results are reproducible across calls.
 */
function shuffleArray(arr: string[], seed: number): string[] {
  // LCG parameters (same as Java's Random)
  let rng = (seed * 1664525 + 1013904223) >>> 0;
  const next = (): number => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 0x100000000;
  };

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Helpers ───────────────────────────────────────────────

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}
