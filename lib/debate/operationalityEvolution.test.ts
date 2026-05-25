// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  evaluateOperationalityGate,
  applyOperationalityDriftCap,
  computeOperationalityUpdates,
  computeCrossPovAdoption,
  buildOperationalityHistoryEntry,
  ATTRIBUTION_THRESHOLD,
  STRENGTH_DROP_THRESHOLD,
  STRENGTH_SURVIVE_THRESHOLD,
  SPECIFY_SCHEMES,
} from './operationalityEvolution.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, ClaimTaxonomyAttribution } from './types.js';
import type { PovNode } from './taxonomyTypes.js';

// ── Helpers ─────────────────────────────────────────────

function makeClaimNode(id: string, opts: {
  speaker?: string;
  strength?: number;
  intentionRef?: string;
  attrConf?: number;
} = {}): ArgumentNetworkNode {
  return {
    id,
    text: `Claim ${id}`,
    speaker: (opts.speaker ?? 'accelerationist') as any,
    source_entry_id: 'entry-1',
    taxonomy_refs: opts.intentionRef ? [opts.intentionRef] : [],
    turn_number: 1,
    computed_strength: opts.strength ?? 0.5,
    claim_taxonomy_attribution: opts.intentionRef ? {
      primary_ref: opts.intentionRef,
      attribution_confidence: opts.attrConf ?? 0.80,
    } : undefined,
  };
}

function makeAttackEdge(source: string, target: string, scheme?: string): ArgumentNetworkEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    type: 'attacks',
    scheme: scheme as any,
  };
}

function makeSupportEdge(source: string, target: string): ArgumentNetworkEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    type: 'supports',
  };
}

function makeIntentionNode(id: string, operationality?: number): PovNode {
  return {
    id,
    category: 'Intentions',
    label: `Intention ${id}`,
    description: `An Intention within test discourse that ${id}`,
    parent_id: null,
    children: [],
    situation_refs: [],
    operationality,
  };
}

// ── evaluateOperationalityGate ──────────────────────────

describe('evaluateOperationalityGate', () => {
  it('passes all 3 conditions: high attribution, SPECIFY scheme, decisive drop', () => {
    const attr: ClaimTaxonomyAttribution = { primary_ref: 'acc-intentions-001', attribution_confidence: 0.80 };
    const edges = [makeAttackEdge('c-2', 'c-1', 'SPECIFY')];
    const claim = makeClaimNode('c-1', { strength: 0.2, intentionRef: 'acc-intentions-001' });

    const result = evaluateOperationalityGate(attr, edges, claim);

    expect(result.passed).toBe(true);
    expect(result.direction).toBe('down');
    expect(result.conditions_met).toHaveLength(3);
  });

  it('passes with EMPIRICAL CHALLENGE scheme and high strength', () => {
    const attr: ClaimTaxonomyAttribution = { primary_ref: 'acc-intentions-001', attribution_confidence: 0.75 };
    const edges = [makeAttackEdge('c-2', 'c-1', 'EMPIRICAL CHALLENGE')];
    const claim = makeClaimNode('c-1', { strength: 0.85, intentionRef: 'acc-intentions-001' });

    const result = evaluateOperationalityGate(attr, edges, claim);

    expect(result.passed).toBe(true);
    expect(result.direction).toBe('up');
  });

  it('fails when attribution too low', () => {
    const attr: ClaimTaxonomyAttribution = { primary_ref: 'acc-intentions-001', attribution_confidence: 0.50 };
    const edges = [makeAttackEdge('c-2', 'c-1', 'SPECIFY')];
    const claim = makeClaimNode('c-1', { strength: 0.2 });

    const result = evaluateOperationalityGate(attr, edges, claim);

    expect(result.passed).toBe(false);
    expect(result.conditions_missed).toContain('attribution');
  });

  it('fails when no SPECIFY/EMPIRICAL CHALLENGE scheme', () => {
    const attr: ClaimTaxonomyAttribution = { primary_ref: 'acc-intentions-001', attribution_confidence: 0.80 };
    const edges = [makeAttackEdge('c-2', 'c-1', 'CONCEDE')];
    const claim = makeClaimNode('c-1', { strength: 0.2 });

    const result = evaluateOperationalityGate(attr, edges, claim);

    expect(result.passed).toBe(false);
    expect(result.conditions_missed).toContain('specify_challenge');
  });

  it('fails when outcome is not decisive (middle strength)', () => {
    const attr: ClaimTaxonomyAttribution = { primary_ref: 'acc-intentions-001', attribution_confidence: 0.80 };
    const edges = [makeAttackEdge('c-2', 'c-1', 'SPECIFY')];
    const claim = makeClaimNode('c-1', { strength: 0.5 });

    const result = evaluateOperationalityGate(attr, edges, claim);

    expect(result.passed).toBe(false);
    expect(result.conditions_missed).toContain('decisive_outcome');
    expect(result.direction).toBe('none');
  });

  it('handles missing attribution', () => {
    const edges = [makeAttackEdge('c-2', 'c-1', 'SPECIFY')];
    const claim = makeClaimNode('c-1', { strength: 0.2 });

    const result = evaluateOperationalityGate(undefined, edges, claim);

    expect(result.passed).toBe(false);
    expect(result.conditions_missed).toContain('attribution');
  });
});

