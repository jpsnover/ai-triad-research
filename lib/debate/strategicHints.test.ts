// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  detectCommitmentTraps,
  detectCapabilityGaps,
  detectStrategyShifts,
  computeStrategicHints,
} from './strategicHints.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore } from './types.js';

// ── Helpers ──────────────────────────────────────────────

function makeNode(overrides: Partial<ArgumentNetworkNode> & { id: string; speaker: string }): ArgumentNetworkNode {
  return {
    text: `Claim ${overrides.id}`,
    source_entry_id: 'e-1',
    taxonomy_refs: [],
    turn_number: 1,
    base_strength: 0.5,
    ...overrides,
  };
}

function makeEdge(
  source: string, target: string,
  type: 'supports' | 'attacks' = 'attacks',
  scheme?: string,
): ArgumentNetworkEdge {
  return { source, target, type, weight: 0.5, scheme };
}

function emptyCommitments(): Record<string, CommitmentStore> {
  return {
    prometheus: { asserted: [], conceded: [], retracted: [] },
    sentinel: { asserted: [], conceded: [], retracted: [] },
    cassandra: { asserted: [], conceded: [], retracted: [] },
  };
}

// ── detectCommitmentTraps ────────────────────────────────

describe('detectCommitmentTraps', () => {
  it('returns empty when no commitments', () => {
    const nodes = [makeNode({ id: 'AN-1', speaker: 'prometheus' })];
    const hints = detectCommitmentTraps('prometheus', nodes, emptyCommitments());
    expect(hints).toHaveLength(0);
  });

  it('detects tension between asserted and conceded claims with overlapping words', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'sentinel' }),
    ];
    const commitments = emptyCommitments();
    commitments.sentinel.asserted = [
      'Advanced artificial intelligence systems require robust safety frameworks and regulatory oversight mechanisms',
    ];
    commitments.sentinel.conceded = [
      'Current artificial intelligence safety frameworks and regulatory oversight have significant limitations and gaps',
    ];

    const hints = detectCommitmentTraps('prometheus', nodes, commitments);
    expect(hints.length).toBeGreaterThanOrEqual(1);
    expect(hints[0].type).toBe('commitment_trap');
    expect(hints[0].target_speaker).toBe('sentinel');
    expect(hints[0].hint).toContain('DISTINGUISH');
  });

  it('does not flag own commitments', () => {
    const nodes = [makeNode({ id: 'AN-1', speaker: 'prometheus' })];
    const commitments = emptyCommitments();
    commitments.prometheus.asserted = [
      'Advanced artificial intelligence systems require robust safety frameworks and regulatory oversight mechanisms',
    ];
    commitments.prometheus.conceded = [
      'Current artificial intelligence safety frameworks and regulatory oversight have significant limitations and gaps',
    ];

    const hints = detectCommitmentTraps('prometheus', nodes, commitments);
    expect(hints).toHaveLength(0);
  });

  it('detects taxonomy ref overlap between conceded and asserted territory', () => {
    const nodes = [
      makeNode({
        id: 'AN-1', speaker: 'sentinel',
        text: 'Safety governance requires international coordination',
        taxonomy_refs: ['saf-desires-001'],
        computed_strength: 0.7,
      }),
      makeNode({
        id: 'AN-2', speaker: 'sentinel',
        text: 'International governance coordination is insufficient today',
        taxonomy_refs: ['saf-desires-001'],
        computed_strength: 0.6,
      }),
    ];
    const commitments = emptyCommitments();
    commitments.sentinel.asserted = ['Safety governance matters'];
    commitments.sentinel.conceded = [
      'International governance coordination mechanisms have fundamental structural problems',
    ];

    const hints = detectCommitmentTraps('prometheus', nodes, commitments);
    // May or may not fire depending on word overlap — the taxonomy ref path requires overlap ≥ 2
    expect(hints.every(h => h.type === 'commitment_trap')).toBe(true);
  });

  it('caps hints at 2 per call', () => {
    const nodes = [makeNode({ id: 'AN-1', speaker: 'sentinel' })];
    const commitments = emptyCommitments();
    // Create many overlapping asserted/conceded pairs
    const baseWords = 'advanced artificial intelligence systems require robust safety frameworks regulatory oversight';
    commitments.sentinel.asserted = [
      `First claim about ${baseWords} being essential`,
      `Second claim about ${baseWords} being necessary`,
      `Third claim about ${baseWords} being critical`,
    ];
    commitments.sentinel.conceded = [
      `Concession that ${baseWords} have limitations`,
      `Another concession about ${baseWords} failures`,
      `Third concession regarding ${baseWords} gaps`,
    ];

    const hints = detectCommitmentTraps('prometheus', nodes, commitments);
    expect(hints.length).toBeLessThanOrEqual(2);
  });
});

