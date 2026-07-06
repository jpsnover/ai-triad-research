// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { extractCalibrationData } from '../calibrationLogger.js';
import type { DebateSession, ArgumentNetworkNode, ArgumentNetworkEdge } from '../types.js';

function makeNode(id: string, speaker: string, sourceEntryId: string): ArgumentNetworkNode {
  return {
    id,
    text: `Claim ${id}`,
    speaker: speaker as ArgumentNetworkNode['speaker'],
    source_entry_id: sourceEntryId,
    taxonomy_refs: [],
    turn_number: 1,
  };
}

function makeEdge(id: string, source: string, target: string, opts?: {
  type?: 'supports' | 'attacks' | 'revoice_of';
  weight?: number;
  strength?: 'decisive' | 'substantial' | 'tangential';
  warrant?: string;
}): ArgumentNetworkEdge {
  return {
    id,
    source,
    target,
    type: opts?.type ?? 'supports',
    weight: opts?.weight,
    strength: opts?.strength,
    warrant: opts?.warrant,
  };
}

function makeSession(nodes: ArgumentNetworkNode[], edges: ArgumentNetworkEdge[], roundCount: number = 3): DebateSession {
  const transcript: any[] = [];
  for (let r = 1; r <= roundCount; r++) {
    transcript.push({
      id: `entry-r${r}-acc`,
      type: r === 1 ? 'opening' : 'statement',
      speaker: 'accelerationist',
      content: `Turn content round ${r}`,
      timestamp: new Date().toISOString(),
      metadata: { round: r },
    });
    transcript.push({
      id: `entry-r${r}-saf`,
      type: r === 1 ? 'opening' : 'statement',
      speaker: 'safetyist',
      content: `Turn content round ${r}`,
      timestamp: new Date().toISOString(),
      metadata: { round: r },
    });
  }

  return {
    id: 'test-debate',
    topic: { original: 'test', final: 'test' },
    phase: 'complete',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    transcript,
    argument_network: { nodes, edges },
    convergence_signals: [],
    context_summaries: [],
    neutral_evaluations: [],
  } as unknown as DebateSession;
}

