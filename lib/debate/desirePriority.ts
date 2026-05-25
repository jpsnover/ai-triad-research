// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Desire priority assignment based on hierarchy + doctrinal boundaries.
 *
 * Priority levels:
 *   5 — Core: non-negotiable value (doctrinal boundary)
 *   4 — High: root-level Desires (no parent)
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
}

/**
 * Assign priority to a batch of Desire nodes.
 * Filters to Desires only. Mutates nodes in place.
 *
 * @param nodes - All POV nodes (Desires will be filtered)
 * @param doctrinalBoundaryIds - Set of Desire node IDs that correspond to doctrinal boundaries (priority 5)
 * @param date - ISO date string for history entry
 */
export function assignDesirePriorities(
  nodes: PovNode[],
  doctrinalBoundaryIds: Set<string>,
  date: string,
): DesirePriorityResult[] {
  const results: DesirePriorityResult[] = [];

  for (const node of nodes) {
    if (node.category !== 'Desires') continue;

    const isDoctrinal = doctrinalBoundaryIds.has(node.id);
    const priority = isDoctrinal ? 5 : computeTreePriority(node);

    node.priority = priority;
    const historyEntry: WeightHistoryEntry = {
      date,
      value: priority,
      delta: 0,
      reason: isDoctrinal
        ? 'Initial assignment: doctrinal boundary'
        : `Initial assignment: ${!node.parent_id ? 'root-level' : node.children.length > 0 ? 'mid-tree' : 'leaf'} Desire`,
    };
    node.priority_history = [historyEntry];

    results.push({ nodeId: node.id, priority, isDoctrinalBoundary: isDoctrinal });
  }

  return results;
}
