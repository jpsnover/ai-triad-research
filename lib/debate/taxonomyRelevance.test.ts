// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { selectRelevantNodes } from './taxonomyRelevance.js';
import type { LineageBoostConfig, LineageBoostResult, RelevanceOptions } from './taxonomyRelevance.js';
import type { PovNode, Category } from './taxonomyTypes.js';

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
    expect(diag!.promotedCount).toBe(1); // only acc-beliefs-001 was promoted (was below, now above)
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
});
