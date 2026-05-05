// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Post-debate claim outcome classification.
 *
 * Classifies each AN node as thrived/survived/died based on
 * computed_strength, reference count, and QBAF dynamics.
 *
 * Phase 1 of t/278 — outcome tracking only, no prompt bias.
 */

import type {
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ClaimOutcome,
  ClaimOutcomeSummary,
  TranscriptEntry,
} from './types.js';

/**
 * Classify a single AN node's outcome.
 *
 * - **thrived**: computed_strength ≥ 0.5 AND referenced by ≥ 2 turns
 * - **survived**: computed_strength ≥ 0.3 OR referenced by ≥ 1 turn
 * - **died**: computed_strength < 0.3 AND never referenced
 */
export function classifyOutcome(
  node: ArgumentNetworkNode,
  referenceCount: number,
): 'thrived' | 'survived' | 'died' {
  const strength = node.computed_strength ?? node.base_strength ?? 0.5;

  if (strength >= 0.5 && referenceCount >= 2) return 'thrived';
  if (strength >= 0.3 || referenceCount >= 1) return 'survived';
  return 'died';
}

/**
 * Count how many transcript entries reference a given AN node by ID.
 * Uses a simple text match against the node's text (first 50 chars)
 * since transcript entries don't directly reference AN node IDs.
 *
 * Falls back to edge count: how many edges connect to this node.
 */
export function countReferences(
  nodeId: string,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
): number {
  // Count edges where this node is a target (attacked or supported)
  return edges.filter(e => e.source === nodeId || e.target === nodeId).length;
}

/**
 * Classify all AN nodes in a completed debate session.
 */
export function classifyClaimOutcomes(
  nodes: ReadonlyArray<ArgumentNetworkNode>,
  edges: ReadonlyArray<ArgumentNetworkEdge>,
): ClaimOutcome[] {
  // Exclude system and document nodes — only classify debate-generated claims
  const debateNodes = nodes.filter(n =>
    n.speaker !== 'system' && n.speaker !== 'document',
  );

  return debateNodes.map(node => {
    const refCount = countReferences(node.id, edges);
    const outcome = classifyOutcome(node, refCount);

    return {
      claim_id: node.id,
      speaker: node.speaker as string,
      bdi_category: node.bdi_category,
      argumentation_scheme: undefined, // schemes are on edges, not nodes
      specificity: node.specificity,
      text_length: node.text.length,
      base_strength: node.base_strength ?? 0.5,
      final_computed_strength: node.computed_strength ?? node.base_strength ?? 0.5,
      reference_count: refCount,
      outcome,
    };
  });
}

/**
 * Compute aggregate outcome stats for calibration logging.
 */
export function summarizeOutcomes(outcomes: ClaimOutcome[]): ClaimOutcomeSummary {
  const total = outcomes.length;
  const thrived = outcomes.filter(o => o.outcome === 'thrived').length;
  const survived = outcomes.filter(o => o.outcome === 'survived').length;
  const died = outcomes.filter(o => o.outcome === 'died').length;

  return {
    total,
    thrived,
    survived,
    died,
    thrived_rate: total > 0 ? thrived / total : 0,
    died_rate: total > 0 ? died / total : 0,
  };
}