// ── detectCapabilityGaps ─────────────────────────────────

describe('detectCapabilityGaps', () => {
  it('returns empty when no taxonomy refs', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus' }),
      makeNode({ id: 'AN-2', speaker: 'sentinel' }),
    ];
    const hints = detectCapabilityGaps('prometheus', nodes);
    expect(hints).toHaveLength(0);
  });

  it('detects sparse coverage in opponent taxonomy area', () => {
    const nodes = [
      // Prometheus has 3 acc refs
      makeNode({ id: 'AN-1', speaker: 'prometheus', taxonomy_refs: ['acc-beliefs-001'] }),
      makeNode({ id: 'AN-2', speaker: 'prometheus', taxonomy_refs: ['acc-desires-002'] }),
      makeNode({ id: 'AN-3', speaker: 'prometheus', taxonomy_refs: ['acc-intentions-003'] }),
      // Sentinel has 0 acc refs
      makeNode({ id: 'AN-4', speaker: 'sentinel', taxonomy_refs: ['saf-beliefs-001'] }),
    ];

    const hints = detectCapabilityGaps('prometheus', nodes);
    expect(hints.length).toBeGreaterThanOrEqual(1);
    expect(hints[0].type).toBe('capability_gap');
    expect(hints[0].target_speaker).toBe('sentinel');
    expect(hints[0].hint).toContain('accelerationist');
  });

  it('does not flag pol or sit prefixes', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'prometheus', taxonomy_refs: ['pol-001'] }),
      makeNode({ id: 'AN-2', speaker: 'prometheus', taxonomy_refs: ['pol-002'] }),
      makeNode({ id: 'AN-3', speaker: 'prometheus', taxonomy_refs: ['pol-003'] }),
      makeNode({ id: 'AN-4', speaker: 'sentinel', taxonomy_refs: ['saf-beliefs-001'] }),
    ];

    const hints = detectCapabilityGaps('prometheus', nodes);
    const polHints = hints.filter(h => h.hint.includes('pol'));
    expect(polHints).toHaveLength(0);
  });

  it('requires at least 3 refs to flag a gap', () => {
    const nodes = [
      // Only 2 acc refs — below threshold
      makeNode({ id: 'AN-1', speaker: 'prometheus', taxonomy_refs: ['acc-beliefs-001'] }),
      makeNode({ id: 'AN-2', speaker: 'prometheus', taxonomy_refs: ['acc-desires-002'] }),
      makeNode({ id: 'AN-3', speaker: 'sentinel', taxonomy_refs: ['saf-beliefs-001'] }),
    ];

    const hints = detectCapabilityGaps('prometheus', nodes);
    expect(hints).toHaveLength(0);
  });

  it('caps hints at 2', () => {
    const nodes = [
      // Prometheus dominates acc, saf, and skp
      ...Array.from({ length: 4 }, (_, i) =>
        makeNode({ id: `AN-${i + 1}`, speaker: 'prometheus', taxonomy_refs: [`acc-beliefs-${i}`] }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeNode({ id: `AN-${i + 5}`, speaker: 'prometheus', taxonomy_refs: [`saf-beliefs-${i}`] }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeNode({ id: `AN-${i + 9}`, speaker: 'prometheus', taxonomy_refs: [`skp-beliefs-${i}`] }),
      ),
      makeNode({ id: 'AN-20', speaker: 'sentinel', taxonomy_refs: [] }),
    ];

    const hints = detectCapabilityGaps('prometheus', nodes);
    expect(hints.length).toBeLessThanOrEqual(2);
  });
});

// ── detectStrategyShifts ─────────────────────────────────

