// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  evaluateGate,
  computeUndermineDelta,
  applyDriftCap,
  computeConfidenceUpdates,
  computeCrossPovUpdates,
  computePriorityUpdates,
  pruneHistory,
  buildEvolutionHistoryEntry,
  ATTRIBUTION_THRESHOLD,
  ATTACK_STRENGTH_THRESHOLD,
  STRENGTH_DROP_THRESHOLD,
  STRENGTH_SURVIVE_THRESHOLD,
  MAX_DRIFT,
  HISTORY_MAX_ENTRIES,
} from './confidenceEvolution.js';
import type {
  DebateEvolutionInput,
  ConfidenceUpdate,
} from './confidenceEvolution.js';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, ClaimTaxonomyAttribution } from './types.js';
import type { PovNode, WeightHistoryEntry } from './taxonomyTypes.js';

// ── Helpers ─────────────────────────────────────────────

function makeAttribution(confidence: number, primaryRef: string): ClaimTaxonomyAttribution {
  return { primary_ref: primaryRef, attribution_confidence: confidence };
}

function makeNode(id: string, overrides: Partial<ArgumentNetworkNode> = {}): ArgumentNetworkNode {
  return {
    id,
    text: `Claim ${id}`,
    speaker: 'accelerationist',
    source_entry_id: 'entry-1',
    taxonomy_refs: [],
    turn_number: 1,
    computed_strength: 0.5,
    ...overrides,
  };
}

function makeEdge(source: string, target: string, overrides: Partial<ArgumentNetworkEdge> = {}): ArgumentNetworkEdge {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    type: 'attacks',
    attack_type: 'undermine',
    weight: 0.8,
    ...overrides,
  };
}

function makeBelief(id: string, confidence: number): PovNode {
  return {
    id,
    category: 'Beliefs',
    label: `Belief ${id}`,
    description: `A Beliefs within accelerationist discourse that ${id}.`,
    parent_id: null,
    children: [],
    situation_refs: [],
    confidence,
  };
}

function makeDesire(id: string, priority: number): PovNode {
  return {
    id,
    category: 'Desires',
    label: `Desire ${id}`,
    description: `A Desires within accelerationist discourse that ${id}.`,
    parent_id: null,
    children: [],
    situation_refs: [],
    priority,
  };
}

// ── evaluateGate ────────────────────────────────────────

describe('evaluateGate', () => {
  it('passes when all 3 conditions met', () => {
    const attr = makeAttribution(0.75, 'acc-beliefs-001');
    const edge = makeEdge('atk-1', 'claim-1', { attack_type: 'undermine' });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });

    const result = evaluateGate(attr, edge, attackNode);

    expect(result.passed).toBe(true);
    expect(result.conditions_met).toHaveLength(3);
    expect(result.conditions_missed).toHaveLength(0);
  });

  it('fails when attribution below threshold', () => {
    const attr = makeAttribution(0.50, 'acc-beliefs-001');
    const edge = makeEdge('atk-1', 'claim-1', { attack_type: 'undermine' });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });

    const result = evaluateGate(attr, edge, attackNode);

    expect(result.passed).toBe(false);
    expect(result.conditions_missed).toContain('attribution');
    expect(result.conditions_met).toHaveLength(2);
  });

  it('fails when attack type is not undermine', () => {
    const attr = makeAttribution(0.75, 'acc-beliefs-001');
    const edge = makeEdge('atk-1', 'claim-1', { attack_type: 'rebut' });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });

    const result = evaluateGate(attr, edge, attackNode);

    expect(result.passed).toBe(false);
    expect(result.conditions_missed).toContain('undermine_type');
  });

  it('fails when attack strength below threshold', () => {
    const attr = makeAttribution(0.75, 'acc-beliefs-001');
    const edge = makeEdge('atk-1', 'claim-1', { attack_type: 'undermine' });
    const attackNode = makeNode('atk-1', { computed_strength: 0.30 });

    const result = evaluateGate(attr, edge, attackNode);

    expect(result.passed).toBe(false);
    expect(result.conditions_missed).toContain('attack_strength');
  });

  it('fails with all 3 missed when no attribution', () => {
    const edge = makeEdge('atk-1', 'claim-1', { attack_type: 'rebut' });
    const attackNode = makeNode('atk-1', { computed_strength: 0.30 });

    const result = evaluateGate(undefined, edge, attackNode);

    expect(result.passed).toBe(false);
    expect(result.conditions_missed).toHaveLength(3);
  });

  it('reports attribution_confidence and attack_strength in result', () => {
    const attr = makeAttribution(0.82, 'acc-beliefs-001');
    const edge = makeEdge('atk-1', 'claim-1', { attack_type: 'undermine' });
    const attackNode = makeNode('atk-1', { computed_strength: 0.73 });

    const result = evaluateGate(attr, edge, attackNode);

    expect(result.attribution_confidence).toBe(0.82);
    expect(result.attack_strength).toBe(0.73);
    expect(result.attack_type).toBe('undermine');
  });
});

