// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { selectRelevantNodes, selectRelevantSituationNodes, computePolicymakerRelevanceBoost } from './taxonomyRelevance.js';
import type { LineageBoostConfig, LineageBoostResult, RelevanceOptions } from './taxonomyRelevance.js';
import type { PovNode, Category, SituationNode } from './taxonomyTypes.js';

// ── Helpers ──────────────────────────────────────────────

function makeNode(id: string, category: Category = 'Beliefs'): PovNode {
  return {
    id,
    label: `Node ${id}`,
    description: `Description for ${id}`,
    category,
  } as PovNode;
}

// ── Lineage boost in selectRelevantNodes ──────────────────

describe('selectRelevantNodes — lineage boost', () => {
  const nameToCluster: Record<string, string> = {
    'AI alignment': 'ai-safety',
    'RLHF': 'ai-safety',
    'labor economics': 'labor-econ',
    'tort law': 'legal-theory',
  };

  it('boosts matching nodes above threshold', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-beliefs-002', 'Beliefs'),
      makeNode('acc-beliefs-003', 'Beliefs'),
    ];

    // Node 001 is just below threshold, node 002 is above, node 003 is far below
    const scores = new Map([
      ['acc-beliefs-001', 0.44],  // just below 0.48
      ['acc-beliefs-002', 0.55],  // above
      ['acc-beliefs-003', 0.20],  // far below
    ]);

    const lineageBoost: LineageBoostConfig = {
      traditions: ['ai-safety'],
      boost: 0.08,
      lineageByNode: {
        'acc-beliefs-001': ['AI alignment', 'RLHF'],  // matches ai-safety
        'acc-beliefs-002': ['labor economics'],         // no match
        'acc-beliefs-003': ['tort law'],                // no match
      },
      nameToCluster,
    };

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      lineageBoost,
    });

    // Node 001 should now be boosted to 0.52 (above 0.48), so it's included
    const ids = result.map(r => r.node.id);
    expect(ids).toContain('acc-beliefs-001');
    expect(ids).toContain('acc-beliefs-002');
    // Node 001 should have boosted score
    const node001 = result.find(r => r.node.id === 'acc-beliefs-001');
    expect(node001!.score).toBeCloseTo(0.52);
  });

  it('does not boost nodes without matching traditions', () => {
    const nodes = [makeNode('acc-beliefs-001', 'Beliefs')];
    const scores = new Map([['acc-beliefs-001', 0.44]]);

    const lineageBoost: LineageBoostConfig = {
      traditions: ['labor-econ'],  // not matching
      boost: 0.08,
      lineageByNode: {
        'acc-beliefs-001': ['AI alignment'],  // maps to ai-safety, not labor-econ
      },
      nameToCluster,
    };

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      lineageBoost,
    });

    // No boost applied — 0.44 is below 0.48 threshold, not included (minPerCategory=0)
    expect(result).toHaveLength(0);
  });

  it('is backward compatible when lineageBoost absent', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('saf-desires-001', 'Desires'),
      makeNode('skp-intentions-001', 'Intentions'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.60],
      ['saf-desires-001', 0.55],
      ['skp-intentions-001', 0.50],
    ]);

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 1,
    });

    expect(result).toHaveLength(3);
  });

  it('exposes lineage boost diagnostics on result', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-beliefs-002', 'Beliefs'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.44],
      ['acc-beliefs-002', 0.55],
    ]);

    const lineageBoost: LineageBoostConfig = {
      traditions: ['ai-safety'],
      boost: 0.08,
      lineageByNode: {
        'acc-beliefs-001': ['AI alignment'],
        'acc-beliefs-002': ['AI alignment'],
      },
      nameToCluster,
    };

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      lineageBoost,
    });

    const diag = (result as typeof result & { _lineageBoost?: LineageBoostResult })._lineageBoost;
    expect(diag).toBeDefined();
    expect(diag!.boostedNodeIds).toHaveLength(2);
    expect(diag!.promotedNodeIds).toEqual(['acc-beliefs-001']); // only acc-beliefs-001 was promoted (was below, now above)
    expect(diag!.promotedCount).toBe(1);
  });

  it('skips nodes without lineage data', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-beliefs-002', 'Beliefs'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.44],
      ['acc-beliefs-002', 0.44],
    ]);

    const lineageBoost: LineageBoostConfig = {
      traditions: ['ai-safety'],
      boost: 0.08,
      lineageByNode: {
        'acc-beliefs-001': ['AI alignment'],
        // acc-beliefs-002 has no lineage data
      },
      nameToCluster,
    };

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      lineageBoost,
    });

    // Only node 001 gets boosted
    const ids = result.map(r => r.node.id);
    expect(ids).toContain('acc-beliefs-001');
    expect(ids).not.toContain('acc-beliefs-002');
  });

  it('does not boost nodes below the near-miss floor (threshold - 0.06)', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),  // 0.41 — below floor (0.42)
      makeNode('acc-beliefs-002', 'Beliefs'),  // 0.43 — above floor
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.41],
      ['acc-beliefs-002', 0.43],
    ]);

    const lineageBoost: LineageBoostConfig = {
      traditions: ['ai-safety'],
      boost: 0.08,
      lineageByNode: {
        'acc-beliefs-001': ['AI alignment'],
        'acc-beliefs-002': ['AI alignment'],
      },
      nameToCluster,
    };

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      lineageBoost,
    });

    const ids = result.map(r => r.node.id);
    // 0.43 + 0.08 = 0.51 → promoted; 0.41 is below floor (0.42) → not boosted
    expect(ids).toContain('acc-beliefs-002');
    expect(ids).not.toContain('acc-beliefs-001');

    const diag = (result as typeof result & { _lineageBoost?: LineageBoostResult })._lineageBoost;
    expect(diag!.boostedNodeIds).toEqual(['acc-beliefs-002']);
    expect(diag!.promotedNodeIds).toEqual(['acc-beliefs-002']);
    expect(diag!.promotedCount).toBe(1);
  });

  it('caps promotions at 5 — only top 5 below-threshold nodes cross', () => {
    // Create 10 nodes all just below threshold, all matching lineage
    const nodes = Array.from({ length: 10 }, (_, i) =>
      makeNode(`acc-beliefs-${String(i + 1).padStart(3, '0')}`, 'Beliefs'),
    );
    // Scores: 0.43–0.479 (all below 0.48 threshold, all within near-miss floor)
    const scores = new Map(
      nodes.map((n, i) => [n.id, 0.43 + i * 0.005]),
    );
    // Also add one node already above threshold to verify it always keeps boost
    const aboveNode = makeNode('acc-beliefs-100', 'Beliefs');
    nodes.push(aboveNode);
    scores.set('acc-beliefs-100', 0.55);

    const lineageByNode: Record<string, string[]> = {};
    for (const n of nodes) lineageByNode[n.id] = ['AI alignment'];

    const lineageBoost: LineageBoostConfig = {
      traditions: ['ai-safety'],
      boost: 0.08,
      lineageByNode,
      nameToCluster,
    };

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      lineageBoost,
    });

    const diag = (result as typeof result & { _lineageBoost?: LineageBoostResult })._lineageBoost;
    expect(diag).toBeDefined();

    // Only 5 promotions allowed, not 10
    expect(diag!.promotedCount).toBe(5);
    expect(diag!.promotedNodeIds).toHaveLength(5);

    // The top 5 by boosted score should be the ones with highest base scores (008–010)
    // since boostedScore = baseScore + 0.08 and sort is descending
    for (const id of ['acc-beliefs-010', 'acc-beliefs-009', 'acc-beliefs-008', 'acc-beliefs-007', 'acc-beliefs-006']) {
      expect(diag!.promotedNodeIds).toContain(id);
    }

    // Above-threshold node always keeps boost (not subject to cap)
    expect(diag!.boostedNodeIds).toContain('acc-beliefs-100');
    // Above-threshold node is NOT a promotion
    expect(diag!.promotedNodeIds).not.toContain('acc-beliefs-100');

    // Excess below-threshold nodes (001–005) should not be in result (reverted to base < 0.48)
    const ids = result.map(r => r.node.id);
    for (const id of ['acc-beliefs-001', 'acc-beliefs-002', 'acc-beliefs-003', 'acc-beliefs-004', 'acc-beliefs-005']) {
      expect(ids).not.toContain(id);
    }
  });
});

