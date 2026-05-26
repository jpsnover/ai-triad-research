// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Compute relevance scores for taxonomy nodes against a debate context.
 * Uses embedding cosine similarity to select the most relevant nodes
 * for each debater's prompt.
 */

import type { PovNode, SituationNode } from './taxonomyTypes.js';
import type { TrackedCrux, ArgumentNetworkNode } from './types.js';

export interface NodeRelevanceScore {
  nodeId: string;
  score: number;
}

export interface ScoredPovNode {
  node: PovNode;
  score: number;
}

export interface ScoredSituationNode {
  node: SituationNode;
  score: number;
}

export interface RelevanceOptions {
  threshold?: number;
  embeddingThreshold?: number;
  lexicalThreshold?: number;
  minPerCategory?: number;
  maxTotal?: number;
  scoringMode?: 'embedding' | 'lexical';
  /** Optional lineage boost configuration — promotes nodes matching the debate's intellectual traditions. */
  lineageBoost?: LineageBoostConfig;
}

export interface LineageBoostConfig {
  /** Level 2 cluster IDs from the debate's lineage_frame. */
  traditions: string[];
  /** Score boost for matching nodes (default 0.08). */
  boost: number;
  /** Per-node lineage: nodeId → lineage name list. */
  lineageByNode: Record<string, string[]>;
  /** Name-to-Level2-cluster mapping. */
  nameToCluster: Record<string, string>;
}

/** Result of applying lineage boost — for diagnostics logging. */
export interface LineageBoostResult {
  /** Node IDs that received a boost. */
  boostedNodeIds: string[];
  /** Node IDs that crossed the threshold thanks to the boost. */
  promotedNodeIds: string[];
  /** Number of nodes that crossed the threshold thanks to the boost. */
  promotedCount: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Compute relevance scores for all nodes against a query embedding.
 * Returns a Map of nodeId → similarity score.
 */
export function scoreNodeRelevance(
  queryVector: number[],
  nodeEmbeddings: Record<string, { pov: string; vector: number[] }>,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [nodeId, entry] of Object.entries(nodeEmbeddings)) {
    if (entry.vector && Array.isArray(entry.vector)) {
      scores.set(nodeId, cosineSimilarity(queryVector, entry.vector));
    }
  }
  return scores;
}

/**
 * Select relevant POV nodes for a debate based on similarity threshold.
 * Includes all nodes above the threshold, sorted by relevance.
 * A minimum of 3 per category is guaranteed even if below threshold.
 */
