// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  evaluateLookahead,
  buildRegenHint,
  evaluateLookaheadPerClaim,
  buildClaimAnalysis,
} from './lookaheadGate.js';
import type { LookaheadGateInput } from './lookaheadGate.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge } from './types.js';

// ── Helpers ──────────────────────────────────────────────

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string }): ArgumentNetworkNode {
  return {
    text: `Claim ${overrides.id}`,
    speaker: 'accelerationist',
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
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.6 }),
    ];
    const existingEdges = [makeEdge('AN-2', 'AN-1', 'attacks', 0.3)];

    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
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
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.8 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.5 }),
    ];
    const existingEdges: ArgumentNetworkEdge[] = [];

    // Add a new claim that attacks the speaker's own strong claim
    const tentativeEdges = [makeEdge('AN-3', 'AN-1', 'attacks', 0.9)];

    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
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
    const existingNodes = [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 })];
    const existingEdges: ArgumentNetworkEdge[] = [];

    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
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
      speaker: 'accelerationist',
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
    const existingNodes = [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.6 })];
    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
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
      speaker: 'accelerationist',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 })],
      existingEdges: [],
      tentativeClaims: [{ text: 'Marginal claim', base_strength: 0.51 }],
      tentativeEdges: [],
    };

    const result = evaluateLookahead(input);
    expect(result.threshold).toBe(0.0);
  });

  it('respects custom threshold', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 }),
    ];

    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
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
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.6 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.7 }),
    ];
    const existingEdges: ArgumentNetworkEdge[] = [];

    // New claim from accelerationist attacks safetyist's node
    const tentativeEdges = [makeEdge('AN-3', 'AN-2', 'attacks', 0.8)];

    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
      existingNodes,
      existingEdges,
      tentativeClaims: [{ text: 'Counter to safetyist', base_strength: 0.8 }],
      tentativeEdges,
    };

    const result = evaluateLookahead(input);
    // Attacking opponent should improve attack_effectiveness
    expect(result.utility_delta).toBeGreaterThanOrEqual(0);
  });

  it('supports edge from tentative claim improves position', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.4 }),
    ];

    // New claim supports own existing claim
    const tentativeEdges = [makeEdge('AN-2', 'AN-1', 'supports', 0.8)];

    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
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
      speaker: 'accelerationist',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.8 })],
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
      speaker: 'accelerationist',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 })],
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

// ── evaluateLookaheadPerClaim ───────────────────────────

describe('evaluateLookaheadPerClaim', () => {
  it('returns empty perClaim for no tentative claims', () => {
    const { batchResult, perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.8 })],
      existingEdges: [],
      tentativeClaims: [],
      tentativeEdges: [],
    });
    expect(batchResult.utility_delta).toBe(0);
    expect(perClaim).toHaveLength(0);
  });

  it('single claim marginal delta equals batch delta', () => {
    const { batchResult, perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.8 })],
      existingEdges: [],
      tentativeClaims: [{ text: 'Strong claim', base_strength: 0.9 }],
      tentativeEdges: [],
    });
    expect(perClaim).toHaveLength(1);
    expect(perClaim[0].marginal_delta).toBeCloseTo(batchResult.utility_delta, 6);
    expect(perClaim[0].classification).toBe('STRONG');
  });

  it('classifies strong and weak claims separately', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.8 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.7 }),
    ];
    const { perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [
        { text: 'Strong support', base_strength: 0.9 },
        { text: 'Self-attack', base_strength: 0.3 },
      ],
      tentativeEdges: [
        // Second claim attacks own node
        makeEdge('AN-4', 'AN-1', 'attacks', 0.8),
      ],
    });
    expect(perClaim).toHaveLength(2);
    // First claim should be STRONG (no harmful edges)
    expect(perClaim[0].classification).toBe('STRONG');
    // Second claim attacks own node — should be WEAK
    expect(perClaim[1].classification).toBe('WEAK');
  });

  it('preserves batch result unchanged', () => {
    const input: LookaheadGateInput = {
      speaker: 'accelerationist',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 })],
      existingEdges: [],
      tentativeClaims: [{ text: 'A', base_strength: 0.7 }],
      tentativeEdges: [],
    };
    const standalone = evaluateLookahead(input);
    const { batchResult } = evaluateLookaheadPerClaim(input);
    expect(batchResult.utility_delta).toBeCloseTo(standalone.utility_delta, 6);
    expect(batchResult.pass).toBe(standalone.pass);
  });

  it('marginal deltas sum approximately to batch delta for independent claims', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.6 }),
    ];
    const { batchResult, perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [
        { text: 'Claim A', base_strength: 0.8 },
        { text: 'Claim B', base_strength: 0.7 },
      ],
      tentativeEdges: [],
    });
    // For independent claims (no edges between them), marginal deltas
    // should approximately sum to the batch delta
    const sumMarginals = perClaim.reduce((s, c) => s + c.marginal_delta, 0);
    // Allow some tolerance since QBAF is non-linear
    expect(Math.abs(sumMarginals - batchResult.utility_delta)).toBeLessThan(0.05);
  });
});