// ── applyOperationalityDriftCap ─────────────────────────

describe('applyOperationalityDriftCap', () => {
  it('allows delta within drift cap', () => {
    expect(applyOperationalityDriftCap(4, 4, -1)).toBe(-1);
    expect(applyOperationalityDriftCap(4, 4, 1)).toBe(1);
  });

  it('caps at ±2 drift', () => {
    // Current=2, initial=4, drift=-2 already. Further -1 should be capped to 0.
    expect(applyOperationalityDriftCap(2, 4, -1)).toBe(0);
    // Current=5, initial=3, drift=+2 already. Further +1 should be capped to 0.
    expect(applyOperationalityDriftCap(5, 3, 1)).toBe(0);
  });

  it('clamps to [1, 5] range', () => {
    // Current=1, trying -1 → would go to 0, clamp to 1 → delta 0
    expect(applyOperationalityDriftCap(1, 3, -1)).toBe(0);
    // Current=5, trying +1 → would go to 6, clamp to 5 → delta 0
    expect(applyOperationalityDriftCap(5, 4, 1)).toBe(0);
  });

  it('allows partial drift when close to cap', () => {
    // Current=3, initial=4, drift=-1. Can still go -1 more.
    expect(applyOperationalityDriftCap(3, 4, -1)).toBe(-1);
    // Current=5, initial=4, drift=+1. Can still go +1 more... but clamped to 5.
    expect(applyOperationalityDriftCap(5, 4, 1)).toBe(0);
  });
});

// ── computeOperationalityUpdates ────────────────────────

describe('computeOperationalityUpdates', () => {
  it('produces -1 update when SPECIFY challenge causes strength drop', () => {
    const intention = makeIntentionNode('acc-intentions-001', 4);
    const claim = makeClaimNode('c-1', { strength: 0.2, intentionRef: 'acc-intentions-001', attrConf: 0.80 });
    const attacker = makeClaimNode('c-2', { speaker: 'safetyist' });
    const edge = makeAttackEdge('c-2', 'c-1', 'SPECIFY');

    const updates = computeOperationalityUpdates({
      debate_id: 'debate-1',
      nodes: [claim, attacker],
      edges: [edge],
      intentions: new Map([['acc-intentions-001', intention]]),
      initial_operationalities: new Map([['acc-intentions-001', 4]]),
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].reason).toBe('failed_specify');
    expect(updates[0].delta).toBe(-1);
    expect(updates[0].new_value).toBe(3);
  });

  it('produces +1 update when SPECIFY challenge is survived', () => {
    const intention = makeIntentionNode('acc-intentions-001', 3);
    const claim = makeClaimNode('c-1', { strength: 0.85, intentionRef: 'acc-intentions-001', attrConf: 0.80 });
    const attacker = makeClaimNode('c-2', { speaker: 'safetyist' });
    const edge = makeAttackEdge('c-2', 'c-1', 'SPECIFY');

    const updates = computeOperationalityUpdates({
      debate_id: 'debate-1',
      nodes: [claim, attacker],
      edges: [edge],
      intentions: new Map([['acc-intentions-001', intention]]),
      initial_operationalities: new Map([['acc-intentions-001', 3]]),
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].reason).toBe('survived_specify');
    expect(updates[0].delta).toBe(1);
    expect(updates[0].new_value).toBe(4);
  });

  it('respects drift cap', () => {
    const intention = makeIntentionNode('acc-intentions-001', 2);
    const claim = makeClaimNode('c-1', { strength: 0.2, intentionRef: 'acc-intentions-001', attrConf: 0.80 });
    const edge = makeAttackEdge('c-2', 'c-1', 'SPECIFY');
    const attacker = makeClaimNode('c-2');

    // Initial was 4, current is 2 → drift already -2, no more room
    const updates = computeOperationalityUpdates({
      debate_id: 'debate-1',
      nodes: [claim, attacker],
      edges: [edge],
      intentions: new Map([['acc-intentions-001', intention]]),
      initial_operationalities: new Map([['acc-intentions-001', 4]]),
    });

    expect(updates).toHaveLength(0); // capped, no update
  });

  it('skips non-Intention nodes', () => {
    const belief: PovNode = {
      id: 'acc-beliefs-001', category: 'Beliefs', label: 'B',
      description: 'A Belief within test discourse that tests',
      parent_id: null, children: [], situation_refs: [], confidence: 0.5,
    };
    const claim = makeClaimNode('c-1', { strength: 0.2, intentionRef: 'acc-beliefs-001', attrConf: 0.80 });
    const edge = makeAttackEdge('c-2', 'c-1', 'SPECIFY');
    const attacker = makeClaimNode('c-2');

    const updates = computeOperationalityUpdates({
      debate_id: 'debate-1',
      nodes: [claim, attacker],
      edges: [edge],
      intentions: new Map([['acc-beliefs-001', belief]]),
      initial_operationalities: new Map(),
    });

    expect(updates).toHaveLength(0);
  });

  it('deduplicates updates for the same intention', () => {
    const intention = makeIntentionNode('acc-intentions-001', 4);
    const claim1 = makeClaimNode('c-1', { strength: 0.2, intentionRef: 'acc-intentions-001', attrConf: 0.80 });
    const claim2 = makeClaimNode('c-3', { strength: 0.15, intentionRef: 'acc-intentions-001', attrConf: 0.90 });
    const attacker1 = makeClaimNode('c-2');
    const attacker2 = makeClaimNode('c-4');

    const updates = computeOperationalityUpdates({
      debate_id: 'debate-1',
      nodes: [claim1, claim2, attacker1, attacker2],
      edges: [
        makeAttackEdge('c-2', 'c-1', 'SPECIFY'),
        makeAttackEdge('c-4', 'c-3', 'EMPIRICAL CHALLENGE'),
      ],
      intentions: new Map([['acc-intentions-001', intention]]),
      initial_operationalities: new Map([['acc-intentions-001', 4]]),
    });

    expect(updates).toHaveLength(1); // deduplicated
  });
});

