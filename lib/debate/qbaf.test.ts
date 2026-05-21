// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeQbafStrengths, computeEdgeAttribution, computeShapleyContributions } from './qbaf.js';
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
