// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { selectRelevantNodes, selectRelevantSituationNodes, buildSituationRootLookup, scoreNodeRelevanceMeanTopN, cosineSimilarity, computePolicymakerRelevanceBoost, filterByTopicConstraints } from './taxonomyRelevance.js';
import type { LineageBoostConfig, LineageBoostResult, BranchBoostResult, RelevanceOptions, ScoredPovNode, ScoredSituationNode, PovDiversityResult } from './taxonomyRelevance.js';
import type { TopicScope } from './types.js';
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
      minPerPov: 0,
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
      minPerPov: 0,
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
      minPerPov: 0,
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

// ── filterByTopicConstraints — discipline boost ─────────────────

describe('filterByTopicConstraints — discipline boost', () => {
  function makeScoredNode(id: string, label: string, description: string, score: number, category: Category = 'Beliefs'): ScoredPovNode {
    return { node: { ...makeNode(id, category), label, description }, score };
  }

  function makeScope(overrides: Partial<TopicScope> = {}): TopicScope {
    return {
      core_proposition: 'AI hiring tools in low-risk consumer products',
      relevant_disciplines: ['labor economics', 'employment law'],
      on_scope_evidence: [],
      key_tensions: [],
      off_scope_topics: [],
      drift_signatures: [],
      example_ceiling: 'job application rejection',
      risk_level: 'low',
      domain: 'employment',
      product_type: null,
      time_horizon: null,
      excluded_scenarios: [],
      explicit_qualifiers: [],
      constraint_confidence: 'inferred',
      ...overrides,
    };
  }

  it('boosts nodes matching 2+ discipline terms with graduated formula', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'Labor market dynamics', 'Labor economics and hiring patterns in automated systems', 0.6),
      makeScoredNode('acc-beliefs-002', 'General AI progress', 'Advances in transformer architecture and compute scaling', 0.5),
    ];
    const result = filterByTopicConstraints(nodes, makeScope());
    expect(result.boosted).toHaveLength(1);
    expect(result.boosted[0].nodeId).toBe('acc-beliefs-001');
    expect(result.boosted[0].originalScore).toBe(0.6);
    expect(result.boosted[0].matchCount).toBe(2);
    expect(result.boosted[0].boostFactor).toBeCloseTo(1.2);
    expect(result.boosted[0].newScore).toBeCloseTo(0.72);
    expect(result.boosted[0].matchedTerms).toContain('labor');
    const boostedNode = result.nodes.find(n => n.node.id === 'acc-beliefs-001');
    expect(boostedNode!.score).toBeCloseTo(0.72);
  });

  it('does not boost with fewer than 2 matching terms', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'Market trends', 'General economics overview of tech markets', 0.6),
    ];
    const result = filterByTopicConstraints(nodes, makeScope());
    expect(result.boosted).toHaveLength(0);
    expect(result.nodes[0].score).toBe(0.6);
  });

  it('respects custom boostIncrement and boostCap config', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'Labor market dynamics', 'Labor economics and employment law compliance', 0.5),
    ];
    // 3 matches (labor, economics, employment) × 0.2 increment = 1.6×, cap 2.0
    const result = filterByTopicConstraints(nodes, makeScope(), { boostIncrement: 0.2, boostCap: 2.0 });
    expect(result.boosted[0].matchCount).toBe(3);
    expect(result.boosted[0].boostFactor).toBeCloseTo(1.6);
    expect(result.boosted[0].newScore).toBeCloseTo(0.8);
  });

  it('graduates boost by match count (3 matches = 1.3×)', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'Labor economics employment law compliance', 'Labor economics employment law compliance overview', 0.5),
    ];
    const result = filterByTopicConstraints(nodes, makeScope({
      relevant_disciplines: ['labor', 'economics', 'employment'],
    }));
    expect(result.boosted).toHaveLength(1);
    expect(result.boosted[0].matchCount).toBe(3);
    expect(result.boosted[0].boostFactor).toBeCloseTo(1.3);
    expect(result.boosted[0].newScore).toBeCloseTo(0.65);
  });

  it('caps boost at boostCap (default 1.5×)', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'Labor economics employment law compliance regulation policy', 'Labor economics employment law compliance regulation policy detail', 0.5),
    ];
    const result = filterByTopicConstraints(nodes, makeScope({
      relevant_disciplines: ['labor', 'economics', 'employment', 'compliance', 'regulation', 'policy'],
    }));
    expect(result.boosted).toHaveLength(1);
    expect(result.boosted[0].matchCount).toBe(6);
    expect(result.boosted[0].boostFactor).toBeCloseTo(1.5);
    expect(result.boosted[0].newScore).toBeCloseTo(0.75);
  });

  it('demotion takes priority over boost', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'Fatal labor catastrophe', 'Catastrophic death toll in labor economics employment markets', 0.6),
    ];
    const result = filterByTopicConstraints(nodes, makeScope({ risk_level: 'low' }));
    expect(result.demoted).toHaveLength(1);
    expect(result.boosted).toHaveLength(0);
  });

  it('returns empty boosted when scope is null', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'Labor trends', 'Labor economics patterns', 0.6),
    ];
    const result = filterByTopicConstraints(nodes, null);
    expect(result.boosted).toHaveLength(0);
    expect(result.nodes[0].score).toBe(0.6);
  });

  it('returns empty boosted when relevant_disciplines is empty', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'Labor trends', 'Labor economics patterns', 0.6),
    ];
    const result = filterByTopicConstraints(nodes, makeScope({ relevant_disciplines: [] }));
    expect(result.boosted).toHaveLength(0);
  });

  it('sorts results by score descending after boost', () => {
    const nodes: ScoredPovNode[] = [
      makeScoredNode('acc-beliefs-001', 'General AI', 'Transformer architecture', 0.7),
      makeScoredNode('acc-beliefs-002', 'Hiring law', 'Employment law and labor economics compliance', 0.5),
    ];
    const result = filterByTopicConstraints(nodes, makeScope());
    expect(result.nodes[0].node.id).toBe('acc-beliefs-001');
    expect(result.nodes[1].node.id).toBe('acc-beliefs-002');
    // 3 matches (labor, economics, employment) × 0.1 = 1.3× boost → 0.5 × 1.3 = 0.65
    expect(result.nodes[1].score).toBeCloseTo(0.65);
  });
});

