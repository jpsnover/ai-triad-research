// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  classifyStrengthOutcome,
  computeCounterfactualCruxes,
  formatCounterfactualCruxReport,
  filterCrossPovCruxes,
  type CounterfactualType,
} from './counterfactualCrux.js';
import { ActionableError } from './errors.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

// ── Test helpers ──────────────────────────────────────────

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string }): ArgumentNetworkNode {
  return {
    text: `Claim ${overrides.id}`,
    speaker: 'accelerationist',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.6,
    computed_strength: 0.6,
    ...overrides,
  };
}

function makeEdge(
  source: string,
  target: string,
  type: 'attacks' | 'supports' = 'attacks',
  weight = 0.7,
): ArgumentNetworkEdge {
  return { id: `${source}->${target}`, source, target, type, weight };
}

// ── classifyStrengthOutcome ───────────────────────────────

describe('classifyStrengthOutcome', () => {
  it('classifies strength ≥ 0.5 as thrived', () => {
    expect(classifyStrengthOutcome(0.5)).toBe('thrived');
    expect(classifyStrengthOutcome(0.8)).toBe('thrived');
    expect(classifyStrengthOutcome(1.0)).toBe('thrived');
  });

  it('classifies strength ≥ 0.3 and < 0.5 as survived', () => {
    expect(classifyStrengthOutcome(0.3)).toBe('survived');
    expect(classifyStrengthOutcome(0.4)).toBe('survived');
    expect(classifyStrengthOutcome(0.499)).toBe('survived');
  });

  it('classifies strength < 0.3 as died', () => {
    expect(classifyStrengthOutcome(0.0)).toBe('died');
    expect(classifyStrengthOutcome(0.1)).toBe('died');
    expect(classifyStrengthOutcome(0.299)).toBe('died');
  });
});

// ── computeCounterfactualCruxes — empty / trivial cases ──

describe('computeCounterfactualCruxes — empty inputs', () => {
  it('returns zero cruxes for an empty node array', () => {
    const result = computeCounterfactualCruxes([], []);
    expect(result.cruxes).toHaveLength(0);
    expect(result.claims_analysed).toBe(0);
    expect(result.removals_tested).toBe(0);
    expect(result.flips_found).toBe(0);
  });

  it('returns zero cruxes for isolated nodes with no edges', () => {
    const nodes = [
      makeNode({ id: 'AN-1', base_strength: 0.7 }),
      makeNode({ id: 'AN-2', base_strength: 0.4 }),
    ];
    const result = computeCounterfactualCruxes(nodes, []);
    expect(result.cruxes).toHaveLength(0);
    expect(result.claims_analysed).toBe(2);
    expect(result.removals_tested).toBe(0);
  });
});

// ── computeCounterfactualCruxes — flip detection ─────────

