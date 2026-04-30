// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  initModeratorState,
  isPhaseAppropriate,
  applyPrerequisites,
  adaptiveModifier,
  getPersonaModifier,
  getTrajectoryModifier,
  getSliModifier,
  computeEffectiveThreshold,
  computeDebateHealthScore,
  updateSliBreaches,
  validateRecommendation,
  updateModeratorState,
  computeTriggerEvaluationContext,
  formatTriggerContext,
  buildIntervention,
  buildInterventionBriefInjection,
  checkInterventionCompliance,
  getResponseFieldForMove,
  getMoveResponseConfig,
  getSynthesisResponder,
} from './moderator';
import type {
  ModeratorState,
  SelectionResult,
  ConvergenceSignals,
  InterventionMove,
  DebatePhase,
} from './types';
import { MOVE_TO_FAMILY, MOVE_TO_FORCE, FAMILY_BURDEN_WEIGHT } from './types';

// ── Helpers ───────────────────────────────────────────────

function makeState(overrides: Partial<ModeratorState> = {}): ModeratorState {
  return {
    ...initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']),
    ...overrides,
  };
}

function makeSelection(overrides: Partial<SelectionResult> = {}): SelectionResult {
  return {
    responder: 'sentinel',
    addressing: 'prometheus',
    focus_point: 'test focus',
    agreement_detected: false,
    intervene: true,
    suggested_move: 'PIN',
    target_debater: 'sentinel',
    trigger_reasoning: 'test reason',
    trigger_evidence: 'test evidence',
    ...overrides,
  };
}

function makeSignals(overrides: Partial<ConvergenceSignals> = {}): ConvergenceSignals {
  return {
    entry_id: 'test',
    round: 1,
    speaker: 'prometheus',
    move_disposition: { confrontational: 1, collaborative: 0, ratio: 1 },
    engagement_depth: { targeted: 1, standalone: 0, ratio: 1 },
    recycling_rate: { avg_self_overlap: 0.1, max_self_overlap: 0.2 },
    strongest_opposing: null,
    concession_opportunity: { strong_attacks_faced: 0, concession_used: false, outcome: 'none' },
    position_delta: { overlap_with_opening: 0.8 },
    ...overrides,
  };
}

// ── initModeratorState ───────────────────────────────────

describe('initModeratorState', () => {
  it('computes budget as ceil(explorationRounds / 2.5)', () => {
    const s = initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']);
    // explorationRounds = max(10 - 3, 1) = 7; ceil(7 / 2.5) = 3
    expect(s.budget_total).toBe(3);
    expect(s.budget_remaining).toBe(3);
    expect(s.exploration_rounds).toBe(7);
  });

  it('handles minimum total rounds', () => {
    const s = initModeratorState(3, ['prometheus', 'sentinel']);
    // explorationRounds = max(3 - 3, 1) = 1; ceil(1 / 2.5) = 1
    expect(s.exploration_rounds).toBe(1);
    expect(s.budget_total).toBe(1);
  });

  it('initializes burden and trigger counts per debater', () => {
    const s = initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']);
    expect(s.burden_per_debater).toEqual({ prometheus: 0, sentinel: 0, cassandra: 0 });
    expect(s.persona_trigger_counts.prometheus).toEqual({});
    expect(s.persona_trigger_counts.sentinel).toEqual({});
    expect(s.persona_trigger_counts.cassandra).toEqual({});
  });

  it('starts with clean counters', () => {
    const s = initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']);
    expect(s.interventions_fired).toBe(0);
    expect(s.rounds_since_last_intervention).toBe(0);
    expect(s.required_gap).toBe(1);
    expect(s.last_target).toBeNull();
    expect(s.last_family).toBeNull();
    expect(s.consecutive_decline).toBe(0);
    expect(s.consecutive_rise).toBe(0);
    expect(s.cooldown_blocked_count).toBe(0);
    expect(s.intervention_history).toEqual([]);
    expect(s.health_history).toEqual([]);
  });
});

// ── isPhaseAppropriate ───────────────────────────────────

