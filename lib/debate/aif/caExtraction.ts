// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// CA-edge detection for AIF build B3 (t/3591).
//
// SEAM: this module produces CrossAgentOpposition (shape-agnostic internal pairs).
// Serialization to CaNode is applied at the caller boundary once B4a's SO consult
// clears — same pattern as runInquiryPipeline (t/3578).
//
// Detection reuses the t/3302 semantic-opposition classifier: verified opposition
// edges live in conflicts.json as ConflictFile entries whose linked_taxonomy_nodes
// connect opposing taxonomy nodes. A cross-agent I-node pair is a CA-edge candidate
// iff both nodes' primary_ref values co-appear in the same conflict entry.
//
// FN measurement (t/3591 AC §1, aif-scoping-design.md §4): CA-edge extraction
// reduces the paraphrase problem rather than eliminating it. unattributedPairs
// tracks the residual FN exposure — claims that paraphrase a known opposition node
// but were not attributed to it (or not attributed at all) escape detection.

import type { ArgumentNetworkNode } from '../types/argumentNetwork.js';
import type { ConflictFile } from '../taxonomyLoader.js';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Shape-agnostic internal representation of a cross-agent semantic opposition.
 * References ArgumentNetworkNode ids (not yet AIF I-node ids).
 * Caller maps these to I-node ids and calls makeCaNode at the B4a seam.
 */
export interface CrossAgentOpposition {
  /** AN node id of the attacking claim (earlier-turn node). */
  attackerNodeId: string;
  /** AN node id of the claim under attack (later-turn node). */
  targetNodeId: string;
  /** ConflictFile.claim_id evidencing this opposition pair. */
  conflictClaimId: string;
}

/**
 * Residual false-negative measurement under paraphrase (aif-scoping-design.md §4).
 *
 * A claim that paraphrases a known opposition node may receive no attribution
 * (primary_ref = '' or absent) or attribution to the wrong node — in either case,
 * the CA-edge is missed. unattributedPairs quantifies this exposure; it is NOT
 * the same as total missed edges (we cannot measure true misses without a ground
 * truth oracle), but it is the detectable upper bound within this classifier.
 */
export interface CaFnMetrics {
  /** Total cross-agent AN-node pairs considered (different speakers, agent only). */
  totalCrossAgentPairs: number;
  /** Pairs where at least one node lacked a primary_ref — paraphrase FN exposure. */
  unattributedPairs: number;
  /** Pairs with attribution on both sides. */
  attributedPairs: number;
  /** Attributed pairs that matched a conflict entry → detected oppositions. */
  detected: number;
  /** Attributed pairs with no matching conflict entry (novel or mis-attributed). */
  noConflictMatch: number;
  /**
   * Paraphrase FN rate estimate: unattributedPairs / totalCrossAgentPairs.
   * 0 when totalCrossAgentPairs is 0.
   */
  fnRateEstimate: number;
}

export interface CaExtractionResult {
  oppositions: CrossAgentOpposition[];
  fnMetrics: CaFnMetrics;
}

// ── Index helpers ─────────────────────────────────────────────────────────────

/**
 * Build a lookup index from the conflicts corpus.
 * Key: `${nodeIdA}::${nodeIdB}` (both orderings stored) → ConflictFile.claim_id.
 * First conflict entry wins when two entries share the same node pair.
 */
function buildConflictIndex(conflicts: readonly ConflictFile[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of conflicts) {
    const nodes = c.linked_taxonomy_nodes ?? [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const k1 = `${nodes[i]}::${nodes[j]}`;
        const k2 = `${nodes[j]}::${nodes[i]}`;
        if (!index.has(k1)) index.set(k1, c.claim_id);
        if (!index.has(k2)) index.set(k2, c.claim_id);
      }
    }
  }
  return index;
}

// ── Extractor ─────────────────────────────────────────────────────────────────

/**
 * Extract cross-agent semantic opposition pairs from attributed debate nodes.
 *
 * Prerequisites:
 * - Attribution/coref (t/3354 §6) must have run: nodes should carry
 *   `claim_taxonomy_attribution.primary_ref`. Nodes without it are counted as
 *   paraphrase FN exposure and skipped.
 * - `conflicts` is the corpus-level semantic-opposition index (t/3302 classifier
 *   output). Pass the result of `loadConflicts(repoRoot)`.
 *
 * Cross-agent invariant: only pairs where `speaker(A) ≠ speaker(B)` are
 * considered. System and document pseudo-speakers are excluded — CA-edges are
 * agent-to-agent only.
 *
 * Direction heuristic: the earlier-turn node is assigned as attacker; the
 * later-turn node is the target. Equal-turn nodes (same turn_number) default
 * to index order (A attacks B).
 */
export function extractCrossAgentOppositions(
  nodes: ArgumentNetworkNode[],
  conflicts: readonly ConflictFile[],
): CaExtractionResult {
  const conflictIndex = buildConflictIndex(conflicts);

  // Agent-only nodes (exclude system/document pseudo-speakers).
  const agentNodes = nodes.filter(
    n => n.speaker !== 'system' && n.speaker !== 'document',
  );

  const oppositions: CrossAgentOpposition[] = [];
  let totalCrossAgentPairs = 0;
  let unattributedPairs = 0;
  let attributedPairs = 0;
  let noConflictMatch = 0;

  for (let i = 0; i < agentNodes.length; i++) {
    for (let j = i + 1; j < agentNodes.length; j++) {
      const a = agentNodes[i];
      const b = agentNodes[j];

      if (a.speaker === b.speaker) continue;

      totalCrossAgentPairs++;

      const refA = a.claim_taxonomy_attribution?.primary_ref;
      const refB = b.claim_taxonomy_attribution?.primary_ref;

      // Missing or empty primary_ref = unattributed → FN exposure.
      if (!refA || !refB) {
        unattributedPairs++;
        continue;
      }

      attributedPairs++;

      const conflictId = conflictIndex.get(`${refA}::${refB}`) ?? null;
      if (conflictId === null) {
        noConflictMatch++;
        continue;
      }

      // Direction: earlier turn is attacker; equal turns → a attacks b (index order).
      const [attacker, target] = a.turn_number <= b.turn_number ? [a, b] : [b, a];

      oppositions.push({
        attackerNodeId: attacker.id,
        targetNodeId: target.id,
        conflictClaimId: conflictId,
      });
    }
  }

  const fnRateEstimate = totalCrossAgentPairs > 0
    ? unattributedPairs / totalCrossAgentPairs
    : 0;

  return {
    oppositions,
    fnMetrics: {
      totalCrossAgentPairs,
      unattributedPairs,
      attributedPairs,
      detected: oppositions.length,
      noConflictMatch,
      fnRateEstimate,
    },
  };
}
