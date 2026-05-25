// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Intention operationality assignment based on tree position, falsifiability, and situation grounding.
 *
 * Operationality levels:
 *   5 — Highly operational: concrete leaf + high falsifiability or situation grounding
 *   4 — Operational: standard leaf (medium falsifiability)
 *   3 — Structured: mid-tree organizing node
 *   2 — Abstract: root umbrella or low-falsifiability leaf
 *   1 — Vague: root + low falsifiability (theoretical framing)
 *
 * Formula: clamp(tree_base + falsifiability_mod + situation_bonus, 1, 5)
 *
 * See research/comp-linguist/docs/intention-operationality-design.md
 */

import type { PovNode, WeightHistoryEntry } from './taxonomyTypes.js';

/**
 * Compute base operationality from tree position.
 * Leaf (no children) → 4, mid-tree (parent + children) → 3, root (no parent) → 2.
 *
 * Note: inverted from desirePriority.ts — leaves are most operational (actionable),
 * roots are least operational (abstract umbrellas).
 */
export function computeTreeBase(node: PovNode): number {
  if (node.children.length === 0) return 4;    // leaf — actionable
  if (node.parent_id) return 3;                // mid-tree — organizing
  return 2;                                    // root — abstract
}

/**
 * Compute falsifiability modifier: high → +1, low → -1, medium/absent → 0.
 */
export function falsifiabilityModifier(node: PovNode): number {
  const f = node.graph_attributes?.falsifiability;
  if (f === 'high') return 1;
  if (f === 'low') return -1;
  return 0;
}

/**
 * Compute operationality score for a single Intention node.
 * Returns clamped integer 1-5.
 */
export function computeOperationality(node: PovNode): number {
  const base = computeTreeBase(node);
  const falsMod = falsifiabilityModifier(node);
  const sitBonus = (node.situation_refs?.length ?? 0) > 0 ? 1 : 0;
  return Math.max(1, Math.min(5, base + falsMod + sitBonus));
}

export interface OperationalityResult {
  nodeId: string;
  operationality: number;
  treeBase: number;
  falsifiabilityMod: number;
  situationBonus: number;
}

/**
 * Assign operationality to a batch of Intention nodes.
 * Filters to Intentions only. Mutates nodes in place.
 *
 * @param nodes - All POV nodes (Intentions will be filtered)
 * @param date - ISO date string for history entry
 */
export function assignIntentionOperationality(
  nodes: PovNode[],
  date: string,
): OperationalityResult[] {
  const results: OperationalityResult[] = [];

  for (const node of nodes) {
    if (node.category !== 'Intentions') continue;

    const treeBase = computeTreeBase(node);
    const falsMod = falsifiabilityModifier(node);
    const sitBonus = (node.situation_refs?.length ?? 0) > 0 ? 1 : 0;
    const operationality = Math.max(1, Math.min(5, treeBase + falsMod + sitBonus));

    node.operationality = operationality;
    const historyEntry: WeightHistoryEntry = {
      date,
      value: operationality,
      delta: 0,
      reason: `Initial assignment: ${treeBase === 4 ? 'leaf' : treeBase === 3 ? 'mid-tree' : 'root'} Intention`
        + (falsMod !== 0 ? ` (falsifiability ${falsMod > 0 ? '+1' : '-1'})` : '')
        + (sitBonus > 0 ? ' (situation grounded)' : ''),
    };
    node.operationality_history = [historyEntry];

    results.push({ nodeId: node.id, operationality, treeBase, falsifiabilityMod: falsMod, situationBonus: sitBonus });
  }

  return results;
}