// ── buildSituationRootLookup ─────────────────────────────────────

describe('buildSituationRootLookup', () => {
  function makeSit(id: string, parentId?: string | null): SituationNode {
    return {
      id, label: `Sit ${id}`, description: '', parent_id: parentId ?? null,
      interpretations: { accelerationist: 'a', safetyist: 'b', skeptic: 'c' },
      linked_nodes: [], conflict_ids: [],
    };
  }

  it('maps children to their root', () => {
    const nodes = [
      makeSit('sit-100', null),      // root
      makeSit('sit-001', 'sit-100'), // depth 1
      makeSit('sit-002', 'sit-001'), // depth 2
    ];
    const lookup = buildSituationRootLookup(nodes);
    expect(lookup.get('sit-100')).toBe('sit-100');
    expect(lookup.get('sit-001')).toBe('sit-100');
    expect(lookup.get('sit-002')).toBe('sit-100');
  });

  it('treats nodes with missing parent_id as standalone roots', () => {
    const nodes = [makeSit('sit-001', null), makeSit('sit-002', undefined)];
    const lookup = buildSituationRootLookup(nodes);
    expect(lookup.get('sit-001')).toBe('sit-001');
    expect(lookup.get('sit-002')).toBe('sit-002');
  });

  it('treats nodes with invalid parent_id (not in set) as standalone', () => {
    const nodes = [makeSit('sit-001', 'sit-999')];
    const lookup = buildSituationRootLookup(nodes);
    expect(lookup.get('sit-001')).toBe('sit-001');
  });

  it('handles cycles gracefully without stack overflow', () => {
    const nodes = [
      makeSit('sit-A', 'sit-B'),
      makeSit('sit-B', 'sit-A'),
    ];
    const lookup = buildSituationRootLookup(nodes);
    // Both resolve without crashing — one breaks the cycle by mapping to itself
    expect(lookup.has('sit-A')).toBe(true);
    expect(lookup.has('sit-B')).toBe(true);
  });
});

