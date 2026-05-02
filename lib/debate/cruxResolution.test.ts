import { describe, it, expect } from 'vitest';
import {
  updateCruxTracker,
  computeCruxPolarity,
  checkOneSideConceded,
  inferDisagreementType,
  formatCruxResolutionContext,
} from './cruxResolution.js';
import type {
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  CommitmentStore,
  TrackedCrux,
} from './types.js';

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

function makeEdge(overrides: Partial<ArgumentNetworkEdge> & { source: string; target: string }): ArgumentNetworkEdge {
  return {
    id: `${overrides.source}->${overrides.target}`,
    type: 'attacks',
    ...overrides,
  };
}

function makeCrux(overrides: Partial<TrackedCrux> & { id: string }): TrackedCrux {
  return {
    description: `Crux ${overrides.id}`,
    identified_turn: 1,
    state: 'identified',
    history: [],
    attacking_claim_ids: [],
    speakers_involved: [],
    last_computed_strength: 0.6,
    support_polarity: 0.5,
    ...overrides,
  };
}

describe('updateCruxTracker', () => {
  it('returns empty array for empty inputs', () => {
    expect(updateCruxTracker(undefined, [], [], {}, 1)).toEqual([]);
  });

  it('returns existing tracker when no nodes', () => {
    const existing = [makeCrux({ id: 'AN-1' })];
    expect(updateCruxTracker(existing, [], [], {}, 2)).toEqual(existing);
  });

  it('identifies a new crux from cross-POV attacks', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', turn_number: 2 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 2 }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'attacks' }),
    ];
    const result = updateCruxTracker(undefined, nodes, edges, {}, 2);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('AN-1');
    expect(result[0].state).toBe('identified');
    expect(result[0].speakers_involved).toContain('accelerationist');
    expect(result[0].speakers_involved).toContain('safetyist');
    expect(result[0].speakers_involved).toContain('skeptic');
  });

  it('does not duplicate already-tracked cruxes', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist' }),
      makeNode({ id: 'AN-3', speaker: 'skeptic' }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'attacks' }),
    ];
    const existing = [makeCrux({ id: 'AN-1', speakers_involved: ['accelerationist', 'safetyist'] })];
    const result = updateCruxTracker(existing, nodes, edges, {}, 3);
    expect(result).toHaveLength(1);
  });

  it('transitions identified -> engaged when new edges appear', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', turn_number: 2 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 2 }),
      makeNode({ id: 'AN-4', speaker: 'safetyist', turn_number: 3 }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-4', target: 'AN-1', type: 'supports' }),
    ];
    const existing = [makeCrux({
      id: 'AN-1',
      identified_turn: 2,
      attacking_claim_ids: ['AN-2', 'AN-3'],
      speakers_involved: ['accelerationist', 'safetyist', 'skeptic'],
    })];
    const result = updateCruxTracker(existing, nodes, edges, {}, 3);
    expect(result[0].state).toBe('engaged');
    expect(result[0].history).toHaveLength(1);
    expect(result[0].history[0].from).toBe('identified');
    expect(result[0].history[0].to).toBe('engaged');
  });

  it('transitions engaged -> resolved when polarity converges to all-support', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', turn_number: 2 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 2 }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'supports' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'supports' }),
    ];
    const existing = [makeCrux({
      id: 'AN-1',
      state: 'engaged',
      identified_turn: 1,
      attacking_claim_ids: ['AN-2', 'AN-3'],
      speakers_involved: ['accelerationist', 'safetyist', 'skeptic'],
      history: [{ from: 'identified', to: 'engaged', turn: 2, trigger: 'test' }],
    })];
    const result = updateCruxTracker(existing, nodes, edges, {}, 3);
    expect(result[0].state).toBe('resolved');
  });

  it('transitions engaged -> one_side_conceded via commitment store', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', turn_number: 2 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 3 }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'supports' }),
    ];
    const commitments: Record<string, CommitmentStore> = {
      safetyist: { asserted: [], conceded: ['Claim AN-2'], challenged: [] },
      accelerationist: { asserted: [], conceded: [], challenged: [] },
    };
    const existing = [makeCrux({
      id: 'AN-1',
      state: 'engaged',
      identified_turn: 1,
      attacking_claim_ids: ['AN-2'],
      speakers_involved: ['accelerationist', 'safetyist'],
      history: [{ from: 'identified', to: 'engaged', turn: 2, trigger: 'test' }],
    })];
    const result = updateCruxTracker(existing, nodes, edges, commitments, 3);
    expect(result[0].state).toBe('one_side_conceded');
  });

  it('transitions engaged -> one_side_conceded via weakened strength', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', computed_strength: 0.2 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 3 }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'supports' }),
    ];
    const existing = [makeCrux({
      id: 'AN-1',
      state: 'engaged',
      identified_turn: 1,
      attacking_claim_ids: ['AN-2'],
      speakers_involved: ['accelerationist', 'safetyist'],
      history: [{ from: 'identified', to: 'engaged', turn: 2, trigger: 'test' }],
    })];
    const result = updateCruxTracker(existing, nodes, edges, {}, 3);
    expect(result[0].state).toBe('one_side_conceded');
  });

  it('does not re-transition terminal states', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.3 }),
    ];
    const resolved = makeCrux({ id: 'AN-1', state: 'resolved', history: [{ from: 'engaged', to: 'resolved', turn: 3, trigger: 'test' }] });
    const result = updateCruxTracker([resolved], nodes, [], {}, 5);
    expect(result[0].state).toBe('resolved');
    expect(result[0].history).toHaveLength(1);
  });

  it('is idempotent — no spurious transitions on repeated calls', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist', computed_strength: 0.7 }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', turn_number: 2 }),
      makeNode({ id: 'AN-3', speaker: 'skeptic', turn_number: 2 }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'attacks' }),
    ];
    const result1 = updateCruxTracker(undefined, nodes, edges, {}, 2);
    const result2 = updateCruxTracker(result1, nodes, edges, {}, 2);
    expect(result2[0].state).toBe(result1[0].state);
    expect(result2[0].history.length).toBe(result1[0].history.length);
  });
});