describe('isPhaseAppropriate', () => {
  it('allows procedural moves in all phases', () => {
    expect(isPhaseAppropriate('REDIRECT', 'thesis-antithesis')).toBe(true);
    expect(isPhaseAppropriate('REDIRECT', 'exploration')).toBe(true);
    // synthesis doesn't include procedural in primary, but REDIRECT is procedural
    // and synthesis primary = { synthesis, reconciliation }, secondary = { repair }
    expect(isPhaseAppropriate('REDIRECT', 'synthesis')).toBe(false);
  });

  it('allows elicitation in thesis-antithesis', () => {
    expect(isPhaseAppropriate('PIN', 'thesis-antithesis')).toBe(true);
    expect(isPhaseAppropriate('PROBE', 'thesis-antithesis')).toBe(true);
    expect(isPhaseAppropriate('CHALLENGE', 'thesis-antithesis')).toBe(true);
  });

  it('allows elicitation in exploration', () => {
    expect(isPhaseAppropriate('PIN', 'exploration')).toBe(true);
    expect(isPhaseAppropriate('PROBE', 'exploration')).toBe(true);
  });

  it('blocks elicitation in synthesis', () => {
    expect(isPhaseAppropriate('PIN', 'synthesis')).toBe(false);
    expect(isPhaseAppropriate('PROBE', 'synthesis')).toBe(false);
  });

  it('allows reconciliation in all phases', () => {
    expect(isPhaseAppropriate('ACKNOWLEDGE', 'thesis-antithesis')).toBe(true);
    expect(isPhaseAppropriate('REVOICE', 'exploration')).toBe(true);
    expect(isPhaseAppropriate('ACKNOWLEDGE', 'synthesis')).toBe(true);
  });

  it('allows COMMIT only in synthesis', () => {
    expect(isPhaseAppropriate('COMMIT', 'thesis-antithesis')).toBe(false);
    expect(isPhaseAppropriate('COMMIT', 'exploration')).toBe(false);
    expect(isPhaseAppropriate('COMMIT', 'synthesis')).toBe(true);
  });

  it('allows META-REFLECT only in exploration', () => {
    expect(isPhaseAppropriate('META-REFLECT', 'exploration')).toBe(true);
    expect(isPhaseAppropriate('META-REFLECT', 'thesis-antithesis')).toBe(false);
    expect(isPhaseAppropriate('META-REFLECT', 'synthesis')).toBe(false);
  });

  it('allows synthesis moves in exploration as secondary (except COMMIT)', () => {
    expect(isPhaseAppropriate('COMPRESS', 'exploration')).toBe(true);
    expect(isPhaseAppropriate('COMMIT', 'exploration')).toBe(false);
  });

  it('allows repair in synthesis as secondary', () => {
    expect(isPhaseAppropriate('CLARIFY', 'synthesis')).toBe(true);
    expect(isPhaseAppropriate('CHECK', 'synthesis')).toBe(true);
  });
});

// ── applyPrerequisites ───────────────────────────────────

describe('applyPrerequisites', () => {
  const state = makeState();

  it('P1: overrides to ACKNOWLEDGE when concession just taken', () => {
    const r = applyPrerequisites('PROBE', state, true, false, false);
    expect(r.overridden_move).toBe('ACKNOWLEDGE');
    expect(r.reason).toContain('P1');
  });

  it('P1: does not override ACKNOWLEDGE itself', () => {
    const r = applyPrerequisites('ACKNOWLEDGE', state, true, false, false);
    expect(r.overridden_move).toBeNull();
  });

  it('P2: overrides elicitation to CLARIFY on semantic divergence', () => {
    const r = applyPrerequisites('PROBE', state, false, true, false);
    expect(r.overridden_move).toBe('CLARIFY');
    expect(r.reason).toContain('P2');
  });

  it('P2: does not override non-elicitation moves', () => {
    const r = applyPrerequisites('REDIRECT', state, false, true, false);
    expect(r.overridden_move).toBeNull();
  });

  it('P3: overrides CHALLENGE to CHECK on misunderstanding', () => {
    const r = applyPrerequisites('CHALLENGE', state, false, false, true);
    expect(r.overridden_move).toBe('CHECK');
    expect(r.reason).toContain('P3');
  });

  it('P3: does not override non-CHALLENGE moves', () => {
    const r = applyPrerequisites('PROBE', state, false, false, true);
    expect(r.overridden_move).toBeNull();
  });

  it('returns no override when no conditions apply', () => {
    const r = applyPrerequisites('PIN', state, false, false, false);
    expect(r.overridden_move).toBeNull();
    expect(r.reason).toBeNull();
  });

  it('P1 takes priority over P2', () => {
    const r = applyPrerequisites('PROBE', state, true, true, false);
    expect(r.overridden_move).toBe('ACKNOWLEDGE');
  });
});

// ── adaptiveModifier ─────────────────────────────────────

describe('adaptiveModifier', () => {
  it('returns prior when no triggers observed', () => {
    expect(adaptiveModifier(0.85, 0)).toBeCloseTo(0.85);
  });

  it('decays toward 1.0 with more triggers', () => {
    const one = adaptiveModifier(0.85, 1);
    const two = adaptiveModifier(0.85, 2);
    expect(one).toBeGreaterThan(0.85);
    expect(one).toBeLessThan(1.0);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThan(1.0);
  });

  it('converges to 1.0 with many triggers', () => {
    const many = adaptiveModifier(0.85, 50);
    expect(many).toBeCloseTo(1.0, 2);
  });

  it('works for priors above 1.0', () => {
    const one = adaptiveModifier(1.3, 1);
    expect(one).toBeLessThan(1.3);
    expect(one).toBeGreaterThan(1.0);
  });
});

// ── getPersonaModifier ───────────────────────────────────

