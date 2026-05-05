// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Coverage tracking engine — matches argument network nodes to source
 * document claims via embedding cosine similarity.
 *
 * Determines which source claims have been discussed in the debate
 * and which remain uncovered. Feeds the coverage badge (t/175)
 * and sidebar panel (t/176).
 */

import { cosineSimilarity } from './taxonomyRelevance.js';
import { ActionableError } from './errors.js';
import type { DocumentINode, ArgumentNetworkNode, ArgumentNetworkEdge, ClaimCoverageEntry } from './types.js';
import { computeQbafStrengths } from './qbaf.js';
import type { QbafNode, QbafEdge } from './qbaf.js';
import { loadProvisionalWeights } from './phaseTransitions.js';

// ── Types ─────────────────────────────────────────────────

export interface CoverageResult {
  /** Per-source-claim coverage entries. */
  entries: ClaimCoverageEntry[];
  /** Ratio of discussed claims to total source claims (0-1). */
  coverage_ratio: number;
  /** Number of discussed claims. */
  discussed_count: number;
  /** Total source claims. */
  total_count: number;
}

export interface CoverageOptions {
  /** Cosine similarity threshold for considering a claim "discussed". Default from provisional-weights.json. */
  threshold?: number;
}

/** Load coverage thresholds from provisional-weights.json, falling back to defaults. */
function getCoverageDefaults(): { discussed: number; covered: number; partial: number } {
  const w = loadProvisionalWeights() as Record<string, unknown>;
  const cov = (w as { coverage?: { discussed_threshold?: number; covered_threshold?: number; partial_threshold?: number } }).coverage;
  return {
    discussed: cov?.discussed_threshold ?? 0.65,
    covered: cov?.covered_threshold ?? 0.50,
    partial: cov?.partial_threshold ?? 0.30,
  };
}

/** Tri-state coverage status for richer reporting (CT-1). */
export type CoverageStatus = 'covered' | 'uncovered' | 'partially_covered';

/** Per-claim coverage detail with tri-state status and matched AN node IDs. */
export interface CoverageMapEntry {
  claimId: string;
  status: CoverageStatus;
  /** AN node IDs that matched above the partial threshold. */
  matchedAnNodes: string[];
  /** Highest similarity score among all AN nodes. */
  similarity: number;
}

/** Full coverage map with per-claim detail and aggregate stats (CT-1). */
export interface CoverageMap {
  documentClaims: Array<{ id: string; text: string }>;
  coverage: CoverageMapEntry[];
  stats: {
    totalClaims: number;
    coveredCount: number;
    partiallyCoveredCount: number;
    uncoveredCount: number;
    coveragePercentage: number;
  };
}

export interface CoverageMapOptions {
  /** Similarity above this = partially_covered. Default: 0.3. */
  partialThreshold?: number;
  /** Similarity above this = covered. Default: 0.5. */
  coveredThreshold?: number;
}

// ── Engine ────────────────────────────────────────────────

/**
 * Compute coverage: match each source document claim against all AN nodes
 * using cosine similarity of their embedding vectors.
 *
 * @param sourceClaims - Document i-nodes with embedding vectors
 * @param anNodes - Argument network nodes with embedding vectors
 * @param sourceVectors - Map of source claim ID → embedding vector
 * @param anVectors - Map of AN node ID → embedding vector
 * @param options - Coverage options (threshold)
 * @returns Coverage result with per-claim entries and aggregate ratio
 */
export function computeCoverage(
  sourceClaims: DocumentINode[],
  anNodes: ArgumentNetworkNode[],
  sourceVectors: Map<string, number[]>,
  anVectors: Map<string, number[]>,
  options?: CoverageOptions,
): CoverageResult {
  const threshold = options?.threshold ?? getCoverageDefaults().discussed;

  const entries: ClaimCoverageEntry[] = [];

  for (const claim of sourceClaims) {
    const claimVec = sourceVectors.get(claim.id);
    if (!claimVec) {
      // No embedding for this claim — mark undiscussed with score 0
      entries.push({ claim_id: claim.id, discussed: false, best_match_score: 0 });
      continue;
    }

    let bestScore = 0;
    let bestNodeId: string | undefined;

    for (const node of anNodes) {
      const nodeVec = anVectors.get(node.id);
      if (!nodeVec) continue;

      const score = cosineSimilarity(claimVec, nodeVec);
      if (score > bestScore) {
        bestScore = score;
        bestNodeId = node.id;
      }
    }

    const discussed = bestScore >= threshold;
    entries.push({
      claim_id: claim.id,
      discussed,
      best_match_score: bestScore,
      matched_an_node: discussed ? bestNodeId : undefined,
    });
  }

  const discussedCount = entries.filter(e => e.discussed).length;
  const totalCount = entries.length;

  return {
    entries,
    coverage_ratio: totalCount > 0 ? discussedCount / totalCount : 0,
    discussed_count: discussedCount,
    total_count: totalCount,
  };
}

