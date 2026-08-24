// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/2709 — the server's GET /api/analytics/engagement returns an EngagementTree
 * ({tool,camps,tabs}), but every panel consumes the hierarchical TreeNode
 * ({id,…metrics,children}) via sumByCamp / sumByCategoryForCamp / collectLeafNodes.
 * `bridgeGet<T>` cast the wire JSON straight to TreeNode, so the shape mismatch
 * compiled and shipped an empty dashboard. These tests pin engagementTreeToTreeNode:
 * they assert the adapter output is exactly what the traversal utilities expect, so
 * the two contracts can never silently diverge again.
 */

import { describe, it, expect } from 'vitest';
import {
  engagementTreeToTreeNode,
  sumByCamp,
  sumByCategoryForCamp,
  collectLeafNodes,
  type WireEngagementTree,
} from './engagementTree';

// A realistic wire tree: tool root, two camps (acc has a category+nodes, saf is bare),
// and a non-taxonomy tab that must NOT surface as a camp.
const WIRE: WireEngagementTree = {
  tool: { visits: 100, engagedVisits: 60, engagedMs: 50_000, cappedRate: 0.1, uniqueUsers: 5 },
  camps: {
    acc: {
      visits: 40, engagedVisits: 25, engagedMs: 20_000, cappedRate: 0,
      categories: {
        'acc-bel': {
          visits: 30, engagedVisits: 20, engagedMs: 15_000, cappedRate: 0,
          nodes: {
            'acc-bel-001': { visits: 20, engagedVisits: 12, engagedMs: 9_000, cappedRate: 0 },
            'acc-bel-002': { visits: 10, engagedVisits: 8, engagedMs: 6_000, cappedRate: 0 },
          },
        },
      },
    },
    saf: { visits: 25, engagedVisits: 15, engagedMs: 12_000, cappedRate: 0, categories: {} },
  },
  tabs: {
    summaries: { visits: 35, engagedVisits: 20, engagedMs: 18_000, cappedRate: 0 },
  },
};

describe('engagementTreeToTreeNode (t/2709)', () => {
  it('maps tool metrics onto the root node (what HealthStrip / isEmpty read)', () => {
    const root = engagementTreeToTreeNode(WIRE);
    expect(root.id).toBe('root');
    expect(root.visits).toBe(100);
    expect(root.engagedVisits).toBe(60);
    expect(root.engagedMs).toBe(50_000);
    expect(root.cappedRate).toBe(0.1);
    expect(root.uniqueUsers).toBe(5);
  });

  it('nests root → single tool → camps (the two levels sumByCamp walks)', () => {
    const root = engagementTreeToTreeNode(WIRE);
    expect(Object.keys(root.children ?? {})).toEqual(['tool']);
    const tool = root.children!.tool;
    // camps present; the `summaries` tab is intentionally excluded (non-taxonomy).
    expect(Object.keys(tool.children ?? {}).sort()).toEqual(['acc', 'saf']);
    expect(tool.children!.summaries).toBeUndefined();
  });

  it('feeds sumByCamp correctly (per-camp engagedMs/visits, sorted desc)', () => {
    const root = engagementTreeToTreeNode(WIRE);
    expect(sumByCamp(root)).toEqual([
      { key: 'acc', engagedMs: 20_000, visits: 40 },
      { key: 'saf', engagedMs: 12_000, visits: 25 },
    ]);
  });

  it('feeds sumByCategoryForCamp correctly for a camp with categories', () => {
    const root = engagementTreeToTreeNode(WIRE);
    expect(sumByCategoryForCamp(root, 'acc')).toEqual([
      { key: 'acc-bel', engagedMs: 15_000, visits: 30 },
    ]);
    // A camp with no categories yields no rows (not a throw).
    expect(sumByCategoryForCamp(root, 'saf')).toEqual([]);
  });

  it('feeds collectLeafNodes only the taxonomy nodes (depth ≥ 3), not camps/categories', () => {
    const root = engagementTreeToTreeNode(WIRE);
    const leaves: Array<{ id: string; engagedMs: number; visits: number }> = [];
    collectLeafNodes(root, 0, leaves);
    expect(leaves.map(l => l.id).sort()).toEqual(['acc-bel-001', 'acc-bel-002']);
    expect(leaves.find(l => l.id === 'acc-bel-001')).toEqual({ id: 'acc-bel-001', engagedMs: 9_000, visits: 20 });
  });

  it('returns null for a missing tree so callers keep their empty-state handling', () => {
    expect(engagementTreeToTreeNode(null)).toBeNull();
    expect(engagementTreeToTreeNode(undefined)).toBeNull();
  });

  it('tolerates a partial tree (server omits empty camps/categories/nodes)', () => {
    const bare: WireEngagementTree = {
      tool: { visits: 0, engagedVisits: 0, engagedMs: 0, cappedRate: 0 },
      camps: {},
      tabs: {},
    };
    const root = engagementTreeToTreeNode(bare);
    expect(root.visits).toBe(0);                       // isEmpty → true
    expect(Object.keys(root.children!.tool.children ?? {})).toEqual([]);
    expect(sumByCamp(root)).toEqual([]);
  });
});
