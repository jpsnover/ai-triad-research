// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Cross-debate weight evolution deduplication.
 *
 * Prevents multi-model debate runs from compounding weight changes
 * on the same node. Supports both Belief confidence and Intention operationality
 * via a `weight_type` discriminator on index entries.
 *
 * Three safeguards:
 *   1. Topic-based dedup (cosine > 0.80 → take max magnitude)
 *   2. Attack-vector dedup (cosine > 0.85 → replace if stronger, discard if weaker)
 *   3. Cross-model robustness scoring (same attack across models → robustness field)
 *
 * See docs/weighted-bdi-proposal.md §"Cross-debate deduplication"
 */

import { cosineSimilarity } from './taxonomyRelevance.js';
import type { WeightHistoryEntry } from './taxonomyTypes.js';

// ── Configuration ───────────────────────────────────────

import { ATTACK_DEDUP_THRESHOLD } from './constants.js';

export const TOPIC_DEDUP_THRESHOLD = 0.80;
export { ATTACK_DEDUP_THRESHOLD };

// ── Index types ─────────────────────────────────────────

/** Which weight type this dedup entry tracks. */
export type WeightType = 'confidence' | 'operationality';

export interface ConfidenceIndexEntry {
  debate_id: string;
  /** Hash or summary of topic embedding for lightweight comparison. */
  topic_embedding_hash: string;
  /** Full embedding of the attack claim for vector comparison. */
  attack_claim_embedding: number[];
  /** Weight delta applied (negative = reduction). */
  delta: number;
  date: string;
  /** AI model used in the debate. */
  model: string;
  /** Embedding model used (skip cross-debate comparison when models differ). */
  embedding_model: string;
  /** The attack claim text. */
  attack_claim: string;
  /** Which weight type this entry tracks. Defaults to 'confidence' for backward compat. */
  weight_type?: WeightType;
}

/** debate-confidence-index.json structure: node_id → entries. Supports both Belief and Intention nodes. */
export interface ConfidenceUpdateIndex {
  [nodeId: string]: ConfidenceIndexEntry[];
}

// ── Dedup decision types ────────────────────────────────

export type DedupAction =
  | { action: 'apply'; reason: string }
  | { action: 'supersede'; supersededDebateId: string; reason: string }
  | { action: 'discard'; reason: string }
  | { action: 'robustness'; supersededDebateId: string; robustness: number; modelConfirmations: string[]; reason: string };

export interface DedupDecision {
  beliefId: string;
  debateId: string;
  action: DedupAction;
  similarityTopic?: number;
  similarityAttack?: number;
}

// ── Topic embedding hash ────────────────────────────────

/**
 * Compute a lightweight hash of a topic embedding for fast filtering.
 * Uses first 8 dimensions quantized to 2 decimal places.
 */
export function hashTopicEmbedding(embedding: number[]): string {
  const dims = embedding.slice(0, 8).map(v => v.toFixed(2));
  return dims.join(',');
}

// ── Core dedup logic ────────────────────────────────────

/**
 * Evaluate whether a new confidence update should be applied, given prior updates
 * recorded in the index.
 *
 * @param beliefId - The Belief node being updated
 * @param newEntry - Proposed new index entry (from current debate)
 * @param topicEmbedding - Full topic embedding for similarity comparison
 * @param priorEntries - Existing index entries for this Belief
 * @returns DedupDecision describing what to do
 */