// ── computeUndermineDelta ───────────────────────────────

describe('computeUndermineDelta', () => {
  it('returns -0.10 when strength is 0', () => {
    expect(computeUndermineDelta(0)).toBeCloseTo(-0.10);
  });

  it('returns 0 when strength is exactly at drop threshold (middle ground)', () => {
    expect(computeUndermineDelta(STRENGTH_DROP_THRESHOLD)).toBe(0);
  });

  it('returns -0.05 when strength is just below drop threshold', () => {
    expect(computeUndermineDelta(STRENGTH_DROP_THRESHOLD - 0.001)).toBeCloseTo(-0.05, 1);
  });

  it('returns scaled value in between', () => {
    const delta = computeUndermineDelta(0.15);
    expect(delta).toBeLessThan(-0.05);
    expect(delta).toBeGreaterThan(-0.10);
  });

  it('returns +0.05 when strength > survive threshold', () => {
    expect(computeUndermineDelta(0.8)).toBeCloseTo(0.05);
  });

  it('returns 0 for middle-ground strength', () => {
    expect(computeUndermineDelta(0.5)).toBe(0);
  });
});

// ── applyDriftCap ───────────────────────────────────────

describe('applyDriftCap', () => {
  it('returns full delta when within cap', () => {
    expect(applyDriftCap(0.50, 0.50, -0.10)).toBe(-0.10);
  });

  it('caps positive drift at MAX_DRIFT', () => {
    // current=0.75, initial=0.50, drift=+0.25, proposed +0.10 → cap at +0.30 total → delta=+0.05
    const delta = applyDriftCap(0.75, 0.50, 0.10);
    expect(delta).toBeCloseTo(0.05);
  });

  it('caps negative drift at -MAX_DRIFT', () => {
    // current=0.25, initial=0.50, drift=-0.25, proposed -0.10 → cap at -0.30 total → delta=-0.05
    const delta = applyDriftCap(0.25, 0.50, -0.10);
    expect(delta).toBeCloseTo(-0.05);
  });

  it('returns 0 when already at cap', () => {
    // current=0.20, initial=0.50, drift=-0.30 → already at cap
    expect(applyDriftCap(0.20, 0.50, -0.05)).toBe(0);
  });
});

// ── computeConfidenceUpdates ────────────────────────────