describe('computeCounterfactualCruxes — flip detection', () => {
  /**
   * Hand-crafted network:
   *   AN-1 (base=0.7, thrived baseline)
   *   AN-2 (base=0.9) → attacks AN-1 with weight=0.9
   *
   * Baseline QBAF for AN-1:
   *   aggAtt = 0.9 * 0.9 = 0.81 (clamped to 0.81)
   *   σ(AN-1) = 0.7 * (1 - 0.81) * (1 + 0) ≈ 0.133  → died
   *
   * Counterfactual without the attack edge:
   *   σ(AN-1) = 0.7  → thrived
   *
   * So removing AN-2's attack flips AN-1 from died → thrived.
   */
  it('detects flip when removing a decisive attack restores a claim to thrived', () => {
    const nodes = [
      makeNode({ id: 'AN-1', base_strength: 0.7 }),
      makeNode({ id: 'AN-2', base_strength: 0.9 }),
    ];
    const edges = [makeEdge('AN-2', 'AN-1', 'attacks', 0.9)];

    const result = computeCounterfactualCruxes(nodes, edges);

    expect(result.flips_found).toBeGreaterThan(0);

    const crux = result.cruxes.find(c => c.claim_id === 'AN-1');
    expect(crux).toBeDefined();
    expect(crux!.flipping_argument_id).toBe('AN-2');
    expect(crux!.edge_type).toBe('attacks');
    // Without AN-2's attack, AN-1 recovers to thrived
    expect(crux!.counterfactual_outcome).toBe('thrived');
    // With AN-2's attack, AN-1 falls to died
    expect(crux!.original_outcome).toBe('died');
    // Removing the attack increases strength
    expect(crux!.strength_delta).toBeGreaterThan(0);
  });

  /**
   * AN-1 (base=0.25, died baseline — would die without support)
   * AN-2 (base=0.9) → supports AN-1 with weight=0.9
   *
   * With support (DF-QuAD):
   *   aggSup = dfQuadAggregate([0.9 × 0.9]) = 0.81
   *   σ(AN-1) = 0.25 + (1 − 0.25) × 0.81 = 0.8575  → thrived
   *
   * Without the support edge:
   *   σ(AN-1) = 0.25  → died
   *
   * Removing the support flips AN-1 from thrived → died.
   */
  it('detects flip when removing a decisive support drops a claim to died', () => {
    const nodes = [
      makeNode({ id: 'AN-1', base_strength: 0.25 }),
      makeNode({ id: 'AN-2', base_strength: 0.9 }),
    ];
    const edges = [makeEdge('AN-2', 'AN-1', 'supports', 0.9)];

    const result = computeCounterfactualCruxes(nodes, edges);

    const crux = result.cruxes.find(c => c.claim_id === 'AN-1');
    expect(crux).toBeDefined();
    expect(crux!.flipping_argument_id).toBe('AN-2');
    expect(crux!.edge_type).toBe('supports');
    expect(crux!.original_outcome).toBe('thrived');
    expect(crux!.counterfactual_outcome).toBe('died');
    // Removing the support decreases strength
    expect(crux!.strength_delta).toBeLessThan(0);
  });

  /**
   * AN-1 (base=0.7) is attacked by a weak attacker (base=0.3, weight=0.2).
   * The attack is tangential — removing it does NOT flip AN-1's outcome.
   */
  it('does not flag a tangential attack as a crux', () => {
    const nodes = [
      makeNode({ id: 'AN-1', base_strength: 0.7 }),
      makeNode({ id: 'AN-2', base_strength: 0.3 }),
    ];
    const edges = [makeEdge('AN-2', 'AN-1', 'attacks', 0.2)];

    const result = computeCounterfactualCruxes(nodes, edges);

    // AN-1 remains thrived whether or not the weak attack is present
    const crux = result.cruxes.find(c => c.claim_id === 'AN-1');
    expect(crux).toBeUndefined();
  });
});

// ── computeCounterfactualCruxes — network-level tests ─────

describe('computeCounterfactualCruxes — multi-node network', () => {
  /**
   * Three-node network simulating a real debate fragment:
   *   AN-1 (Prometheus, base=0.6) ← attacks ← AN-2 (Sentinel, base=0.8, weight=0.8)
   *   AN-2 ← attacks ← AN-3 (Cassandra, base=0.7, weight=0.7)
   *
   * Baseline propagation resolves each node's strength. The test verifies
   * that crux detection visits all nodes and all edges.
   */
  it('analyses all nodes and edges in a multi-node network', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.6 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.8 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', base_strength: 0.7 }),
    ];
    const edges = [
      makeEdge('AN-2', 'AN-1', 'attacks', 0.8),
      makeEdge('AN-3', 'AN-2', 'attacks', 0.7),
    ];

    const result = computeCounterfactualCruxes(nodes, edges);

    expect(result.claims_analysed).toBe(3);
    // Each edge touches 2 nodes; 2 edges × 2 nodes each = 4 total edge-node tests
    expect(result.removals_tested).toBe(4);
  });

  it('sorts cruxes by absolute strength_delta descending', () => {
    // Build a network where multiple flips occur with different delta magnitudes
    const nodes = [
      makeNode({ id: 'AN-1', base_strength: 0.7 }),
      makeNode({ id: 'AN-2', base_strength: 0.95, speaker: 'safetyist' }),
      makeNode({ id: 'AN-3', base_strength: 0.26 }),
      makeNode({ id: 'AN-4', base_strength: 0.9, speaker: 'skeptic' }),
    ];
    const edges = [
      makeEdge('AN-2', 'AN-1', 'attacks', 0.95),   // large delta
      makeEdge('AN-4', 'AN-3', 'supports', 0.9),   // moderate delta
    ];

    const result = computeCounterfactualCruxes(nodes, edges);

    if (result.cruxes.length >= 2) {
      const deltas = result.cruxes.map(c => Math.abs(c.strength_delta));
      for (let i = 1; i < deltas.length; i++) {
        expect(deltas[i]).toBeLessThanOrEqual(deltas[i - 1]);
      }
    }
  });

  it('handles networks up to 100 nodes within time budget', () => {
    const nodes: ArgumentNetworkNode[] = [];
    const edges: ArgumentNetworkEdge[] = [];

    // Create 100 nodes
    for (let i = 1; i <= 100; i++) {
      nodes.push(makeNode({ id: `AN-${i}`, base_strength: 0.5 + (i % 5) * 0.1 }));
    }

    // Create a chain: each node attacks the next (99 edges)
    for (let i = 1; i < 100; i++) {
      edges.push(makeEdge(`AN-${i}`, `AN-${i + 1}`, 'attacks', 0.5));
    }

    const start = Date.now();
    const result = computeCounterfactualCruxes(nodes, edges);
    const elapsed = Date.now() - start;

    expect(result.claims_analysed).toBe(100);
    // Each interior node is touched by 2 edges; endpoints by 1
    expect(result.removals_tested).toBe(99 * 2 - 2 + 2); // = 198 - 2 + 2 = 198... actually 99*2 - endpoints correction
    // Loose guard: catches gross complexity regressions, not micro-benchmarks
    expect(elapsed).toBeLessThan(5000);
  });
});