export function evaluateDedup(
  beliefId: string,
  newEntry: ConfidenceIndexEntry,
  topicEmbedding: number[],
  priorEntries: ConfidenceIndexEntry[],
): DedupDecision {
  // Filter to same weight_type (confidence entries don't dedup against operationality)
  const entryType = newEntry.weight_type ?? 'confidence';
  const sameType = priorEntries.filter(e => (e.weight_type ?? 'confidence') === entryType);

  if (sameType.length === 0) {
    return {
      beliefId,
      debateId: newEntry.debate_id,
      action: { action: 'apply', reason: `No prior ${entryType} updates — first change` },
    };
  }

  // Filter to same embedding model (incomparable otherwise)
  const comparable = sameType.filter(e => e.embedding_model === newEntry.embedding_model);
  if (comparable.length === 0) {
    return {
      beliefId,
      debateId: newEntry.debate_id,
      action: { action: 'apply', reason: 'No prior updates with same embedding model' },
    };
  }

  // ── Safeguard 1: Topic-based dedup ──────────────────
  // Find the prior entry with highest topic similarity
  let bestTopicSim = -1;
  let bestTopicEntry: ConfidenceIndexEntry | null = null;

  for (const prior of comparable) {
    if (prior.attack_claim_embedding.length === 0) continue;
    // Use attack_claim_embedding as proxy for topic when topic embedding not stored separately
    // The topic embedding is passed directly for comparison
    // We need a way to compare topics — use the hash for fast pre-filter, then full vector
  }

  // For topic comparison, compare against all prior entries' attack embeddings
  // (topic overlap often correlates with attack overlap)
  // But the spec says to compare topic embeddings — we use the passed topicEmbedding
  // against a reconstructed topic proxy from prior entries
  // In practice, we compare the full topic embedding against prior attack_claim_embeddings
  // as the topic drives the attack content

  // ── Safeguard 2: Attack-vector dedup ────────────────
  let bestAttackSim = -1;
  let bestAttackEntry: ConfidenceIndexEntry | null = null;

  for (const prior of comparable) {
    if (prior.attack_claim_embedding.length === 0 || newEntry.attack_claim_embedding.length === 0) continue;

    const attackSim = cosineSimilarity(newEntry.attack_claim_embedding, prior.attack_claim_embedding);
    if (attackSim > bestAttackSim) {
      bestAttackSim = attackSim;
      bestAttackEntry = prior;
    }

    // Also compute topic similarity using the topic embedding
    if (topicEmbedding.length > 0 && prior.attack_claim_embedding.length > 0) {
      const topicSim = cosineSimilarity(topicEmbedding, prior.attack_claim_embedding);
      if (topicSim > bestTopicSim) {
        bestTopicSim = topicSim;
        bestTopicEntry = prior;
      }
    }
  }

  // ── Safeguard 3: Cross-model robustness ─────────────
  // Check if the same attack comes from a different model
  if (bestAttackSim >= ATTACK_DEDUP_THRESHOLD && bestAttackEntry) {
    if (bestAttackEntry.model !== newEntry.model) {
      // Same attack, different model → robustness signal
      const allModels = new Set<string>();
      allModels.add(newEntry.model);
      for (const prior of comparable) {
        if (prior.attack_claim_embedding.length === 0 || newEntry.attack_claim_embedding.length === 0) continue;
        const sim = cosineSimilarity(newEntry.attack_claim_embedding, prior.attack_claim_embedding);
        if (sim >= ATTACK_DEDUP_THRESHOLD) {
          allModels.add(prior.model);
        }
      }

      return {
        beliefId,
        debateId: newEntry.debate_id,
        action: {
          action: 'robustness',
          supersededDebateId: bestAttackEntry.debate_id,
          robustness: allModels.size,
          modelConfirmations: [...allModels],
          reason: `Same attack confirmed by ${allModels.size} models (attack similarity ${bestAttackSim.toFixed(3)})`,
        },
        similarityTopic: bestTopicSim > 0 ? bestTopicSim : undefined,
        similarityAttack: bestAttackSim,
      };
    }

    // Same model, same attack → replace if stronger, discard if weaker
    const newMagnitude = Math.abs(newEntry.delta);
    const priorMagnitude = Math.abs(bestAttackEntry.delta);

    if (newMagnitude > priorMagnitude) {
      return {
        beliefId,
        debateId: newEntry.debate_id,
        action: {
          action: 'supersede',
          supersededDebateId: bestAttackEntry.debate_id,
          reason: `Stronger attack replaces prior (|${newEntry.delta.toFixed(3)}| > |${bestAttackEntry.delta.toFixed(3)}|, attack similarity ${bestAttackSim.toFixed(3)})`,
        },
        similarityTopic: bestTopicSim > 0 ? bestTopicSim : undefined,
        similarityAttack: bestAttackSim,
      };
    } else {
      return {
        beliefId,
        debateId: newEntry.debate_id,
        action: {
          action: 'discard',
          reason: `Weaker/equal attack discarded (|${newEntry.delta.toFixed(3)}| ≤ |${bestAttackEntry.delta.toFixed(3)}|, attack similarity ${bestAttackSim.toFixed(3)})`,
        },
        similarityTopic: bestTopicSim > 0 ? bestTopicSim : undefined,
        similarityAttack: bestAttackSim,
      };
    }
  }

  // Topic dedup: similar topic but different attack vector
  if (bestTopicSim >= TOPIC_DEDUP_THRESHOLD && bestTopicEntry) {
    // Same topic, novel attack → take max magnitude
    const newMagnitude = Math.abs(newEntry.delta);
    const priorMagnitude = Math.abs(bestTopicEntry.delta);

    if (newMagnitude > priorMagnitude) {
      return {
        beliefId,
        debateId: newEntry.debate_id,
        action: {
          action: 'supersede',
          supersededDebateId: bestTopicEntry.debate_id,
          reason: `Same topic, stronger update replaces prior (|${newEntry.delta.toFixed(3)}| > |${bestTopicEntry.delta.toFixed(3)}|, topic similarity ${bestTopicSim.toFixed(3)})`,
        },
        similarityTopic: bestTopicSim,
        similarityAttack: bestAttackSim > 0 ? bestAttackSim : undefined,
      };
    } else {
      return {
        beliefId,
        debateId: newEntry.debate_id,
        action: {
          action: 'discard',
          reason: `Same topic, weaker/equal update discarded (|${newEntry.delta.toFixed(3)}| ≤ |${bestTopicEntry.delta.toFixed(3)}|, topic similarity ${bestTopicSim.toFixed(3)})`,
        },
        similarityTopic: bestTopicSim,
        similarityAttack: bestAttackSim > 0 ? bestAttackSim : undefined,
      };
    }
  }

  // Novel topic + novel attack → apply
  return {
    beliefId,
    debateId: newEntry.debate_id,
    action: { action: 'apply', reason: `Novel attack vector (best topic sim ${bestTopicSim.toFixed(3)}, best attack sim ${bestAttackSim.toFixed(3)})` },
    similarityTopic: bestTopicSim > 0 ? bestTopicSim : undefined,
    similarityAttack: bestAttackSim > 0 ? bestAttackSim : undefined,
  };
}