// ── computePolicymakerRelevanceBoost ────────────────────────────────

describe('computePolicymakerRelevanceBoost', () => {
  it('returns +0.10 when 2+ keyword matches for policymaker audience', () => {
    const sit = { description: 'The agency issued a new regulation on AI safety compliance standards.' };
    expect(computePolicymakerRelevanceBoost(sit, 'policymakers')).toBe(0.10);
  });

  it('returns 0 when only 1 keyword match', () => {
    const sit = { description: 'The regulation addresses fundamental questions about technology.' };
    expect(computePolicymakerRelevanceBoost(sit, 'policymakers')).toBe(0);
  });

  it('returns 0 for non-policymaker audience', () => {
    const sit = { description: 'The agency issued a new regulation on AI safety compliance standards.' };
    expect(computePolicymakerRelevanceBoost(sit, 'researchers')).toBe(0);
    expect(computePolicymakerRelevanceBoost(sit, undefined)).toBe(0);
  });

  it('matches keywords case-insensitively', () => {
    const sit = { description: 'Congressional OVERSIGHT BODY reviewed the mandate.' };
    expect(computePolicymakerRelevanceBoost(sit, 'policymakers')).toBe(0.10);
  });

  it('returns 0 for empty description', () => {
    const sit = { description: '' };
    expect(computePolicymakerRelevanceBoost(sit, 'policymakers')).toBe(0);
  });
});