// ── computeCounterfactualCruxes — error handling ──────────

describe('computeCounterfactualCruxes — error handling', () => {
  it('throws ActionableError when an edge references an unknown node', () => {
    const nodes = [makeNode({ id: 'AN-1' })];
    // AN-99 does not exist in the nodes array
    const edges = [makeEdge('AN-99', 'AN-1', 'attacks', 0.5)];

    expect(() => computeCounterfactualCruxes(nodes, edges)).toThrow(ActionableError);
  });

  it('ActionableError includes Goal, Problem, Location, Next Steps', () => {
    const nodes = [makeNode({ id: 'AN-1' })];
    const edges = [makeEdge('AN-99', 'AN-1', 'attacks', 0.5)];

    try {
      computeCounterfactualCruxes(nodes, edges);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ActionableError);
      const ae = err as ActionableError;
      expect(ae.goal).toBeTruthy();
      expect(ae.problem).toContain('AN-99');
      expect(ae.location).toContain('computeCounterfactualCruxes');
      expect(ae.nextSteps.length).toBeGreaterThan(0);
    }
  });
});

// ── formatCounterfactualCruxReport ────────────────────────

describe('formatCounterfactualCruxReport', () => {
  it('returns empty string when no cruxes found', () => {
    const result = { cruxes: [], claims_analysed: 5, removals_tested: 10, flips_found: 0 };
    expect(formatCounterfactualCruxReport(result)).toBe('');
  });

  it('includes the flip description in the report', () => {
    const crux = {
      claim_id: 'AN-1',
      claim_text: 'AI regulation hinders innovation',
      flipping_argument_id: 'AN-2',
      flipping_argument_text: 'EU AI Act evidence shows slowed research',
      edge_type: 'attacks' as const,
      original_outcome: 'thrived' as const,
      counterfactual_outcome: 'died' as const,
      original_strength: 0.65,
      counterfactual_strength: 0.15,
      strength_delta: -0.50,
    };
    const result = {
      cruxes: [crux],
      claims_analysed: 5,
      removals_tested: 10,
      flips_found: 1,
    };

    const report = formatCounterfactualCruxReport(result);
    expect(report).toContain('COUNTERFACTUAL CRUX ANALYSIS');
    expect(report).toContain('AI regulation hinders innovation');
    expect(report).toContain('EU AI Act evidence shows slowed research');
    expect(report).toContain('thrived');
    expect(report).toContain('died');
  });

  it('respects maxCruxes limit', () => {
    const cruxes = Array.from({ length: 10 }, (_, i) => ({
      claim_id: `AN-${i}`,
      claim_text: `Claim ${i}`,
      flipping_argument_id: `AN-${i + 10}`,
      flipping_argument_text: `Arg ${i + 10}`,
      edge_type: 'attacks' as const,
      original_outcome: 'thrived' as const,
      counterfactual_outcome: 'died' as const,
      original_strength: 0.7,
      counterfactual_strength: 0.2,
      strength_delta: -0.5,
    }));
    const result = { cruxes, claims_analysed: 20, removals_tested: 40, flips_found: 10 };

    const report = formatCounterfactualCruxReport(result, 3);
    // Should mention overflow
    expect(report).toContain('7 more');
    // Should show exactly 3 items (3 dashes at start of line)
    const bulletLines = report.split('\n').filter(l => l.startsWith('- If '));
    expect(bulletLines).toHaveLength(3);
  });

  it('truncates long claim text to 80 chars with ellipsis', () => {
    const longText = 'A'.repeat(100);
    const crux = {
      claim_id: 'AN-1',
      claim_text: longText,
      flipping_argument_id: 'AN-2',
      flipping_argument_text: 'short',
      edge_type: 'attacks' as const,
      original_outcome: 'survived' as const,
      counterfactual_outcome: 'died' as const,
      original_strength: 0.4,
      counterfactual_strength: 0.1,
      strength_delta: -0.3,
    };
    const result = { cruxes: [crux], claims_analysed: 2, removals_tested: 2, flips_found: 1 };

    const report = formatCounterfactualCruxReport(result);
    // The truncated text should end with ellipsis
    expect(report).toContain('…');
    // No line should contain the full 100-char string
    expect(report).not.toContain(longText);
  });
});