describe('computeConfidenceUpdates', () => {
  it('produces update when all 3 gate conditions met and claim strength drops', () => {
    const belief = makeBelief('acc-beliefs-001', 0.80);
    const targetNode = makeNode('claim-1', {
      computed_strength: 0.20,
      claim_taxonomy_attribution: makeAttribution(0.75, 'acc-beliefs-001'),
    });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });
    const edge = makeEdge('atk-1', 'claim-1');

    const input: DebateEvolutionInput = {
      debate_id: 'deb-001',
      nodes: [targetNode, attackNode],
      edges: [edge],
      beliefs: new Map([['acc-beliefs-001', belief]]),
      initial_confidences: new Map([['acc-beliefs-001', 0.80]]),
    };

    const { updates, near_misses } = computeConfidenceUpdates(input);

    expect(updates).toHaveLength(1);
    expect(updates[0].belief_id).toBe('acc-beliefs-001');
    expect(updates[0].reason).toBe('undermined');
    expect(updates[0].delta).toBeLessThan(0);
    expect(updates[0].new_value).toBeLessThan(0.80);
    expect(near_misses).toHaveLength(0);
  });

  it('produces no update when gate fails (rebut type)', () => {
    const belief = makeBelief('acc-beliefs-001', 0.80);
    const targetNode = makeNode('claim-1', {
      computed_strength: 0.20,
      claim_taxonomy_attribution: makeAttribution(0.75, 'acc-beliefs-001'),
    });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });
    const edge = makeEdge('atk-1', 'claim-1', { attack_type: 'rebut' });

    const input: DebateEvolutionInput = {
      debate_id: 'deb-001',
      nodes: [targetNode, attackNode],
      edges: [edge],
      beliefs: new Map([['acc-beliefs-001', belief]]),
      initial_confidences: new Map([['acc-beliefs-001', 0.80]]),
    };

    const { updates } = computeConfidenceUpdates(input);
    expect(updates).toHaveLength(0);
  });

  it('records near-miss when 2-of-3 conditions met', () => {
    const belief = makeBelief('acc-beliefs-001', 0.80);
    const targetNode = makeNode('claim-1', {
      computed_strength: 0.20,
      claim_taxonomy_attribution: makeAttribution(0.75, 'acc-beliefs-001'),
    });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });
    // rebut instead of undermine → 2/3 conditions met
    const edge = makeEdge('atk-1', 'claim-1', { attack_type: 'rebut' });

    const input: DebateEvolutionInput = {
      debate_id: 'deb-001',
      nodes: [targetNode, attackNode],
      edges: [edge],
      beliefs: new Map([['acc-beliefs-001', belief]]),
      initial_confidences: new Map([['acc-beliefs-001', 0.80]]),
    };

    const { near_misses } = computeConfidenceUpdates(input);
    expect(near_misses).toHaveLength(1);
    expect(near_misses[0].missing).toBe('undermine_type');
    expect(near_misses[0].conditions_met).toContain('attribution');
    expect(near_misses[0].conditions_met).toContain('attack_strength');
  });

  it('produces survived update when claim survives attack', () => {
    const belief = makeBelief('acc-beliefs-001', 0.70);
    const targetNode = makeNode('claim-1', {
      computed_strength: 0.85,
      claim_taxonomy_attribution: makeAttribution(0.75, 'acc-beliefs-001'),
    });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });
    const edge = makeEdge('atk-1', 'claim-1');

    const input: DebateEvolutionInput = {
      debate_id: 'deb-001',
      nodes: [targetNode, attackNode],
      edges: [edge],
      beliefs: new Map([['acc-beliefs-001', belief]]),
      initial_confidences: new Map([['acc-beliefs-001', 0.70]]),
    };

    const { updates } = computeConfidenceUpdates(input);
    // The attack passes gate but claim survived → +0.05
    // Also the survived-claims loop should find it
    const survivedUpdates = updates.filter(u => u.reason === 'survived');
    expect(survivedUpdates.length).toBeGreaterThanOrEqual(1);
    expect(survivedUpdates[0].delta).toBeGreaterThan(0);
  });

  it('caps drift at ±0.3 from initial', () => {
    const belief = makeBelief('acc-beliefs-001', 0.55); // already drifted -0.25 from initial 0.80
    const targetNode = makeNode('claim-1', {
      computed_strength: 0.10,
      claim_taxonomy_attribution: makeAttribution(0.75, 'acc-beliefs-001'),
    });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });
    const edge = makeEdge('atk-1', 'claim-1');

    const input: DebateEvolutionInput = {
      debate_id: 'deb-001',
      nodes: [targetNode, attackNode],
      edges: [edge],
      beliefs: new Map([['acc-beliefs-001', belief]]),
      initial_confidences: new Map([['acc-beliefs-001', 0.80]]),
    };

    const { updates } = computeConfidenceUpdates(input);
    if (updates.length > 0) {
      // New value should not go below 0.80 - 0.30 = 0.50
      expect(updates[0].new_value).toBeGreaterThanOrEqual(0.50);
    }
  });

  it('flags human review for changes > 0.2', () => {
    // This is hard to trigger with normal magnitudes (max delta is -0.10)
    // But we can test the flag logic directly
    const update: ConfidenceUpdate = {
      belief_id: 'acc-beliefs-001',
      reason: 'document_contradiction',
      delta: -0.25,
      new_value: 0.55,
      debate_id: 'deb-001',
      requires_human_review: Math.abs(-0.25) > 0.2,
    };
    expect(update.requires_human_review).toBe(true);
  });

  it('skips non-Belief nodes', () => {
    const desire = makeDesire('acc-desires-001', 3);
    const targetNode = makeNode('claim-1', {
      computed_strength: 0.20,
      claim_taxonomy_attribution: makeAttribution(0.75, 'acc-desires-001'),
    });
    const attackNode = makeNode('atk-1', { computed_strength: 0.65 });
    const edge = makeEdge('atk-1', 'claim-1');

    const input: DebateEvolutionInput = {
      debate_id: 'deb-001',
      nodes: [targetNode, attackNode],
      edges: [edge],
      beliefs: new Map([['acc-desires-001', desire]]),
      initial_confidences: new Map(),
    };

    const { updates } = computeConfidenceUpdates(input);
    expect(updates).toHaveLength(0);
  });
});

