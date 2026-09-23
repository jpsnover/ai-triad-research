// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { extractCrossAgentOppositions } from './caExtraction.js';
import type { ArgumentNetworkNode } from '../types/argumentNetwork.js';
import type { ConflictFile } from '../taxonomyLoader.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  speaker: ArgumentNetworkNode['speaker'],
  turn: number,
  primaryRef: string | undefined,
): ArgumentNetworkNode {
  return {
    id,
    text: `Claim ${id}`,
    speaker,
    source_entry_id: 'e1',
    taxonomy_refs: [],
    turn_number: turn,
    claim_taxonomy_attribution: primaryRef !== undefined
      ? { primary_ref: primaryRef, attribution_confidence: 0.9 }
      : undefined,
  };
}

function makeConflict(claimId: string, ...nodeIds: string[]): ConflictFile {
  return {
    claim_id: claimId,
    claim_label: `Conflict ${claimId}`,
    description: 'Semantic opposition pair',
    status: 'active',
    linked_taxonomy_nodes: nodeIds,
    instances: [],
  };
}

// ── Core detection ────────────────────────────────────────────────────────────

describe('extractCrossAgentOppositions', () => {
  it('detects a single cross-agent opposition', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 1, 'saf-B-001'),
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions).toHaveLength(1);
    expect(result.oppositions[0].attackerNodeId).toBe('AN-1');
    expect(result.oppositions[0].targetNodeId).toBe('AN-2');
    expect(result.oppositions[0].conflictClaimId).toBe('CF-1');
  });

  it('assigns earlier-turn node as attacker', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 5, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 2, 'saf-B-001'),
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions[0].attackerNodeId).toBe('AN-2'); // turn 2 < turn 5
    expect(result.oppositions[0].targetNodeId).toBe('AN-1');
  });

  it('index-order tiebreak when turns are equal', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 3, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 3, 'saf-B-001'),
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    // a.turn_number <= b.turn_number (3 <= 3) → a is attacker
    expect(result.oppositions[0].attackerNodeId).toBe('AN-1');
    expect(result.oppositions[0].targetNodeId).toBe('AN-2');
  });

  it('returns empty when nodes have no matching conflict entry', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 1, 'saf-B-002'), // different node — no conflict
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions).toHaveLength(0);
    expect(result.fnMetrics.noConflictMatch).toBe(1);
  });

  it('detects opposition regardless of node order in conflict entry', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'saf-B-001'), // reversed attribution order
      makeNode('AN-2', 'safetyist', 1, 'acc-B-001'),
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions).toHaveLength(1);
  });

  it('detects multiple independent oppositions in a single debate', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 1, 'saf-B-001'),
      makeNode('AN-3', 'accelerationist', 2, 'acc-B-002'),
      makeNode('AN-4', 'skeptic', 3, 'skp-B-001'),
    ];
    const conflicts = [
      makeConflict('CF-1', 'acc-B-001', 'saf-B-001'),
      makeConflict('CF-2', 'acc-B-002', 'skp-B-001'),
    ];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions).toHaveLength(2);
    const conflictIds = result.oppositions.map(o => o.conflictClaimId).sort();
    expect(conflictIds).toEqual(['CF-1', 'CF-2']);
  });
});

// ── Cross-agent invariant ─────────────────────────────────────────────────────

describe('extractCrossAgentOppositions — cross-agent invariant', () => {
  it('skips same-speaker pairs', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'accelerationist', 1, 'acc-B-002'),
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'acc-B-002')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions).toHaveLength(0);
    expect(result.fnMetrics.totalCrossAgentPairs).toBe(0);
  });

  it('excludes system and document pseudo-speakers', () => {
    const nodes = [
      makeNode('AN-1', 'system' as ArgumentNetworkNode['speaker'], 0, 'acc-B-001'),
      makeNode('AN-2', 'document' as ArgumentNetworkNode['speaker'], 1, 'saf-B-001'),
      makeNode('AN-3', 'accelerationist', 2, 'acc-B-001'),
      makeNode('AN-4', 'safetyist', 3, 'saf-B-001'),
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    // Only AN-3 and AN-4 are agent nodes → exactly 1 opposition
    expect(result.oppositions).toHaveLength(1);
    expect(result.fnMetrics.totalCrossAgentPairs).toBe(1);
  });
});

// ── FN metrics ────────────────────────────────────────────────────────────────