export function selectRelevantNodes(
  povNodes: PovNode[],
  scores: Map<string, number>,
  thresholdOrOpts: number | RelevanceOptions = 0.48,
  minPerCategory: number = 3,
  maxTotal?: number,
): ScoredPovNode[] {
  const opts = typeof thresholdOrOpts === 'number' ? { threshold: thresholdOrOpts } : thresholdOrOpts;
  const threshold = opts.threshold ?? (
    opts.scoringMode === 'lexical'
      ? (opts.lexicalThreshold ?? 0.22)
      : (opts.embeddingThreshold ?? 0.48)
  );
  minPerCategory = opts.minPerCategory ?? minPerCategory;
  maxTotal = opts.maxTotal ?? maxTotal;

  // Apply lineage boost if configured
  const effectiveScores = new Map(scores);
  let _lineageBoostResult: LineageBoostResult | undefined;
  if (opts.lineageBoost && opts.lineageBoost.traditions.length > 0) {
    const lb = opts.lineageBoost;
    const tradSet = new Set(lb.traditions);
    const boostedIds: string[] = [];
    const promotedIds: string[] = [];

    for (const node of povNodes) {
      const names = lb.lineageByNode[node.id];
      if (!names) continue;
      const matches = names.some(name => {
        const cluster = lb.nameToCluster[name];
        return cluster != null && tradSet.has(cluster);
      });
      if (matches) {
        const base = effectiveScores.get(node.id) ?? 0;
        // Only boost near-miss nodes (within 0.06 of threshold) — skip semantically weak ones
        if (base >= threshold - 0.06) {
          const boosted = base + lb.boost;
          effectiveScores.set(node.id, boosted);
          boostedIds.push(node.id);
          if (base < threshold && boosted >= threshold) promotedIds.push(node.id);
        }
      }
    }

    // Cap promotions: only the top 5 below→above-threshold nodes keep the boost
    const LINEAGE_PROMOTION_CAP = 5;
    if (promotedIds.length > LINEAGE_PROMOTION_CAP) {
      // Sort by boosted score descending — keep the best near-miss matches
      promotedIds.sort((a, b) => (effectiveScores.get(b) ?? 0) - (effectiveScores.get(a) ?? 0));
      const excess = promotedIds.splice(LINEAGE_PROMOTION_CAP);
      for (const id of excess) {
        // Revert to base score
        effectiveScores.set(id, (effectiveScores.get(id) ?? 0) - lb.boost);
        const bIdx = boostedIds.indexOf(id);
        if (bIdx >= 0) boostedIds.splice(bIdx, 1);
      }
    }

    _lineageBoostResult = { boostedNodeIds: boostedIds, promotedNodeIds: promotedIds, promotedCount: promotedIds.length };
  }

  // Group by category
  const groups: Record<string, ScoredPovNode[]> = {
    'Beliefs': [],
    'Desires': [],
    'Intentions': [],
  };

  for (const node of povNodes) {
    const cat = node.category || 'Intentions';
    const score = effectiveScores.get(node.id) || 0;
    (groups[cat] ?? groups['Intentions']).push({ node, score });
  }

  // For each category: include all above threshold, guarantee minimum
  const result: ScoredPovNode[] = [];
  for (const cat of ['Beliefs', 'Desires', 'Intentions']) {
    const sorted = groups[cat].sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
    const aboveThreshold = sorted.filter(s => s.score >= threshold);
    // Take at least minPerCategory, even if below threshold
    const selected = aboveThreshold.length >= minPerCategory
      ? aboveThreshold
      : sorted.slice(0, Math.max(minPerCategory, aboveThreshold.length));
    result.push(...selected);
  }

  // Stash diagnostics on the result array for callers that want it
  const sliced = maxTotal != null ? result.slice(0, maxTotal) : result;
  if (_lineageBoostResult) {
    (sliced as ScoredPovNode[] & { _lineageBoost?: LineageBoostResult })._lineageBoost = _lineageBoostResult;
  }
  return sliced;
}

/**
 * Select relevant situation nodes based on similarity threshold.
 */
export function selectRelevantSituationNodes(
  situationNodes: SituationNode[],
  scores: Map<string, number>,
  thresholdOrOpts: number | RelevanceOptions = 0.48,
  min: number = 3,
  max: number = 15,
): ScoredSituationNode[] {
  const opts = typeof thresholdOrOpts === 'number' ? { threshold: thresholdOrOpts } : thresholdOrOpts;
  const threshold = opts.threshold ?? (
    opts.scoringMode === 'lexical'
      ? (opts.lexicalThreshold ?? 0.22)
      : (opts.embeddingThreshold ?? 0.48)
  );
  const scored = situationNodes
    .map(n => ({ node: n, score: scores.get(n.id) || 0 }))
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));

  const aboveThreshold = scored.filter(s => s.score >= threshold);
  const selected = aboveThreshold.length >= min
    ? aboveThreshold
    : scored.slice(0, Math.max(min, aboveThreshold.length));

  return selected.slice(0, max);
}

/**
 * Lexical fallback for when no embedding adapter is available.
 * Scores nodes by normalized token overlap between the query and each node's
 * label+description. Output range is [0,1] per node; uses the same Map shape
 * as `scoreNodeRelevance` so downstream selection logic is interchangeable.
 *
 * This is worse than real embedding similarity but at least varies turn-over-turn
 * with the debate transcript, which the prior "first vector in the map" hack did not.
 */
