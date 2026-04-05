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

import { cosineSimilarity } from './taxonomyRelevance';
import type { DocumentINode, ArgumentNetworkNode, ClaimCoverageEntry } from './types';

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
  /** Cosine similarity threshold for considering a claim "discussed". Default: 0.65. */
  threshold?: number;
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
  const threshold = options?.threshold ?? 0.65;

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
  const threshold = options?.threshold ?? 0.65;

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
