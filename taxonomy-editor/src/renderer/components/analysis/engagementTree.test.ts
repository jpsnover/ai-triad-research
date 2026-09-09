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
  formatNonComparabilityFootnote,
  fmtCappedRate,
  type WireEngagementTree,
  type NonComparabilityBoundary,
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

  it('feeds sumByCamp correctly (per-camp engagedMs/visits/cappedRate, sorted desc)', () => {
    const root = engagementTreeToTreeNode(WIRE);
    expect(sumByCamp(root)).toEqual([
      { key: 'acc', engagedMs: 20_000, visits: 40, cappedRate: 0 },
      { key: 'saf', engagedMs: 12_000, visits: 25, cappedRate: 0 },
    ]);
  });

  it('feeds sumByCategoryForCamp correctly for a camp with categories', () => {
    const root = engagementTreeToTreeNode(WIRE);
    expect(sumByCategoryForCamp(root, 'acc')).toEqual([
      { key: 'acc-bel', engagedMs: 15_000, visits: 30, cappedRate: 0 },
    ]);
    // A camp with no categories yields no rows (not a throw).
    expect(sumByCategoryForCamp(root, 'saf')).toEqual([]);
  });

  it('feeds collectLeafNodes only the taxonomy nodes (depth ≥ 3), not camps/categories', () => {
    const root = engagementTreeToTreeNode(WIRE);
    const leaves: Array<{ id: string; engagedMs: number; visits: number; cappedRate?: number }> = [];
    collectLeafNodes(root, 0, leaves);
    expect(leaves.map(l => l.id).sort()).toEqual(['acc-bel-001', 'acc-bel-002']);
    expect(leaves.find(l => l.id === 'acc-bel-001')).toEqual({ id: 'acc-bel-001', engagedMs: 9_000, visits: 20, cappedRate: 0 });
  });

  it('sumByCamp weights cappedRate by engagedVisits and omits it when no engaged visits exist', () => {
    const wireVariedCap: WireEngagementTree = {
      tool: { visits: 0, engagedVisits: 0, engagedMs: 0, cappedRate: 0 },
      camps: {
        acc: { visits: 10, engagedVisits: 10, engagedMs: 1000, cappedRate: 0.5, categories: {} },
        saf: { visits: 10, engagedVisits: 0, engagedMs: 0, cappedRate: 0, categories: {} },
      },
      tabs: {},
    };
    const root = engagementTreeToTreeNode(wireVariedCap);
    const rows = sumByCamp(root);
    expect(rows.find(r => r.key === 'acc')?.cappedRate).toBe(0.5);
    // saf has zero engagedVisits — no weight to average, cappedRate is omitted, not 0.
    expect(rows.find(r => r.key === 'saf')?.cappedRate).toBeUndefined();
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

describe('fmtCappedRate', () => {
  it('formats a [0,1] fraction as a rounded percentage', () => {
    expect(fmtCappedRate(0.123)).toBe('12.3%');
    expect(fmtCappedRate(0)).toBe('0.0%');
    expect(fmtCappedRate(1)).toBe('100.0%');
  });
});

describe('formatNonComparabilityFootnote (t/3424)', () => {
  it('returns an empty string for no boundaries', () => {
    expect(formatNonComparabilityFootnote([])).toBe('');
  });

  it('renders a single boundary as one clause', () => {
    const boundaries: NonComparabilityBoundary[] = [{ date: '2026-09-09T15:15:45Z', label: 'client idle-tail fix' }];
    const text = formatNonComparabilityFootnote(boundaries);
    expect(text).toContain('2026-09-09 (client idle-tail fix)');
    expect(text).toContain("aren't one comparable series");
  });

  it('groups same-day boundaries into a single clause instead of repeating the date', () => {
    const boundaries: NonComparabilityBoundary[] = [
      { date: '2026-09-09T15:15:45Z', label: 'client idle-tail fix' },
      { date: '2026-09-09T15:23:26Z', label: 'server winsorize cap' },
    ];
    const text = formatNonComparabilityFootnote(boundaries);
    expect(text).toContain('2026-09-09 (client idle-tail fix, server winsorize cap)');
    // The date string itself appears exactly once, not twice.
    expect(text.split('2026-09-09').length - 1).toBe(1);
  });

  it('renders distinct dates as separate "and"-joined clauses, sorted chronologically', () => {
    const boundaries: NonComparabilityBoundary[] = [
      { date: '2026-09-20T00:00:00Z', label: 'accumulator rewrite' },
      { date: '2026-09-09T15:15:45Z', label: 'client idle-tail fix' },
    ];
    const text = formatNonComparabilityFootnote(boundaries);
    const idxFirst = text.indexOf('2026-09-09');
    const idxSecond = text.indexOf('2026-09-20');
    expect(idxFirst).toBeGreaterThan(-1);
    expect(idxSecond).toBeGreaterThan(idxFirst);
    expect(text).toContain(' and ');
  });
});
