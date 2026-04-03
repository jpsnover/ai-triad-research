// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeQbafStrengths } from '../../../../lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '../../../../lib/debate/qbaf';

// ── Helpers ───────────────────────────────────────────────

function nodes(...entries: [string, number][]): QbafNode[] {
  return entries.map(([id, base_strength]) => ({ id, base_strength }));
}

function edge(source: string, target: string, type: 'supports' | 'attacks', weight: number, attack_type?: 'rebut' | 'undercut' | 'undermine'): QbafEdge {
  return { source, target, type, weight, attack_type };
}

// ── Basic scenarios ───────────────────────────────────────

describe('computeQbafStrengths', () => {
  it('returns empty map for empty graph', () => {
    const result = computeQbafStrengths([], []);
    expect(result.strengths.size).toBe(0);
    expect(result.iterations).toBe(0);
    expect(result.converged).toBe(true);
  });

  it('returns base_strength for single node with no edges', () => {
    const result = computeQbafStrengths(nodes(['a', 0.8]), []);
    expect(result.strengths.get('a')).toBeCloseTo(0.8);
    expect(result.converged).toBe(true);
  });

  it('returns base_strength for disconnected nodes', () => {
    const result = computeQbafStrengths(nodes(['a', 0.8], ['b', 0.3], ['c', 0.6]), []);
    expect(result.strengths.get('a')).toBeCloseTo(0.8);
    expect(result.strengths.get('b')).toBeCloseTo(0.3);
    expect(result.strengths.get('c')).toBeCloseTo(0.6);
  });

  // ── Attack-only graphs ──────────────────────────────────

  it('attack reduces target strength', () => {
    const result = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.7]),
      [edge('a', 'b', 'attacks', 0.5)],
    );
    expect(result.strengths.get('b')!).toBeLessThan(0.7);
    expect(result.strengths.get('a')).toBeCloseTo(0.8); // attacker unchanged (no incoming edges)
  });

  it('strong attack reduces target more than weak attack', () => {
    const r1 = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.7]),
      [edge('a', 'b', 'attacks', 0.9)],
    );
    const r2 = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.7]),
      [edge('a', 'b', 'attacks', 0.3)],
    );
    expect(r1.strengths.get('b')!).toBeLessThan(r2.strengths.get('b')!);
  });

  // ── Support-only graphs ─────────────────────────────────

  it('support increases target strength', () => {
    const result = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.4]),
      [edge('a', 'b', 'supports', 0.5)],
    );
    expect(result.strengths.get('b')!).toBeGreaterThan(0.4);
  });

  it('strong support increases target more than weak support', () => {
    const r1 = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.4]),
      [edge('a', 'b', 'supports', 0.9)],
    );
    const r2 = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.4]),
      [edge('a', 'b', 'supports', 0.3)],
    );
    expect(r1.strengths.get('b')!).toBeGreaterThan(r2.strengths.get('b')!);
  });

  // ── Mixed graphs ────────────────────────────────────────

  it('acyclic graph: attack and support on same target', () => {
    const result = computeQbafStrengths(
      nodes(['attacker', 0.9], ['supporter', 0.6], ['target', 0.5]),
      [
        edge('attacker', 'target', 'attacks', 0.7),
        edge('supporter', 'target', 'supports', 0.4),
      ],
    );
    // Should converge
    expect(result.converged).toBe(true);
    // All scores should be valid numbers
    for (const [, v] of result.strengths) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('chain: a attacks b, b attacks c — transitive weakening', () => {
    const result = computeQbafStrengths(
      nodes(['a', 0.9], ['b', 0.8], ['c', 0.7]),
      [
        edge('a', 'b', 'attacks', 0.6),
        edge('b', 'c', 'attacks', 0.6),
      ],
    );
    // a weakens b, weakened b weakens c less
    expect(result.strengths.get('b')!).toBeLessThan(0.8);
    expect(result.strengths.get('c')!).toBeLessThan(0.7);
    // c should be stronger than if b were full strength (transitive weakening)
    const directResult = computeQbafStrengths(
      nodes(['b', 0.8], ['c', 0.7]),
      [edge('b', 'c', 'attacks', 0.6)],
    );
    expect(result.strengths.get('c')!).toBeGreaterThan(directResult.strengths.get('c')!);
  });

  // ── Cyclic graphs ───────────────────────────────────────

  it('cyclic graph converges or hits max iterations', () => {
    const result = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.7]),
      [
        edge('a', 'b', 'attacks', 0.5),
        edge('b', 'a', 'attacks', 0.5),
      ],
      { maxIterations: 200 },
    );
    // Should either converge or terminate at max iterations
    expect(result.iterations).toBeLessThanOrEqual(200);
    expect(result.strengths.get('a')).toBeDefined();
    expect(result.strengths.get('b')).toBeDefined();
  });

  // ── Attack type weighting ───────────────────────────────

  it('undermine has higher impact than rebut (default weights)', () => {
    const rRebut = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.7]),
      [edge('a', 'b', 'attacks', 0.5, 'rebut')],
    );
    const rUndermine = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.7]),
      [edge('a', 'b', 'attacks', 0.5, 'undermine')],
    );
    expect(rUndermine.strengths.get('b')!).toBeLessThan(rRebut.strengths.get('b')!);
  });

  it('custom attack weights override defaults', () => {
    const result = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.7]),
      [edge('a', 'b', 'attacks', 0.5, 'rebut')],
      { attackWeights: { rebut: 2.0 } },
    );
    const defaultResult = computeQbafStrengths(
      nodes(['a', 0.8], ['b', 0.7]),
      [edge('a', 'b', 'attacks', 0.5, 'rebut')],
    );
    expect(result.strengths.get('b')!).toBeLessThan(defaultResult.strengths.get('b')!);
  });

  // ── Property-based tests (Risk Assessor requirements) ───

  describe('INVARIANT: range [0, 1]', () => {
    it('all strengths are in [0, 1] for extreme inputs', () => {
      const result = computeQbafStrengths(
        nodes(['a', 1.0], ['b', 0.0], ['c', 0.5]),
        [
          edge('a', 'c', 'attacks', 1.0),
          edge('b', 'c', 'supports', 1.0),
          edge('a', 'b', 'supports', 1.0),
        ],
      );
      for (const [, v] of result.strengths) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('clamps out-of-range base_strength inputs', () => {
      const result = computeQbafStrengths(
        nodes(['a', 1.5], ['b', -0.3]),
        [],
      );
      expect(result.strengths.get('a')).toBeLessThanOrEqual(1);
      expect(result.strengths.get('b')).toBeGreaterThanOrEqual(0);
    });
  });

  describe('INVARIANT: monotonicity', () => {
    it('adding a supporter never decreases target strength', () => {
      const without = computeQbafStrengths(
        nodes(['a', 0.8], ['b', 0.5]),
        [],
      );
      const withSupport = computeQbafStrengths(
        nodes(['a', 0.8], ['b', 0.5]),
        [edge('a', 'b', 'supports', 0.6)],
      );
      expect(withSupport.strengths.get('b')!).toBeGreaterThanOrEqual(without.strengths.get('b')!);
    });
  });

  describe('INVARIANT: directionality', () => {
    it('adding an attacker never increases target strength', () => {
      const without = computeQbafStrengths(
        nodes(['a', 0.8], ['b', 0.7]),
        [],
      );
      const withAttack = computeQbafStrengths(
        nodes(['a', 0.8], ['b', 0.7]),
        [edge('a', 'b', 'attacks', 0.6)],
      );
      expect(withAttack.strengths.get('b')!).toBeLessThanOrEqual(without.strengths.get('b')!);
    });
  });

  describe('INVARIANT: convergence', () => {
    it('converges in bounded iterations for acyclic graph', () => {
      const result = computeQbafStrengths(
        nodes(['a', 0.9], ['b', 0.8], ['c', 0.7], ['d', 0.6], ['e', 0.5]),
        [
          edge('a', 'b', 'attacks', 0.5),
          edge('b', 'c', 'supports', 0.4),
          edge('c', 'd', 'attacks', 0.6),
          edge('d', 'e', 'supports', 0.3),
        ],
      );
      expect(result.converged).toBe(true);
      expect(result.iterations).toBeLessThan(50);
    });

    it('terminates at maxIterations for worst-case cyclic graph', () => {
      const result = computeQbafStrengths(
        nodes(['a', 0.8], ['b', 0.8]),
        [
          edge('a', 'b', 'attacks', 1.0),
          edge('b', 'a', 'attacks', 1.0),
        ],
        { maxIterations: 50 },
      );
      expect(result.iterations).toBeLessThanOrEqual(50);
    });
  });

  // ── Edge cases ──────────────────────────────────────────

  it('ignores edges referencing unknown nodes', () => {
    const result = computeQbafStrengths(
      nodes(['a', 0.8]),
      [edge('unknown', 'a', 'attacks', 0.5)],
    );
    expect(result.strengths.get('a')).toBeCloseTo(0.8);
  });

  it('handles self-attack gracefully', () => {
    const result = computeQbafStrengths(
      nodes(['a', 0.8]),
      [edge('a', 'a', 'attacks', 0.5)],
    );
    expect(result.strengths.get('a')!).toBeGreaterThanOrEqual(0);
    expect(result.strengths.get('a')!).toBeLessThanOrEqual(1);
    expect(result.converged).toBe(true);
  });
});
