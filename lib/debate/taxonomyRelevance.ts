// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Compute relevance scores for taxonomy nodes against a debate context.
 * Uses embedding cosine similarity to select the most relevant nodes
 * for each debater's prompt.
 */

import type { PovNode, SituationNode } from './taxonomyTypes.js';
import type { TrackedCrux, ArgumentNetworkNode } from './types.js';
import { stripExcludes } from './helpers.js';
import { filterByExclusionRatio, type ExclusionFilterResult } from './exclusionGuard.js';
import { POV_PREFIXES } from './nodeIdUtils.js';

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
  /** Embeddings map with optional exclusion_vector — enables exclusion ratio filtering. */
  nodeEmbeddings?: Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] }>;
  /** Query embedding vector — required for exclusion filtering. */
  queryVector?: number[];
  /** Minimum nodes per POV (accelerationist/safetyist/skeptic) to include. Default 2. */
  minPerPov?: number;
  /** Branch-aware situation selection — boosts nodes in topic-relevant root categories. */
  situationBranchBoost?: SituationBranchBoostConfig;
}

export interface SituationBranchBoostConfig {
  /** Score boost for nodes in topic-relevant branches (default 0.06). */
  boost?: number;
  /** Minimum branch score to activate boosting. Defaults to the node threshold. */
  branchThreshold?: number;
  /** Max branches to boost (default 4). */
  maxBranches?: number;
}

