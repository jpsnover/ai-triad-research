// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Desire priority assignment based on hierarchy + doctrinal boundaries.
 *
 * Priority levels:
 *   5 — Core: hardcoded boundary (identity-defining, never concede)
 *   4 — High: softcoded boundary OR root-level Desires (no parent)
 *   3 — Important: mid-tree Desires (has parent and children)
 *   2 — Preferred: leaf Desires (has parent, no children)
 *   1 — Nice-to-have: (not assigned by initial formula — reserved for future demotion)
 *
 * See docs/weighted-bdi-proposal.md §"Desire Priority"
 */

import type { PovNode, WeightHistoryEntry } from './taxonomyTypes.js';

/**
 * Determine base priority from tree position.
 * Root (no parent) → 4, mid-tree (parent + children) → 3, leaf (parent, no children) → 2.
 */
export function computeTreePriority(node: PovNode): number {
  if (!node.parent_id) return 4;             // root-level
  if (node.children.length > 0) return 3;    // mid-tree
  return 2;                                  // leaf
}

export interface DesirePriorityResult {
  nodeId: string;
  priority: number;
  isDoctrinalBoundary: boolean;
  boundaryType?: 'hardcoded' | 'softcoded';
}

/**
 * Assign priority to a batch of Desire nodes.
 * Filters to Desires only. Mutates nodes in place.
 *
 * @param nodes - All POV nodes (Desires will be filtered)
 * @param doctrinalBoundaryIds - Set of Desire node IDs that correspond to hardcoded doctrinal boundaries (priority 5)
 * @param date - ISO date string for history entry
 * @param softcodedBoundaryIds - Set of Desire node IDs that correspond to softcoded boundaries (priority 4)
 */
export function assignDesirePriorities(
  nodes: PovNode[],
  doctrinalBoundaryIds: Set<string>,
  date: string,
  softcodedBoundaryIds?: Set<string>,
): DesirePriorityResult[] {
  const results: DesirePriorityResult[] = [];
  const softcoded = softcodedBoundaryIds ?? new Set<string>();

  for (const node of nodes) {
    if (node.category !== 'Desires') continue;

    const isHardcoded = doctrinalBoundaryIds.has(node.id);
    const isSoftcoded = softcoded.has(node.id);
    const isDoctrinal = isHardcoded || isSoftcoded;
    const priority = isHardcoded ? 5 : isSoftcoded ? 4 : computeTreePriority(node);

    node.priority = priority;
    const historyEntry: WeightHistoryEntry = {
      date,
      value: priority,
      delta: 0,
      reason: isHardcoded
        ? 'Initial assignment: hardcoded boundary'
        : isSoftcoded
          ? 'Initial assignment: softcoded boundary'
          : `Initial assignment: ${!node.parent_id ? 'root-level' : node.children.length > 0 ? 'mid-tree' : 'leaf'} Desire`,
    };
    node.priority_history = [historyEntry];

    results.push({
      nodeId: node.id,
      priority,
      isDoctrinalBoundary: isDoctrinal,
      boundaryType: isHardcoded ? 'hardcoded' : isSoftcoded ? 'softcoded' : undefined,
    });
  }

  return results;
}
