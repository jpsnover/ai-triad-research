import { describe, it, expect } from 'vitest';
import {
  confidenceUpdatesToProposals,
  priorityUpdatesToProposals,
} from './confidenceEvolution.js';
import type { ConfidenceUpdate, PriorityUpdate } from './confidenceEvolution.js';
import { operationalityUpdatesToProposals } from './operationalityEvolution.js';
import type { OperationalityUpdate } from './operationalityEvolution.js';
import { weightAdjustmentsToProposals } from './cruxTaxonomyFeedback.js';
import type { WeightAdjustment } from './cruxTaxonomyFeedback.js';
import type { ReflectionProposal } from './types.js';

describe('confidenceUpdatesToProposals', () => {
  it('maps ConfidenceUpdate fields to ReflectionProposal shape', () => {
    const update: ConfidenceUpdate = {
      belief_id: 'acc-beliefs-001',
      reason: 'undermined',
      delta: -0.08,
      new_value: 0.42,
      debate_id: 'test-debate-1',
      claim_id: 'c1',
      attack_claim: 'Counter-evidence from study X',
      requires_human_review: false,
      gate: { passed: true, conditions_met: ['attribution', 'undermine_type', 'attack_strength'], conditions_missed: [] },
    };

    const proposals = confidenceUpdatesToProposals([update]);
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.source).toBe('confidence_evolution');
    expect(p.node_id).toBe('acc-beliefs-001');
    expect(p.field).toBe('confidence');
    expect(p.delta).toBe(-0.08);
    expect(p.new_value).toBe(0.42);
    expect(p.debate_id).toBe('test-debate-1');
    expect(p.requires_human_review).toBe(false);
    expect(p.floor_violation).toBeNull();
    expect(p.reason).toContain('Counter-evidence from study X');
    expect(p.gate).toBeDefined();
  });

  it('sets requires_human_review from source update', () => {
    const update: ConfidenceUpdate = {
      belief_id: 'saf-beliefs-010',
      reason: 'undermined',
      delta: -0.25,
      new_value: 0.25,
      debate_id: 'd2',
      requires_human_review: true,
    };

    const [p] = confidenceUpdatesToProposals([update]);
    expect(p.requires_human_review).toBe(true);
  });

  it('handles empty input', () => {
    expect(confidenceUpdatesToProposals([])).toEqual([]);
  });
});

describe('priorityUpdatesToProposals', () => {
  it('maps PriorityUpdate to proposal with no floor violation', () => {
    const update: PriorityUpdate = {
      desire_id: 'acc-desires-003',
      reason: 'crux_of_disagreement',
      delta: 1,
      new_value: 4,
      debate_id: 'd1',
    };

    const [p] = priorityUpdatesToProposals([update]);
    expect(p.source).toBe('priority_evolution');
    expect(p.node_id).toBe('acc-desires-003');
    expect(p.field).toBe('priority');
    expect(p.delta).toBe(1);
    expect(p.new_value).toBe(4);
    expect(p.requires_human_review).toBe(false);
    expect(p.floor_violation).toBeNull();
  });

  it('flags floor violation without capping new_value', () => {
    const update: PriorityUpdate = {
      desire_id: 'saf-desires-007',
      reason: 'reflection_concession',
      delta: -1,
      new_value: 2,
      debate_id: 'd3',
    };

    const floors = new Map([['saf-desires-007', 3]]);
    const [p] = priorityUpdatesToProposals([update], floors);
    expect(p.requires_human_review).toBe(true);
    expect(p.new_value).toBe(2);
    expect(p.floor_violation).toEqual({ floor: 3, raw_value: 2 });
  });

  it('no floor violation when new_value is above floor', () => {
    const update: PriorityUpdate = {
      desire_id: 'acc-desires-001',
      reason: 'crux_of_disagreement',
      delta: 1,
      new_value: 4,
      debate_id: 'd4',
    };

    const floors = new Map([['acc-desires-001', 3]]);
    const [p] = priorityUpdatesToProposals([update], floors);
    expect(p.requires_human_review).toBe(false);
    expect(p.floor_violation).toBeNull();
  });
});

describe('operationalityUpdatesToProposals', () => {
  it('maps OperationalityUpdate to proposal', () => {
    const update: OperationalityUpdate = {
      intention_id: 'skp-intentions-002',
      reason: 'survived_specify',
      delta: 1,
      new_value: 4,
      debate_id: 'd5',
      claim_id: 'c10',
      attack_claim: 'How would you implement that?',
      gate: { passed: true, direction: 'up', conditions_met: ['attribution', 'specify_challenge', 'decisive_outcome'], conditions_missed: [] },
    };

    const [p] = operationalityUpdatesToProposals([update]);
    expect(p.source).toBe('operationality_evolution');
    expect(p.node_id).toBe('skp-intentions-002');
    expect(p.field).toBe('operationality');
    expect(p.delta).toBe(1);
    expect(p.new_value).toBe(4);
    expect(p.requires_human_review).toBe(false);
    expect(p.floor_violation).toBeNull();
    expect(p.reason).toContain('How would you implement that?');
  });

  it('handles update without attack_claim', () => {
    const update: OperationalityUpdate = {
      intention_id: 'acc-intentions-001',
      reason: 'productive_strategy',
      delta: 1,
      new_value: 4,
      debate_id: 'd6',
    };

    const [p] = operationalityUpdatesToProposals([update]);
    expect(p.reason).toBe('productive_strategy');
  });
});

