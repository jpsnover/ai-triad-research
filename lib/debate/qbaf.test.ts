// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeQbafStrengths,
  computeEdgeAttribution,
  computeShapleyContributions,
  computeQbafConvergence,
  computeFactCheckStrength,
  dfQuadAggregate,
  dfQuadCombine,
  saturatingSumAggregate,
  saturatingSumCombine,
} from './qbaf.js';
import type { QbafNode, QbafEdge } from './qbaf.js';

describe('computeQbafStrengths — NaN guard', () => {
  it('clamps NaN base_strength to 0.5 instead of propagating', () => {
    const nodes: QbafNode[] = [
      { id: 'A', base_strength: NaN },
      { id: 'B', base_strength: 0.7 },
    ];
    const edges: QbafEdge[] = [
      { source: 'B', target: 'A', type: 'supports', weight: 0.5 },
    ];
    const result = computeQbafStrengths(nodes, edges);
    const aStrength = result.strengths.get('A')!;
    const bStrength = result.strengths.get('B')!;
    expect(Number.isFinite(aStrength)).toBe(true);
    expect(Number.isFinite(bStrength)).toBe(true);
    expect(result.converged).toBe(true);
  });
});

describe('computeEdgeAttribution', () => {
  it('identifies attack as negative attribution', () => {
    const nodes: QbafNode[] = [{ id: 'A', base_strength: 0.8 }, { id: 'B', base_strength: 0.7 }];
    const edges: QbafEdge[] = [{ source: 'B', target: 'A', type: 'attacks', weight: 0.6, attack_type: 'rebut' }];
    const attr = computeEdgeAttribution(nodes, edges, 'A');
    const val = attr.get('B→A');
    expect(val).toBeDefined();
    expect(val!).toBeLessThan(0);
  });

  it('identifies support as positive attribution', () => {
    const nodes: QbafNode[] = [{ id: 'A', base_strength: 0.5 }, { id: 'B', base_strength: 0.7 }];
    const edges: QbafEdge[] = [{ source: 'B', target: 'A', type: 'supports', weight: 0.8 }];
    const attr = computeEdgeAttribution(nodes, edges, 'A');
    const val = attr.get('B→A');
    expect(val).toBeDefined();
    expect(val!).toBeGreaterThan(0);
  });

  it('returns empty map for node with no edges', () => {
    const nodes: QbafNode[] = [{ id: 'A', base_strength: 0.8 }];
    const attr = computeEdgeAttribution(nodes, [], 'A');
    expect(attr.size).toBe(0);
  });

  it('ranks multiple edges by attribution magnitude', () => {
    const nodes: QbafNode[] = [
      { id: 'A', base_strength: 0.8 },
      { id: 'B', base_strength: 0.9 },
      { id: 'C', base_strength: 0.3 },
    ];
    const edges: QbafEdge[] = [
      { source: 'B', target: 'A', type: 'attacks', weight: 0.9, attack_type: 'rebut' },
      { source: 'C', target: 'A', type: 'attacks', weight: 0.2, attack_type: 'rebut' },
    ];
    const attr = computeEdgeAttribution(nodes, edges, 'A');
    const bAttr = Math.abs(attr.get('B→A') ?? 0);
    const cAttr = Math.abs(attr.get('C→A') ?? 0);
    expect(bAttr).toBeGreaterThan(cAttr);
  });
});