// ── computeCrossPovAdoption ─────────────────────────────

describe('computeCrossPovAdoption', () => {
  it('produces +1 when opponent supports an Intention claim', () => {
    const intention = makeIntentionNode('acc-intentions-001', 3);
    const ownClaim = makeClaimNode('c-1', { speaker: 'accelerationist', intentionRef: 'acc-intentions-001', attrConf: 0.80 });
    const opponentClaim = makeClaimNode('c-2', { speaker: 'safetyist' });
    const supportEdge = makeSupportEdge('c-2', 'c-1');

    const updates = computeCrossPovAdoption(
      [ownClaim, opponentClaim],
      [supportEdge],
      new Map([['acc-intentions-001', intention]]),
      new Map([['acc-intentions-001', 3]]),
      'debate-1',
      { accelerationist: 'accelerationist', safetyist: 'safetyist', skeptic: 'skeptic' },
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].reason).toBe('cross_pov_adoption');
    expect(updates[0].delta).toBe(1);
    expect(updates[0].new_value).toBe(4);
  });

  it('ignores same-POV support', () => {
    const intention = makeIntentionNode('acc-intentions-001', 3);
    const claim1 = makeClaimNode('c-1', { speaker: 'accelerationist', intentionRef: 'acc-intentions-001', attrConf: 0.80 });
    const claim2 = makeClaimNode('c-2', { speaker: 'accelerationist' });
    const supportEdge = makeSupportEdge('c-2', 'c-1');

    const updates = computeCrossPovAdoption(
      [claim1, claim2],
      [supportEdge],
      new Map([['acc-intentions-001', intention]]),
      new Map([['acc-intentions-001', 3]]),
      'debate-1',
      { accelerationist: 'accelerationist', safetyist: 'safetyist' },
    );

    expect(updates).toHaveLength(0);
  });
});

// ── buildOperationalityHistoryEntry ─────────────────────

describe('buildOperationalityHistoryEntry', () => {
  it('builds a history entry with attack_claim', () => {
    const entry = buildOperationalityHistoryEntry({
      intention_id: 'acc-intentions-001',
      reason: 'failed_specify',
      delta: -1,
      new_value: 3,
      debate_id: 'debate-1',
      attack_claim: 'Strategy lacks concrete implementation path',
    }, '2026-05-25');

    expect(entry.date).toBe('2026-05-25');
    expect(entry.value).toBe(3);
    expect(entry.delta).toBe(-1);
    expect(entry.reason).toContain('failed_specify');
    expect(entry.attack_claim).toBe('Strategy lacks concrete implementation path');
  });

  it('omits attack_claim when absent', () => {
    const entry = buildOperationalityHistoryEntry({
      intention_id: 'acc-intentions-001',
      reason: 'cross_pov_adoption',
      delta: 1,
      new_value: 4,
      debate_id: 'debate-2',
    }, '2026-05-25');

    expect(entry.attack_claim).toBeUndefined();
  });
});