// ── selectRelevantSituationNodes — branch boosting ───────────────

describe('selectRelevantSituationNodes — branch boosting', () => {
  function makeSit(id: string, parentId?: string | null, divergence?: number): SituationNode {
    return {
      id, label: `Situation ${id}`, description: `Description for ${id}`,
      parent_id: parentId ?? null,
      interpretations: { accelerationist: 'a', safetyist: 'b', skeptic: 'c' },
      linked_nodes: [], conflict_ids: [], interpretation_divergence: divergence,
    };
  }

  it('boosts nodes in high-scoring branches above threshold', () => {
    const nodes = [
      makeSit('sit-100', null),           // root A
      makeSit('sit-001', 'sit-100', 0.5), // child of A, high score
      makeSit('sit-002', 'sit-100', 0.5), // child of A, medium score
      makeSit('sit-200', null),           // root B
      makeSit('sit-003', 'sit-200', 0.5), // child of B, low score
    ];
    const scores = new Map([
      ['sit-100', 0.60], ['sit-001', 0.55], ['sit-002', 0.50],
      ['sit-200', 0.30], ['sit-003', 0.30],
    ]);
    const result = selectRelevantSituationNodes(nodes, scores, {
      threshold: 0.48,
      situationBranchBoost: { boost: 0.06, branchThreshold: 0.48, maxBranches: 4 },
    }, 0, 10);

    // Branch A nodes should be boosted, branch B should not
    const branchANodes = result.filter(s => ['sit-100', 'sit-001', 'sit-002'].includes(s.node.id));
    const branchBNodes = result.filter(s => ['sit-200', 'sit-003'].includes(s.node.id));
    expect(branchANodes.length).toBeGreaterThan(0);
    // sit-003 at 0.30 should not cross 0.48 threshold (no boost)
    expect(branchBNodes.length).toBe(0);
  });

  it('promotes near-threshold nodes in selected branches', () => {
    const nodes = [
      makeSit('sit-100', null),
      makeSit('sit-001', 'sit-100', 0.5), // below threshold but near
    ];
    const scores = new Map([['sit-100', 0.55], ['sit-001', 0.44]]);
    const result = selectRelevantSituationNodes(nodes, scores, {
      threshold: 0.48,
      situationBranchBoost: { boost: 0.06, branchThreshold: 0.48, maxBranches: 4 },
    }, 0, 10);

    // sit-001 at 0.44 + 0.06 boost = 0.50 → should cross 0.48 threshold
    const promoted = result.find(s => s.node.id === 'sit-001');
    expect(promoted).toBeDefined();
    expect(promoted!.score).toBeCloseTo(0.50);
  });

  it('falls back to flat selection when no branches score above threshold', () => {
    const nodes = [
      makeSit('sit-100', null),
      makeSit('sit-001', 'sit-100', 0.5),
      makeSit('sit-002', 'sit-100', 0.5),
    ];
    const scores = new Map([['sit-100', 0.30], ['sit-001', 0.52], ['sit-002', 0.35]]);
    const result = selectRelevantSituationNodes(nodes, scores, {
      threshold: 0.48,
      situationBranchBoost: { boost: 0.06, branchThreshold: 0.50, maxBranches: 4 },
    }, 0, 10);

    // No branch boost applied — flat selection picks sit-001 above threshold
    expect(result.some(s => s.node.id === 'sit-001')).toBe(true);
    const boost = (result as ScoredSituationNode[] & { _branchBoost?: BranchBoostResult })._branchBoost;
    expect(boost).toBeUndefined();
  });

  it('falls back to flat selection when nodes lack parent_id', () => {
    const nodes = [
      makeSit('sit-001', null, 0.5),
      makeSit('sit-002', null, 0.5),
    ];
    const scores = new Map([['sit-001', 0.55], ['sit-002', 0.52]]);
    const result = selectRelevantSituationNodes(nodes, scores, {
      threshold: 0.48,
      situationBranchBoost: { boost: 0.06, maxBranches: 4 },
    }, 0, 10);

    // All standalone — no hierarchy, should work like flat selection
    expect(result.length).toBe(2);
    expect(result[0].node.id).toBe('sit-001');
  });

  it('exposes diagnostics via _branchBoost property', () => {
    const nodes = [
      makeSit('sit-100', null),
      makeSit('sit-001', 'sit-100', 0.5),
    ];
    const scores = new Map([['sit-100', 0.55], ['sit-001', 0.55]]);
    const result = selectRelevantSituationNodes(nodes, scores, {
      threshold: 0.48,
      situationBranchBoost: { boost: 0.06, maxBranches: 4 },
    }, 0, 10);

    const boost = (result as ScoredSituationNode[] & { _branchBoost?: BranchBoostResult })._branchBoost;
    expect(boost).toBeDefined();
    expect(boost!.selectedBranches.length).toBe(1);
    expect(boost!.selectedBranches[0].rootId).toBe('sit-100');
    expect(boost!.boostedNodeIds).toContain('sit-001');
  });

  it('does not boost root nodes themselves', () => {
    const nodes = [
      makeSit('sit-100', null),
      makeSit('sit-001', 'sit-100', 0.5),
    ];
    const scores = new Map([['sit-100', 0.55], ['sit-001', 0.55]]);
    const result = selectRelevantSituationNodes(nodes, scores, {
      threshold: 0.48,
      situationBranchBoost: { boost: 0.06, maxBranches: 4 },
    }, 0, 10);

    const boost = (result as ScoredSituationNode[] & { _branchBoost?: BranchBoostResult })._branchBoost;
    expect(boost).toBeDefined();
    // Root node should NOT be in the boosted list
    expect(boost!.boostedNodeIds).not.toContain('sit-100');
    // Child should be boosted
    expect(boost!.boostedNodeIds).toContain('sit-001');
    // Root's score should be unboosted (0.55), child's boosted (0.61)
    const rootResult = result.find(s => s.node.id === 'sit-100');
    const childResult = result.find(s => s.node.id === 'sit-001');
    expect(rootResult!.score).toBeCloseTo(0.55);
    expect(childResult!.score).toBeCloseTo(0.61);
  });
});