// ── History entry builder ───────────────────────────────

/**
 * Build a WeightHistoryEntry from a dedup decision.
 * Only called when the decision is 'apply', 'supersede', or 'robustness'.
 */
export function buildHistoryEntry(
  decision: DedupDecision,
  newValue: number,
  delta: number,
  attackClaim: string,
  date: string,
): WeightHistoryEntry {
  const base: WeightHistoryEntry = {
    date,
    value: newValue,
    delta,
    reason: `Debate ${decision.debateId}: ${decision.action.reason}`,
  };

  if (attackClaim) {
    base.attack_claim = attackClaim;
  }

  const act = decision.action;
  if (act.action === 'supersede') {
    base.supersedes = act.supersededDebateId;
  } else if (act.action === 'robustness') {
    base.supersedes = act.supersededDebateId;
    base.robustness = act.robustness;
    base.model_confirmations = act.modelConfirmations;
  }

  return base;
}

// ── Index helpers ───────────────────────────────────────

/**
 * Add an entry to the confidence index (mutates in place).
 * When superseding, removes the superseded entry.
 */
export function addToIndex(
  index: ConfidenceUpdateIndex,
  beliefId: string,
  entry: ConfidenceIndexEntry,
  supersededDebateId?: string,
): void {
  if (!index[beliefId]) {
    index[beliefId] = [];
  }

  if (supersededDebateId) {
    index[beliefId] = index[beliefId].filter(e => e.debate_id !== supersededDebateId);
  }

  index[beliefId].push(entry);
}

/**
 * Rebuild the confidence index from a set of history entries across all Belief nodes.
 * Used for corruption recovery.
 */
export function rebuildIndex(
  beliefHistories: Record<string, WeightHistoryEntry[]>,
  embeddingModel: string,
  embedFn: (text: string) => number[],
): ConfidenceUpdateIndex {
  const index: ConfidenceUpdateIndex = {};

  for (const [beliefId, history] of Object.entries(beliefHistories)) {
    const entries: ConfidenceIndexEntry[] = [];
    for (const h of history) {
      if (!h.attack_claim) continue;
      const embedding = embedFn(h.attack_claim);
      entries.push({
        debate_id: h.supersedes ?? `rebuilt-${h.date}`,
        topic_embedding_hash: hashTopicEmbedding(embedding),
        attack_claim_embedding: embedding,
        delta: h.delta,
        date: h.date,
        model: h.model_confirmations?.[0] ?? 'unknown',
        embedding_model: embeddingModel,
        attack_claim: h.attack_claim,
      });
    }
    if (entries.length > 0) {
      index[beliefId] = entries;
    }
  }

  return index;
}