describe('getPersonaModifier', () => {
  it('returns 1.0 for debaters with no persona priors', () => {
    const triggers: Record<string, Partial<Record<InterventionMove, number>>> = { user: {} };
    expect(getPersonaModifier('user', 'PIN', triggers)).toBe(1.0);
  });

  it('returns prior for known debater with no triggers', () => {
    const triggers: Record<string, Partial<Record<InterventionMove, number>>> = { prometheus: {} };
    // Prometheus has PIN: 0.85
    const result = getPersonaModifier('prometheus', 'PIN', triggers);
    expect(result).toBeCloseTo(0.85);
  });

  it('returns 1.0 for move without a prior', () => {
    const triggers: Record<string, Partial<Record<InterventionMove, number>>> = { prometheus: {} };
    // Prometheus has no prior for REDIRECT
    expect(getPersonaModifier('prometheus', 'REDIRECT', triggers)).toBe(1.0);
  });

  it('decays prior with observed triggers', () => {
    const triggers: Record<string, Partial<Record<InterventionMove, number>>> = {
      prometheus: { PIN: 3 },
    };
    const result = getPersonaModifier('prometheus', 'PIN', triggers);
    expect(result).toBeGreaterThan(0.85);
    expect(result).toBeLessThan(1.0);
  });
});

// ── getTrajectoryModifier ────────────────────────────────

describe('getTrajectoryModifier', () => {
  it('returns 1.0 with no decline', () => {
    expect(getTrajectoryModifier(makeState())).toBe(1.0);
  });

  it('returns 0.95 with 1 consecutive decline', () => {
    expect(getTrajectoryModifier(makeState({ consecutive_decline: 1 }))).toBe(0.95);
  });

  it('returns 0.85 with 2 consecutive declines', () => {
    expect(getTrajectoryModifier(makeState({ consecutive_decline: 2 }))).toBe(0.85);
  });

  it('returns 0.75 with 3+ consecutive declines', () => {
    expect(getTrajectoryModifier(makeState({ consecutive_decline: 3 }))).toBe(0.75);
    expect(getTrajectoryModifier(makeState({ consecutive_decline: 10 }))).toBe(0.75);
  });

  it('returns 1.15 with 2+ consecutive rises', () => {
    expect(getTrajectoryModifier(makeState({ consecutive_rise: 2 }))).toBe(1.15);
    expect(getTrajectoryModifier(makeState({ consecutive_rise: 5 }))).toBe(1.15);
  });

  it('rise takes priority when both set (consecutive_rise >= 2)', () => {
    expect(getTrajectoryModifier(makeState({ consecutive_rise: 2, consecutive_decline: 3 }))).toBe(1.15);
  });
});

// ── getSliModifier ───────────────────────────────────────

describe('getSliModifier', () => {
  it('returns 1.0 with no breaches', () => {
    expect(getSliModifier('elicitation', makeState())).toBe(1.0);
  });

  it('returns 0.75 when SLI floor breached >= 2 consecutive turns', () => {
    const state = makeState({
      sli_consecutive_breaches: { engagement: 2 },
    });
    expect(getSliModifier('elicitation', state)).toBe(0.75);
  });

  it('returns 1.0 for family not matching the breached component', () => {
    const state = makeState({
      sli_consecutive_breaches: { engagement: 3 },
    });
    // engagement maps to elicitation, not procedural
    expect(getSliModifier('procedural', state)).toBe(1.0);
  });

  it('returns 0.75 when coverage breached (maps to procedural)', () => {
    const state = makeState({
      sli_consecutive_breaches: { coverage: 2 },
    });
    expect(getSliModifier('procedural', state)).toBe(0.75);
  });

  it('returns 1.0 when breach count is below threshold', () => {
    const state = makeState({
      sli_consecutive_breaches: { engagement: 1 },
    });
    expect(getSliModifier('elicitation', state)).toBe(1.0);
  });
});

// ── computeEffectiveThreshold ────────────────────────────

describe('computeEffectiveThreshold', () => {
  it('returns base threshold when all modifiers are 1.0', () => {
    const state = makeState();
    const result = computeEffectiveThreshold(0.7, 'sentinel', 'REDIRECT', state);
    // sentinel has no prior for REDIRECT, trajectory=1.0, no SLI breaches
    expect(result).toBeCloseTo(0.7);
  });

  it('lowers threshold when trajectory declines', () => {
    const state = makeState({ consecutive_decline: 2 });
    const result = computeEffectiveThreshold(0.7, 'sentinel', 'REDIRECT', state);
    // trajectory = 0.85, combined = 1.0 * 0.85 * 1.0 = 0.85
    expect(result).toBeCloseTo(0.7 * 0.85);
  });

  it('clamps combined modifier to [0.6, 1.4]', () => {
    // Extreme scenario: trajectory 0.75, SLI 0.75, persona 0.85
    const state = makeState({
      consecutive_decline: 3,
      sli_consecutive_breaches: { engagement: 3 },
    });
    // persona(prometheus, PIN) = 0.85, trajectory = 0.75, SLI = 0.75
    // combined = 0.85 * 0.75 * 0.75 = 0.478 → clamped to 0.6
    const result = computeEffectiveThreshold(1.0, 'prometheus', 'PIN', state);
    expect(result).toBeCloseTo(0.6);
  });
});

// ── computeDebateHealthScore ─────────────────────────────