// ── scoreNodeRelevanceMeanTopN ───────────────────────────

describe('scoreNodeRelevanceMeanTopN', () => {
  // Unit vectors for deterministic similarity testing
  const unitX: number[] = [1, 0, 0];
  const unitY: number[] = [0, 1, 0];
  const unitZ: number[] = [0, 0, 1];
  const midXY: number[] = [Math.SQRT1_2, Math.SQRT1_2, 0]; // 45° between X and Y

  it('returns mean of top-3 cosine similarities for multi-vector nodes', () => {
    const embeddings = {
      'node-A': {
        pov: 'acc',
        vector: unitX,
        vectors: [unitX, midXY, unitY, unitZ], // 4 vectors
      },
    };
    const scores = scoreNodeRelevanceMeanTopN(unitX, embeddings, 3);
    // cos(unitX, unitX) = 1.0, cos(unitX, midXY) ≈ 0.707, cos(unitX, unitY) = 0, cos(unitX, unitZ) = 0
    // Top 3: 1.0, 0.707, 0 → mean ≈ 0.569
    const expected = (1.0 + Math.SQRT1_2 + 0) / 3;
    expect(scores.get('node-A')).toBeCloseTo(expected, 3);
  });

  it('falls back to single-vector cosine when vectors is absent', () => {
    const embeddings = {
      'node-A': { pov: 'acc', vector: midXY },
    };
    const scores = scoreNodeRelevanceMeanTopN(unitX, embeddings, 3);
    expect(scores.get('node-A')).toBeCloseTo(cosineSimilarity(unitX, midXY), 5);
  });

  it('handles fewer vectors than topN gracefully', () => {
    const embeddings = {
      'node-A': { pov: 'acc', vector: unitX, vectors: [unitX, midXY] }, // only 2 vectors
    };
    const scores = scoreNodeRelevanceMeanTopN(unitX, embeddings, 3);
    // Top 2 (all): 1.0, 0.707 → mean ≈ 0.854
    const expected = (1.0 + Math.SQRT1_2) / 2;
    expect(scores.get('node-A')).toBeCloseTo(expected, 3);
  });

  it('scores multiple nodes independently', () => {
    const embeddings = {
      'node-A': { pov: 'acc', vector: unitX, vectors: [unitX, unitX, unitX] },
      'node-B': { pov: 'acc', vector: unitY, vectors: [unitY, unitY, unitY] },
    };
    const scores = scoreNodeRelevanceMeanTopN(unitX, embeddings, 3);
    expect(scores.get('node-A')).toBeCloseTo(1.0);
    expect(scores.get('node-B')).toBeCloseTo(0.0);
  });
});