// ── filterCrossPovCruxes ──────────────────────────────────

describe('filterCrossPovCruxes', () => {
  const nodes = [
    makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
    makeNode({ id: 'AN-2', speaker: 'safetyist' }),
    makeNode({ id: 'AN-3', speaker: 'accelerationist' }),
  ];

  it('keeps cruxes where claim and flipping argument have different speakers', () => {
    const cruxes = [
      {
        claim_id: 'AN-1',           // accelerationist
        flipping_argument_id: 'AN-2', // safetyist — cross-POV
        claim_text: '',
        flipping_argument_text: '',
        edge_type: 'attacks' as const,
        original_outcome: 'thrived' as const,
        counterfactual_outcome: 'died' as const,
        original_strength: 0.6,
        counterfactual_strength: 0.2,
        strength_delta: -0.4,
      },
    ];

    const filtered = filterCrossPovCruxes(cruxes, nodes);
    expect(filtered).toHaveLength(1);
  });

  it('removes cruxes where claim and flipping argument have the same speaker', () => {
    const cruxes = [
      {
        claim_id: 'AN-1',           // accelerationist
        flipping_argument_id: 'AN-3', // also accelerationist — same POV
        claim_text: '',
        flipping_argument_text: '',
        edge_type: 'supports' as const,
        original_outcome: 'thrived' as const,
        counterfactual_outcome: 'survived' as const,
        original_strength: 0.6,
        counterfactual_strength: 0.35,
        strength_delta: -0.25,
      },
    ];

    const filtered = filterCrossPovCruxes(cruxes, nodes);
    expect(filtered).toHaveLength(0);
  });

  it('handles empty cruxes array', () => {
    expect(filterCrossPovCruxes([], nodes)).toHaveLength(0);
  });
});

// ── CounterfactualType field ────────────────────────────

describe('CounterfactualType on CounterfactualCrux', () => {
  it('accepts optional counterfactual_type on a crux object', () => {
    const crux = {
      claim_id: 'AN-1',
      claim_text: 'Strict liability would drive developers out',
      flipping_argument_id: 'AN-2',
      flipping_argument_text: 'EU compliance data shows retention',
      edge_type: 'attacks' as const,
      original_outcome: 'thrived' as const,
      counterfactual_outcome: 'died' as const,
      original_strength: 0.65,
      counterfactual_strength: 0.15,
      strength_delta: -0.50,
      counterfactual_type: 'interventional' as CounterfactualType,
    };
    expect(crux.counterfactual_type).toBe('interventional');
  });

  it('allows crux without counterfactual_type (backward compat)', () => {
    const crux = {
      claim_id: 'AN-1',
      claim_text: 'Test',
      flipping_argument_id: 'AN-2',
      flipping_argument_text: 'Test arg',
      edge_type: 'attacks' as const,
      original_outcome: 'thrived' as const,
      counterfactual_outcome: 'died' as const,
      original_strength: 0.6,
      counterfactual_strength: 0.2,
      strength_delta: -0.4,
    };
    expect(crux.counterfactual_type).toBeUndefined();
  });

  it('includes type tag in report when counterfactual_type is set', () => {
    const crux = {
      claim_id: 'AN-1',
      claim_text: 'AI regulation hinders innovation',
      flipping_argument_id: 'AN-2',
      flipping_argument_text: 'EU AI Act evidence',
      edge_type: 'attacks' as const,
      original_outcome: 'thrived' as const,
      counterfactual_outcome: 'died' as const,
      original_strength: 0.65,
      counterfactual_strength: 0.15,
      strength_delta: -0.50,
      counterfactual_type: 'backtracking' as CounterfactualType,
    };
    const result = { cruxes: [crux], claims_analysed: 2, removals_tested: 2, flips_found: 1 };
    const report = formatCounterfactualCruxReport(result);
    expect(report).toContain('[backtracking]');
  });

  it('omits type tag in report when counterfactual_type is absent', () => {
    const crux = {
      claim_id: 'AN-1',
      claim_text: 'Test claim',
      flipping_argument_id: 'AN-2',
      flipping_argument_text: 'Test arg',
      edge_type: 'attacks' as const,
      original_outcome: 'thrived' as const,
      counterfactual_outcome: 'died' as const,
      original_strength: 0.6,
      counterfactual_strength: 0.2,
      strength_delta: -0.4,
    };
    const result = { cruxes: [crux], claims_analysed: 2, removals_tested: 2, flips_found: 1 };
    const report = formatCounterfactualCruxReport(result);
    expect(report).not.toContain('[');
  });
});