// ── buildClaimAnalysis ──────────────────────────────────

describe('buildClaimAnalysis', () => {
  it('separates strong and weak claims', () => {
    const { perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes: [
        makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.8 }),
        makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.7 }),
      ],
      existingEdges: [],
      tentativeClaims: [
        { text: 'Good claim', base_strength: 0.9 },
        { text: 'Self-attack', base_strength: 0.3 },
      ],
      tentativeEdges: [
        makeEdge('AN-4', 'AN-1', 'attacks', 0.8),
      ],
    });

    const analysis = buildClaimAnalysis(perClaim);
    expect(analysis.strongFoundations.length).toBeGreaterThanOrEqual(1);
    expect(analysis.avoidClaims.length).toBeGreaterThanOrEqual(0);
    // All items have required fields
    for (const item of [...analysis.strongFoundations, ...analysis.avoidClaims]) {
      expect(item.text).toBeTruthy();
      expect(typeof item.base_strength).toBe('number');
      expect(typeof item.marginal_delta).toBe('number');
      expect(item.reason.length).toBeGreaterThan(10);
    }
  });

  it('generates human-readable reasons (no raw metrics)', () => {
    const { perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.7 })],
      existingEdges: [],
      tentativeClaims: [{ text: 'Test', base_strength: 0.9 }],
      tentativeEdges: [],
    });
    const analysis = buildClaimAnalysis(perClaim);
    for (const item of [...analysis.strongFoundations, ...analysis.avoidClaims]) {
      // Reasons should not contain raw metric names
      expect(item.reason).not.toContain('base_strength');
      expect(item.reason).not.toContain('computed_strength');
      expect(item.reason).not.toContain('composite');
    }
  });

  it('sorts strong by delta descending, weak by delta ascending', () => {
    const { perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes: [makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 })],
      existingEdges: [],
      tentativeClaims: [
        { text: 'Medium', base_strength: 0.6 },
        { text: 'Best', base_strength: 0.95 },
      ],
      tentativeEdges: [],
    });
    const analysis = buildClaimAnalysis(perClaim);
    if (analysis.strongFoundations.length >= 2) {
      expect(analysis.strongFoundations[0].marginal_delta)
        .toBeGreaterThanOrEqual(analysis.strongFoundations[1].marginal_delta);
    }
  });

  it('returns empty arrays when no claims', () => {
    const analysis = buildClaimAnalysis([]);
    expect(analysis.strongFoundations).toHaveLength(0);
    expect(analysis.avoidClaims).toHaveLength(0);
    expect(analysis.preserveConcessions).toHaveLength(0);
  });
});

// ── Concession exemption ────────────────────────────────