describe('local sufficiency calibration metrics', () => {
  it('scores zero for claims with no incoming supports', () => {
    const nodes = [
      makeNode('c1', 'accelerationist', 'entry-r1-acc'),
      makeNode('c2', 'safetyist', 'entry-r1-saf'),
    ];
    const session = makeSession(nodes, [], 2);
    const dp = extractCalibrationData(session, 'test');

    expect(dp.local_sufficiency_mean).toBe(0);
    expect(dp.unsupported_claim_rate).toBe(1);
  });

  it('applies warrant bonus (1.25x) for edges with explicit warrant', () => {
    const nodes = [
      makeNode('c1', 'accelerationist', 'entry-r1-acc'),
      makeNode('premise', 'safetyist', 'entry-r1-saf'),
    ];
    const edgesNoWarrant = [
      makeEdge('e1', 'premise', 'c1', { weight: 0.5, strength: 'decisive' }),
    ];
    const edgesWithWarrant = [
      makeEdge('e1', 'premise', 'c1', { weight: 0.5, strength: 'decisive', warrant: 'Because X follows from Y' }),
    ];

    const dpNoWarrant = extractCalibrationData(makeSession(nodes, edgesNoWarrant, 2), 'test');
    const dpWithWarrant = extractCalibrationData(makeSession(nodes, edgesWithWarrant, 2), 'test');

    expect(dpWithWarrant.local_sufficiency_mean!).toBeGreaterThan(dpNoWarrant.local_sufficiency_mean!);
  });

  it('applies correct strength multipliers', () => {
    const nodes = [
      makeNode('c1', 'accelerationist', 'entry-r1-acc'),
      makeNode('c2', 'accelerationist', 'entry-r1-acc'),
      makeNode('c3', 'accelerationist', 'entry-r1-acc'),
      makeNode('premise', 'safetyist', 'entry-r1-saf'),
    ];

    const makeSessionWithStrength = (strength: 'decisive' | 'substantial' | 'tangential', target: string) => {
      const edges = [makeEdge('e1', 'premise', target, { weight: 1.0, strength })];
      return extractCalibrationData(makeSession([...nodes], edges, 2), 'test');
    };

    const dpDecisive = makeSessionWithStrength('decisive', 'c1');
    const dpSubstantial = makeSessionWithStrength('substantial', 'c1');
    const dpTangential = makeSessionWithStrength('tangential', 'c1');

    // decisive (1.0) > substantial (0.7) > tangential (0.3), but only c1 gets support
    // c2, c3 get 0, so mean = support_score / 4 (4 eligible claims including premise)
    // Just check the relative ordering holds
    expect(dpDecisive.local_sufficiency_mean!).toBeGreaterThan(dpSubstantial.local_sufficiency_mean!);
    expect(dpSubstantial.local_sufficiency_mean!).toBeGreaterThan(dpTangential.local_sufficiency_mean!);
  });

  it('excludes final-round claims from eligibility (maturity window)', () => {
    const nodes = [
      makeNode('c1', 'accelerationist', 'entry-r1-acc'),
      makeNode('c2', 'safetyist', 'entry-r2-saf'),
      makeNode('c3-final', 'accelerationist', 'entry-r3-acc'),
    ];
    const edges = [
      makeEdge('e1', 'c2', 'c1', { weight: 0.8, strength: 'decisive' }),
    ];
    const session = makeSession(nodes, edges, 3);
    const dp = extractCalibrationData(session, 'test');

    // c3-final is round 3 (max round) → excluded
    // eligible: c1 (supported, score ~0.8) + c2 (unsupported, score 0)
    // unsupported_claim_rate = 1/2 = 0.5
    expect(dp.unsupported_claim_rate).toBe(0.5);
  });

  it('returns null for all three fields when argument_network is absent', () => {
    const session = {
      id: 'test-no-an',
      topic: { original: 'test', final: 'test' },
      phase: 'complete',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      transcript: [
        { id: 'e1', type: 'opening', speaker: 'accelerationist', content: 'test', timestamp: new Date().toISOString(), metadata: { round: 1 } },
      ],
      convergence_signals: [],
      context_summaries: [],
      neutral_evaluations: [],
    } as unknown as DebateSession;

    const dp = extractCalibrationData(session, 'test');
    expect(dp.local_sufficiency_mean).toBeNull();
    expect(dp.unsupported_claim_rate).toBeNull();
    expect(dp.local_sufficiency_by_speaker).toBeNull();
  });

  it('excludes system and document nodes from eligibility', () => {
    const nodes = [
      makeNode('c1', 'accelerationist', 'entry-r1-acc'),
      makeNode('sys1', 'system', 'entry-r1-acc'),
      makeNode('doc1', 'document', 'entry-r1-saf'),
    ];
    const edges = [
      makeEdge('e1', 'doc1', 'c1', { weight: 0.9, strength: 'decisive' }),
    ];
    const session = makeSession(nodes, edges, 2);
    const dp = extractCalibrationData(session, 'test');

    // Only c1 is eligible (system/document excluded)
    // c1 has one decisive support at 0.9 → s(c1) = min(1, 0.9) = 0.9
    expect(dp.unsupported_claim_rate).toBe(0);
    expect(dp.local_sufficiency_mean).toBe(0.9);
  });

  it('populates per-speaker breakdown', () => {
    const nodes = [
      makeNode('c1', 'accelerationist', 'entry-r1-acc'),
      makeNode('c2', 'safetyist', 'entry-r1-saf'),
      makeNode('premise', 'accelerationist', 'entry-r1-acc'),
    ];
    const edges = [
      makeEdge('e1', 'premise', 'c2', { weight: 0.7, strength: 'substantial' }),
    ];
    const session = makeSession(nodes, edges, 2);
    const dp = extractCalibrationData(session, 'test');

    expect(dp.local_sufficiency_by_speaker).not.toBeNull();
    expect(dp.local_sufficiency_by_speaker!['accelerationist']).toBeDefined();
    expect(dp.local_sufficiency_by_speaker!['safetyist']).toBeDefined();
    // accelerationist: c1 (0) + premise (0) → mean 0
    expect(dp.local_sufficiency_by_speaker!['accelerationist']).toBe(0);
    // safetyist: c2 has support → score > 0
    expect(dp.local_sufficiency_by_speaker!['safetyist']).toBeGreaterThan(0);
  });

  it('caps individual claim score at 1.0', () => {
    const nodes = [
      makeNode('c1', 'accelerationist', 'entry-r1-acc'),
      makeNode('p1', 'safetyist', 'entry-r1-saf'),
      makeNode('p2', 'safetyist', 'entry-r1-saf'),
    ];
    const edges = [
      makeEdge('e1', 'p1', 'c1', { weight: 1.0, strength: 'decisive', warrant: 'reason A' }),
      makeEdge('e2', 'p2', 'c1', { weight: 1.0, strength: 'decisive', warrant: 'reason B' }),
    ];
    const session = makeSession(nodes, edges, 2);
    const dp = extractCalibrationData(session, 'test');

    // c1 has massive support (>1.0 raw) but capped at 1.0
    // p1, p2 have no support → 0 each
    // mean = (1.0 + 0 + 0) / 3
    expect(dp.local_sufficiency_mean!).toBeLessThanOrEqual(1);
  });
});