const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'will', 'their', 'they',
  'there', 'which', 'what', 'when', 'where', 'because', 'these', 'those', 'about',
  'would', 'could', 'should', 'than', 'then', 'also', 'into', 'over', 'under',
  'such', 'some', 'been', 'being', 'other', 'more', 'most', 'just', 'like',
]);

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length >= 4 && !STOPWORDS.has(t)) tokens.add(t);
  }
  return tokens;
}

export function scoreNodesLexical(
  query: string,
  povNodes: ReadonlyArray<Pick<PovNode, 'id' | 'label' | 'description'>>,
  situationNodes: ReadonlyArray<Pick<SituationNode, 'id' | 'label' | 'description'>>,
): Map<string, number> {
  const q = tokenize(query);
  const scores = new Map<string, number>();
  if (q.size === 0) return scores;

  const score = (nodeId: string, text: string) => {
    const nodeTokens = tokenize(text);
    if (nodeTokens.size === 0) {
      scores.set(nodeId, 0);
      return;
    }
    let overlap = 0;
    for (const t of q) if (nodeTokens.has(t)) overlap++;
    // Normalize by geometric mean of sizes — favors real overlap without
    // over-rewarding short nodes that share one common word.
    const denom = Math.sqrt(q.size * nodeTokens.size);
    scores.set(nodeId, denom > 0 ? overlap / denom : 0);
  };

  for (const n of povNodes) {
    score(n.id, `${n.label} ${n.description}`);
  }
  for (const n of situationNodes) {
    score(n.id, `${n.label} ${n.description}`);
  }
  return scores;
}

/**
 * Build a query string from the debate context for embedding.
 * Combines topic + recent transcript for relevance scoring.
 */
export function buildRelevanceQuery(
  topic: string,
  recentTranscript: string,
  maxLength: number = 500,
): string {
  const combined = `${topic}\n\n${recentTranscript}`;
  return combined.length > maxLength ? combined.slice(0, maxLength) : combined;
}

// ── AN-based relevance scoring ──────────────────────────────────────

export interface ANClaimEmbedding {
  /** Argument network node ID (e.g., AN-3) */
  id: string;
  /** Pre-computed embedding vector */
  vector: number[];
  /** Optional QBAF computed strength — used to weight claim contribution */
  strength?: number;
}

/**
 * Score taxonomy nodes by maximum similarity to any argument network claim.
 *
 * Instead of one blended query embedding, this computes cosine similarity
 * between each node and each AN claim, then takes the max. Nodes that are
 * highly relevant to ANY active argument score high, even if they're
 * irrelevant to the debate topic in aggregate.
 *
 * When `strengthWeighted` is true, the similarity is multiplied by the
 * claim's QBAF strength (0-1), so strong surviving arguments contribute
 * more to node relevance than weak/refuted claims.
 *
 * Falls back to topicVector scoring when no AN claims are available.
 */
export function scoreNodesViaAN(
  claimEmbeddings: ANClaimEmbedding[],
  nodeEmbeddings: Record<string, { pov: string; vector: number[] }>,
  topicVector?: number[],
  strengthWeighted: boolean = false,
): Map<string, number> {
  const scores = new Map<string, number>();

  // Fallback: no AN claims yet (e.g., first opening statement)
  if (claimEmbeddings.length === 0) {
    if (topicVector) {
      return scoreNodeRelevance(topicVector, nodeEmbeddings);
    }
    return scores;
  }

  for (const [nodeId, entry] of Object.entries(nodeEmbeddings)) {
    if (!entry.vector || !Array.isArray(entry.vector)) continue;

    let maxScore = 0;
    for (const claim of claimEmbeddings) {
      let sim = cosineSimilarity(entry.vector, claim.vector);
      if (strengthWeighted && claim.strength != null) {
        // Blend: 70% raw similarity + 30% strength-weighted
        // This prevents a single high-strength claim from dominating
        sim = sim * (0.7 + 0.3 * claim.strength);
      }
      if (sim > maxScore) maxScore = sim;
    }
    scores.set(nodeId, maxScore);
  }

  return scores;
}

// ── Adaptive situation re-scoring (t/23, t/35) ─────────────────────