describe('computeShapleyContributions', () => {
  it('returns empty map for empty nodes', () => {
    const contributions = computeShapleyContributions([], []);
    expect(contributions.size).toBe(0);
  });

  it('returns empty map when no edges exist (no target claims)', () => {
    const nodes: QbafNode[] = [
      { id: 'A', base_strength: 0.7 },
      { id: 'B', base_strength: 0.6 },
    ];
    const contributions = computeShapleyContributions(nodes, []);
    expect(contributions.size).toBe(0);
  });

  it('single attacker: Shapley value is negative (attacker hurts claim)', () => {
    const nodes: QbafNode[] = [
      { id: 'claim', base_strength: 0.8 },
      { id: 'attacker', base_strength: 0.7 },
    ];
    const edges: QbafEdge[] = [
      { source: 'attacker', target: 'claim', type: 'attacks', weight: 0.8, attack_type: 'rebut' },
    ];
    const contributions = computeShapleyContributions(nodes, edges);
    const claimMap = contributions.get('claim');
    expect(claimMap).toBeDefined();
    const phi = claimMap!.get('attacker') ?? 0;
    // Removing the attacker should increase claim strength → Shapley value is negative
    expect(phi).toBeLessThan(0);
  });

  it('single supporter: Shapley value is positive (supporter helps claim)', () => {
    const nodes: QbafNode[] = [
      { id: 'claim', base_strength: 0.5 },
      { id: 'supporter', base_strength: 0.7 },
    ];
    const edges: QbafEdge[] = [
      { source: 'supporter', target: 'claim', type: 'supports', weight: 0.8 },
    ];
    const contributions = computeShapleyContributions(nodes, edges);
    const claimMap = contributions.get('claim');
    expect(claimMap).toBeDefined();
    const phi = claimMap!.get('supporter') ?? 0;
    expect(phi).toBeGreaterThan(0);
  });

  it('Shapley values sum to marginal contribution of full coalition', () => {
    // Efficiency axiom: Σ φ_i ≈ v(N) - v(∅)
    // v(N) = baseline strength with all args; v(∅) = claim's isolated base strength
    const nodes: QbafNode[] = [
      { id: 'claim', base_strength: 0.6 },
      { id: 'arg1', base_strength: 0.8 },
      { id: 'arg2', base_strength: 0.5 },
    ];
    const edges: QbafEdge[] = [
      { source: 'arg1', target: 'claim', type: 'attacks', weight: 0.7, attack_type: 'rebut' },
      { source: 'arg2', target: 'claim', type: 'supports', weight: 0.6 },
    ];

    const contributions = computeShapleyContributions(nodes, edges);
    const claimMap = contributions.get('claim')!;
    const phi1 = claimMap.get('arg1') ?? 0;
    const phi2 = claimMap.get('arg2') ?? 0;
    const shapleySum = phi1 + phi2;

    // v(N): strength with all args
    const baselineResult = computeQbafStrengths(nodes, edges);
    const vN = baselineResult.strengths.get('claim') ?? 0;

    // v(∅): strength with no args (just the claim node alone)
    const vEmpty = computeQbafStrengths(
      [{ id: 'claim', base_strength: 0.6 }],
      [],
    ).strengths.get('claim') ?? 0;

    // Efficiency: sum of Shapley values ≈ v(N) - v(∅)
    expect(Math.abs(shapleySum - (vN - vEmpty))).toBeLessThan(1e-6);
  });

  it('topN limits output to N arguments per claim', () => {
    const nodes: QbafNode[] = [
      { id: 'claim', base_strength: 0.6 },
      { id: 'a1', base_strength: 0.8 },
      { id: 'a2', base_strength: 0.5 },
      { id: 'a3', base_strength: 0.3 },
      { id: 'a4', base_strength: 0.7 },
    ];
    const edges: QbafEdge[] = [
      { source: 'a1', target: 'claim', type: 'attacks', weight: 0.9, attack_type: 'rebut' },
      { source: 'a2', target: 'claim', type: 'supports', weight: 0.5 },
      { source: 'a3', target: 'claim', type: 'attacks', weight: 0.3, attack_type: 'undercut' },
      { source: 'a4', target: 'claim', type: 'supports', weight: 0.7 },
    ];
    const contributions = computeShapleyContributions(nodes, edges, { topN: 2 });
    const claimMap = contributions.get('claim')!;
    expect(claimMap.size).toBe(2);
  });

  it('stronger argument has higher Shapley magnitude than weaker argument', () => {
    const nodes: QbafNode[] = [
      { id: 'claim', base_strength: 0.7 },
      { id: 'strong', base_strength: 0.9 },
      { id: 'weak', base_strength: 0.2 },
    ];
    const edges: QbafEdge[] = [
      { source: 'strong', target: 'claim', type: 'attacks', weight: 0.9, attack_type: 'rebut' },
      { source: 'weak', target: 'claim', type: 'attacks', weight: 0.1, attack_type: 'rebut' },
    ];
    const contributions = computeShapleyContributions(nodes, edges);
    const claimMap = contributions.get('claim')!;
    const strongPhi = Math.abs(claimMap.get('strong') ?? 0);
    const weakPhi = Math.abs(claimMap.get('weak') ?? 0);
    expect(strongPhi).toBeGreaterThan(weakPhi);
  });

  it('isolated node (no edges to claim) has zero Shapley value', () => {
    const nodes: QbafNode[] = [
      { id: 'claim', base_strength: 0.6 },
      { id: 'connected', base_strength: 0.7 },
      { id: 'isolated', base_strength: 0.8 },
    ];
    const edges: QbafEdge[] = [
      { source: 'connected', target: 'claim', type: 'supports', weight: 0.6 },
      // 'isolated' has no edge to 'claim'
    ];
    const contributions = computeShapleyContributions(nodes, edges);
    const claimMap = contributions.get('claim')!;
    // Isolated node should have zero or near-zero Shapley value
    const isolatedPhi = claimMap.get('isolated') ?? 0;
    expect(Math.abs(isolatedPhi)).toBeLessThan(1e-10);
  });

  it('Monte Carlo mode (sampleThreshold=1) returns reasonable approximation', () => {
    // Force sampling mode by setting sampleThreshold very low
    const nodes: QbafNode[] = [
      { id: 'claim', base_strength: 0.6 },
      { id: 'arg1', base_strength: 0.8 },
      { id: 'arg2', base_strength: 0.5 },
    ];
    const edges: QbafEdge[] = [
      { source: 'arg1', target: 'claim', type: 'attacks', weight: 0.7, attack_type: 'rebut' },
      { source: 'arg2', target: 'claim', type: 'supports', weight: 0.6 },
    ];

    // Exact values
    const exact = computeShapleyContributions(nodes, edges, { sampleThreshold: 20 });

    // Monte Carlo approximation (many samples for accuracy)
    const approx = computeShapleyContributions(nodes, edges, {
      sampleThreshold: 1,
      numSamples: 2000,
    });

    const exactMap = exact.get('claim')!;
    const approxMap = approx.get('claim')!;

    // Signs must agree
    expect(Math.sign(approxMap.get('arg1') ?? 0)).toBe(Math.sign(exactMap.get('arg1') ?? 0));
    expect(Math.sign(approxMap.get('arg2') ?? 0)).toBe(Math.sign(exactMap.get('arg2') ?? 0));

    // Approximation within 0.05 of exact
    expect(Math.abs((approxMap.get('arg1') ?? 0) - (exactMap.get('arg1') ?? 0))).toBeLessThan(0.05);
    expect(Math.abs((approxMap.get('arg2') ?? 0) - (exactMap.get('arg2') ?? 0))).toBeLessThan(0.05);
  });
});

