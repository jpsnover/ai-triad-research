// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { evaluateLookahead, buildRegenHint } from './lookaheadGate.js';
import type { LookaheadGateInput } from './lookaheadGate.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

// ── Helpers ──────────────────────────────────────────────

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string }): ArgumentNetworkNode {
  return {
    text: `Claim ${overrides.id}`,
    speaker: 'prometheus',
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.5,
    computed_strength: 0.5,
    ...overrides,
  };
}

function makeEdge(
  source: string,
  target: string,
  type: 'attacks' | 'supports' = 'attacks',
  weight = 0.5,
): ArgumentNetworkEdge {
  return { id: `${source}->${target}`, source, target, type, weight };
}

// ── evaluateLookahead — basic ────────────────────────────

describe('evaluateLookahead — basic', () => {
  it('passes when adding a strong claim for the speaker', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.5 }),
      makeNode({ id: 'AN-2', speaker: 'sentinel', base_strength: 0.6 }),
    ];
    const existingEdges = [makeEdge('AN-2', 'AN-1', 'attacks', 0.3)];

    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes,
      existingEdges,
      tentativeClaims: [{ text: 'New strong argument for acceleration', base_strength: 0.8 }],
      tentativeEdges: [],
      threshold: 0.0,
    };

    const result = evaluateLookahead(input);
    expect(result.pass).toBe(true);
    // Adding a strong claim should improve position_strength
    expect(result.utility_after.position_strength).toBeGreaterThanOrEqual(result.utility_before.position_strength);
    expect(result.tentative_claims).toHaveLength(1);
    expect(result.tentative_network_size.nodes).toBe(3);
  });

  it('fails when tentative claims weaken speaker position', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.8 }),
      makeNode({ id: 'AN-2', speaker: 'sentinel', base_strength: 0.5 }),
    ];
    const existingEdges: ArgumentNetworkEdge[] = [];

    // Add a new claim that attacks the speaker's own strong claim
    const tentativeEdges = [makeEdge('AN-3', 'AN-1', 'attacks', 0.9)];

    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes,
      existingEdges,
      tentativeClaims: [{ text: 'Actually regulation might be good', base_strength: 0.7 }],
      tentativeEdges,
      threshold: 0.05, // require meaningful improvement
    };

    const result = evaluateLookahead(input);
    // The tentative claim attacks the speaker's own node, so utility should drop
    expect(result.utility_delta).toBeLessThan(0.05);
  });

  it('returns correct tentative_network_size', () => {
    const existingNodes = [makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.5 })];
    const existingEdges: ArgumentNetworkEdge[] = [];

    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes,
      existingEdges,
      tentativeClaims: [
        { text: 'Claim A', base_strength: 0.6 },
        { text: 'Claim B', base_strength: 0.7 },
      ],
      tentativeEdges: [makeEdge('AN-2', 'AN-1', 'supports', 0.5)],
    };

    const result = evaluateLookahead(input);
    expect(result.tentative_network_size.nodes).toBe(3); // 1 existing + 2 tentative
    expect(result.tentative_network_size.edges).toBe(1);
  });

  it('handles empty existing network', () => {
    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes: [],
      existingEdges: [],
      tentativeClaims: [{ text: 'First claim ever', base_strength: 0.6 }],
      tentativeEdges: [],
    };

    const result = evaluateLookahead(input);
    expect(result.pass).toBe(true);
    expect(result.utility_before.composite).toBe(0); // no nodes for this speaker before
    expect(result.utility_after.position_strength).toBeGreaterThan(0);
  });

  it('handles empty tentative claims', () => {
    const existingNodes = [makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.6 })];
    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [],
      tentativeEdges: [],
    };

    const result = evaluateLookahead(input);
    // No new claims → delta should be ~0
    expect(result.utility_delta).toBeCloseTo(0, 5);
    expect(result.pass).toBe(true); // 0 >= 0 (default threshold)
  });
});

// ── evaluateLookahead — threshold behavior ───────────────

describe('evaluateLookahead — threshold', () => {
  it('uses default threshold of 0.0 when not specified', () => {
    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.5 })],
      existingEdges: [],
      tentativeClaims: [{ text: 'Marginal claim', base_strength: 0.51 }],
      tentativeEdges: [],
    };

    const result = evaluateLookahead(input);
    expect(result.threshold).toBe(0.0);
  });

  it('respects custom threshold', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.5 }),
    ];

    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [{ text: 'Weak claim', base_strength: 0.51 }],
      tentativeEdges: [],
      threshold: 0.5, // very high threshold
    };

    const result = evaluateLookahead(input);
    expect(result.threshold).toBe(0.5);
    // Marginal improvement won't pass a 0.5 threshold
    expect(result.pass).toBe(false);
  });
});

// ── evaluateLookahead — utility computation ──────────────

describe('evaluateLookahead — utility delta', () => {
  it('adding a claim that attacks opponent improves utility', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.6 }),
      makeNode({ id: 'AN-2', speaker: 'sentinel', base_strength: 0.7 }),
    ];
    const existingEdges: ArgumentNetworkEdge[] = [];

    // New claim from prometheus attacks sentinel's node
    const tentativeEdges = [makeEdge('AN-3', 'AN-2', 'attacks', 0.8)];

    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes,
      existingEdges,
      tentativeClaims: [{ text: 'Counter to sentinel', base_strength: 0.8 }],
      tentativeEdges,
    };

    const result = evaluateLookahead(input);
    // Attacking opponent should improve attack_effectiveness
    expect(result.utility_delta).toBeGreaterThanOrEqual(0);
  });

  it('supports edge from tentative claim improves position', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.4 }),
    ];

    // New claim supports own existing claim
    const tentativeEdges = [makeEdge('AN-2', 'AN-1', 'supports', 0.8)];

    const input: LookaheadGateInput = {
      speaker: 'prometheus',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [{ text: 'Supporting evidence', base_strength: 0.7 }],
      tentativeEdges,
    };

    const result = evaluateLookahead(input);
    // Supporting own claim should boost position_strength
    expect(result.utility_after.position_strength).toBeGreaterThan(result.utility_before.position_strength);
  });
});

// ── buildRegenHint ──────────────────────────────────────

describe('buildRegenHint', () => {
  it('generates hint for negative delta', () => {
    const result = evaluateLookahead({
      speaker: 'prometheus',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.8 })],
      existingEdges: [],
      tentativeClaims: [],
      tentativeEdges: [],
      threshold: 0.1,
    });
    // Force a negative delta for testing
    const fakeResult = { ...result, utility_delta: -0.05, pass: false };
    const hint = buildRegenHint(fakeResult);

    expect(hint).toContain('below threshold');
    expect(hint).toContain('weaken your position');
  });

  it('generates hint for marginal positive delta', () => {
    const result = evaluateLookahead({
      speaker: 'prometheus',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'prometheus', base_strength: 0.5 })],
      existingEdges: [],
      tentativeClaims: [{ text: 'Weak', base_strength: 0.5 }],
      tentativeEdges: [],
      threshold: 0.2,
    });
    const fakeResult = { ...result, utility_delta: 0.01, pass: false };
    const hint = buildRegenHint(fakeResult);

    expect(hint).toContain('marginal value');
    expect(hint).toContain('Component breakdown');
  });
});