describe('weightAdjustmentsToProposals', () => {
  it('maps confidence WeightAdjustment with current value', () => {
    const adj: WeightAdjustment = {
      node_id: 'acc-beliefs-005',
      type: 'confidence',
      delta: -0.05,
      reason: "Cross-debate empirical crux 'AI alignment difficulty' irreducible in 3 debates",
      crux_description: 'AI alignment difficulty',
      irreducible_count: 3,
    };

    const currentValues = new Map([['acc-beliefs-005', 0.7]]);
    const [p] = weightAdjustmentsToProposals([adj], 'debate-x', currentValues);
    expect(p.source).toBe('crux_weight_adjustment');
    expect(p.field).toBe('confidence');
    expect(p.new_value).toBeCloseTo(0.65, 10);
    expect(p.delta).toBe(-0.05);
    expect(p.floor_violation).toBeNull();
  });

  it('maps priority WeightAdjustment and flags floor violation', () => {
    const adj: WeightAdjustment = {
      node_id: 'saf-desires-002',
      type: 'priority',
      delta: 1,
      reason: 'Cross-debate values crux',
      crux_description: 'Precautionary principle scope',
      irreducible_count: 4,
    };

    const currentValues = new Map([['saf-desires-002', 4]]);
    const [p] = weightAdjustmentsToProposals([adj], 'd7', currentValues);
    expect(p.field).toBe('priority');
    expect(p.new_value).toBe(5);
    expect(p.floor_violation).toBeNull();
  });

  it('flags floor violation on priority decrease', () => {
    const adj: WeightAdjustment = {
      node_id: 'acc-desires-010',
      type: 'priority',
      delta: -1,
      reason: 'Test reason',
      crux_description: 'Test crux',
      irreducible_count: 2,
    };

    const currentValues = new Map([['acc-desires-010', 3]]);
    const floors = new Map([['acc-desires-010', 3]]);
    const [p] = weightAdjustmentsToProposals([adj], 'd8', currentValues, floors);
    expect(p.requires_human_review).toBe(true);
    expect(p.floor_violation).toEqual({ floor: 3, raw_value: 2 });
    expect(p.new_value).toBe(2);
  });

  it('uses default value when node not in currentValues map', () => {
    const adj: WeightAdjustment = {
      node_id: 'unknown-node',
      type: 'confidence',
      delta: -0.05,
      reason: 'Test',
      crux_description: 'Test',
      irreducible_count: 2,
    };

    const [p] = weightAdjustmentsToProposals([adj], 'd9', new Map());
    expect(p.new_value).toBe(0.45);
  });
});

describe('ReflectionProposal type shape', () => {
  it('all sources produce valid ReflectionProposal objects', () => {
    const confUpdate: ConfidenceUpdate = {
      belief_id: 'b1', reason: 'survived', delta: 0.05, new_value: 0.55,
      debate_id: 'd1', requires_human_review: false,
    };
    const priUpdate: PriorityUpdate = {
      desire_id: 'd1', reason: 'crux_of_disagreement', delta: 1, new_value: 4, debate_id: 'd1',
    };
    const opUpdate: OperationalityUpdate = {
      intention_id: 'i1', reason: 'productive_strategy', delta: 1, new_value: 4, debate_id: 'd1',
    };
    const wAdj: WeightAdjustment = {
      node_id: 'n1', type: 'confidence', delta: -0.05,
      reason: 'test', crux_description: 'test', irreducible_count: 2,
    };

    const all: ReflectionProposal[] = [
      ...confidenceUpdatesToProposals([confUpdate]),
      ...priorityUpdatesToProposals([priUpdate]),
      ...operationalityUpdatesToProposals([opUpdate]),
      ...weightAdjustmentsToProposals([wAdj], 'd1', new Map([['n1', 0.6]])),
    ];

    expect(all).toHaveLength(4);
    for (const p of all) {
      expect(p).toHaveProperty('source');
      expect(p).toHaveProperty('node_id');
      expect(p).toHaveProperty('field');
      expect(p).toHaveProperty('delta');
      expect(p).toHaveProperty('new_value');
      expect(p).toHaveProperty('reason');
      expect(p).toHaveProperty('debate_id');
      expect(p).toHaveProperty('requires_human_review');
      expect(p).toHaveProperty('floor_violation');
      expect(typeof p.new_value).toBe('number');
      expect(Number.isNaN(p.new_value)).toBe(false);
    }

    const sources = all.map(p => p.source);
    expect(sources).toContain('confidence_evolution');
    expect(sources).toContain('priority_evolution');
    expect(sources).toContain('operationality_evolution');
    expect(sources).toContain('crux_weight_adjustment');
  });
});