export interface BranchBoostResult {
  selectedBranches: { rootId: string; label: string; branchScore: number }[];
  boostedNodeIds: string[];
  promotedNodeIds: string[];
  promotedCount: number;
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

/** Result of applying POV diversity floor — for diagnostics logging. */
export interface PovDiversityResult {
  /** Node counts per POV before diversity enforcement. */
  povCounts: Record<string, number>;
  /** Node IDs added to fill POV deficits. */
  addedNodeIds: string[];
  /** Number of nodes added. */
  addedCount: number;
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
 * Mean-of-top-N scoring: for a query embedding, compute cosine similarity
 * against all node vectors (synthetic multi-vector when available, single-vector
 * fallback), then take the mean of the top N similarities.
 *
 * This captures how well a claim overlaps with a node's semantic neighborhood
 * rather than relying on a single centroid embedding.
 */
export function scoreNodeRelevanceMeanTopN(
  queryVector: number[],
  nodeEmbeddings: Record<string, { pov: string; vector: number[]; vectors?: number[][] }>,
  topN: number = 3,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [nodeId, entry] of Object.entries(nodeEmbeddings)) {
    if (entry.vectors && entry.vectors.length > 0) {
      const sims = entry.vectors
        .map(v => cosineSimilarity(queryVector, v))
        .sort((a, b) => b - a);
      const top = sims.slice(0, Math.min(topN, sims.length));
      scores.set(nodeId, top.reduce((s, v) => s + v, 0) / top.length);
    } else if (entry.vector && Array.isArray(entry.vector)) {
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

  // POV diversity floor: ensure minimum representation from each active POV
  const minPov = opts.minPerPov ?? 2;
  let _povDiversityResult: PovDiversityResult | undefined;
  if (minPov > 0) {
    const selectedIds = new Set(result.map(s => s.node.id));
    const povCounts: Record<string, number> = {};
    for (const [prefix, pov] of Object.entries(POV_PREFIXES)) {
      povCounts[pov] = result.filter(s => s.node.id.startsWith(prefix)).length;
    }
    const addedNodeIds: string[] = [];
    for (const [prefix, pov] of Object.entries(POV_PREFIXES)) {
      const count = povCounts[pov];
      if (count >= minPov) continue;
      const deficit = minPov - count;
      const candidates = povNodes
        .filter(n => n.id.startsWith(prefix) && !selectedIds.has(n.id))
        .map(n => ({ node: n, score: effectiveScores.get(n.id) || 0 }))
        .sort((a, b) => b.score - a.score);
      for (let i = 0; i < Math.min(deficit, candidates.length); i++) {
        result.push(candidates[i]);
        selectedIds.add(candidates[i].node.id);
        addedNodeIds.push(candidates[i].node.id);
      }
    }
    if (addedNodeIds.length > 0) {
      _povDiversityResult = { povCounts, addedNodeIds, addedCount: addedNodeIds.length };
    }
  }

  // Apply maxTotal — when POV diversity is active, protect floor nodes from trimming
  let sliced: ScoredPovNode[];
  if (maxTotal != null && result.length > maxTotal && minPov > 0) {
    const protectedIds = new Set<string>();
    for (const prefix of Object.keys(POV_PREFIXES)) {
      const povInResult = result
        .filter(s => s.node.id.startsWith(prefix))
        .sort((a, b) => b.score - a.score);
      for (let i = 0; i < Math.min(minPov, povInResult.length); i++) {
        protectedIds.add(povInResult[i].node.id);
      }
    }
    const protectedSlice = result.filter(s => protectedIds.has(s.node.id));
    const rest = result
      .filter(s => !protectedIds.has(s.node.id))
      .sort((a, b) => b.score - a.score);
    sliced = [...protectedSlice, ...rest.slice(0, Math.max(0, maxTotal - protectedSlice.length))];
  } else {
    sliced = maxTotal != null ? result.slice(0, maxTotal) : result;
  }

  // Stash diagnostics on the result array for callers that want it
  if (_lineageBoostResult) {
    (sliced as ScoredPovNode[] & { _lineageBoost?: LineageBoostResult })._lineageBoost = _lineageBoostResult;
  }
  if (_povDiversityResult) {
    (sliced as ScoredPovNode[] & { _povDiversity?: PovDiversityResult })._povDiversity = _povDiversityResult;
  }

  // Apply exclusion ratio filter when embeddings and query vector are provided
  if (opts.nodeEmbeddings && opts.queryVector) {
    const nodeIds = sliced.map(s => s.node.id);
    const exclusionResult = filterByExclusionRatio(nodeIds, opts.queryVector, opts.nodeEmbeddings);
    if (exclusionResult.demoted.length > 0) {
      const passedSet = new Set(exclusionResult.passed);
      sliced = sliced.filter(s => passedSet.has(s.node.id));
    }
    (sliced as ScoredPovNode[] & { _exclusionFilter?: ExclusionFilterResult })._exclusionFilter = exclusionResult;
  }

  return sliced;
}

/**
 * Build a node→root lookup for situation hierarchy. Returns a Map of nodeId → rootId.
 * Nodes without parent_id (or with invalid parent_id) map to themselves.
 */
export function buildSituationRootLookup(
  nodes: readonly SituationNode[],
): Map<string, string> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const rootCache = new Map<string, string>();
  const inProgress = new Set<string>();

  function findRoot(id: string): string {
    if (rootCache.has(id)) return rootCache.get(id)!;
    if (inProgress.has(id)) { rootCache.set(id, id); return id; }
    inProgress.add(id);
    const node = nodeMap.get(id);
    if (!node || !node.parent_id || !nodeMap.has(node.parent_id)) {
      rootCache.set(id, id);
      return id;
    }
    const root = findRoot(node.parent_id);
    rootCache.set(id, root);
    return root;
  }

  for (const n of nodes) findRoot(n.id);
  return rootCache;
}

/**
 * Select relevant situation nodes based on similarity threshold.
 * When situationBranchBoost is configured and nodes have parent_id, scores
 * at branch level first and boosts descendants of topic-relevant categories.
 * Falls back to flat selection when no branches score above threshold.
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

  // Branch boosting: identify top root categories and boost their descendants
  const effectiveScores = new Map(scores);
  let _branchBoostResult: BranchBoostResult | undefined;
  const branchCfg = opts.situationBranchBoost;
  const hasHierarchy = situationNodes.some(n => n.parent_id != null);

  if (branchCfg && hasHierarchy) {
    const boostAmount = branchCfg.boost ?? 0.06;
    const branchThreshold = branchCfg.branchThreshold ?? threshold;
    const maxBranches = branchCfg.maxBranches ?? 4;

    const rootLookup = buildSituationRootLookup(situationNodes);
    const nodeMap = new Map(situationNodes.map(n => [n.id, n]));

    // Group nodes by root
    const branchMembers = new Map<string, string[]>();
    for (const n of situationNodes) {
      const root = rootLookup.get(n.id) ?? n.id;
      if (root === n.id && !n.parent_id) {
        // This is a root node — don't add it to its own branch members
        // (branch score is computed from descendants only)
        if (!branchMembers.has(root)) branchMembers.set(root, []);
        continue;
      }
      const members = branchMembers.get(root) ?? [];
      members.push(n.id);
      branchMembers.set(root, members);
    }

    // Compute branch scores: max(root embedding score, mean of top-3 descendant scores)
    const branchScores: { rootId: string; label: string; branchScore: number }[] = [];
    for (const [rootId, memberIds] of branchMembers) {
      const rootNode = nodeMap.get(rootId);
      if (!rootNode || rootNode.parent_id) continue; // only true roots

      const rootScore = scores.get(rootId) ?? 0;
      const memberScores = memberIds
        .map(id => scores.get(id) ?? 0)
        .sort((a, b) => b - a);
      const top3Mean = memberScores.length > 0
        ? memberScores.slice(0, 3).reduce((s, v) => s + v, 0) / Math.min(3, memberScores.length)
        : 0;
      const branchScore = Math.max(rootScore, top3Mean);

      branchScores.push({ rootId, label: rootNode.label, branchScore });
    }

    // Select top branches above threshold
    branchScores.sort((a, b) => b.branchScore - a.branchScore);
    const selectedBranches = branchScores
      .filter(b => b.branchScore >= branchThreshold)
      .slice(0, maxBranches);

    if (selectedBranches.length > 0) {
      const selectedRootIds = new Set(selectedBranches.map(b => b.rootId));
      const boostedIds: string[] = [];
      const promotedIds: string[] = [];

      for (const n of situationNodes) {
        if (!n.parent_id) continue;
        const root = rootLookup.get(n.id) ?? n.id;
        if (selectedRootIds.has(root)) {
          const base = effectiveScores.get(n.id) ?? 0;
          const boosted = base + boostAmount;
          effectiveScores.set(n.id, boosted);
          boostedIds.push(n.id);
          if (base < threshold && boosted >= threshold) promotedIds.push(n.id);
        }
      }

      _branchBoostResult = { selectedBranches, boostedNodeIds: boostedIds, promotedNodeIds: promotedIds, promotedCount: promotedIds.length };
    }
  }

  const scored = situationNodes
    .map(n => {
      let score = effectiveScores.get(n.id) || 0;
      // Deprioritize near-consensus situations (low interpretation divergence)
      if (n.interpretation_divergence != null && n.interpretation_divergence < 0.20) {
        score -= 0.05;
      }
      return { node: n, score };
    })
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));

  const aboveThreshold = scored.filter(s => s.score >= threshold);
  const selected = aboveThreshold.length >= min
    ? aboveThreshold
    : scored.slice(0, Math.max(min, aboveThreshold.length));

  let result = selected.slice(0, max);

  if (_branchBoostResult) {
    (result as ScoredSituationNode[] & { _branchBoost?: BranchBoostResult })._branchBoost = _branchBoostResult;
  }

  // Apply exclusion ratio filter when embeddings and query vector are provided
  if (opts.nodeEmbeddings && opts.queryVector) {
    const nodeIds = result.map(s => s.node.id);
    const exclusionResult = filterByExclusionRatio(nodeIds, opts.queryVector, opts.nodeEmbeddings);
    if (exclusionResult.demoted.length > 0) {
      const passedSet = new Set(exclusionResult.passed);
      result = result.filter(s => passedSet.has(s.node.id));
    }
    (result as ScoredSituationNode[] & { _exclusionFilter?: ExclusionFilterResult })._exclusionFilter = exclusionResult;
  }

  return result;
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
    score(n.id, `${n.label} ${stripExcludes(n.description)}`);
  }
  for (const n of situationNodes) {
    score(n.id, `${n.label} ${stripExcludes(n.description)}`);
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

// ── Policymaker situation relevance boost ───────────────────────────

const POLICYMAKER_KEYWORDS = /\b(regulation|regulatory|legislation|legislative|enforcement|agency|commission|mandate|compliance|jurisdiction|statute|executive order|rulemaking|oversight body|congressional|parliamentary)\b/gi;

/**
 * Compute a relevance boost for situation nodes in policymaker-audience debates.
 * Returns +0.10 when 2+ institutional/regulatory keywords appear in the description.
 * Returns 0 for non-policymaker audiences or fewer than 2 matches.
 */
export function computePolicymakerRelevanceBoost(
  situation: Pick<SituationNode, 'description'>,
  audience?: string,
): number {
  if (audience !== 'policymakers') return 0;
  const matches = stripExcludes(situation.description || '').match(POLICYMAKER_KEYWORDS) || [];
  return matches.length >= 2 ? 0.10 : 0;
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
  nodeEmbeddings: Record<string, { pov: string; vector: number[]; vectors?: number[][] }>,
  topicVector?: number[],
  strengthWeighted: boolean = false,
): Map<string, number> {
  const scores = new Map<string, number>();

  // Fallback: no AN claims yet (e.g., first opening statement)
  if (claimEmbeddings.length === 0) {
    if (topicVector) {
      return scoreNodeRelevanceMeanTopN(topicVector, nodeEmbeddings);
    }
    return scores;
  }

  for (const [nodeId, entry] of Object.entries(nodeEmbeddings)) {
    if (!entry.vector || !Array.isArray(entry.vector)) continue;

    // Collect all node vectors: description embedding + synthetic vectors
    const nodeVectors = entry.vectors?.length
      ? [entry.vector, ...entry.vectors]
      : [entry.vector];

    let maxScore = 0;
    for (const claim of claimEmbeddings) {
      // Score against best-matching node vector
      let sim = 0;
      for (const nv of nodeVectors) {
        const s = cosineSimilarity(nv, claim.vector);
        if (s > sim) sim = s;
      }
      if (strengthWeighted && claim.strength != null) {
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
  computeInterpretsBoost,
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
  nodeEmbeddings: Record<string, { pov: string; vector: number[]; vectors?: number[][] }>;
  /** Situation IDs that were injected in prior turns. */
  injectedSitIds: ReadonlySet<string>;
  /** Situation IDs actually referenced in transcript taxonomy_refs. */
  referencedSitIds: ReadonlySet<string>;
  /** Taxonomy edges — used for INTERPRETS boost scoring. */
  edges?: readonly { source: string; target: string; type: string; status?: string }[];
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
    // Scale crux relevance by interpretation divergence — high-divergence situations
    // matching a crux are more valuable than crux-adjacent situations where POVs agree
    const divergenceScale = 0.7 + 0.3 * (sit.interpretation_divergence ?? 0.3);
    adjustment += (relevance * divergenceScale) * 0.25; // crux alignment scaled to [0, 0.25]
    if (diversity > 0) adjustment += DIVERSITY_BONUS;
    if (freshness === 0) adjustment += STALE_PENALTY;
    if (input.edges) adjustment += computeInterpretsBoost(sit.id, input.edges);

    if (adjustment !== 0) {
      adjustments.set(sit.id, adjustment);
    }
  }

  return { adjustments, components };
}

// ── Constraint-aware post-selection filter (t/339) ─────────────────

import type { TopicScope } from './types.js';

const CATASTROPHIC_SIGNALS = new Set([
  'fatal', 'death', 'deaths', 'killed', 'killing', 'catastrophic', 'catastrophe',
  'existential', 'collapse', 'extinction', 'casualty', 'casualties',
  'devastating', 'destroyed', 'destruction',
]);

export interface TopicConstraintFilterConfig {
  mode: 'demote' | 'exclude';
  penaltyFactor: number;
  boostIncrement: number;
  boostCap: number;
  minPerCategory: number;
}

export interface TopicConstraintFilterResult {
  nodes: ScoredPovNode[];
  demoted: { nodeId: string; reason: string; originalScore: number; newScore: number }[];
  boosted: { nodeId: string; matchedTerms: string[]; matchCount: number; boostFactor: number; originalScore: number; newScore: number }[];
  restorations: string[];
}

export function filterByTopicConstraints(
  nodes: ScoredPovNode[],
  scope: TopicScope | null | undefined,
  config?: Partial<TopicConstraintFilterConfig>,
): TopicConstraintFilterResult {
  if (!scope) return { nodes, demoted: [], boosted: [], restorations: [] };

  const penalty = config?.penaltyFactor ?? 0.7;
  const boostIncrement = config?.boostIncrement ?? 0.1;
  const boostCap = config?.boostCap ?? 1.5;
  const minPerCat = config?.minPerCategory ?? 3;

  const isLowRisk = scope.risk_level === 'low' || scope.risk_level === 'medium';
  const excludedTerms = scope.excluded_scenarios
    .flatMap(s => s.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
  const offScopeTerms = scope.off_scope_topics
    .flatMap(t => t.toLowerCase().split(/\s+/).filter(w => w.length >= 4));
  const disciplineTerms = scope.relevant_disciplines
    .flatMap(d => d.toLowerCase().split(/\s+/).filter(w => w.length >= 4));

  const demoted: TopicConstraintFilterResult['demoted'] = [];
  const boosted: TopicConstraintFilterResult['boosted'] = [];
  const result: (ScoredPovNode & { _demoted?: boolean })[] = [];

  for (const entry of nodes) {
    const desc = `${entry.node.label} ${stripExcludes(entry.node.description)}`.toLowerCase();
    let reason: string | null = null;

    if (isLowRisk) {
      let catSignals = 0;
      for (const signal of CATASTROPHIC_SIGNALS) {
        if (desc.includes(signal)) catSignals++;
      }
      if (catSignals >= 2) {
        reason = 'risk-level: catastrophic framing in low/medium-risk debate';
      }
    }

    if (!reason && excludedTerms.length > 0) {
      let matches = 0;
      for (const term of excludedTerms) {
        if (desc.includes(term)) matches++;
      }
      if (matches >= 2) {
        reason = `excluded-scenario: matches ${matches} exclusion terms`;
      }
    }

    if (!reason && offScopeTerms.length > 0) {
      let matches = 0;
      for (const term of offScopeTerms) {
        if (desc.includes(term)) matches++;
      }
      if (matches >= 3) {
        reason = `off-scope: matches ${matches} off-scope topic terms`;
      }
    }

    if (reason) {
      const newScore = entry.score * penalty;
      demoted.push({ nodeId: entry.node.id, reason, originalScore: entry.score, newScore });
      result.push({ node: entry.node, score: newScore, _demoted: true });
    } else if (disciplineTerms.length > 0) {
      const matchedTerms: string[] = [];
      for (const term of disciplineTerms) {
        if (desc.includes(term)) matchedTerms.push(term);
      }
      if (matchedTerms.length >= 2) {
        const factor = Math.min(1.0 + boostIncrement * matchedTerms.length, boostCap);
        const newScore = entry.score * factor;
        boosted.push({ nodeId: entry.node.id, matchedTerms, matchCount: matchedTerms.length, boostFactor: factor, originalScore: entry.score, newScore });
        result.push({ node: entry.node, score: newScore });
      } else {
        result.push({ ...entry });
      }
    } else {
      result.push({ ...entry });
    }
  }

  const restorations: string[] = [];
  const categories = ['Beliefs', 'Desires', 'Intentions'] as const;
  for (const cat of categories) {
    const catNodes = result.filter(n => (n.node.category || 'Intentions') === cat);
    const nonDemoted = catNodes.filter(n => !n._demoted);
    if (nonDemoted.length < minPerCat) {
      const deficit = minPerCat - nonDemoted.length;
      const demotedInCat = catNodes
        .filter(n => n._demoted)
        .sort((a, b) => b.score - a.score);
      for (let i = 0; i < Math.min(deficit, demotedInCat.length); i++) {
        const restored = demotedInCat[i];
        const orig = demoted.find(d => d.nodeId === restored.node.id);
        if (orig) {
          restored.score = orig.originalScore;
          delete restored._demoted;
          restorations.push(restored.node.id);
        }
      }
    }
  }

  const cleaned = result.map(({ _demoted, ...rest }) => rest) as ScoredPovNode[];
  cleaned.sort((a, b) => b.score - a.score);

  return { nodes: cleaned, demoted, boosted, restorations };
}