describe('extractCrossAgentOppositions — FN metrics', () => {
  it('counts unattributed pair when one node has no attribution', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 1, undefined), // no attribution
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions).toHaveLength(0);
    expect(result.fnMetrics.unattributedPairs).toBe(1);
    expect(result.fnMetrics.totalCrossAgentPairs).toBe(1);
    expect(result.fnMetrics.fnRateEstimate).toBeCloseTo(1.0);
  });

  it('counts unattributed pair when primary_ref is empty string', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      {
        ...makeNode('AN-2', 'safetyist', 1, ''),
        claim_taxonomy_attribution: { primary_ref: '', attribution_confidence: 0 },
      },
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.fnMetrics.unattributedPairs).toBe(1);
  });

  it('fnRateEstimate is 0 when no cross-agent pairs', () => {
    const result = extractCrossAgentOppositions([], []);
    expect(result.fnMetrics.fnRateEstimate).toBe(0);
  });

  it('fnRateEstimate is 0 when all pairs are attributed and matched', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 1, 'saf-B-001'),
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.fnMetrics.unattributedPairs).toBe(0);
    expect(result.fnMetrics.fnRateEstimate).toBe(0);
  });

  it('mixed: some attributed pairs matched, some not, some unattributed', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 1, 'saf-B-001'),    // matches CF-1
      makeNode('AN-3', 'skeptic', 2, 'skp-B-999'),      // attributed but no match
      makeNode('AN-4', 'safetyist', 3, undefined),      // unattributed
    ];
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    // Cross-agent pairs (speaker-distinct):
    // AN-1(acc) vs AN-2(saf) → match CF-1
    // AN-1(acc) vs AN-3(skp) → no conflict match
    // AN-1(acc) vs AN-4(saf) → unattributed (AN-4)
    // AN-2(saf) vs AN-3(skp) → no conflict match
    // AN-2(saf) vs AN-4(saf) → same speaker — skipped
    // AN-3(skp) vs AN-4(saf) → unattributed (AN-4)
    expect(result.fnMetrics.totalCrossAgentPairs).toBe(5);
    expect(result.fnMetrics.detected).toBe(1);
    expect(result.fnMetrics.noConflictMatch).toBe(2);
    expect(result.fnMetrics.unattributedPairs).toBe(2);
  });
});

// ── Empty inputs ──────────────────────────────────────────────────────────────

describe('extractCrossAgentOppositions — empty inputs', () => {
  it('handles empty nodes array', () => {
    const result = extractCrossAgentOppositions([], [makeConflict('CF-1', 'a', 'b')]);
    expect(result.oppositions).toHaveLength(0);
    expect(result.fnMetrics.totalCrossAgentPairs).toBe(0);
  });

  it('handles empty conflicts array', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 1, 'saf-B-001'),
    ];
    const result = extractCrossAgentOppositions(nodes, []);
    expect(result.oppositions).toHaveLength(0);
    expect(result.fnMetrics.noConflictMatch).toBe(1);
  });

  it('handles both empty', () => {
    const result = extractCrossAgentOppositions([], []);
    expect(result.oppositions).toHaveLength(0);
    expect(result.fnMetrics.totalCrossAgentPairs).toBe(0);
    expect(result.fnMetrics.fnRateEstimate).toBe(0);
  });
});

// ── Conflict index — multi-node entries ───────────────────────────────────────

describe('extractCrossAgentOppositions — multi-node conflict entries', () => {
  it('detects opposition when entry has more than two linked_taxonomy_nodes', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-003'),
      makeNode('AN-2', 'safetyist', 1, 'saf-B-001'),
    ];
    // Conflict entry links three nodes; acc-B-003 and saf-B-001 are among them
    const conflicts = [makeConflict('CF-1', 'acc-B-001', 'acc-B-003', 'saf-B-001')];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions).toHaveLength(1);
    expect(result.oppositions[0].conflictClaimId).toBe('CF-1');
  });

  it('first conflict entry wins when two entries share the same node pair', () => {
    const nodes = [
      makeNode('AN-1', 'accelerationist', 0, 'acc-B-001'),
      makeNode('AN-2', 'safetyist', 1, 'saf-B-001'),
    ];
    const conflicts = [
      makeConflict('CF-FIRST', 'acc-B-001', 'saf-B-001'),
      makeConflict('CF-SECOND', 'acc-B-001', 'saf-B-001'),
    ];

    const result = extractCrossAgentOppositions(nodes, conflicts);

    expect(result.oppositions[0].conflictClaimId).toBe('CF-FIRST');
  });
});