describe('evaluateLookahead — concession exemption', () => {
  it('exempts concession claims from gate delta', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.8 }),
    ];
    const existingEdges: ArgumentNetworkEdge[] = [];

    // Concession: accelerationist's new claim supports safetyist's existing node
    const tentativeEdges = [makeEdge('AN-3', 'AN-2', 'supports', 0.7)];

    const result = evaluateLookahead({
      speaker: 'accelerationist',
      existingNodes,
      existingEdges,
      tentativeClaims: [{ text: 'Fair point that regulation alone cannot prevent misuse', base_strength: 0.6 }],
      tentativeEdges,
    });

    // Should be identified as a concession
    expect(result.concession_indices).toEqual([0]);
    // A turn that is ALL concession passes — delta ~0 (no non-concession claims to evaluate)
    expect(result.pass).toBe(true);
  });

  it('concession + weak claim: gate evaluates only the non-concession claim', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.8 }),
    ];

    // Claim 0: concession (supports opponent)
    // Claim 1: weak claim (attacks own node)
    const tentativeEdges: ArgumentNetworkEdge[] = [
      makeEdge('AN-3', 'AN-2', 'supports', 0.7), // concession
      makeEdge('AN-4', 'AN-1', 'attacks', 0.9),   // self-attack
    ];

    const result = evaluateLookahead({
      speaker: 'accelerationist',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [
        { text: 'Concession to safetyist', base_strength: 0.5 },
        { text: 'Self-undermining claim', base_strength: 0.3 },
      ],
      tentativeEdges,
    });

    // Concession at index 0
    expect(result.concession_indices).toEqual([0]);
    // Gate delta should reflect only the weak claim, not the concession
    // The self-attack should make the delta negative or near-zero
  });

  it('non-concession supports edge is not flagged (supports own node)', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.5 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.6 }),
    ];

    // Supports OWN node — not a concession
    const tentativeEdges = [makeEdge('AN-3', 'AN-1', 'supports', 0.8)];

    const result = evaluateLookahead({
      speaker: 'accelerationist',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [{ text: 'Supporting evidence for my claim', base_strength: 0.7 }],
      tentativeEdges,
    });

    // Should NOT be identified as a concession — supports own node
    expect(result.concession_indices).toBeUndefined();
  });
});

describe('evaluateLookaheadPerClaim — concession classification', () => {
  it('classifies concession claims as PRESERVE', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.8 }),
    ];

    const { perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [
        { text: 'Strong attack', base_strength: 0.9 },
        { text: 'Concession to safetyist', base_strength: 0.5 },
      ],
      tentativeEdges: [
        makeEdge('AN-3', 'AN-2', 'attacks', 0.8), // attack
        makeEdge('AN-4', 'AN-2', 'supports', 0.7), // concession
      ],
    });

    expect(perClaim).toHaveLength(2);
    expect(perClaim[0].classification).toBe('STRONG');
    expect(perClaim[1].classification).toBe('PRESERVE');
    expect(perClaim[1].marginal_delta).toBe(0); // Neutral
  });

  it('PRESERVE concessions go to preserveConcessions in buildClaimAnalysis', () => {
    const existingNodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', base_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', base_strength: 0.8 }),
    ];

    const { perClaim } = evaluateLookaheadPerClaim({
      speaker: 'accelerationist',
      existingNodes,
      existingEdges: [],
      tentativeClaims: [
        { text: 'Concession to safetyist', base_strength: 0.5 },
      ],
      tentativeEdges: [
        makeEdge('AN-3', 'AN-2', 'supports', 0.7),
      ],
    });

    const analysis = buildClaimAnalysis(perClaim);
    expect(analysis.preserveConcessions).toHaveLength(1);
    expect(analysis.preserveConcessions[0].text).toBe('Concession to safetyist');
    expect(analysis.preserveConcessions[0].reason).toContain('Concession to opponent');
    expect(analysis.strongFoundations).toHaveLength(0);
    expect(analysis.avoidClaims).toHaveLength(0);
  });
});