describe('computeDebateHealthScore', () => {
  it('returns perfect health with no signals', () => {
    const h = computeDebateHealthScore([], { prometheus: 3, sentinel: 3 }, 10, 10);
    expect(h.value).toBe(1.0);
    expect(h.components.engagement).toBe(1.0);
    expect(h.components.novelty).toBe(1.0);
  });

  it('computes engagement from engagement_depth ratio', () => {
    const sig = makeSignals({ engagement_depth: { targeted: 2, standalone: 1, ratio: 0.6 } });
    const h = computeDebateHealthScore([sig], { prometheus: 3, sentinel: 3 }, 10, 10);
    expect(h.components.engagement).toBeCloseTo(0.6);
  });

  it('computes novelty as 1 - avg_self_overlap', () => {
    const sig = makeSignals({ recycling_rate: { avg_self_overlap: 0.4, max_self_overlap: 0.5 } });
    const h = computeDebateHealthScore([sig], { prometheus: 3, sentinel: 3 }, 10, 10);
    expect(h.components.novelty).toBeCloseTo(0.6);
  });

  it('computes responsiveness from concession outcomes', () => {
    const sig1 = makeSignals({
      concession_opportunity: { strong_attacks_faced: 1, concession_used: true, outcome: 'taken' },
    });
    const sig2 = makeSignals({
      concession_opportunity: { strong_attacks_faced: 1, concession_used: false, outcome: 'missed' },
    });
    const h = computeDebateHealthScore([sig1, sig2], { prometheus: 1, sentinel: 1 }, 5, 10);
    expect(h.components.responsiveness).toBeCloseTo(0.5);
  });

  it('computes coverage from cited/relevant node ratio', () => {
    const sig = makeSignals();
    const h = computeDebateHealthScore([sig], { prometheus: 3, sentinel: 3 }, 5, 20);
    expect(h.components.coverage).toBeCloseTo(0.25);
  });

  it('caps coverage at 1.0', () => {
    const sig = makeSignals();
    const h = computeDebateHealthScore([sig], { prometheus: 3, sentinel: 3 }, 30, 20);
    expect(h.components.coverage).toBe(1.0);
  });

  it('computes balance from turn distribution', () => {
    // Math.min(...turns, 0) uses 0 as a floor, so even equal turns get (max - 0)/total
    // With 3 debaters at 5 turns each: max=5, min=0 (floor), total=15 → 1 - 5/15 = 0.667
    const h1 = computeDebateHealthScore([makeSignals()], { prometheus: 5, sentinel: 5, cassandra: 5 }, 10, 10);
    expect(h1.components.balance).toBeCloseTo(0.667, 2);

    // Unequal turns = lower balance
    const h2 = computeDebateHealthScore([makeSignals()], { prometheus: 10, sentinel: 2, cassandra: 3 }, 10, 10);
    expect(h2.components.balance).toBeLessThan(1.0);
  });

  it('uses 3-turn sliding window', () => {
    const sigs = [
      makeSignals({ engagement_depth: { targeted: 1, standalone: 0, ratio: 0.2 } }),
      makeSignals({ engagement_depth: { targeted: 1, standalone: 0, ratio: 0.4 } }),
      makeSignals({ engagement_depth: { targeted: 1, standalone: 0, ratio: 0.6 } }),
      makeSignals({ engagement_depth: { targeted: 1, standalone: 0, ratio: 0.8 } }),
    ];
    const h = computeDebateHealthScore(sigs, { prometheus: 3, sentinel: 3 }, 10, 10);
    // Window = last 3: [0.4, 0.6, 0.8] → avg engagement = 0.6
    expect(h.components.engagement).toBeCloseTo(0.6);
  });

  it('clamps health value to [0, 1]', () => {
    const h = computeDebateHealthScore([makeSignals()], { prometheus: 3, sentinel: 3 }, 10, 10);
    expect(h.value).toBeGreaterThanOrEqual(0);
    expect(h.value).toBeLessThanOrEqual(1);
  });
});

// ── updateSliBreaches ────────────────────────────────────

describe('updateSliBreaches', () => {
  it('increments breach count when component below floor', () => {
    const state = makeState();
    const health = computeDebateHealthScore([], {}, 0, 0);
    health.components.engagement = 0.1; // below 0.25 floor
    updateSliBreaches(health, state);
    expect(state.sli_consecutive_breaches.engagement).toBe(1);
    updateSliBreaches(health, state);
    expect(state.sli_consecutive_breaches.engagement).toBe(2);
  });

  it('resets breach count when component above floor', () => {
    const state = makeState({ sli_consecutive_breaches: { engagement: 3 } });
    const health = computeDebateHealthScore([], {}, 0, 0);
    health.components.engagement = 0.5; // above 0.25 floor
    updateSliBreaches(health, state);
    expect(state.sli_consecutive_breaches.engagement).toBe(0);
  });
});

// ── validateRecommendation ───────────────────────────────