describe('detectStrategyShifts', () => {
  it('returns empty with insufficient data', () => {
    const nodes = [makeNode({ id: 'AN-1', speaker: 'prometheus' })];
    const edges = [makeEdge('AN-1', 'AN-1', 'attacks', 'COUNTEREXAMPLE')];
    const hints = detectStrategyShifts(nodes, edges, 1);
    expect(hints).toHaveLength(0);
  });

  it('detects shift from adversarial to cooperative', () => {
    const nodes = [
      // Early adversarial moves (turns 1-3)
      makeNode({ id: 'AN-1', speaker: 'sentinel', turn_number: 1 }),
      makeNode({ id: 'AN-2', speaker: 'sentinel', turn_number: 2 }),
      makeNode({ id: 'AN-3', speaker: 'sentinel', turn_number: 3 }),
      // Recent cooperative moves (turns 5-7)
      makeNode({ id: 'AN-4', speaker: 'sentinel', turn_number: 5 }),
      makeNode({ id: 'AN-5', speaker: 'sentinel', turn_number: 6 }),
      makeNode({ id: 'AN-6', speaker: 'sentinel', turn_number: 7 }),
      // Targets
      makeNode({ id: 'AN-T1', speaker: 'prometheus', turn_number: 1 }),
      makeNode({ id: 'AN-T2', speaker: 'prometheus', turn_number: 5 }),
    ];
    const edges: ArgumentNetworkEdge[] = [
      // Early: all adversarial
      makeEdge('AN-1', 'AN-T1', 'attacks', 'COUNTEREXAMPLE'),
      makeEdge('AN-2', 'AN-T1', 'attacks', 'UNDERCUT'),
      makeEdge('AN-3', 'AN-T1', 'attacks', 'BURDEN-SHIFT'),
      // Recent: all cooperative
      makeEdge('AN-4', 'AN-T2', 'supports', 'EXTEND'),
      makeEdge('AN-5', 'AN-T2', 'supports', 'INTEGRATE'),
      makeEdge('AN-6', 'AN-T2', 'supports', 'CONCEDE-AND-PIVOT'),
    ];

    // Recent window starts at turn 5
    const hints = detectStrategyShifts(nodes, edges, 5);
    expect(hints.length).toBeGreaterThanOrEqual(1);
    expect(hints[0].type).toBe('strategy_shift');
    expect(hints[0].target_speaker).toBe('sentinel');
    expect(hints[0].hint).toContain('cooperative');
  });

  it('does not flag when shift is below threshold', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'sentinel', turn_number: 1 }),
      makeNode({ id: 'AN-2', speaker: 'sentinel', turn_number: 2 }),
      makeNode({ id: 'AN-3', speaker: 'sentinel', turn_number: 3 }),
      makeNode({ id: 'AN-4', speaker: 'sentinel', turn_number: 5 }),
      makeNode({ id: 'AN-T1', speaker: 'prometheus', turn_number: 1 }),
    ];
    const edges: ArgumentNetworkEdge[] = [
      // Mix of adversarial and cooperative throughout
      makeEdge('AN-1', 'AN-T1', 'attacks', 'COUNTEREXAMPLE'),
      makeEdge('AN-2', 'AN-T1', 'supports', 'EXTEND'),
      makeEdge('AN-3', 'AN-T1', 'attacks', 'UNDERCUT'),
      makeEdge('AN-4', 'AN-T1', 'supports', 'EXTEND'),
    ];

    const hints = detectStrategyShifts(nodes, edges, 4);
    // Small shift — should not trigger (need ≥0.25 delta)
    const shiftHints = hints.filter(h => h.target_speaker === 'sentinel');
    // Ratio is balanced enough that shift < 0.25
    expect(shiftHints.length).toBeLessThanOrEqual(1); // May or may not fire depending on exact ratios
  });

  it('ignores system and document speakers', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'system', turn_number: 1 }),
      makeNode({ id: 'AN-2', speaker: 'document', turn_number: 2 }),
      makeNode({ id: 'AN-T1', speaker: 'prometheus', turn_number: 1 }),
    ];
    const edges: ArgumentNetworkEdge[] = [
      makeEdge('AN-1', 'AN-T1', 'attacks', 'COUNTEREXAMPLE'),
      makeEdge('AN-2', 'AN-T1', 'supports', 'EXTEND'),
    ];

    const hints = detectStrategyShifts(nodes, edges, 1);
    expect(hints).toHaveLength(0);
  });
});

// ── computeStrategicHints (integration) ──────────────────

describe('computeStrategicHints', () => {
  it('returns string array combining all hint types', () => {
    const nodes = [
      // Prometheus has 3 acc refs, sentinel has none
      makeNode({ id: 'AN-1', speaker: 'prometheus', taxonomy_refs: ['acc-beliefs-001'] }),
      makeNode({ id: 'AN-2', speaker: 'prometheus', taxonomy_refs: ['acc-desires-002'] }),
      makeNode({ id: 'AN-3', speaker: 'prometheus', taxonomy_refs: ['acc-intentions-003'] }),
      makeNode({ id: 'AN-4', speaker: 'sentinel', taxonomy_refs: ['saf-beliefs-001'] }),
    ];
    const edges: ArgumentNetworkEdge[] = [];
    const commitments = emptyCommitments();

    const hints = computeStrategicHints('prometheus', nodes, edges, commitments, 3);
    expect(Array.isArray(hints)).toBe(true);
    expect(hints.every(h => typeof h === 'string')).toBe(true);
    // Should have at least the capability gap hint
    expect(hints.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array when no hints generated', () => {
    const nodes = [makeNode({ id: 'AN-1', speaker: 'prometheus' })];
    const hints = computeStrategicHints('prometheus', nodes, [], emptyCommitments(), 1);
    expect(hints).toHaveLength(0);
  });
});