import {
  computeCruxRelevance,
  computeDiversityComponent,
  computeMidDebateFreshness,
  type SituationScoreComponents,
} from './situationScoring.js';

/** Diversity bonus for situations covering all three disagreement types. */
const DIVERSITY_BONUS = 0.15;
/** Penalty for previously-injected but never-referenced situations. */
const STALE_PENALTY = -0.20;

export interface SituationReScoreInput {
  situationNodes: readonly SituationNode[];
  cruxes: readonly TrackedCrux[];
  anNodes: readonly ArgumentNetworkNode[];
  nodeEmbeddings: Record<string, { pov: string; vector: number[] }>;
  /** Situation IDs that were injected in prior turns. */
  injectedSitIds: ReadonlySet<string>;
  /** Situation IDs actually referenced in transcript taxonomy_refs. */
  referencedSitIds: ReadonlySet<string>;
}

export interface SituationReScoreResult {
  adjustments: Map<string, number>;
  /** Per-situation shared scoring components (for diagnostics / reconciliation with pre-debate scoring). */
  components: Map<string, SituationScoreComponents>;
}

/**
 * Re-score situation nodes against emerging cruxes at phase transitions.
 *
 * Uses shared scoring components (t/35) with mid-debate-specific computation:
 * 1. Crux alignment (relevance): max cosine similarity to crux-related AN claims, scaled to [0, 0.25].
 * 2. Diversity bonus: +0.15 for underrepresented disagreement types.
 * 3. Stale penalty (freshness): -0.20 for injected but never-referenced situations.
 *
 * Returns a Map of situation node ID → score adjustment to add to base scores.
 */
export function reScoreSituationsForCruxes(input: SituationReScoreInput): Map<string, number> {
  const result = reScoreSituationsForCruxesDetailed(input);
  return result.adjustments;
}

/**
 * Detailed variant that also returns per-situation shared scoring components.
 * Callers that want diagnostics or component-level analysis should use this.
 */
export function reScoreSituationsForCruxesDetailed(input: SituationReScoreInput): SituationReScoreResult {
  const adjustments = new Map<string, number>();
  const components = new Map<string, SituationScoreComponents>();

  // Build crux-related claim embeddings from AN nodes
  const cruxClaimIds = new Set<string>();
  for (const crux of input.cruxes) {
    for (const claimId of crux.attacking_claim_ids) cruxClaimIds.add(claimId);
  }

  const cruxEmbeddings: { vector: number[]; strength: number }[] = [];
  for (const node of input.anNodes) {
    if (cruxClaimIds.has(node.id) && node.embedding && node.embedding.length > 0) {
      cruxEmbeddings.push({
        vector: node.embedding,
        strength: node.computed_strength ?? node.base_strength ?? 0.5,
      });
    }
  }

  // Count existing disagreement types for diversity bonus
  const typePresence = new Set<string>();
  for (const sit of input.situationNodes) {
    if (sit.disagreement_type) typePresence.add(sit.disagreement_type);
  }

  for (const sit of input.situationNodes) {
    // Compute shared components
    const sitEmbedding = input.nodeEmbeddings[sit.id]?.vector;
    const relevance = computeCruxRelevance(sitEmbedding, cruxEmbeddings);
    const diversity = computeDiversityComponent(sit, typePresence);
    const freshness = computeMidDebateFreshness(sit.id, input.injectedSitIds, input.referencedSitIds);

    const comp: SituationScoreComponents = {
      relevance,
      diversity,
      freshness,
      bdi_entropy: 0, // not computed in mid-debate context
      conflict_openness: 0, // not computed in mid-debate context
    };
    components.set(sit.id, comp);

    // Convert to adjustment (preserving original numeric behavior)
    let adjustment = 0;
    adjustment += relevance * 0.25; // crux alignment scaled to [0, 0.25]
    if (diversity > 0) adjustment += DIVERSITY_BONUS;
    if (freshness === 0) adjustment += STALE_PENALTY;

    if (adjustment !== 0) {
      adjustments.set(sit.id, adjustment);
    }
  }

  return { adjustments, components };
}