describe('computeCruxPolarity', () => {
  it('returns 0.5 for unknown node', () => {
    expect(computeCruxPolarity('nonexistent', [], [])).toBe(0.5);
  });

  it('returns 0.5 when no cross-POV edges', () => {
    const nodes = [makeNode({ id: 'AN-1', speaker: 'accelerationist' })];
    expect(computeCruxPolarity('AN-1', nodes, [])).toBe(0.5);
  });

  it('returns 1.0 for all-support', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
      makeNode({ id: 'AN-2', speaker: 'safetyist' }),
    ];
    const edges = [makeEdge({ source: 'AN-2', target: 'AN-1', type: 'supports' })];
    expect(computeCruxPolarity('AN-1', nodes, edges)).toBe(1.0);
  });

  it('returns 0.0 for all-attack', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
      makeNode({ id: 'AN-2', speaker: 'safetyist' }),
    ];
    const edges = [makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks' })];
    expect(computeCruxPolarity('AN-1', nodes, edges)).toBe(0.0);
  });

  it('returns 0.5 for mixed', () => {
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
      makeNode({ id: 'AN-2', speaker: 'safetyist' }),
      makeNode({ id: 'AN-3', speaker: 'skeptic' }),
    ];
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'supports' }),
      makeEdge({ source: 'AN-3', target: 'AN-1', type: 'attacks' }),
    ];
    expect(computeCruxPolarity('AN-1', nodes, edges)).toBe(0.5);
  });
});