// ── selectRelevantNodes — POV diversity floor ──────────────

describe('selectRelevantNodes — POV diversity floor', () => {
  it('fills underrepresented POVs from best-scoring candidates', () => {
    // All high-scoring nodes are acc — saf and skp are below threshold
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-desires-001', 'Desires'),
      makeNode('acc-intentions-001', 'Intentions'),
      makeNode('saf-beliefs-001', 'Beliefs'),
      makeNode('saf-desires-001', 'Desires'),
      makeNode('skp-beliefs-001', 'Beliefs'),
      makeNode('skp-desires-001', 'Desires'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.80],
      ['acc-desires-001', 0.75],
      ['acc-intentions-001', 0.70],
      ['saf-beliefs-001', 0.30],
      ['saf-desires-001', 0.25],
      ['skp-beliefs-001', 0.28],
      ['skp-desires-001', 0.22],
    ]);

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      minPerPov: 2,
    });

    const ids = result.map(r => r.node.id);
    // acc nodes above threshold — included naturally
    expect(ids).toContain('acc-beliefs-001');
    expect(ids).toContain('acc-desires-001');
    expect(ids).toContain('acc-intentions-001');
    // saf and skp floor — 2 each, best-scoring from each POV
    expect(ids).toContain('saf-beliefs-001');
    expect(ids).toContain('saf-desires-001');
    expect(ids).toContain('skp-beliefs-001');
    expect(ids).toContain('skp-desires-001');
    expect(result).toHaveLength(7);
  });

  it('does not add nodes when POV already meets floor', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('saf-beliefs-001', 'Beliefs'),
      makeNode('skp-beliefs-001', 'Beliefs'),
      makeNode('acc-desires-001', 'Desires'),
      makeNode('saf-desires-001', 'Desires'),
      makeNode('skp-desires-001', 'Desires'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.60], ['saf-beliefs-001', 0.55], ['skp-beliefs-001', 0.52],
      ['acc-desires-001', 0.58], ['saf-desires-001', 0.54], ['skp-desires-001', 0.50],
    ]);

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      minPerPov: 2,
    });

    // All above threshold, all POVs have >= 2 — no diversity additions
    expect(result).toHaveLength(6);
    const diag = (result as typeof result & { _povDiversity?: PovDiversityResult })._povDiversity;
    expect(diag).toBeUndefined();
  });

  it('handles single-POV input gracefully', () => {
    // Only acc nodes available — can't fill saf/skp floor
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-desires-001', 'Desires'),
      makeNode('acc-intentions-001', 'Intentions'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.60],
      ['acc-desires-001', 0.55],
      ['acc-intentions-001', 0.50],
    ]);

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      minPerPov: 2,
    });

    // Only 3 acc nodes — no saf/skp available to add
    expect(result).toHaveLength(3);
  });

  it('minPerPov=0 disables diversity enforcement', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('saf-beliefs-001', 'Beliefs'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.60],
      ['saf-beliefs-001', 0.30],
    ]);

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      minPerPov: 0,
    });

    // Only acc above threshold, no diversity floor
    expect(result).toHaveLength(1);
    expect(result[0].node.id).toBe('acc-beliefs-001');
  });

  it('protects POV floor nodes when maxTotal trims the result', () => {
    // 4 acc above threshold + 1 saf floor + 1 skp floor = 6, maxTotal = 5
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-beliefs-002', 'Beliefs'),
      makeNode('acc-desires-001', 'Desires'),
      makeNode('acc-intentions-001', 'Intentions'),
      makeNode('saf-beliefs-001', 'Beliefs'),
      makeNode('skp-beliefs-001', 'Beliefs'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.80],
      ['acc-beliefs-002', 0.70],
      ['acc-desires-001', 0.65],
      ['acc-intentions-001', 0.55],
      ['saf-beliefs-001', 0.30],
      ['skp-beliefs-001', 0.28],
    ]);

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      minPerPov: 1,
      maxTotal: 5,
    });

    expect(result).toHaveLength(5);
    const ids = result.map(r => r.node.id);
    // Protected: 1 acc (0.80) + 1 saf (0.30) + 1 skp (0.28) = 3 protected
    // Remaining 2 slots filled by top-scoring non-protected: acc-beliefs-002 (0.70), acc-desires-001 (0.65)
    // acc-intentions-001 (0.55) gets trimmed
    expect(ids).toContain('saf-beliefs-001');
    expect(ids).toContain('skp-beliefs-001');
    expect(ids).toContain('acc-beliefs-001');
    expect(ids).toContain('acc-beliefs-002');
    expect(ids).toContain('acc-desires-001');
    expect(ids).not.toContain('acc-intentions-001');
  });

  it('exposes POV diversity diagnostics on result', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('acc-desires-001', 'Desires'),
      makeNode('saf-beliefs-001', 'Beliefs'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.60],
      ['acc-desires-001', 0.55],
      ['saf-beliefs-001', 0.30],
    ]);

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      minPerPov: 2,
    });

    const diag = (result as typeof result & { _povDiversity?: PovDiversityResult })._povDiversity;
    expect(diag).toBeDefined();
    expect(diag!.povCounts['accelerationist']).toBe(2);
    expect(diag!.povCounts['safetyist']).toBe(0);
    expect(diag!.addedNodeIds).toContain('saf-beliefs-001');
    expect(diag!.addedCount).toBe(1);
  });

  it('picks highest-scoring candidates when filling POV deficit', () => {
    const nodes = [
      makeNode('acc-beliefs-001', 'Beliefs'),
      makeNode('saf-beliefs-001', 'Beliefs'),
      makeNode('saf-beliefs-002', 'Beliefs'),
      makeNode('saf-desires-001', 'Desires'),
    ];
    const scores = new Map([
      ['acc-beliefs-001', 0.60],
      ['saf-beliefs-001', 0.40],
      ['saf-beliefs-002', 0.35],
      ['saf-desires-001', 0.20],
    ]);

    const result = selectRelevantNodes(nodes, scores, {
      embeddingThreshold: 0.48,
      minPerCategory: 0,
      minPerPov: 2,
    });

    const ids = result.map(r => r.node.id);
    // saf-beliefs-001 (0.40) and saf-beliefs-002 (0.35) are top 2 saf nodes
    expect(ids).toContain('saf-beliefs-001');
    expect(ids).toContain('saf-beliefs-002');
    // saf-desires-001 (0.20) should NOT be added — deficit is only 2, filled by top 2
    expect(ids).not.toContain('saf-desires-001');
  });
});
