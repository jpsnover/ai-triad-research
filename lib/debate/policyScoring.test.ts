// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeConsensusScores, topPolicies } from './policyScoring.js';
import type { RawPolicy } from './policyScoring.js';

// ── computeConsensusScores ──────────────────────────────────

describe('computeConsensusScores', () => {
  function makePolicy(overrides: Partial<RawPolicy> = {}): RawPolicy {
    return {
      id: 'pol-001',
      action: 'Require AI impact assessments',
      source_povs: ['accelerationist', 'safetyist'],
      member_count: 5,
      ...overrides,
    };
  }

  it('computes all score components', () => {
    const policies = [makePolicy()];
    const scored = computeConsensusScores(policies);

    expect(scored).toHaveLength(1);
    expect(scored[0].score_components.breadth).toBe(1.0);
    expect(scored[0].score_components.cross_pov).toBe(0.5);
    expect(scored[0].score_components.debate_cited).toBe(0);
    expect(scored[0].score_components.edge_support).toBe(0.5);
    expect(scored[0].consensus_score).toBeGreaterThan(0);
  });

  it('counts ASSUMES as 0.5-weight partial endorsement in edge_support', () => {
    const policies = [makePolicy({ source_povs: ['accelerationist'] })];
    const edges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'ASSUMES' },
      { source: 'acc-beliefs-003', target: 'saf-beliefs-004', type: 'CONTRADICTS' },
    ];
    const scored = computeConsensusScores(policies, edges);

    // ASSUMES contributes 0.5 supports, CONTRADICTS contributes 1 contradicts
    // edge_support = 0.5 / (0.5 + 1) = 0.333...
    expect(scored[0].score_components.edge_support).toBeCloseTo(0.33, 1);
  });

  it('SUPPORTS counts full weight vs ASSUMES half weight', () => {
    const policySup = makePolicy({ id: 'pol-sup', source_povs: ['accelerationist'] });
    const policyAsm = makePolicy({ id: 'pol-asm', source_povs: ['accelerationist'] });
    const supEdges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'SUPPORTS' },
    ];
    const asmEdges = [
      { source: 'acc-beliefs-001', target: 'saf-beliefs-002', type: 'ASSUMES' },
    ];

    const scoredSup = computeConsensusScores([policySup], supEdges);
    const scoredAsm = computeConsensusScores([policyAsm], asmEdges);

    expect(scoredSup[0].score_components.edge_support).toBe(1.0);
    expect(scoredAsm[0].score_components.edge_support).toBe(1.0);
  });

  it('sorts by consensus_score descending', () => {
    const policies = [
      makePolicy({ id: 'pol-low', member_count: 1, source_povs: ['accelerationist'] }),
      makePolicy({ id: 'pol-high', member_count: 10, source_povs: ['accelerationist', 'safetyist', 'skeptic'] }),
    ];
    const scored = computeConsensusScores(policies);

    expect(scored[0].id).toBe('pol-high');
    expect(scored[1].id).toBe('pol-low');
  });
});

// ── topPolicies ─────────────────────────────────────────────

describe('topPolicies', () => {
  it('filters out archived and superseded policies', () => {
    const policies = [
      { id: 'pol-1', action: 'A', source_povs: [], member_count: 1, consensus_score: 0.9, score_components: { breadth: 0, cross_pov: 0, debate_cited: 0, edge_support: 0 } },
      { id: 'pol-2', action: 'B', source_povs: [], member_count: 1, consensus_score: 0.8, score_components: { breadth: 0, cross_pov: 0, debate_cited: 0, edge_support: 0 }, status: 'archived' as const },
      { id: 'pol-3', action: 'C', source_povs: [], member_count: 1, consensus_score: 0.7, score_components: { breadth: 0, cross_pov: 0, debate_cited: 0, edge_support: 0 }, status: 'superseded' as const },
    ];
    const top = topPolicies(policies, 10);

    expect(top).toHaveLength(1);
    expect(top[0].id).toBe('pol-1');
  });

  it('limits to n results', () => {
    const policies = Array.from({ length: 5 }, (_, i) => ({
      id: `pol-${i}`, action: `Action ${i}`, source_povs: [] as string[], member_count: 1,
      consensus_score: 1 - i * 0.1,
      score_components: { breadth: 0, cross_pov: 0, debate_cited: 0, edge_support: 0 },
    }));
    expect(topPolicies(policies, 3)).toHaveLength(3);
  });
});
