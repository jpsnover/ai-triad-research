// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared situation scoring components used by both pre-debate ranking
 * (situation_wisdom_potential) and mid-debate re-scoring (reScoreSituationsForCruxes).
 *
 * Design: t/35#1 — five shared components, context-specific weights.
 */

import type { SituationNode, Category } from './taxonomyTypes.js';
import { cosineSimilarity } from './taxonomyRelevance.js';

// ── Shared component interface ──────────────────────────────

export interface SituationScoreComponents {
  /** Embedding-based relevance (0-1). Computation differs by context. */
  relevance: number;
  /** Disagreement type diversity (0-1). Shannon entropy of disagreement types. */
  diversity: number;
  /** Freshness (0-1). Inverse of prior coverage/staleness. */
  freshness: number;
  /** BDI heterogeneity (0-1). Entropy of linked B/D/I distribution. */
  bdi_entropy: number;
  /** Conflict openness (0-1). Fraction of linked conflicts unresolved or low-margin. */
  conflict_openness: number;
}

export interface SituationScoringWeights {
  relevance: number;
  diversity: number;
  freshness: number;
  bdi_entropy: number;
  conflict_openness: number;
}

/** Pre-debate weights — selecting which situations are worth debating. */
export const PRE_DEBATE_WEIGHTS: SituationScoringWeights = {
  relevance: 0.30,
  diversity: 0.10,
  freshness: 0.15,
  bdi_entropy: 0.20,
  conflict_openness: 0.25,
};

/** Mid-debate weights — re-ranking for context injection based on emerging cruxes. */
export const MID_DEBATE_WEIGHTS: SituationScoringWeights = {
  relevance: 0.50,
  diversity: 0.15,
  freshness: 0.20,
  bdi_entropy: 0.05,
  conflict_openness: 0.10,
};

// ── Weighted scoring ────────────────────────────────────────

export function weightedSituationScore(
  components: SituationScoreComponents,
  weights: SituationScoringWeights,
): number {
  return (
    components.relevance * weights.relevance +
    components.diversity * weights.diversity +
    components.freshness * weights.freshness +
    components.bdi_entropy * weights.bdi_entropy +
    components.conflict_openness * weights.conflict_openness
  );
}

// ── Shared component computations ───────────────────────────

/**
 * Compute diversity component for a situation.
 * Returns 1.0 if the situation's disagreement_type is underrepresented,
 * 0.0 otherwise. When computing for a set, pass the types already present.
 */
export function computeDiversityComponent(
  situation: Pick<SituationNode, 'disagreement_type'>,
  presentTypes: ReadonlySet<string>,
): number {
  if (!situation.disagreement_type) return 0;
  // All 3 types already covered — no diversity bonus
  if (presentTypes.size >= 3) return 0;
  // This situation adds a missing type
  return presentTypes.has(situation.disagreement_type) ? 0 : 1;
}

/**
 * Compute BDI entropy of linked taxonomy nodes.
 * Normalized Shannon entropy: 0 = all nodes in one category, 1 = even spread across B/D/I.
 */
export function computeBdiEntropy(
  linkedNodeIds: readonly string[],
  nodeCategoryLookup: ReadonlyMap<string, Category>,
): number {
  if (linkedNodeIds.length === 0) return 0;

  const counts: Record<string, number> = {};
  let total = 0;
  for (const nodeId of linkedNodeIds) {
    const cat = nodeCategoryLookup.get(nodeId) ?? 'Intentions';
    counts[cat] = (counts[cat] ?? 0) + 1;
    total++;
  }

  if (total === 0) return 0;
  const maxEntropy = Math.log2(3); // 3 BDI categories

  let entropy = 0;
  for (const count of Object.values(counts)) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Compute freshness for mid-debate context: 0 if injected but never referenced, 1 otherwise.
 */
export function computeMidDebateFreshness(
  situationId: string,
  injectedSitIds: ReadonlySet<string>,
  referencedSitIds: ReadonlySet<string>,
): number {
  if (injectedSitIds.has(situationId) && !referencedSitIds.has(situationId)) {
    return 0;
  }
  return 1;
}

/**
 * Compute freshness for pre-debate ranking: inverse of debate coverage.
 * Situations that have been debated many times have lower freshness.
 */
export function computePreDebateFreshness(
  situation: Pick<SituationNode, 'debate_refs'>,
  maxDebateCount: number,
): number {
  const debateCount = situation.debate_refs?.length ?? 0;
  if (maxDebateCount <= 0) return 1;
  return 1 - Math.min(debateCount / maxDebateCount, 1);
}

/**
 * Compute relevance via max cosine similarity to a set of claim embeddings.
 * Used by mid-debate re-scoring (crux alignment).
 */
export function computeCruxRelevance(
  situationEmbedding: number[] | undefined,
  claimEmbeddings: readonly { vector: number[] }[],
): number {
  if (!situationEmbedding || situationEmbedding.length === 0 || claimEmbeddings.length === 0) {
    return 0;
  }
  let maxSim = 0;
  for (const claim of claimEmbeddings) {
    const sim = cosineSimilarity(situationEmbedding, claim.vector);
    if (sim > maxSim) maxSim = sim;
  }
  return maxSim;
}

/**
 * Compute conflict openness: fraction of linked conflicts that are unresolved.
 * Used by pre-debate ranking.
 */
export function computeConflictOpenness(
  conflictIds: readonly string[],
  resolvedConflictIds: ReadonlySet<string>,
): number {
  if (conflictIds.length === 0) return 0;
  let unresolved = 0;
  for (const id of conflictIds) {
    if (!resolvedConflictIds.has(id)) unresolved++;
  }
  return unresolved / conflictIds.length;
}
