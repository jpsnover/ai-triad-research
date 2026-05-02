// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

// ── Default constants ────────────────────────────────────────────────
export const GC_TRIGGER = 175;
export const GC_TARGET = 150;
export const HARD_CAP = 200;

// ── Result type ──────────────────────────────────────────────────────

export interface GcResult {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
  prunedNodes: ArgumentNetworkNode[];
  prunedEdges: ArgumentNetworkEdge[];
  before: number;
  after: number;
}

// ── Threshold helpers ────────────────────────────────────────────────

/** Returns true when the network has grown large enough to trigger GC. */
export function needsGc(nodeCount: number, gcTrigger: number): boolean {
  return nodeCount >= gcTrigger;
}

/** Returns true when the network has hit the hard cap and must be pruned immediately. */
export function needsHardCap(nodeCount: number, hardCap: number): boolean {
  return nodeCount >= hardCap;
}

// ── Pruning ──────────────────────────────────────────────────────────

/**
 * Prune low-value nodes from the argument network to preserve QBAF
 * performance and extraction fidelity.
 *
 * Pruning tiers (lowest priority first):
 *   1. Orphan nodes — zero edges
 *   2. Tangential leaf nodes — computed_strength < 0.3, no support edges, ≤1 attack edge
 *   3. Low-engagement nodes — computed_strength < 0.4, only 1 edge total
 *
 * Within each tier nodes are sorted by computed_strength ascending (weakest first).
 * Pruning stops as soon as `nodes.length <= targetSize`.
 */
export function pruneArgumentNetwork(
  nodes: ArgumentNetworkNode[],
  edges: ArgumentNetworkEdge[],
  targetSize: number,
): GcResult {
  const before = nodes.length;

  // Fast path: already within budget
  if (nodes.length <= targetSize) {
    return {
      nodes: [...nodes],
      edges: [...edges],
      prunedNodes: [],
      prunedEdges: [],
      before,
      after: nodes.length,
    };
  }

  // Working copies — we'll mutate these as we prune
  let liveNodes = [...nodes];
  let liveEdges = [...edges];
  const prunedNodes: ArgumentNetworkNode[] = [];
  const prunedEdges: ArgumentNetworkEdge[] = [];

  /**
   * Remove a set of node IDs from the live network, collecting pruned
   * nodes and their dangling edges.
   */
  function removeNodes(idsToRemove: Set<string>): void {
    for (const node of liveNodes) {
      if (idsToRemove.has(node.id)) {
        prunedNodes.push(node);
      }
    }
    liveNodes = liveNodes.filter((n) => !idsToRemove.has(n.id));

    // Remove edges that reference any pruned node
    const newEdges: ArgumentNetworkEdge[] = [];
    for (const edge of liveEdges) {
      if (idsToRemove.has(edge.source) || idsToRemove.has(edge.target)) {
        prunedEdges.push(edge);
      } else {
        newEdges.push(edge);
      }
    }
    liveEdges = newEdges;
  }

  /** Build adjacency counts from the current live edge set. */
  function buildEdgeMaps() {
    const edgeCount = new Map<string, number>();
    const supportCount = new Map<string, number>();
    const attackCount = new Map<string, number>();

    for (const node of liveNodes) {
      edgeCount.set(node.id, 0);
      supportCount.set(node.id, 0);
      attackCount.set(node.id, 0);
    }

    for (const edge of liveEdges) {
      edgeCount.set(edge.source, (edgeCount.get(edge.source) ?? 0) + 1);
      edgeCount.set(edge.target, (edgeCount.get(edge.target) ?? 0) + 1);

      if (edge.type === 'supports') {
        supportCount.set(edge.source, (supportCount.get(edge.source) ?? 0) + 1);
        supportCount.set(edge.target, (supportCount.get(edge.target) ?? 0) + 1);
      } else {
        attackCount.set(edge.source, (attackCount.get(edge.source) ?? 0) + 1);
        attackCount.set(edge.target, (attackCount.get(edge.target) ?? 0) + 1);
      }
    }

    return { edgeCount, supportCount, attackCount };
  }

  /** Sort by computed_strength ascending (weakest first). Treat undefined as 0. */
  function sortByStrengthAsc(a: ArgumentNetworkNode, b: ArgumentNetworkNode): number {
    return (a.computed_strength ?? 0) - (b.computed_strength ?? 0);
  }

  /**
   * Given a sorted candidate list, select just enough IDs to reach targetSize,
   * remove them, and return whether we've reached the target.
   */
  function pruneFromCandidates(candidates: ArgumentNetworkNode[]): boolean {
    if (liveNodes.length <= targetSize) return true;

    const excess = liveNodes.length - targetSize;
    const toPrune = candidates.slice(0, excess);
    if (toPrune.length > 0) {
      removeNodes(new Set(toPrune.map((n) => n.id)));
    }
    return liveNodes.length <= targetSize;
  }

  // ── Tier 1: Orphan nodes (zero edges) ──────────────────────────────
  {
    const { edgeCount } = buildEdgeMaps();
    const orphans = liveNodes
      .filter((n) => (edgeCount.get(n.id) ?? 0) === 0)
      .sort(sortByStrengthAsc);

    if (pruneFromCandidates(orphans)) {
      return { nodes: liveNodes, edges: liveEdges, prunedNodes, prunedEdges, before, after: liveNodes.length };
    }
  }

  // ── Tier 2: Tangential leaf nodes ──────────────────────────────────
  //   computed_strength < 0.3, zero support edges, ≤1 attack edge
  {
    const { supportCount, attackCount } = buildEdgeMaps();
    const tangential = liveNodes
      .filter((n) => {
        const strength = n.computed_strength ?? 0;
        return (
          strength < 0.3 &&
          (supportCount.get(n.id) ?? 0) === 0 &&
          (attackCount.get(n.id) ?? 0) <= 1
        );
      })
      .sort(sortByStrengthAsc);

    if (pruneFromCandidates(tangential)) {
      return { nodes: liveNodes, edges: liveEdges, prunedNodes, prunedEdges, before, after: liveNodes.length };
    }
  }

  // ── Tier 3: Low-engagement nodes ───────────────────────────────────
  //   computed_strength < 0.4, only 1 edge total
  {
    const { edgeCount } = buildEdgeMaps();
    const lowEngagement = liveNodes
      .filter((n) => {
        const strength = n.computed_strength ?? 0;
        return strength < 0.4 && (edgeCount.get(n.id) ?? 0) === 1;
      })
      .sort(sortByStrengthAsc);

    if (pruneFromCandidates(lowEngagement)) {
      return { nodes: liveNodes, edges: liveEdges, prunedNodes, prunedEdges, before, after: liveNodes.length };
    }
  }

  // If we've exhausted all tiers and still above target, return what we have
  return {
    nodes: liveNodes,
    edges: liveEdges,
    prunedNodes,
    prunedEdges,
    before,
    after: liveNodes.length,
  };
}