describe('computeQbafStrengths — progressive damping', () => {
  it('stabilises a mutual-attack cycle that oscillates under fixed damping', () => {
    const nodes: QbafNode[] = [
      { id: 'A1', base_strength: 0.9 },
      { id: 'A2', base_strength: 0.85 },
      { id: 'A3', base_strength: 0.8 },
      { id: 'C', base_strength: 0.7 },
    ];
    const edges: QbafEdge[] = [
      { source: 'A1', target: 'A2', type: 'attacks', weight: 0.9, attack_type: 'rebut' },
      { source: 'A2', target: 'A1', type: 'attacks', weight: 0.9, attack_type: 'rebut' },
      { source: 'A2', target: 'A3', type: 'attacks', weight: 0.7, attack_type: 'rebut' },
      { source: 'A3', target: 'A2', type: 'attacks', weight: 0.7, attack_type: 'rebut' },
      { source: 'A1', target: 'C', type: 'supports', weight: 0.6 },
      { source: 'A3', target: 'C', type: 'attacks', weight: 0.5, attack_type: 'undercut' },
    ];

    const result = computeQbafStrengths(nodes, edges);

    for (const [, s] of result.strengths) {
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(result.dampingLevel).toBeDefined();
    expect(result.dampingLevel!).toBeGreaterThanOrEqual(0);
  });

  it('returns dampingLevel 0 for a simple convergent network', () => {
    const nodes: QbafNode[] = [
      { id: 'A', base_strength: 0.8 },
      { id: 'B', base_strength: 0.6 },
    ];
    const edges: QbafEdge[] = [
      { source: 'B', target: 'A', type: 'supports', weight: 0.5 },
    ];

    const result = computeQbafStrengths(nodes, edges);
    expect(result.converged).toBe(true);
    expect(result.dampingLevel).toBe(0);
  });
});

// ── dfQuadAggregate ─────────────────────────────────────

describe('dfQuadAggregate', () => {
  it('returns 0 for empty influences', () => {
    expect(dfQuadAggregate([])).toBe(0);
  });

  it('returns the value for a single influence', () => {
    expect(dfQuadAggregate([0.4])).toBeCloseTo(0.4);
  });

  it('computes probabilistic sum for two influences', () => {
    // 1 - (1-0.3)(1-0.5) = 1 - 0.7*0.5 = 0.65
    expect(dfQuadAggregate([0.3, 0.5])).toBeCloseTo(0.65);
  });

  it('saturates below 1.0 for large inputs', () => {
    // 1 - (1-0.9)^3 = 1 - 0.001 = 0.999
    expect(dfQuadAggregate([0.9, 0.9, 0.9])).toBeCloseTo(0.999);
    expect(dfQuadAggregate([0.9, 0.9, 0.9])).toBeLessThan(1.0);
  });

  it('clamps negative inputs to 0', () => {
    expect(dfQuadAggregate([-0.5, 0.3])).toBeCloseTo(0.3);
  });

  it('clamps inputs above 1 to 1', () => {
    // clamp(1.5)=1 → (1-1)=0 → product=0 → result=1
    expect(dfQuadAggregate([1.5, 0.3])).toBeCloseTo(1.0);
  });
});

// ── dfQuadCombine ───────────────────────────────────────

describe('dfQuadCombine', () => {
  it('returns base when no attack or support', () => {
    expect(dfQuadCombine(0.6, 0, 0)).toBeCloseTo(0.6);
  });

  it('boosts toward 1 when support exceeds attack', () => {
    // base=0.5, sup=0.4, att=0.1 → 0.5 + (1-0.5)*0.3 = 0.65
    expect(dfQuadCombine(0.5, 0.1, 0.4)).toBeCloseTo(0.65);
  });

  it('reduces toward 0 when attack exceeds support', () => {
    // base=0.5, sup=0.1, att=0.4 → 0.5 - 0.5*0.3 = 0.35
    expect(dfQuadCombine(0.5, 0.4, 0.1)).toBeCloseTo(0.35);
  });

  it('pure support pushes toward 1 but never exceeds it', () => {
    // base=0.8, sup=0.5, att=0 → 0.8 + 0.2*0.5 = 0.9
    expect(dfQuadCombine(0.8, 0, 0.5)).toBeCloseTo(0.9);
  });

  it('pure attack pushes toward 0 but never below it', () => {
    // base=0.2, sup=0, att=0.5 → 0.2 - 0.2*0.5 = 0.1
    expect(dfQuadCombine(0.2, 0.5, 0)).toBeCloseTo(0.1);
  });

  it('equal support and attack returns base', () => {
    expect(dfQuadCombine(0.7, 0.3, 0.3)).toBeCloseTo(0.7);
  });
});

// ── saturatingSumAggregate ──────────────────────────────

describe('saturatingSumAggregate', () => {
  it('returns 0 for empty influences', () => {
    expect(saturatingSumAggregate([])).toBe(0);
  });

  it('sums and clamps to [0,1]', () => {
    expect(saturatingSumAggregate([0.3, 0.5])).toBeCloseTo(0.8);
    expect(saturatingSumAggregate([0.6, 0.7])).toBe(1.0);
  });
});

// ── saturatingSumCombine ───────────────────────────────

describe('saturatingSumCombine', () => {
  it('returns base when no attack or support', () => {
    expect(saturatingSumCombine(0.6, 0, 0)).toBeCloseTo(0.6);
  });

  it('multiplies base by (1 - att) × (1 + sup)', () => {
    // base=0.5, att=0.2, sup=0.3 → 0.5 * 0.8 * 1.3 = 0.52
    expect(saturatingSumCombine(0.5, 0.2, 0.3)).toBeCloseTo(0.52);
  });
});

// ── algorithm preset selection ──────────────────────────

describe('algorithm preset selection', () => {
  const nodes: QbafNode[] = [
    { id: 'sup', base_strength: 0.8 },
    { id: 'target', base_strength: 0.5 },
  ];
  const edges: QbafEdge[] = [
    { source: 'sup', target: 'target', type: 'supports', weight: 0.6 },
  ];

  it('dfquad is the default algorithm', () => {
    const noAlgo = computeQbafStrengths(nodes, edges);
    const explicit = computeQbafStrengths(nodes, edges, { algorithm: 'dfquad' });
    expect(noAlgo.strengths.get('target')).toBeCloseTo(
      explicit.strengths.get('target')!,
    );
  });

  it('saturating-sum can be selected explicitly', () => {
    const result = computeQbafStrengths(nodes, edges, { algorithm: 'saturating-sum' });
    // saturating-sum: base * (1-0) * (1 + aggSup) where aggSup = clamp(0.8*0.6) = 0.48
    // → 0.5 * 1 * 1.48 = 0.74
    expect(result.strengths.get('target')!).toBeCloseTo(0.74, 1);
  });

  it('custom hooks override algorithm preset', () => {
    const customAgg = (influences: number[]): number => {
      return influences.length > 0 ? 0.42 : 0;
    };
    const result = computeQbafStrengths(nodes, edges, {
      algorithm: 'saturating-sum',
      aggregateSupports: customAgg,
    });
    // Custom hook used for supports, saturating-sum combine still active
    // combine: base * (1-0) * (1 + 0.42) = 0.5 * 1.42 = 0.71
    expect(result.strengths.get('target')!).toBeCloseTo(0.71, 1);
  });

  it('attacks-only case produces same results for both algorithms', () => {
    const atkNodes: QbafNode[] = [
      { id: 'a1', base_strength: 0.7 },
      { id: 'target', base_strength: 0.6 },
    ];
    const atkEdges: QbafEdge[] = [
      { source: 'a1', target: 'target', type: 'attacks', weight: 0.4 },
    ];
    const dfquad = computeQbafStrengths(atkNodes, atkEdges, { algorithm: 'dfquad' });
    const satsum = computeQbafStrengths(atkNodes, atkEdges, { algorithm: 'saturating-sum' });
    // single attacker, no support: both reduce base by same factor
    expect(dfquad.strengths.get('target')!).toBeCloseTo(
      satsum.strengths.get('target')!, 1,
    );
  });
});

// ── computeQbafConvergence ──────────────────────────────

describe('computeQbafConvergence', () => {
  it('returns undefined for empty claim list', () => {
    expect(computeQbafConvergence([], new Map())).toBeUndefined();
  });

  it('returns undefined when no claims have strengths', () => {
    expect(computeQbafConvergence(['a', 'b'], new Map())).toBeUndefined();
  });

  it('averages strengths of matched claims', () => {
    const strengths = new Map([['a', 0.8], ['b', 0.4], ['c', 0.6]]);
    expect(computeQbafConvergence(['a', 'b'], strengths)).toBeCloseTo(0.6);
  });
});

// ── null edges regression (t/2441 / t/2432) ────────────

describe('null edges guard — community-debate format', () => {
  const nodes: QbafNode[] = [
    { id: 'a', base_strength: 0.7 },
    { id: 'b', base_strength: 0.4 },
  ];

  it('computeQbafStrengths does not throw when edges is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeQbafStrengths(nodes, null as any)).not.toThrow();
  });

  it('computeQbafStrengths returns clamped base strengths when edges is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = computeQbafStrengths(nodes, null as any);
    expect(result.strengths.get('a')).toBeCloseTo(0.7);
    expect(result.strengths.get('b')).toBeCloseTo(0.4);
    expect(result.converged).toBe(true);
  });

  it('computeEdgeAttribution does not throw when edges is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeEdgeAttribution(nodes, null as any, 'a')).not.toThrow();
  });

  it('computeEdgeAttribution returns empty attributions when edges is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = computeEdgeAttribution(nodes, null as any, 'a');
    expect(result.size).toBe(0);
  });

  it('computeShapleyContributions does not throw when edges is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeShapleyContributions(nodes, null as any)).not.toThrow();
  });

  it('computeShapleyContributions returns empty map when edges is null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = computeShapleyContributions(nodes, null as any);
    expect(result.size).toBe(0);
  });
});

// ── computeFactCheckStrength ────────────────────────────

describe('computeFactCheckStrength', () => {
  it('returns base strength with no evidence', () => {
    const result = computeFactCheckStrength(0.7, []);
    expect(result.adjusted_strength).toBeCloseTo(0.7);
    expect(result.original_strength).toBe(0.7);
    expect(result.support_count).toBe(0);
    expect(result.attack_count).toBe(0);
  });

  it('increases strength with supporting evidence', () => {
    const result = computeFactCheckStrength(0.5, [
      { id: 'e1', text: 'supports', relation: 'supports', source_reliability: 0.9, relevance: 0.8 },
    ]);
    expect(result.adjusted_strength).toBeGreaterThan(0.5);
    expect(result.support_count).toBe(1);
  });

  it('decreases strength with attacking evidence', () => {
    const result = computeFactCheckStrength(0.5, [
      { id: 'e1', text: 'attacks', relation: 'attacks', source_reliability: 0.9, relevance: 0.8 },
    ]);
    expect(result.adjusted_strength).toBeLessThan(0.5);
    expect(result.attack_count).toBe(1);
  });
});