/**
 * Compute coverage using text overlap as a fallback when embeddings
 * are not available. Uses word-level Jaccard similarity.
 */
export function computeCoverageByTextOverlap(
  sourceClaims: DocumentINode[],
  anNodes: ArgumentNetworkNode[],
  options?: CoverageOptions,
): CoverageResult {
  const threshold = options?.threshold ?? getCoverageDefaults().discussed;

  const entries: ClaimCoverageEntry[] = [];

  for (const claim of sourceClaims) {
    const claimWords = tokenize(claim.text);
    let bestScore = 0;
    let bestNodeId: string | undefined;

    for (const node of anNodes) {
      const nodeWords = tokenize(node.text);
      const score = jaccardSimilarity(claimWords, nodeWords);
      if (score > bestScore) {
        bestScore = score;
        bestNodeId = node.id;
      }
    }

    const discussed = bestScore >= threshold;
    entries.push({
      claim_id: claim.id,
      discussed,
      best_match_score: bestScore,
      matched_an_node: discussed ? bestNodeId : undefined,
    });
  }

  const discussedCount = entries.filter(e => e.discussed).length;
  const totalCount = entries.length;

  return {
    entries,
    coverage_ratio: totalCount > 0 ? discussedCount / totalCount : 0,
    discussed_count: discussedCount,
    total_count: totalCount,
  };
}

// ── Tri-state coverage engine (CT-1) ──────────────────────

/**
 * Compute a tri-state coverage map matching AN nodes to source document claims
 * using word-level Jaccard similarity.
 *
 * Thresholds:
 * - > coveredThreshold (default 0.5) → 'covered'
 * - > partialThreshold (default 0.3) → 'partially_covered'
 * - otherwise → 'uncovered'
 *
 * All AN nodes above the partial threshold are included in matchedAnNodes,
 * not just the best match — so consumers can see every relevant debate turn.
 *
 * @param anNodes - Argument network nodes from the debate
 * @param documentClaims - Source document claims (id + text pairs)
 * @param options - Threshold overrides
 * @returns CoverageMap with per-claim status and aggregate stats
 */
export function computeCoverageMap(
  anNodes: ArgumentNetworkNode[],
  documentClaims: Array<{ id: string; text: string }>,
  options?: CoverageMapOptions,
): CoverageMap {
  const defaults = getCoverageDefaults();
  const partialThreshold = options?.partialThreshold ?? defaults.partial;
  const coveredThreshold = options?.coveredThreshold ?? defaults.covered;

  if (coveredThreshold <= partialThreshold) {
    throw new ActionableError({
      goal: 'Compute debate coverage map',
      problem: `coveredThreshold (${coveredThreshold}) must be greater than partialThreshold (${partialThreshold})`,
      location: 'coverageTracker.computeCoverageMap',
      nextSteps: [
        'Ensure coveredThreshold > partialThreshold in CoverageMapOptions',
        'Defaults are partialThreshold=0.3, coveredThreshold=0.5',
      ],
    });
  }

  // Pre-tokenize AN nodes once (avoid re-tokenizing per claim)
  const anTokenSets = anNodes.map(n => ({ id: n.id, tokens: tokenize(n.text) }));

  const coverage: CoverageMapEntry[] = [];

  for (const claim of documentClaims) {
    const claimTokens = tokenize(claim.text);
    let bestScore = 0;
    const matchedAnNodes: string[] = [];

    for (const an of anTokenSets) {
      const score = jaccardSimilarity(claimTokens, an.tokens);
      if (score > bestScore) bestScore = score;
      if (score >= partialThreshold) matchedAnNodes.push(an.id);
    }

    let status: CoverageStatus;
    if (bestScore >= coveredThreshold) {
      status = 'covered';
    } else if (bestScore >= partialThreshold) {
      status = 'partially_covered';
    } else {
      status = 'uncovered';
    }

    coverage.push({
      claimId: claim.id,
      status,
      matchedAnNodes,
      similarity: bestScore,
    });
  }

  const coveredCount = coverage.filter(c => c.status === 'covered').length;
  const partiallyCoveredCount = coverage.filter(c => c.status === 'partially_covered').length;
  const uncoveredCount = coverage.filter(c => c.status === 'uncovered').length;
  const totalClaims = coverage.length;

  return {
    documentClaims,
    coverage,
    stats: {
      totalClaims,
      coveredCount,
      partiallyCoveredCount,
      uncoveredCount,
      coveragePercentage: totalClaims > 0
        ? ((coveredCount + partiallyCoveredCount * 0.5) / totalClaims) * 100
        : 0,
    },
  };
}