// ── selectRelevantSituationNodes — divergence penalty ───────────────

describe('selectRelevantSituationNodes — divergence penalty', () => {
  function makeSit(id: string, divergence?: number): SituationNode {
    return {
      id,
      label: `Situation ${id}`,
      description: `Description for ${id}`,
      interpretations: {
        accelerationist: 'interp',
        safetyist: 'interp',
        skeptic: 'interp',
      },
      linked_nodes: [],
      conflict_ids: [],
      interpretation_divergence: divergence,
    };
  }

  it('penalizes low-divergence situations (<0.20) by -0.05', () => {
    const nodes = [
      makeSit('sit-001', 0.10), // low divergence
      makeSit('sit-002', 0.50), // high divergence
    ];
    // Both at same base score — low divergence should rank lower
    const scores = new Map([['sit-001', 0.55], ['sit-002', 0.55]]);
    const result = selectRelevantSituationNodes(nodes, scores, 0.48, 0, 10);
    expect(result[0].node.id).toBe('sit-002'); // high-divergence first
    expect(result[1].node.id).toBe('sit-001'); // penalized
    expect(result[1].score).toBe(0.50); // 0.55 - 0.05
  });

  it('does not penalize when divergence >= 0.20', () => {
    const nodes = [makeSit('sit-001', 0.25)];
    const scores = new Map([['sit-001', 0.55]]);
    const result = selectRelevantSituationNodes(nodes, scores, 0.48, 0, 10);
    expect(result[0].score).toBe(0.55); // no penalty
  });

  it('does not penalize when divergence is absent', () => {
    const nodes = [makeSit('sit-001', undefined)];
    const scores = new Map([['sit-001', 0.55]]);
    const result = selectRelevantSituationNodes(nodes, scores, 0.48, 0, 10);
    expect(result[0].score).toBe(0.55); // backward compatible
  });
});
