// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeProcessReward,
  PROCESS_REWARD_WEIGHTS,
} from './processReward.js';
import type { ProcessRewardInput } from './processReward.js';
import type { ConvergenceSignals, TurnValidation } from './types.js';

// ── Factory helpers ────────────────────────────────────────

function makeConvergenceSignals(overrides: Partial<ConvergenceSignals> = {}): ConvergenceSignals {
  return {
    entry_id: 'entry-1',
    round: 3,
    speaker: 'prometheus',
    move_polarity: { confrontational: 1, collaborative: 1, ratio: 0.5 },
    dialectical_engagement: { targeted: 2, standalone: 1, ratio: 0.67 },
    argument_redundancy: { avg_self_overlap: 0.2, max_self_overlap: 0.3 },
    dominant_counterargument: null,
    concession_opportunity: { strong_attacks_faced: 0, concession_used: false, outcome: 'none' },
    position_drift: { overlap_with_opening: 0.6, drift: 0.1 },
    crux_engagement_rate: { used_this_turn: false, cumulative_count: 0, cumulative_follow_through: 0 },
    ...overrides,
  };
}

function makeValidation(overrides: Partial<TurnValidation> = {}): TurnValidation {
  return {
    outcome: 'pass',
    score: 0.8,
    dimensions: {
      schema: { pass: true, issues: [] },
      grounding: { pass: true, issues: [] },
      advancement: { pass: true, signals: ['new_refs:2'] },
      clarifies: { pass: false, signals: [] },
    },
    repairHints: [],
    clarifies_taxonomy: [],
    judge_used: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ProcessRewardInput> = {}): ProcessRewardInput {
  return {
    convergenceSignals: makeConvergenceSignals(),
    turnValidation: makeValidation(),
    phase: 'exploration',
    moveCount: 2,
    taxonomyRefCount: 3,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('computeProcessReward', () => {
  it('returns a score in [0,1]', () => {
    const result = computeProcessReward(makeInput());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('returns all five component scores in [0,1]', () => {
    const result = computeProcessReward(makeInput());
    for (const key of Object.keys(result.components) as (keyof typeof result.components)[]) {
      expect(result.components[key]).toBeGreaterThanOrEqual(0);
      expect(result.components[key]).toBeLessThanOrEqual(1);
    }
  });

  it('includes the weight vector for reproducibility', () => {
    const result = computeProcessReward(makeInput());
    expect(result.weights).toEqual(PROCESS_REWARD_WEIGHTS);
  });

  it('weights sum to 1.0', () => {
    const sum = Object.values(PROCESS_REWARD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  // ── Engagement ──

  it('rewards high engagement depth', () => {
    const high = computeProcessReward(makeInput({
      convergenceSignals: makeConvergenceSignals({ dialectical_engagement: { targeted: 4, standalone: 0, ratio: 1.0 } }),
    }));
    const low = computeProcessReward(makeInput({
      convergenceSignals: makeConvergenceSignals({ dialectical_engagement: { targeted: 0, standalone: 4, ratio: 0.0 } }),
    }));
    expect(high.components.engagement).toBeGreaterThan(low.components.engagement);
    expect(high.score).toBeGreaterThan(low.score);
  });

  // ── Novelty ──

  it('rewards low recycling rate (high novelty)', () => {
    const novel = computeProcessReward(makeInput({
      convergenceSignals: makeConvergenceSignals({ argument_redundancy: { avg_self_overlap: 0.1, max_self_overlap: 0.2 } }),
    }));
    const recycled = computeProcessReward(makeInput({
      convergenceSignals: makeConvergenceSignals({ argument_redundancy: { avg_self_overlap: 0.9, max_self_overlap: 0.95 } }),
    }));
    expect(novel.components.novelty).toBeGreaterThan(recycled.components.novelty);
  });

  it('uses semantic similarity when available', () => {
    const withSemantic = computeProcessReward(makeInput({
      convergenceSignals: makeConvergenceSignals({
        argument_redundancy: { avg_self_overlap: 0.2, max_self_overlap: 0.3, semantic_max_similarity: 0.9 },
      }),
    }));
    // semantic_max_similarity=0.9 → novelty = 1-0.9 = 0.1
    expect(withSemantic.components.novelty).toBeCloseTo(0.1, 1);
  });

  // ── Consistency ──

  it('rewards taken concession opportunities', () => {
    const taken = computeProcessReward(makeInput({
      convergenceSignals: makeConvergenceSignals({
        concession_opportunity: { strong_attacks_faced: 2, concession_used: true, outcome: 'taken' },
      }),
    }));
    const missed = computeProcessReward(makeInput({
      convergenceSignals: makeConvergenceSignals({
        concession_opportunity: { strong_attacks_faced: 2, concession_used: false, outcome: 'missed' },
      }),
    }));
    expect(taken.components.consistency).toBeGreaterThan(missed.components.consistency);
  });

  // ── Grounding ──

  it('rewards passing grounding + schema validation', () => {
    const passing = computeProcessReward(makeInput({
      turnValidation: makeValidation({
        dimensions: {
          schema: { pass: true, issues: [] },
          grounding: { pass: true, issues: [] },
          advancement: { pass: true, signals: [] },
          clarifies: { pass: false, signals: [] },
        },
      }),
    }));
    const failing = computeProcessReward(makeInput({
      turnValidation: makeValidation({
        dimensions: {
          schema: { pass: false, issues: ['bad'] },
          grounding: { pass: false, issues: ['bad'] },
          advancement: { pass: true, signals: [] },
          clarifies: { pass: false, signals: [] },
        },
      }),
    }));
    expect(passing.components.grounding).toBeGreaterThan(failing.components.grounding);
  });

  it('accounts for taxonomy ref utilization when injected count provided', () => {
    const good = computeProcessReward(makeInput({
      taxonomyRefCount: 5,
      injectedNodeCount: 10,
    }));
    const poor = computeProcessReward(makeInput({
      taxonomyRefCount: 1,
      injectedNodeCount: 10,
    }));
    expect(good.components.grounding).toBeGreaterThan(poor.components.grounding);
  });

  // ── Move quality ──

  it('rewards higher move diversity', () => {
    const diverse = computeProcessReward(makeInput({ moveCount: 3 }));
    const single = computeProcessReward(makeInput({ moveCount: 1 }));
    expect(diverse.components.move_quality).toBeGreaterThan(single.components.move_quality);
  });

  it('applies a variation bonus when move count differs from prior', () => {
    const varied = computeProcessReward(makeInput({ moveCount: 2, priorMoveCount: 3 }));
    const same = computeProcessReward(makeInput({ moveCount: 2, priorMoveCount: 2 }));
    expect(varied.components.move_quality).toBeGreaterThan(same.components.move_quality);
  });

  // ── Phase bonuses ──

  it('rewards confrontational moves in thesis-antithesis', () => {
    const confrontational = computeProcessReward(makeInput({
      phase: 'thesis-antithesis',
      convergenceSignals: makeConvergenceSignals({
        move_polarity: { confrontational: 3, collaborative: 0, ratio: 0.0 },
        dialectical_engagement: { targeted: 3, standalone: 0, ratio: 1.0 },
      }),
    }));
    const collaborative = computeProcessReward(makeInput({
      phase: 'thesis-antithesis',
      convergenceSignals: makeConvergenceSignals({
        move_polarity: { confrontational: 0, collaborative: 3, ratio: 1.0 },
        dialectical_engagement: { targeted: 3, standalone: 0, ratio: 1.0 },
      }),
    }));
    expect(confrontational.components.move_quality).toBeGreaterThan(collaborative.components.move_quality);
  });

  it('rewards crux identification in exploration', () => {
    const crux = computeProcessReward(makeInput({
      phase: 'exploration',
      convergenceSignals: makeConvergenceSignals({
        crux_engagement_rate: { used_this_turn: true, cumulative_count: 1, cumulative_follow_through: 0 },
      }),
    }));
    const noCrux = computeProcessReward(makeInput({
      phase: 'exploration',
      convergenceSignals: makeConvergenceSignals({
        crux_engagement_rate: { used_this_turn: false, cumulative_count: 0, cumulative_follow_through: 0 },
      }),
    }));
    expect(crux.components.move_quality).toBeGreaterThan(noCrux.components.move_quality);
  });

  it('rewards collaborative moves and taxonomy clarification in synthesis', () => {
    const goodSynthesis = computeProcessReward(makeInput({
      phase: 'synthesis',
      convergenceSignals: makeConvergenceSignals({
        move_polarity: { confrontational: 0, collaborative: 3, ratio: 1.0 },
      }),
      turnValidation: makeValidation({
        clarifies_taxonomy: [{ action: 'narrow', node_id: 'acc-beliefs-001', rationale: 'test' }],
      }),
    }));
    const poorSynthesis = computeProcessReward(makeInput({
      phase: 'synthesis',
      convergenceSignals: makeConvergenceSignals({
        move_polarity: { confrontational: 3, collaborative: 0, ratio: 0.0 },
      }),
    }));
    expect(goodSynthesis.components.move_quality).toBeGreaterThan(poorSynthesis.components.move_quality);
  });

  // ── Edge cases ──

  it('handles zero moves gracefully', () => {
    const result = computeProcessReward(makeInput({ moveCount: 0 }));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.components.move_quality).toBeGreaterThanOrEqual(0);
  });

  it('handles terminated phase', () => {
    const result = computeProcessReward(makeInput({ phase: 'terminated' }));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('composite score equals weighted sum of components', () => {
    const result = computeProcessReward(makeInput());
    const w = PROCESS_REWARD_WEIGHTS;
    const expected =
      result.components.engagement * w.engagement +
      result.components.novelty * w.novelty +
      result.components.consistency * w.consistency +
      result.components.grounding * w.grounding +
      result.components.move_quality * w.move_quality;
    expect(result.score).toBeCloseTo(expected, 10);
  });
});