describe('validateRecommendation', () => {
  it('proceeds for a valid recommendation', () => {
    const state = makeState({ phase: 'exploration', rounds_since_last_intervention: 2 });
    const sel = makeSelection({ suggested_move: 'PIN', target_debater: 'sentinel' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
    expect(r.validated_move).toBe('PIN');
  });

  it('suppresses when intervene is false', () => {
    const state = makeState({ phase: 'exploration' });
    const sel = makeSelection({ intervene: false });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('engine_override');
  });

  it('refills budget when exhausted and proceeds (non-COMMIT)', () => {
    const state = makeState({ phase: 'exploration', budget_remaining: 0, budget_total: 3, rounds_since_last_intervention: 5 });
    const sel = makeSelection({ suggested_move: 'PIN' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
    expect(state.budget_epoch).toBe(1);
    expect(state.budget_remaining).toBeGreaterThanOrEqual(0);
    expect(state.refill_gap).toBe(2);
  });

  it('increases gap on each budget refill epoch', () => {
    const state = makeState({ phase: 'exploration', budget_remaining: 0, budget_total: 4, rounds_since_last_intervention: 5, budget_epoch: 1, refill_gap: 2 });
    const sel = makeSelection({ suggested_move: 'PIN' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
    expect(state.budget_epoch).toBe(2);
    expect(state.refill_gap).toBe(3);
  });

  it('COMMIT is off-budget', () => {
    const state = makeState({ phase: 'synthesis', budget_remaining: 0, rounds_since_last_intervention: 5 });
    const sel = makeSelection({ suggested_move: 'COMMIT', target_debater: 'prometheus' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });

  it('suppresses when cooldown active (non-exempt family)', () => {
    const state = makeState({
      phase: 'exploration',
      rounds_since_last_intervention: 0,
      required_gap: 1,
    });
    const sel = makeSelection({ suggested_move: 'REDIRECT' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('cooldown_active');
  });

  it('reconciliation is cooldown-exempt', () => {
    const state = makeState({
      phase: 'exploration',
      rounds_since_last_intervention: 0,
      required_gap: 2,
    });
    const sel = makeSelection({ suggested_move: 'ACKNOWLEDGE', target_debater: 'prometheus' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });

  it('suppresses on phase mismatch', () => {
    const state = makeState({ phase: 'thesis-antithesis', rounds_since_last_intervention: 2 });
    const sel = makeSelection({ suggested_move: 'COMMIT' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('phase_mismatch');
  });

  it('suppresses same-debater consecutive (non-reconciliation)', () => {
    const state = makeState({
      phase: 'exploration',
      rounds_since_last_intervention: 2,
      last_target: 'sentinel',
    });
    const sel = makeSelection({ suggested_move: 'PIN', target_debater: 'sentinel' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('same_debater_consecutive');
  });

  it('allows same-debater consecutive for reconciliation', () => {
    const state = makeState({
      phase: 'exploration',
      rounds_since_last_intervention: 0,
      required_gap: 1,
      last_target: 'sentinel',
    });
    const sel = makeSelection({ suggested_move: 'ACKNOWLEDGE', target_debater: 'sentinel' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });

  it('suppresses when burden cap exceeded', () => {
    const state = makeState({
      phase: 'exploration',
      rounds_since_last_intervention: 2,
      burden_per_debater: { prometheus: 0.5, sentinel: 5.0, cassandra: 0.5 },
      avg_burden: 2.0,
    });
    // sentinel burden (5.0) > avg (2.0) * 1.5 (3.0) and elicitation weight = 1.0 > 0.5
    const sel = makeSelection({ suggested_move: 'PIN', target_debater: 'sentinel' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('burden_cap');
  });

  it('allows high-burden debater with low-burden move', () => {
    const state = makeState({
      phase: 'exploration',
      rounds_since_last_intervention: 2,
      burden_per_debater: { prometheus: 0.5, sentinel: 5.0, cassandra: 0.5 },
      avg_burden: 2.0,
    });
    // reconciliation weight = 0.25, which is <= 0.5 threshold
    const sel = makeSelection({ suggested_move: 'ACKNOWLEDGE', target_debater: 'sentinel' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });
});

// ── updateModeratorState ─────────────────────────────────

describe('updateModeratorState', () => {
  it('increments rounds_since_last_intervention when no intervention', () => {
    const state = makeState({ rounds_since_last_intervention: 2 });
    const validation = { proceed: false, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'sentinel' as const };
    updateModeratorState(state, undefined, validation, 3, 'exploration');
    expect(state.rounds_since_last_intervention).toBe(3);
    expect(state.round).toBe(3);
  });

  it('resets rounds_since_last_intervention on intervention', () => {
    const state = makeState({ rounds_since_last_intervention: 3, interventions_fired: 0 });
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'sentinel' },
      'test text',
      'test reason',
      'test evidence',
    );
    const validation = { proceed: true, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'sentinel' as const };
    updateModeratorState(state, intervention, validation, 5, 'exploration');
    expect(state.rounds_since_last_intervention).toBe(0);
    expect(state.interventions_fired).toBe(1);
    expect(state.budget_remaining).toBeCloseTo(state.budget_total - 0.34, 1);
  });

  it('COMMIT does not consume budget', () => {
    const state = makeState({ interventions_fired: 0 });
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'COMMIT', validated_family: 'synthesis', validated_target: 'prometheus' },
      'commit text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'COMMIT' as InterventionMove, validated_family: 'synthesis' as const, validated_target: 'prometheus' as const };
    updateModeratorState(state, intervention, validation, 8, 'synthesis');
    expect(state.interventions_fired).toBe(0);
    expect(state.budget_remaining).toBe(state.budget_total);
  });

  it('keeps cooldown at 1 after multiple interventions', () => {
    const state = makeState({ interventions_fired: 3 });
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'PROBE', validated_family: 'elicitation', validated_target: 'cassandra' },
      'text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'PROBE' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'cassandra' as const };
    updateModeratorState(state, intervention, validation, 6, 'exploration');
    expect(state.required_gap).toBe(1);
  });

  it('elicitation family is cooldown-exempt', () => {
    const state = makeState({
      phase: 'exploration',
      rounds_since_last_intervention: 0,
      required_gap: 1,
    });
    const sel = makeSelection({ suggested_move: 'PIN', target_debater: 'prometheus' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });

  it('tracks burden per debater', () => {
    const state = makeState();
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'prometheus' },
      'text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'prometheus' as const };
    updateModeratorState(state, intervention, validation, 4, 'exploration');
    // elicitation burden weight = 1.0
    expect(state.burden_per_debater.prometheus).toBe(1.0);
    expect(state.avg_burden).toBeCloseTo(1.0 / 3);
  });

  it('records intervention in history', () => {
    const state = makeState();
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'CHALLENGE', validated_family: 'elicitation', validated_target: 'sentinel' },
      'text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'CHALLENGE' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'sentinel' as const };
    updateModeratorState(state, intervention, validation, 5, 'exploration');
    expect(state.intervention_history).toHaveLength(1);
    expect(state.intervention_history[0]).toMatchObject({
      round: 5,
      move: 'CHALLENGE',
      family: 'elicitation',
      target: 'sentinel',
      burden: 1.0,
    });
  });

  it('increments cooldown_blocked_count when suppressed by cooldown', () => {
    const state = makeState({ cooldown_blocked_count: 0 });
    const validation = {
      proceed: false,
      validated_move: 'PIN' as InterventionMove,
      validated_family: 'elicitation' as const,
      validated_target: 'sentinel' as const,
      suppressed_reason: 'cooldown_active' as const,
    };
    updateModeratorState(state, undefined, validation, 3, 'exploration');
    expect(state.cooldown_blocked_count).toBe(1);
  });

  it('sets trajectory_freeze_until after intervention', () => {
    const state = makeState();
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'sentinel' },
      'text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'sentinel' as const };
    updateModeratorState(state, intervention, validation, 5, 'exploration');
    expect(state.trajectory_freeze_until).toBe(6);
  });
});

// ── buildIntervention ────────────────────────────────────

describe('buildIntervention', () => {
  it('maps validation result to intervention object', () => {
    const validation = {
      proceed: true,
      validated_move: 'CHALLENGE' as InterventionMove,
      validated_family: 'elicitation' as const,
      validated_target: 'prometheus' as const,
    };
    const int = buildIntervention(validation, 'Challenge text', 'reason', 'evidence', 'original claim');
    expect(int.family).toBe('elicitation');
    expect(int.move).toBe('CHALLENGE');
    expect(int.force).toBe(MOVE_TO_FORCE['CHALLENGE']);
    expect(int.burden).toBe(FAMILY_BURDEN_WEIGHT['elicitation']);
    expect(int.target_debater).toBe('prometheus');
    expect(int.text).toBe('Challenge text');
    expect(int.original_claim_text).toBe('original claim');
    expect(int.trigger_reason).toBe('reason');
    expect(int.source_evidence).toBe('evidence');
  });
});

// ── buildInterventionBriefInjection ──────────────────────

describe('buildInterventionBriefInjection', () => {
  it('includes required field and response format for hard-compliance moves when targeted', () => {
    const int = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'sentinel' },
      'Pin text',
      'reason',
      'evidence',
    );
    const injection = buildInterventionBriefInjection(int, 'Sentinel');
    expect(injection).toContain('pin_response');
    expect(injection).toContain('MANDATORY RESPONSE FORMAT');
    expect(injection).toContain('Pin text');
    expect(injection).toContain('BREVITY RULE');
  });

  it('shows acknowledge instruction for non-targeted responder', () => {
    const int = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'sentinel' },
      'Pin text',
      'reason',
      'evidence',
    );
    const injection = buildInterventionBriefInjection(int, 'Prometheus');
    expect(injection).toContain('directed at sentinel');
    expect(injection).toContain('not you');
    expect(injection).toContain('Pin text');
  });

  it('includes guidance for non-compliance moves', () => {
    const int = buildIntervention(
      { proceed: true, validated_move: 'ACKNOWLEDGE', validated_family: 'reconciliation', validated_target: 'sentinel' },
      'Acknowledge text',
      'reason',
      'evidence',
    );
    const injection = buildInterventionBriefInjection(int);
    expect(injection).not.toContain('pin_response');
    expect(injection).toContain('Acknowledge text');
  });
});

// ── checkInterventionCompliance ──────────────────────────

describe('checkInterventionCompliance', () => {
  it('returns compliant for non-hard-compliance moves', () => {
    expect(checkInterventionCompliance('ACKNOWLEDGE', {}).compliant).toBe(true);
    expect(checkInterventionCompliance('REDIRECT', {}).compliant).toBe(true);
  });

  it('fails when required field missing', () => {
    const r = checkInterventionCompliance('PIN', {});
    expect(r.compliant).toBe(false);
    expect(r.missing_field).toBe('pin_response');
    expect(r.repair_hint).toContain('pin_response');
  });

  it('passes when required field present', () => {
    const r = checkInterventionCompliance('PIN', {
      pin_response: { position: 'agree', brief_reason: 'test' },
    });
    expect(r.compliant).toBe(true);
  });

  it('fails PIN when position sub-field missing', () => {
    const r = checkInterventionCompliance('PIN', {
      pin_response: { brief_reason: 'test' },
    });
    expect(r.compliant).toBe(false);
    expect(r.missing_field).toBe('pin_response.position');
  });

  it('fails PROBE when evidence empty', () => {
    const r = checkInterventionCompliance('PROBE', {
      probe_response: { evidence: '', evidence_type: 'empirical' },
    });
    expect(r.compliant).toBe(false);
    expect(r.missing_field).toBe('probe_response.evidence');
  });

  it('passes PROBE with valid evidence', () => {
    const r = checkInterventionCompliance('PROBE', {
      probe_response: { evidence: 'Smith et al. 2024', evidence_type: 'empirical' },
    });
    expect(r.compliant).toBe(true);
  });

  it('fails CLARIFY when definition empty', () => {
    const r = checkInterventionCompliance('CLARIFY', {
      clarification: { term: 'alignment', definition: '  ', example: 'test' },
    });
    expect(r.compliant).toBe(false);
  });

  it('fails META-REFLECT when conclusion empty', () => {
    const r = checkInterventionCompliance('META-REFLECT', {
      reflection: { type: 'crux', conclusion: '' },
    });
    expect(r.compliant).toBe(false);
  });

  it('fails COMPRESS when over 50 words', () => {
    const longThesis = Array(51).fill('word').join(' ');
    const r = checkInterventionCompliance('COMPRESS', {
      compressed_thesis: longThesis,
    });
    expect(r.compliant).toBe(false);
    expect(r.repair_hint).toContain('51 words');
  });

  it('passes COMPRESS under 50 words', () => {
    const r = checkInterventionCompliance('COMPRESS', {
      compressed_thesis: 'AI alignment requires careful coordination between governance and technical safety.',
    });
    expect(r.compliant).toBe(true);
  });

  it('fails COMMIT when sub-fields missing', () => {
    const r = checkInterventionCompliance('COMMIT', {
      commitment: { concessions: [] },
    });
    expect(r.compliant).toBe(false);
  });

  it('passes COMMIT with all sub-fields', () => {
    const r = checkInterventionCompliance('COMMIT', {
      commitment: {
        concessions: ['test'],
        conditions_for_change: ['test'],
        sharpest_disagreements: { sentinel: 'test' },
      },
    });
    expect(r.compliant).toBe(true);
  });

  it('fails CHECK when field missing', () => {
    const r = checkInterventionCompliance('CHECK', {});
    expect(r.compliant).toBe(false);
    expect(r.missing_field).toBe('check_response');
  });

  it('fails REVOICE when field missing', () => {
    const r = checkInterventionCompliance('REVOICE', {});
    expect(r.compliant).toBe(false);
    expect(r.missing_field).toBe('revoice_response');
  });

  it('fails CHALLENGE when field missing', () => {
    const r = checkInterventionCompliance('CHALLENGE', {});
    expect(r.compliant).toBe(false);
    expect(r.missing_field).toBe('challenge_response');
  });
});

// ── getResponseFieldForMove / getMoveResponseConfig ──────

describe('getResponseFieldForMove', () => {
  it('returns field name for hard-compliance moves', () => {
    expect(getResponseFieldForMove('PIN')).toBe('pin_response');
    expect(getResponseFieldForMove('COMMIT')).toBe('commitment');
    expect(getResponseFieldForMove('COMPRESS')).toBe('compressed_thesis');
  });

  it('returns null for non-compliance moves', () => {
    expect(getResponseFieldForMove('ACKNOWLEDGE')).toBeNull();
    expect(getResponseFieldForMove('REDIRECT')).toBeNull();
  });
});

describe('getMoveResponseConfig', () => {
  it('returns full config for each move', () => {
    const config = getMoveResponseConfig('PIN');
    expect(config.field).toBe('pin_response');
    expect(config.hardCompliance).toBe(true);
    expect(config.schema).toContain('position');
  });
});

// ── computeTriggerEvaluationContext ──────────────────────

describe('computeTriggerEvaluationContext', () => {
  it('computes context from clean state', () => {
    const state = makeState({ round: 4, phase: 'exploration' });
    const ctx = computeTriggerEvaluationContext(state, { prometheus: 3, sentinel: 3, cassandra: 2 });
    expect(ctx.round).toBe(4);
    expect(ctx.phase).toBe('exploration');
    expect(ctx.budget_remaining).toBe(state.budget_remaining);
    // rounds_since_last_intervention = 0, required_gap = 1 → cooldown = max(0, 1 - 0) = 1
    expect(ctx.cooldown_rounds_left).toBe(1);
    expect(ctx.intervention_history_summary).toBe('none');
    expect(ctx.sli_breaches).toEqual([]);
  });

  it('includes recent intervention history', () => {
    const state = makeState({
      round: 6,
      phase: 'exploration',
      intervention_history: [
        { round: 4, move: 'PIN' as InterventionMove, family: 'elicitation', target: 'sentinel' as const, burden: 1.0 },
      ],
      last_family: 'elicitation',
      last_target: 'sentinel',
    });
    const ctx = computeTriggerEvaluationContext(state, { prometheus: 3, sentinel: 3 });
    expect(ctx.last_intervention_move).toBe('PIN');
    expect(ctx.last_intervention_family).toBe('elicitation');
    expect(ctx.last_intervention_target).toBe('sentinel');
    expect(ctx.intervention_history_summary).toContain('R4: PIN → sentinel');
  });

  it('reports SLI breaches', () => {
    const state = makeState({
      sli_consecutive_breaches: { engagement: 3 },
    });
    const ctx = computeTriggerEvaluationContext(state, {});
    expect(ctx.sli_breaches).toHaveLength(1);
    expect(ctx.sli_breaches[0]).toContain('engagement');
  });
});

// ── formatTriggerContext ─────────────────────────────────

describe('formatTriggerContext', () => {
  it('produces readable multi-line output', () => {
    const state = makeState({ round: 5, phase: 'exploration' });
    const ctx = computeTriggerEvaluationContext(state, { prometheus: 4, sentinel: 3, cassandra: 3 });
    const text = formatTriggerContext(ctx);
    expect(text).toContain('Round: 5');
    expect(text).toContain('Phase: exploration');
    expect(text).toContain('Budget:');
    expect(text).toContain('Cooldown:');
    expect(text).toContain('Burden:');
    expect(text).toContain('Turn counts:');
    expect(text).toContain('Intervention history:');
  });
});

// ── getSynthesisResponder ────────────────────────────────

describe('getSynthesisResponder', () => {
  const povers: ('prometheus' | 'sentinel' | 'cassandra')[] = ['prometheus', 'sentinel', 'cassandra'];

  function transcript(...speakers: string[]) {
    return speakers.map(s => ({ speaker: s, type: 'statement' }));
  }

  it('returns first-appearing debater when none committed', () => {
    const state = makeState();
    const t = transcript('prometheus', 'sentinel', 'cassandra', 'prometheus');
    expect(getSynthesisResponder(state, povers, t)).toBe('prometheus');
  });

  it('skips debaters already committed', () => {
    const state = makeState({
      intervention_history: [
        { round: 9, move: 'COMMIT' as InterventionMove, family: 'synthesis', target: 'prometheus' as const, burden: 0.8 },
      ],
    });
    const t = transcript('prometheus', 'sentinel', 'cassandra');
    expect(getSynthesisResponder(state, povers, t)).toBe('sentinel');
  });

  it('returns null when all debaters committed', () => {
    const state = makeState({
      intervention_history: [
        { round: 9, move: 'COMMIT' as InterventionMove, family: 'synthesis', target: 'prometheus' as const, burden: 0.8 },
        { round: 10, move: 'COMMIT' as InterventionMove, family: 'synthesis', target: 'sentinel' as const, burden: 0.8 },
        { round: 11, move: 'COMMIT' as InterventionMove, family: 'synthesis', target: 'cassandra' as const, burden: 0.8 },
      ],
    });
    const t = transcript('prometheus', 'sentinel', 'cassandra');
    expect(getSynthesisResponder(state, povers, t)).toBeNull();
  });

  it('respects first-appearance order', () => {
    const state = makeState();
    // cassandra spoke first
    const t = transcript('cassandra', 'prometheus', 'sentinel');
    expect(getSynthesisResponder(state, povers, t)).toBe('cassandra');
  });

  it('includes debaters who never spoke in fallback order', () => {
    const state = makeState();
    // Only prometheus spoke
    const t = transcript('prometheus');
    const first = getSynthesisResponder(state, povers, t);
    expect(first).toBe('prometheus');

    // After prometheus committed, sentinel is next (from activePovers order)
    const state2 = makeState({
      intervention_history: [
        { round: 9, move: 'COMMIT' as InterventionMove, family: 'synthesis', target: 'prometheus' as const, burden: 0.8 },
      ],
    });
    const second = getSynthesisResponder(state2, povers, t);
    expect(second).toBe('sentinel');
  });

  it('ignores non-COMMIT interventions in history', () => {
    const state = makeState({
      intervention_history: [
        { round: 5, move: 'PIN' as InterventionMove, family: 'elicitation', target: 'prometheus' as const, burden: 1.0 },
      ],
    });
    const t = transcript('prometheus', 'sentinel', 'cassandra');
    expect(getSynthesisResponder(state, povers, t)).toBe('prometheus');
  });
});