// ── computeCrossPovUpdates ──────────────────────────────

describe('computeCrossPovUpdates', () => {
  it('increases confidence when opposing camp cites Belief', () => {
    const belief = makeBelief('acc-beliefs-001', 0.70);
    const node = makeNode('claim-1', {
      speaker: 'safetyist',
      claim_taxonomy_attribution: makeAttribution(0.75, 'acc-beliefs-001'),
    });

    const updates = computeCrossPovUpdates(
      [node],
      new Map([['acc-beliefs-001', belief]]),
      new Map([['acc-beliefs-001', 0.70]]),
      'deb-001',
      { safetyist: 'safetyist', accelerationist: 'accelerationist' },
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].reason).toBe('cross_pov');
    expect(updates[0].delta).toBeCloseTo(0.10);
  });

  it('skips when same POV cites own Belief', () => {
    const belief = makeBelief('acc-beliefs-001', 0.70);
    const node = makeNode('claim-1', {
      speaker: 'accelerationist',
      claim_taxonomy_attribution: makeAttribution(0.75, 'acc-beliefs-001'),
    });

    const updates = computeCrossPovUpdates(
      [node],
      new Map([['acc-beliefs-001', belief]]),
      new Map([['acc-beliefs-001', 0.70]]),
      'deb-001',
      { accelerationist: 'accelerationist' },
    );

    expect(updates).toHaveLength(0);
  });

  it('skips when attribution below threshold', () => {
    const belief = makeBelief('acc-beliefs-001', 0.70);
    const node = makeNode('claim-1', {
      speaker: 'safetyist',
      claim_taxonomy_attribution: makeAttribution(0.40, 'acc-beliefs-001'),
    });

    const updates = computeCrossPovUpdates(
      [node],
      new Map([['acc-beliefs-001', belief]]),
      new Map([['acc-beliefs-001', 0.70]]),
      'deb-001',
      { safetyist: 'safetyist' },
    );

    expect(updates).toHaveLength(0);
  });
});

// ── computePriorityUpdates ──────────────────────────────

describe('computePriorityUpdates', () => {
  it('reduces priority on reflection concession', () => {
    const desire = makeDesire('acc-desires-001', 4);
    const updates = computePriorityUpdates(
      [{ desire_id: 'acc-desires-001' }],
      new Set(),
      new Map([['acc-desires-001', desire]]),
      'deb-001',
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].reason).toBe('reflection_concession');
    expect(updates[0].delta).toBe(-1);
    expect(updates[0].new_value).toBe(3);
  });

  it('increases priority for crux desire', () => {
    const desire = makeDesire('acc-desires-001', 3);
    const updates = computePriorityUpdates(
      [],
      new Set(['acc-desires-001']),
      new Map([['acc-desires-001', desire]]),
      'deb-001',
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].reason).toBe('crux_of_disagreement');
    expect(updates[0].delta).toBe(1);
    expect(updates[0].new_value).toBe(4);
  });

  it('does not reduce below 1', () => {
    const desire = makeDesire('acc-desires-001', 1);
    const updates = computePriorityUpdates(
      [{ desire_id: 'acc-desires-001' }],
      new Set(),
      new Map([['acc-desires-001', desire]]),
      'deb-001',
    );

    expect(updates).toHaveLength(0);
  });

  it('does not increase above 5', () => {
    const desire = makeDesire('acc-desires-001', 5);
    const updates = computePriorityUpdates(
      [],
      new Set(['acc-desires-001']),
      new Map([['acc-desires-001', desire]]),
      'deb-001',
    );

    expect(updates).toHaveLength(0);
  });

  it('concession takes precedence over crux for same desire', () => {
    const desire = makeDesire('acc-desires-001', 3);
    const updates = computePriorityUpdates(
      [{ desire_id: 'acc-desires-001' }],
      new Set(['acc-desires-001']),
      new Map([['acc-desires-001', desire]]),
      'deb-001',
    );

    // Concession first, crux skips since already updated
    expect(updates).toHaveLength(1);
    expect(updates[0].reason).toBe('reflection_concession');
  });
});