// ── Strength-weighted coverage (CT-11) ───────────────────

export interface StrengthWeightedCoverage {
  /** Raw coverage % (same as CoverageMap.stats.coveragePercentage). */
  raw_coverage: number;
  /** Coverage weighted by QBAF computed_strength of matched AN nodes.
   *  Uncovered claims are weighted at 1.0 (conservative: assumed load-bearing). */
  strength_weighted_coverage: number;
  /** Gap between raw and weighted — large positive gap means debate avoided the hard arguments. */
  coverage_gap: number;
  /** Per-claim strength weights for consumers that need drill-down. */
  claim_weights: Array<{ claimId: string; weight: number; status: CoverageStatus }>;
}

/**
 * Enrich a CoverageMap with QBAF strength-weighted coverage.
 *
 * For each source claim:
 * - Covered/partially covered: weight = computed_strength of best-matching AN node
 * - Uncovered: weight = 1.0 (conservative — treat as potentially load-bearing)
 *
 * The weighted metric answers: "what fraction of argumentative weight has been
 * engaged?" A debate can have 95% raw coverage but low strength-weighted coverage
 * if it only engaged weak claims and left the load-bearing arguments uncovered.
 */
export function computeStrengthWeightedCoverage(
  coverageMap: CoverageMap,
  anNodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
): StrengthWeightedCoverage {
  const qbafNodes: QbafNode[] = anNodes.map(n => ({
    id: n.id,
    base_strength: n.base_strength ?? 0.5,
  }));
  const qbafEdges: QbafEdge[] = edges.map(e => ({
    source: e.source,
    target: e.target,
    type: e.type as 'attacks' | 'supports',
    weight: e.weight ?? 0.5,
    attack_type: e.attack_type,
  }));
  const strengths = computeQbafStrengths(qbafNodes, qbafEdges).strengths;

  const anStrength = (nodeId: string): number => strengths.get(nodeId) ?? 0.5;

  const claimWeights: StrengthWeightedCoverage['claim_weights'] = [];
  let weightedCoveredSum = 0;
  let totalWeightSum = 0;

  for (const entry of coverageMap.coverage) {
    let weight: number;
    if (entry.status === 'uncovered') {
      weight = 1.0;
    } else {
      weight = Math.max(
        ...entry.matchedAnNodes.map(id => anStrength(id)),
        0.5,
      );
    }

    claimWeights.push({ claimId: entry.claimId, weight, status: entry.status });
    totalWeightSum += weight;

    if (entry.status === 'covered') {
      weightedCoveredSum += weight;
    } else if (entry.status === 'partially_covered') {
      weightedCoveredSum += weight * 0.5;
    }
  }

  const rawCoverage = coverageMap.stats.coveragePercentage;
  const strengthWeighted = totalWeightSum > 0
    ? (weightedCoveredSum / totalWeightSum) * 100
    : 0;

  return {
    raw_coverage: rawCoverage,
    strength_weighted_coverage: strengthWeighted,
    coverage_gap: rawCoverage - strengthWeighted,
    claim_weights: claimWeights,
  };
}

// ── Helpers ───────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}