describe('inferDisagreementType', () => {
  it('returns undefined for no edges', () => {
    expect(inferDisagreementType('AN-1', [])).toBeUndefined();
  });

  it('returns empirical for evidence schemes', () => {
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks', argumentation_scheme: 'ARGUMENT_FROM_EVIDENCE' }),
    ];
    expect(inferDisagreementType('AN-1', edges)).toBe('empirical');
  });

  it('returns values for values schemes', () => {
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks', argumentation_scheme: 'ARGUMENT_FROM_VALUES' }),
    ];
    expect(inferDisagreementType('AN-1', edges)).toBe('values');
  });

  it('returns definitional for definition schemes', () => {
    const edges = [
      makeEdge({ source: 'AN-2', target: 'AN-1', type: 'attacks', argumentation_scheme: 'ARGUMENT_FROM_DEFINITION' }),
    ];
    expect(inferDisagreementType('AN-1', edges)).toBe('definitional');
  });
});

describe('checkOneSideConceded', () => {
  it('detects concession via commitment store', () => {
    const crux = makeCrux({
      id: 'AN-1',
      description: 'AI will become sentient',
      attacking_claim_ids: ['AN-2'],
      speakers_involved: ['accelerationist', 'safetyist'],
    });
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', text: 'Sentience is unlikely' }),
    ];
    const commitments: Record<string, CommitmentStore> = {
      safetyist: { asserted: [], conceded: ['sentience is unlikely'], challenged: [] },
    };
    const result = checkOneSideConceded(crux, nodes, [], commitments);
    expect(result.conceded).toBe(true);
    expect(result.conceding_speaker).toBe('safetyist');
  });

  it('detects concession via weakened strength', () => {
    const crux = makeCrux({
      id: 'AN-1',
      attacking_claim_ids: ['AN-2'],
      speakers_involved: ['accelerationist', 'safetyist'],
    });
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', computed_strength: 0.1 }),
    ];
    const result = checkOneSideConceded(crux, nodes, [], {});
    expect(result.conceded).toBe(true);
    expect(result.conceding_speaker).toBe('safetyist');
  });

  it('returns false when no concession', () => {
    const crux = makeCrux({
      id: 'AN-1',
      attacking_claim_ids: ['AN-2'],
      speakers_involved: ['accelerationist', 'safetyist'],
    });
    const nodes = [
      makeNode({ id: 'AN-1', speaker: 'accelerationist' }),
      makeNode({ id: 'AN-2', speaker: 'safetyist', computed_strength: 0.7 }),
    ];
    const result = checkOneSideConceded(crux, nodes, [], {});
    expect(result.conceded).toBe(false);
  });
});

describe('formatCruxResolutionContext', () => {
  it('returns empty string for empty tracker', () => {
    expect(formatCruxResolutionContext([])).toBe('');
  });

  it('formats resolved cruxes', () => {
    const tracker = [makeCrux({
      id: 'AN-1',
      state: 'resolved',
      description: 'AI risk is overblown',
      history: [{ from: 'engaged', to: 'resolved', turn: 5, trigger: 'polarity converged' }],
    })];
    const result = formatCruxResolutionContext(tracker);
    expect(result).toContain('RESOLVED CRUXES');
    expect(result).toContain('AI risk is overblown');
    expect(result).toContain('turn 5');
  });

  it('formats mixed states', () => {
    const tracker = [
      makeCrux({ id: 'AN-1', state: 'resolved', description: 'Resolved claim', history: [{ from: 'engaged', to: 'resolved', turn: 5, trigger: 'test' }] }),
      makeCrux({ id: 'AN-2', state: 'irreducible', description: 'Values clash', disagreement_type: 'values' }),
      makeCrux({ id: 'AN-3', state: 'engaged', description: 'Active debate', support_polarity: 0.42 }),
    ];
    const result = formatCruxResolutionContext(tracker);
    expect(result).toContain('RESOLVED CRUXES');
    expect(result).toContain('IRREDUCIBLE DISAGREEMENTS');
    expect(result).toContain('ACTIVE CRUXES');
    expect(result).toContain('0.42');
  });
});