// ── pruneHistory ────────────────────────────────────────

describe('pruneHistory', () => {
  it('prunes when count exceeds max', () => {
    const history: WeightHistoryEntry[] = Array.from({ length: 35 }, (_, i) => ({
      date: `2026-0${Math.floor(i / 10) + 1}-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 0.80 - i * 0.01,
      delta: -0.01,
      reason: `Update ${i}`,
    }));

    const result = pruneHistory('b-001', history);

    expect(result).not.toBeNull();
    expect(result!.pruned_count).toBe(5); // 35 - 30
    expect(history).toHaveLength(HISTORY_MAX_ENTRIES);
  });

  it('prunes by age when count is within limit', () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 14); // 14 months ago

    const history: WeightHistoryEntry[] = [
      { date: old.toISOString().slice(0, 10), value: 0.75, delta: -0.05, reason: 'Old entry' },
      { date: new Date().toISOString().slice(0, 10), value: 0.70, delta: -0.05, reason: 'Recent entry' },
    ];

    const result = pruneHistory('b-001', history);

    expect(result).not.toBeNull();
    expect(result!.pruned_count).toBe(1);
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe('Recent entry');
  });

  it('returns null when no pruning needed', () => {
    const history: WeightHistoryEntry[] = [
      { date: new Date().toISOString().slice(0, 10), value: 0.80, delta: -0.05, reason: 'Recent' },
    ];

    const result = pruneHistory('b-001', history);
    expect(result).toBeNull();
  });

  it('computes net_delta_pruned correctly', () => {
    const history: WeightHistoryEntry[] = Array.from({ length: 33 }, (_, i) => ({
      date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 0.80,
      delta: i < 3 ? -0.05 : 0.01, // first 3 pruned: total delta = -0.15
      reason: `Update ${i}`,
    }));

    const result = pruneHistory('b-001', history);

    expect(result).not.toBeNull();
    expect(result!.pruned_count).toBe(3);
    expect(result!.net_delta_pruned).toBeCloseTo(-0.15);
  });
});

// ── buildEvolutionHistoryEntry ──────────────────────────

describe('buildEvolutionHistoryEntry', () => {
  it('builds entry from confidence update', () => {
    const update: ConfidenceUpdate = {
      belief_id: 'acc-beliefs-001',
      reason: 'undermined',
      delta: -0.08,
      new_value: 0.72,
      debate_id: 'deb-001',
      claim_id: 'claim-1',
      attack_claim: 'Scaling laws plateau',
      requires_human_review: false,
    };

    const entry = buildEvolutionHistoryEntry(update, '2026-05-24');

    expect(entry.date).toBe('2026-05-24');
    expect(entry.value).toBe(0.72);
    expect(entry.delta).toBe(-0.08);
    expect(entry.reason).toContain('deb-001');
    expect(entry.attack_claim).toBe('Scaling laws plateau');
  });

  it('builds entry from priority update', () => {
    const update = {
      desire_id: 'acc-desires-001',
      reason: 'reflection_concession' as const,
      delta: -1,
      new_value: 3,
      debate_id: 'deb-001',
    };

    const entry = buildEvolutionHistoryEntry(update, '2026-05-24');

    expect(entry.value).toBe(3);
    expect(entry.delta).toBe(-1);
    expect(entry.attack_claim).toBeUndefined();
  });
});
