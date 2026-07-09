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
  detectNearMisses,
  getBurdenModifier,
  getConcludingResponder,
  shouldFirePolicyChallenge,
  extractContestedTerm,
  detectCruxFocusTrigger,
  buildCruxFocusInterventionText,
} from './moderator.js';
import type {
  ModeratorState,
  SelectionResult,
  ConvergenceSignals,
  InterventionMove,
  DebatePhase,
  SpeakerId,
} from './types.js';
import { MOVE_TO_FAMILY, MOVE_TO_FORCE, FAMILY_BURDEN_WEIGHT } from './types.js';

// ── Helpers ───────────────────────────────────────────────

function makeState(overrides: Partial<ModeratorState> = {}): ModeratorState {
  return {
    ...initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic']),
    ...overrides,
  };
}

function makeSelection(overrides: Partial<SelectionResult> = {}): SelectionResult {
  return {
    responder: 'safetyist',
    addressing: 'accelerationist',
    focus_point: 'test focus',
    agreement_detected: false,
    intervene: true,
    suggested_move: 'PIN',
    target_debater: 'safetyist',
    trigger_reasoning: 'test reason',
    trigger_evidence: 'test evidence',
    ...overrides,
  };
}

function makeSignals(overrides: Partial<ConvergenceSignals> = {}): ConvergenceSignals {
  return {
    entry_id: 'test',
    round: 1,
    speaker: 'accelerationist',
    move_polarity: { confrontational: 1, collaborative: 0, ratio: 1 },
    dialectical_engagement: { targeted: 1, standalone: 0, ratio: 1 },
    argument_redundancy: { avg_self_overlap: 0.1, max_self_overlap: 0.2 },
    dominant_counterargument: null,
    concession_opportunity: { strong_attacks_faced: 0, concession_used: false, outcome: 'none' },
    position_drift: { overlap_with_opening: 0.8 },
    ...overrides,
  };
}

// ── initModeratorState ───────────────────────────────────

describe('initModeratorState', () => {
  it('computes budget as ceil(argumentationRounds / 2.5)', () => {
    const s = initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic']);
    // argumentationRounds = max(10 - 3, 1) = 7; ceil(7 / 2.5) = 3
    expect(s.budget_total).toBe(3);
    expect(s.budget_remaining).toBe(3);
    expect(s.argumentation_rounds).toBe(7);
  });

  it('handles minimum total rounds', () => {
    const s = initModeratorState(3, ['accelerationist', 'safetyist']);
    // argumentationRounds = max(3 - 3, 1) = 1; ceil(1 / 2.5) = 1
    expect(s.argumentation_rounds).toBe(1);
    expect(s.budget_total).toBe(1);
  });

  it('initializes burden and trigger counts per debater', () => {
    const s = initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic']);
    expect(s.burden_per_debater).toEqual({ accelerationist: 0, safetyist: 0, skeptic: 0 });
    expect(s.persona_trigger_counts.accelerationist).toEqual({});
    expect(s.persona_trigger_counts.safetyist).toEqual({});
    expect(s.persona_trigger_counts.skeptic).toEqual({});
  });

  it('starts with clean counters', () => {
    const s = initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic']);
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
    expect(isPhaseAppropriate('REDIRECT', 'confrontation')).toBe(true);
    expect(isPhaseAppropriate('REDIRECT', 'argumentation')).toBe(true);
    // concluding doesn't include procedural in primary, but REDIRECT is procedural
    // and concluding primary = { synthesis, reconciliation }, secondary = { repair }
    expect(isPhaseAppropriate('REDIRECT', 'concluding')).toBe(false);
  });

  it('allows elicitation in confrontation', () => {
    expect(isPhaseAppropriate('PIN', 'confrontation')).toBe(true);
    expect(isPhaseAppropriate('PROBE', 'confrontation')).toBe(true);
    expect(isPhaseAppropriate('CHALLENGE', 'confrontation')).toBe(true);
  });

  it('allows elicitation in argumentation', () => {
    expect(isPhaseAppropriate('PIN', 'argumentation')).toBe(true);
    expect(isPhaseAppropriate('PROBE', 'argumentation')).toBe(true);
  });

  it('blocks elicitation in concluding', () => {
    expect(isPhaseAppropriate('PIN', 'concluding')).toBe(false);
    expect(isPhaseAppropriate('PROBE', 'concluding')).toBe(false);
  });

  it('allows reconciliation in all phases', () => {
    expect(isPhaseAppropriate('ACKNOWLEDGE', 'confrontation')).toBe(true);
    expect(isPhaseAppropriate('REVOICE', 'argumentation')).toBe(true);
    expect(isPhaseAppropriate('ACKNOWLEDGE', 'concluding')).toBe(true);
  });

  it('allows COMMIT only in concluding', () => {
    expect(isPhaseAppropriate('COMMIT', 'confrontation')).toBe(false);
    expect(isPhaseAppropriate('COMMIT', 'argumentation')).toBe(false);
    expect(isPhaseAppropriate('COMMIT', 'concluding')).toBe(true);
  });

  it('allows META-REFLECT only in argumentation', () => {
    expect(isPhaseAppropriate('META-REFLECT', 'argumentation')).toBe(true);
    expect(isPhaseAppropriate('META-REFLECT', 'confrontation')).toBe(false);
    expect(isPhaseAppropriate('META-REFLECT', 'concluding')).toBe(false);
  });

  it('allows concluding moves in argumentation as secondary (except COMMIT)', () => {
    expect(isPhaseAppropriate('COMPRESS', 'argumentation')).toBe(true);
    expect(isPhaseAppropriate('COMMIT', 'argumentation')).toBe(false);
  });

  it('allows repair in concluding as secondary', () => {
    expect(isPhaseAppropriate('CLARIFY', 'concluding')).toBe(true);
    expect(isPhaseAppropriate('CHECK', 'concluding')).toBe(true);
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
    const triggers: Record<string, Partial<Record<InterventionMove, number>>> = { accelerationist: {} };
    // Prometheus has PIN: 0.85
    const result = getPersonaModifier('accelerationist', 'PIN', triggers);
    expect(result).toBeCloseTo(0.85);
  });

  it('returns 1.0 for move without a prior', () => {
    const triggers: Record<string, Partial<Record<InterventionMove, number>>> = { accelerationist: {} };
    // Prometheus has no prior for REDIRECT
    expect(getPersonaModifier('accelerationist', 'REDIRECT', triggers)).toBe(1.0);
  });

  it('decays prior with observed triggers', () => {
    const triggers: Record<string, Partial<Record<InterventionMove, number>>> = {
      accelerationist: { PIN: 3 },
    };
    const result = getPersonaModifier('accelerationist', 'PIN', triggers);
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
    const result = computeEffectiveThreshold(0.7, 'safetyist', 'REDIRECT', state);
    // safetyist has no prior for REDIRECT, trajectory=1.0, no SLI breaches
    expect(result).toBeCloseTo(0.7);
  });

  it('lowers threshold when trajectory declines', () => {
    const state = makeState({ consecutive_decline: 2 });
    const result = computeEffectiveThreshold(0.7, 'safetyist', 'REDIRECT', state);
    // trajectory = 0.85, combined = 1.0 * 0.85 * 1.0 = 0.85
    expect(result).toBeCloseTo(0.7 * 0.85);
  });

  it('clamps combined modifier to [0.6, 1.4]', () => {
    // Extreme scenario: trajectory 0.75, SLI 0.75, persona 0.85
    const state = makeState({
      consecutive_decline: 3,
      sli_consecutive_breaches: { engagement: 3 },
    });
    // persona(accelerationist, PIN) = 0.85, trajectory = 0.75, SLI = 0.75
    // combined = 0.85 * 0.75 * 0.75 = 0.478 → clamped to 0.6
    const result = computeEffectiveThreshold(1.0, 'accelerationist', 'PIN', state);
    expect(result).toBeCloseTo(0.6);
  });

  it('raises threshold by 1.3× for overburdened debater with high-burden move', () => {
    const state = makeState({
      burden_per_debater: { accelerationist: 0.5, safetyist: 5.0, skeptic: 0.5 },
      avg_burden: 2.0,
    });
    // safetyist burden (5.0) > avg (2.0) × 1.5 (3.0), PIN is elicitation (weight 1.0 > 0.5)
    const result = computeEffectiveThreshold(0.7, 'safetyist', 'PIN', state);
    expect(result).toBeCloseTo(0.7 * 1.3);
  });

  it('does not raise threshold for low-burden family on overburdened debater', () => {
    const state = makeState({
      burden_per_debater: { accelerationist: 0.5, safetyist: 5.0, skeptic: 0.5 },
      avg_burden: 2.0,
    });
    // REVOICE is reconciliation (weight 0.25 ≤ 0.5) — no burden modifier
    // safetyist has no persona modifier for REVOICE
    const result = computeEffectiveThreshold(0.7, 'safetyist', 'REVOICE', state);
    expect(result).toBeCloseTo(0.7);
  });
});

// ── getBurdenModifier ────────────────────────────────────

describe('getBurdenModifier', () => {
  it('returns 1.0 when avg_burden is zero', () => {
    const state = makeState();
    expect(getBurdenModifier('safetyist', 'PIN', state)).toBe(1.0);
  });

  it('returns 1.3 for overburdened debater with high-burden move', () => {
    const state = makeState({
      burden_per_debater: { accelerationist: 0.5, safetyist: 5.0, skeptic: 0.5 },
      avg_burden: 2.0,
    });
    expect(getBurdenModifier('safetyist', 'PIN', state)).toBe(1.3);
  });

  it('returns 1.0 for overburdened debater with low-burden move', () => {
    const state = makeState({
      burden_per_debater: { accelerationist: 0.5, safetyist: 5.0, skeptic: 0.5 },
      avg_burden: 2.0,
    });
    expect(getBurdenModifier('safetyist', 'ACKNOWLEDGE', state)).toBe(1.0);
  });

  it('returns 1.0 when debater is not overburdened', () => {
    const state = makeState({
      burden_per_debater: { accelerationist: 1.0, safetyist: 1.0, skeptic: 1.0 },
      avg_burden: 1.0,
    });
    expect(getBurdenModifier('safetyist', 'PIN', state)).toBe(1.0);
  });
});

// ── computeDebateHealthScore ─────────────────────────────

describe('computeDebateHealthScore', () => {
  it('returns perfect health with no signals', () => {
    const h = computeDebateHealthScore([], { accelerationist: 3, safetyist: 3 }, 10, 10);
    expect(h.value).toBe(1.0);
    expect(h.components.engagement).toBe(1.0);
    expect(h.components.novelty).toBe(1.0);
  });

  it('computes engagement from dialectical_engagement ratio', () => {
    const sig = makeSignals({ dialectical_engagement: { targeted: 2, standalone: 1, ratio: 0.6 } });
    const h = computeDebateHealthScore([sig], { accelerationist: 3, safetyist: 3 }, 10, 10);
    expect(h.components.engagement).toBeCloseTo(0.6);
  });

  it('computes novelty as 1 - avg_self_overlap', () => {
    const sig = makeSignals({ argument_redundancy: { avg_self_overlap: 0.4, max_self_overlap: 0.5 } });
    const h = computeDebateHealthScore([sig], { accelerationist: 3, safetyist: 3 }, 10, 10);
    expect(h.components.novelty).toBeCloseTo(0.6);
  });

  it('computes responsiveness from concession outcomes', () => {
    const sig1 = makeSignals({
      concession_opportunity: { strong_attacks_faced: 1, concession_used: true, outcome: 'taken' },
    });
    const sig2 = makeSignals({
      concession_opportunity: { strong_attacks_faced: 1, concession_used: false, outcome: 'missed' },
    });
    const h = computeDebateHealthScore([sig1, sig2], { accelerationist: 1, safetyist: 1 }, 5, 10);
    expect(h.components.responsiveness).toBeCloseTo(0.5);
  });

  it('computes coverage from cited/relevant node ratio', () => {
    const sig = makeSignals();
    const h = computeDebateHealthScore([sig], { accelerationist: 3, safetyist: 3 }, 5, 20);
    expect(h.components.coverage).toBeCloseTo(0.25);
  });

  it('caps coverage at 1.0', () => {
    const sig = makeSignals();
    const h = computeDebateHealthScore([sig], { accelerationist: 3, safetyist: 3 }, 30, 20);
    expect(h.components.coverage).toBe(1.0);
  });

  it('computes balance from turn distribution', () => {
    // Math.min(...turns, 0) uses 0 as a floor, so even equal turns get (max - 0)/total
    // With 3 debaters at 5 turns each: max=5, min=0 (floor), total=15 → 1 - 5/15 = 0.667
    const h1 = computeDebateHealthScore([makeSignals()], { accelerationist: 5, safetyist: 5, skeptic: 5 }, 10, 10);
    expect(h1.components.balance).toBeCloseTo(0.667, 2);

    // Unequal turns = lower balance
    const h2 = computeDebateHealthScore([makeSignals()], { accelerationist: 10, safetyist: 2, skeptic: 3 }, 10, 10);
    expect(h2.components.balance).toBeLessThan(1.0);
  });

  it('uses 3-turn sliding window', () => {
    const sigs = [
      makeSignals({ dialectical_engagement: { targeted: 1, standalone: 0, ratio: 0.2 } }),
      makeSignals({ dialectical_engagement: { targeted: 1, standalone: 0, ratio: 0.4 } }),
      makeSignals({ dialectical_engagement: { targeted: 1, standalone: 0, ratio: 0.6 } }),
      makeSignals({ dialectical_engagement: { targeted: 1, standalone: 0, ratio: 0.8 } }),
    ];
    const h = computeDebateHealthScore(sigs, { accelerationist: 3, safetyist: 3 }, 10, 10);
    // Window = last 3: [0.4, 0.6, 0.8] → avg engagement = 0.6
    expect(h.components.engagement).toBeCloseTo(0.6);
  });

  it('clamps health value to [0, 1]', () => {
    const h = computeDebateHealthScore([makeSignals()], { accelerationist: 3, safetyist: 3 }, 10, 10);
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
    const state = makeState({ phase: 'argumentation', rounds_since_last_intervention: 2 });
    const sel = makeSelection({ suggested_move: 'PIN', target_debater: 'safetyist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
    expect(r.validated_move).toBe('PIN');
  });

  it('suppresses when intervene is false', () => {
    const state = makeState({ phase: 'argumentation' });
    const sel = makeSelection({ intervene: false });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('engine_override');
  });

  it('refills budget when exhausted and proceeds (non-COMMIT)', () => {
    const state = makeState({ phase: 'argumentation', budget_remaining: 0, budget_total: 3, rounds_since_last_intervention: 5 });
    const sel = makeSelection({ suggested_move: 'PIN' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
    expect(state.budget_epoch).toBe(1);
    expect(state.budget_remaining).toBeGreaterThanOrEqual(0);
    expect(state.refill_gap).toBe(2);
  });

  it('increases gap on each budget refill epoch', () => {
    const state = makeState({ phase: 'argumentation', budget_remaining: 0, budget_total: 4, rounds_since_last_intervention: 5, budget_epoch: 1, refill_gap: 2 });
    const sel = makeSelection({ suggested_move: 'PIN' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
    expect(state.budget_epoch).toBe(2);
    expect(state.refill_gap).toBe(3);
  });

  it('COMMIT is off-budget', () => {
    const state = makeState({ phase: 'concluding', budget_remaining: 0, rounds_since_last_intervention: 5 });
    const sel = makeSelection({ suggested_move: 'COMMIT', target_debater: 'accelerationist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });

  it('suppresses when cooldown active (non-exempt family)', () => {
    const state = makeState({
      phase: 'argumentation',
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
      phase: 'argumentation',
      rounds_since_last_intervention: 0,
      required_gap: 2,
    });
    const sel = makeSelection({ suggested_move: 'ACKNOWLEDGE', target_debater: 'accelerationist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });

  it('suppresses on phase mismatch', () => {
    const state = makeState({ phase: 'confrontation', rounds_since_last_intervention: 2 });
    const sel = makeSelection({ suggested_move: 'COMMIT' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('phase_mismatch');
  });

  it('suppresses same-debater consecutive (non-reconciliation)', () => {
    const state = makeState({
      phase: 'argumentation',
      rounds_since_last_intervention: 2,
      last_target: 'safetyist',
    });
    const sel = makeSelection({ suggested_move: 'PIN', target_debater: 'safetyist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('same_debater_consecutive');
  });

  it('allows same-debater consecutive for reconciliation', () => {
    const state = makeState({
      phase: 'argumentation',
      rounds_since_last_intervention: 0,
      required_gap: 1,
      last_target: 'safetyist',
    });
    const sel = makeSelection({ suggested_move: 'ACKNOWLEDGE', target_debater: 'safetyist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });

  it('allows overburdened debater with burden diagnostic', () => {
    const state = makeState({
      phase: 'argumentation',
      rounds_since_last_intervention: 2,
      burden_per_debater: { accelerationist: 0.5, safetyist: 5.0, skeptic: 0.5 },
      avg_burden: 2.0,
    });
    // safetyist burden (5.0) > avg (2.0) * 1.5 (3.0) — no longer blocked, emits diagnostic
    const sel = makeSelection({ suggested_move: 'PIN', target_debater: 'safetyist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
    expect(r.burden_diagnostic).toBeDefined();
    expect(r.burden_diagnostic!.debater).toBe('safetyist');
    expect(r.burden_diagnostic!.burden).toBe(5.0);
    expect(r.burden_diagnostic!.avg).toBe(2.0);
    expect(r.burden_diagnostic!.threshold_multiplier).toBe(1.3);
  });

  it('emits burden diagnostic with multiplier 1.0 for low-burden family', () => {
    const state = makeState({
      phase: 'argumentation',
      rounds_since_last_intervention: 2,
      burden_per_debater: { accelerationist: 0.5, safetyist: 5.0, skeptic: 0.5 },
      avg_burden: 2.0,
    });
    // reconciliation weight = 0.25 ≤ 0.5 — burden exceeds 1.5× avg but family is low-burden
    const sel = makeSelection({ suggested_move: 'ACKNOWLEDGE', target_debater: 'safetyist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
    expect(r.burden_diagnostic).toBeDefined();
    expect(r.burden_diagnostic!.threshold_multiplier).toBe(1.0);
  });

  it('suppresses CHALLENGE in confrontation before round 4', () => {
    const state = makeState({
      phase: 'confrontation',
      round: 1,
      rounds_since_last_intervention: 2,
    });
    const sel = makeSelection({ suggested_move: 'CHALLENGE', target_debater: 'accelerationist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('phase_mismatch');
  });

  it('allows CHALLENGE in confrontation at round 4+', () => {
    const state = makeState({
      phase: 'confrontation',
      round: 4,
      rounds_since_last_intervention: 2,
    });
    const sel = makeSelection({ suggested_move: 'CHALLENGE', target_debater: 'accelerationist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });

  it('allows CHALLENGE in argumentation at round 1', () => {
    const state = makeState({
      phase: 'argumentation',
      round: 1,
      rounds_since_last_intervention: 2,
    });
    const sel = makeSelection({ suggested_move: 'CHALLENGE', target_debater: 'accelerationist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(true);
  });
});

// ── suppression reason invariant (t/458 regression) ───────

describe('validateRecommendation — suppression reason invariant', () => {
  it('records suppression reason when META-REFLECT is blocked by cooldown', () => {
    const state = makeState({
      phase: 'argumentation',
      rounds_since_last_intervention: 0,
      required_gap: 2,
    });
    const sel = makeSelection({ suggested_move: 'META-REFLECT', target_debater: 'accelerationist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('cooldown_active');
    expect(r.suppression_explanation).toBeTruthy();
  });

  it('records suppression reason when META-REFLECT is blocked by phase', () => {
    const state = makeState({
      phase: 'confrontation',
      rounds_since_last_intervention: 2,
    });
    const sel = makeSelection({ suggested_move: 'META-REFLECT', target_debater: 'accelerationist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('phase_mismatch');
  });

  it('never produces null suppressed_reason when proceed=false and intervene=true', () => {
    const suppressionScenarios: { label: string; state: Partial<ModeratorState>; sel: Partial<SelectionResult> }[] = [
      { label: 'cooldown', state: { phase: 'argumentation', rounds_since_last_intervention: 0, required_gap: 2 }, sel: { suggested_move: 'PIN' } },
      { label: 'phase_mismatch', state: { phase: 'confrontation', rounds_since_last_intervention: 2 }, sel: { suggested_move: 'COMMIT' } },
      { label: 'same_debater_consecutive', state: { phase: 'argumentation', rounds_since_last_intervention: 2, last_target: 'safetyist' }, sel: { suggested_move: 'PIN', target_debater: 'safetyist' } },
      { label: 'engine_override (no move)', state: { phase: 'argumentation' }, sel: { intervene: true, suggested_move: undefined as unknown as string } },
      { label: 'engine_override (no target)', state: { phase: 'argumentation' }, sel: { intervene: true, target_debater: undefined as unknown as string } },
      { label: 'engine_override (not intervening)', state: { phase: 'argumentation' }, sel: { intervene: false } },
    ];

    for (const scenario of suppressionScenarios) {
      const state = makeState(scenario.state);
      const sel = makeSelection(scenario.sel);
      const r = validateRecommendation(sel, state);
      expect(r.proceed, `expected proceed=false for ${scenario.label}`).toBe(false);
      expect(r.suppressed_reason, `missing suppressed_reason for ${scenario.label}`).toBeTruthy();
    }
  });
});

// ── updateModeratorState ─────────────────────────────────

describe('updateModeratorState', () => {
  it('increments rounds_since_last_intervention when no intervention', () => {
    const state = makeState({ rounds_since_last_intervention: 2 });
    const validation = { proceed: false, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'safetyist' as const };
    updateModeratorState(state, undefined, validation, 3, 'argumentation');
    expect(state.rounds_since_last_intervention).toBe(3);
    expect(state.round).toBe(3);
  });

  it('resets rounds_since_last_intervention on intervention', () => {
    const state = makeState({ rounds_since_last_intervention: 3, interventions_fired: 0 });
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'safetyist' },
      'test text',
      'test reason',
      'test evidence',
    );
    const validation = { proceed: true, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'safetyist' as const };
    updateModeratorState(state, intervention, validation, 5, 'argumentation');
    expect(state.rounds_since_last_intervention).toBe(0);
    expect(state.interventions_fired).toBe(1);
    expect(state.budget_remaining).toBeCloseTo(state.budget_total - 0.34, 1);
  });

  it('COMMIT does not consume budget', () => {
    const state = makeState({ interventions_fired: 0 });
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'COMMIT', validated_family: 'synthesis', validated_target: 'accelerationist' },
      'commit text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'COMMIT' as InterventionMove, validated_family: 'synthesis' as const, validated_target: 'accelerationist' as const };
    updateModeratorState(state, intervention, validation, 8, 'concluding');
    expect(state.interventions_fired).toBe(0);
    expect(state.budget_remaining).toBe(state.budget_total);
  });

  it('keeps cooldown at 1 after multiple interventions', () => {
    const state = makeState({ interventions_fired: 3 });
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'PROBE', validated_family: 'elicitation', validated_target: 'skeptic' },
      'text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'PROBE' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'skeptic' as const };
    updateModeratorState(state, intervention, validation, 6, 'argumentation');
    expect(state.required_gap).toBe(1);
  });

  it('elicitation family is subject to cooldown', () => {
    const state = makeState({
      phase: 'argumentation',
      rounds_since_last_intervention: 0,
      required_gap: 1,
    });
    const sel = makeSelection({ suggested_move: 'PIN', target_debater: 'accelerationist' });
    const r = validateRecommendation(sel, state);
    expect(r.proceed).toBe(false);
    expect(r.suppressed_reason).toBe('cooldown_active');
  });

  it('tracks burden per debater', () => {
    const state = makeState();
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'accelerationist' },
      'text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'accelerationist' as const };
    updateModeratorState(state, intervention, validation, 4, 'argumentation');
    // elicitation burden weight = 1.0
    expect(state.burden_per_debater.accelerationist).toBe(1.0);
    expect(state.avg_burden).toBeCloseTo(1.0 / 3);
  });

  it('records intervention in history', () => {
    const state = makeState();
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'CHALLENGE', validated_family: 'elicitation', validated_target: 'safetyist' },
      'text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'CHALLENGE' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'safetyist' as const };
    updateModeratorState(state, intervention, validation, 5, 'argumentation');
    expect(state.intervention_history).toHaveLength(1);
    expect(state.intervention_history[0]).toMatchObject({
      round: 5,
      move: 'CHALLENGE',
      family: 'elicitation',
      target: 'safetyist',
      burden: 1.0,
    });
  });

  it('increments cooldown_blocked_count when suppressed by cooldown', () => {
    const state = makeState({ cooldown_blocked_count: 0 });
    const validation = {
      proceed: false,
      validated_move: 'PIN' as InterventionMove,
      validated_family: 'elicitation' as const,
      validated_target: 'safetyist' as const,
      suppressed_reason: 'cooldown_active' as const,
    };
    updateModeratorState(state, undefined, validation, 3, 'argumentation');
    expect(state.cooldown_blocked_count).toBe(1);
  });

  it('sets trajectory_freeze_until after intervention', () => {
    const state = makeState();
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'safetyist' },
      'text',
      'reason',
      'evidence',
    );
    const validation = { proceed: true, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'safetyist' as const };
    updateModeratorState(state, intervention, validation, 5, 'argumentation');
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
      validated_target: 'accelerationist' as const,
    };
    const int = buildIntervention(validation, 'Challenge text', 'reason', 'evidence', 'original claim');
    expect(int.family).toBe('elicitation');
    expect(int.move).toBe('CHALLENGE');
    expect(int.force).toBe(MOVE_TO_FORCE['CHALLENGE']);
    expect(int.burden).toBe(FAMILY_BURDEN_WEIGHT['elicitation']);
    expect(int.target_debater).toBe('accelerationist');
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
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'safetyist' },
      'Pin text',
      'reason',
      'evidence',
    );
    const injection = buildInterventionBriefInjection(int, 'Safetyist');
    expect(injection).toContain('pin_response');
    expect(injection).toContain('MANDATORY RESPONSE FORMAT');
    expect(injection).toContain('Pin text');
    expect(injection).toContain('BREVITY RULE');
  });

  it('shows acknowledge instruction for non-targeted responder', () => {
    const int = buildIntervention(
      { proceed: true, validated_move: 'PIN', validated_family: 'elicitation', validated_target: 'safetyist' },
      'Pin text',
      'reason',
      'evidence',
    );
    const injection = buildInterventionBriefInjection(int, 'Accelerationist');
    expect(injection).toContain('directed at Safetyist');
    expect(injection).toContain('not you');
    expect(injection).toContain('Pin text');
  });

  it('includes recency field reminder for targeted hard-compliance moves', () => {
    const int = buildIntervention(
      { proceed: true, validated_move: 'COMMIT', validated_family: 'accountability', validated_target: 'skeptic' },
      'Commit text',
      'reason',
      'evidence',
    );
    const injection = buildInterventionBriefInjection(int, 'Skeptic');
    expect(injection).toContain('REMINDER');
    expect(injection).toContain('"commitment"');
    expect(injection).toContain('trigger a retry');
  });

  it('includes guidance for non-compliance moves', () => {
    const int = buildIntervention(
      { proceed: true, validated_move: 'ACKNOWLEDGE', validated_family: 'reconciliation', validated_target: 'safetyist' },
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
        sharpest_disagreements: { safetyist: 'test' },
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
    const state = makeState({ round: 4, phase: 'argumentation' });
    const ctx = computeTriggerEvaluationContext(state, { accelerationist: 3, safetyist: 3, skeptic: 2 });
    expect(ctx.round).toBe(4);
    expect(ctx.phase).toBe('argumentation');
    expect(ctx.budget_remaining).toBe(state.budget_remaining);
    // rounds_since_last_intervention = 0, required_gap = 1 → cooldown = max(0, 1 - 0) = 1
    expect(ctx.cooldown_rounds_left).toBe(1);
    expect(ctx.intervention_history_summary).toBe('none');
    expect(ctx.sli_breaches).toEqual([]);
  });

  it('includes recent intervention history', () => {
    const state = makeState({
      round: 6,
      phase: 'argumentation',
      intervention_history: [
        { round: 4, move: 'PIN' as InterventionMove, family: 'elicitation', target: 'safetyist' as const, burden: 1.0 },
      ],
      last_family: 'elicitation',
      last_target: 'safetyist',
    });
    const ctx = computeTriggerEvaluationContext(state, { accelerationist: 3, safetyist: 3 });
    expect(ctx.last_intervention_move).toBe('PIN');
    expect(ctx.last_intervention_family).toBe('elicitation');
    expect(ctx.last_intervention_target).toBe('safetyist');
    expect(ctx.intervention_history_summary).toContain('R4: PIN → safetyist');
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
    const state = makeState({ round: 5, phase: 'argumentation' });
    const ctx = computeTriggerEvaluationContext(state, { accelerationist: 4, safetyist: 3, skeptic: 3 });
    const text = formatTriggerContext(ctx);
    expect(text).toContain('Round: 5');
    expect(text).toContain('Phase: argumentation');
    expect(text).toContain('Budget:');
    expect(text).toContain('Cooldown:');
    expect(text).toContain('Burden:');
    expect(text).toContain('Turn counts:');
    expect(text).toContain('Intervention history:');
  });

  const makeHealth = (): import('./types.js').DebateHealthScore => ({
    value: 0.72,
    trend: 0.01,
    consecutive_decline: 0,
    components: { engagement: 0.8, novelty: 0.7, responsiveness: 0.6, coverage: 0.75, balance: 0.85 },
  });

  it('suppresses health scores when convergence signal count < 3', () => {
    const state = makeState({
      round: 2,
      phase: 'confrontation',
      health_history: [makeHealth(), makeHealth()],
    });
    const ctx = computeTriggerEvaluationContext(state, { accelerationist: 1, safetyist: 1 });
    expect(ctx.convergence_signal_count).toBe(2);
    const text = formatTriggerContext(ctx);
    expect(text).toContain('suppressed');
    expect(text).toContain('2/3 signals');
    expect(text).not.toContain('engagement=');
  });

  it('shows health scores when convergence signal count >= 3', () => {
    const state = makeState({
      round: 5,
      phase: 'argumentation',
      health_history: [makeHealth(), makeHealth(), makeHealth()],
    });
    const ctx = computeTriggerEvaluationContext(state, { accelerationist: 3, safetyist: 3 });
    expect(ctx.convergence_signal_count).toBe(3);
    const text = formatTriggerContext(ctx);
    expect(text).toContain('Health: 0.72');
    expect(text).toContain('engagement=');
    expect(text).not.toContain('suppressed');
  });
});

// ── getConcludingResponder ────────────────────────────────

describe('getConcludingResponder', () => {
  const povers: ('accelerationist' | 'safetyist' | 'skeptic')[] = ['accelerationist', 'safetyist', 'skeptic'];

  function transcript(...speakers: string[]) {
    return speakers.map(s => ({ speaker: s, type: 'statement' }));
  }

  it('returns first-appearing debater when none committed', () => {
    const state = makeState();
    const t = transcript('accelerationist', 'safetyist', 'skeptic', 'accelerationist');
    expect(getConcludingResponder(state, povers, t)).toBe('accelerationist');
  });

  it('skips debaters already committed', () => {
    const state = makeState({
      intervention_history: [
        { round: 9, move: 'COMMIT' as InterventionMove, family: 'concluding', target: 'accelerationist' as const, burden: 0.8 },
      ],
    });
    const t = transcript('accelerationist', 'safetyist', 'skeptic');
    expect(getConcludingResponder(state, povers, t)).toBe('safetyist');
  });

  it('returns null when all debaters committed', () => {
    const state = makeState({
      intervention_history: [
        { round: 9, move: 'COMMIT' as InterventionMove, family: 'concluding', target: 'accelerationist' as const, burden: 0.8 },
        { round: 10, move: 'COMMIT' as InterventionMove, family: 'concluding', target: 'safetyist' as const, burden: 0.8 },
        { round: 11, move: 'COMMIT' as InterventionMove, family: 'concluding', target: 'skeptic' as const, burden: 0.8 },
      ],
    });
    const t = transcript('accelerationist', 'safetyist', 'skeptic');
    expect(getConcludingResponder(state, povers, t)).toBeNull();
  });

  it('respects first-appearance order', () => {
    const state = makeState();
    // skeptic spoke first
    const t = transcript('skeptic', 'accelerationist', 'safetyist');
    expect(getConcludingResponder(state, povers, t)).toBe('skeptic');
  });

  it('includes debaters who never spoke in fallback order', () => {
    const state = makeState();
    // Only accelerationist spoke
    const t = transcript('accelerationist');
    const first = getConcludingResponder(state, povers, t);
    expect(first).toBe('accelerationist');

    // After accelerationist committed, safetyist is next (from activePovers order)
    const state2 = makeState({
      intervention_history: [
        { round: 9, move: 'COMMIT' as InterventionMove, family: 'concluding', target: 'accelerationist' as const, burden: 0.8 },
      ],
    });
    const second = getConcludingResponder(state2, povers, t);
    expect(second).toBe('safetyist');
  });

  it('ignores non-COMMIT interventions in history', () => {
    const state = makeState({
      intervention_history: [
        { round: 5, move: 'PIN' as InterventionMove, family: 'elicitation', target: 'accelerationist' as const, burden: 1.0 },
      ],
    });
    const t = transcript('accelerationist', 'safetyist', 'skeptic');
    expect(getConcludingResponder(state, povers, t)).toBe('accelerationist');
  });
});

describe('shouldFirePolicyChallenge (t/249)', () => {
  const baseInput = {
    audience: 'policymakers' as const,
    phase: 'argumentation' as const,
    argumentationRoundCount: 4,
    convergenceSignals: [
      { move_polarity: { ratio: 0.7 } },
      { move_polarity: { ratio: 0.65 } },
      { move_polarity: { ratio: 0.72 } },
    ],
    intentionNodes: [
      { specificity: 'abstract' },
      { specificity: 'general' },
      { specificity: 'abstract' },
    ],
  };

  const makeModState = (overrides: Partial<ModeratorState> = {}): ModeratorState => ({
    ...initModeratorState(10, ['accelerationist', 'safetyist', 'skeptic'] as SpeakerId[]),
    rounds_since_last_intervention: 3,
    ...overrides,
  });

  it('fires when all 4 conditions are met', () => {
    const result = shouldFirePolicyChallenge(
      baseInput,
      makeModState(),
      ['accelerationist', 'safetyist', 'skeptic'] as SpeakerId[],
    );
    expect(result).not.toBeNull();
  });

  it('does not fire for non-policymaker audience', () => {
    const result = shouldFirePolicyChallenge(
      { ...baseInput, audience: 'technical_researchers' },
      makeModState(),
      ['accelerationist', 'safetyist', 'skeptic'] as SpeakerId[],
    );
    expect(result).toBeNull();
  });

  it('does not fire before 3 argumentation rounds', () => {
    const result = shouldFirePolicyChallenge(
      { ...baseInput, argumentationRoundCount: 2 },
      makeModState(),
      ['accelerationist', 'safetyist', 'skeptic'] as SpeakerId[],
    );
    expect(result).toBeNull();
  });

  it('does not fire when collaborative ratio is low', () => {
    const result = shouldFirePolicyChallenge(
      { ...baseInput, convergenceSignals: [{ move_polarity: { ratio: 0.3 } }] },
      makeModState(),
      ['accelerationist', 'safetyist', 'skeptic'] as SpeakerId[],
    );
    expect(result).toBeNull();
  });

  it('does not fire when intention nodes are precise', () => {
    const result = shouldFirePolicyChallenge(
      { ...baseInput, intentionNodes: [{ specificity: 'precise' }, { specificity: 'precise' }] },
      makeModState(),
      ['accelerationist', 'safetyist', 'skeptic'] as SpeakerId[],
    );
    expect(result).toBeNull();
  });

  it('does not fire twice in the same debate', () => {
    const state = makeModState({
      intervention_history: [
        { round: 5, move: 'POLICY_CHALLENGE' as InterventionMove, family: 'elicitation', target: 'safetyist' as SpeakerId, burden: 1.0 },
      ],
    });
    const result = shouldFirePolicyChallenge(
      baseInput,
      state,
      ['accelerationist', 'safetyist', 'skeptic'] as SpeakerId[],
    );
    expect(result).toBeNull();
  });
});

// ── CRUX_FOCUS ──────────────────────────────────────────

describe('extractContestedTerm', () => {
  it('finds the most-frequent shared content word (>5 chars)', () => {
    const crux = 'Whether alignment research can keep pace with capability scaling';
    const attacks = [
      'Alignment research has historically lagged capability development by years',
      'The alignment gap grows with each capability jump',
    ];
    const term = extractContestedTerm(crux, attacks);
    expect(term).toBe('alignment');
  });

  it('returns undefined when no shared content words exist', () => {
    const term = extractContestedTerm('Short text', ['Other words here']);
    expect(term).toBeUndefined();
  });

  it('ignores stop words', () => {
    const crux = 'Whether the between should really matter however';
    const attacks = ['However between should really does matter'];
    const term = extractContestedTerm(crux, attacks);
    expect(term).toBe('matter');
  });
});

describe('detectCruxFocusTrigger', () => {
  const activePovers = ['accelerationist', 'safetyist', 'skeptic'] as SpeakerId[];

  const makeCrux = (overrides: Partial<{ id: string; description: string; identified_turn: number; state: string; disagreement_type: string; attacking_claim_ids: string[]; speakers_involved: SpeakerId[] }> = {}) => ({
    id: 'crux-1',
    description: 'Whether AI alignment can scale',
    identified_turn: 3,
    state: 'engaged',
    disagreement_type: 'empirical',
    attacking_claim_ids: [],
    speakers_involved: ['accelerationist', 'safetyist'] as SpeakerId[],
    ...overrides,
  });

  const makeFocusState = (overrides: Partial<ModeratorState> = {}): ModeratorState => ({
    ...initModeratorState(10, activePovers),
    phase: 'argumentation' as DebatePhase,
    rounds_since_last_intervention: 3,
    ...overrides,
  });

  it('fires for an engaged crux that has been unresolved for 2+ rounds', () => {
    const result = detectCruxFocusTrigger(
      [makeCrux()], 5, makeFocusState(), activePovers,
    );
    expect(result).not.toBeNull();
    expect(result!.cruxId).toBe('crux-1');
    expect(result!.disagreementType).toBe('empirical');
    expect(result!.roundsEngaged).toBe(2);
  });

  it('does not fire during confrontation phase', () => {
    const result = detectCruxFocusTrigger(
      [makeCrux()], 5,
      makeFocusState({ phase: 'confrontation' as DebatePhase }),
      activePovers,
    );
    expect(result).toBeNull();
  });

  it('does not fire if crux is not in engaged state', () => {
    const result = detectCruxFocusTrigger(
      [makeCrux({ state: 'one_side_conceded' })], 5,
      makeFocusState(), activePovers,
    );
    expect(result).toBeNull();
  });

  it('does not fire if crux engaged for less than 2 rounds', () => {
    const result = detectCruxFocusTrigger(
      [makeCrux({ identified_turn: 4 })], 5,
      makeFocusState(), activePovers,
    );
    expect(result).toBeNull();
  });

  it('does not fire again for an already-focused crux', () => {
    const state = makeFocusState({ crux_focused_ids: new Set(['crux-1']) });
    const result = detectCruxFocusTrigger(
      [makeCrux()], 5, state, activePovers,
    );
    expect(result).toBeNull();
  });

  it('does not fire when budget is exhausted', () => {
    const result = detectCruxFocusTrigger(
      [makeCrux()], 5,
      makeFocusState({ budget_remaining: 0 }),
      activePovers,
    );
    expect(result).toBeNull();
  });

  it('does not fire during cooldown', () => {
    const result = detectCruxFocusTrigger(
      [makeCrux()], 5,
      makeFocusState({ rounds_since_last_intervention: 0 }),
      activePovers,
    );
    expect(result).toBeNull();
  });

  it('picks the crux with the most rounds engaged', () => {
    const cruxes = [
      makeCrux({ id: 'crux-1', identified_turn: 4 }),
      makeCrux({ id: 'crux-2', identified_turn: 1, description: 'Older crux' }),
    ];
    const result = detectCruxFocusTrigger(cruxes, 5, makeFocusState(), activePovers);
    expect(result!.cruxId).toBe('crux-2');
    expect(result!.roundsEngaged).toBe(4);
  });

  it('extracts contested term for definitional cruxes', () => {
    const crux = makeCrux({
      disagreement_type: 'definitional',
      description: 'Whether artificial intelligence includes symbolic reasoning',
      attacking_claim_ids: ['c1', 'c2'],
    });
    const claimTexts = {
      c1: 'Artificial intelligence by the connectionist definition excludes symbolic reasoning',
      c2: 'The intelligence framing matters for policy — symbolic intelligence should count',
    };
    const result = detectCruxFocusTrigger([crux], 5, makeFocusState(), activePovers, claimTexts);
    expect(result).not.toBeNull();
    expect(result!.contestedTerm).toBeDefined();
  });
});

describe('buildCruxFocusInterventionText', () => {
  it('produces empirical template with evidence demand', () => {
    const text = buildCruxFocusInterventionText({
      cruxId: 'crux-1',
      description: 'Whether AI can self-improve',
      disagreementType: 'empirical',
      roundsEngaged: 3,
      speakersInvolved: ['accelerationist'] as SpeakerId[],
    }, 'Accelerationist');
    expect(text).toContain('factual question');
    expect(text).toContain('Accelerationist');
    expect(text).toContain('Whether AI can self-improve');
    expect(text).toContain('falsifiable');
  });

  it('produces values template with tradeoff demand', () => {
    const text = buildCruxFocusInterventionText({
      cruxId: 'crux-2',
      description: 'Speed vs safety priority',
      disagreementType: 'values',
      roundsEngaged: 3,
      speakersInvolved: ['safetyist'] as SpeakerId[],
    }, 'Safetyist');
    expect(text).toContain('competing priorities');
    expect(text).toContain('Safetyist');
    expect(text).toContain('conditional agreement');
  });

  it('produces definitional template with contested term', () => {
    const text = buildCruxFocusInterventionText({
      cruxId: 'crux-3',
      description: 'What counts as alignment',
      disagreementType: 'definitional',
      roundsEngaged: 2,
      speakersInvolved: ['skeptic'] as SpeakerId[],
      contestedTerm: 'alignment',
    }, 'Skeptic');
    expect(text).toContain('"alignment"');
    expect(text).toContain('Skeptic');
    expect(text).toContain('Define your key term');
  });

  it('uses fallback when no contested term extracted', () => {
    const text = buildCruxFocusInterventionText({
      cruxId: 'crux-4',
      description: 'Definition dispute',
      disagreementType: 'definitional',
      roundsEngaged: 2,
      speakersInvolved: ['skeptic'] as SpeakerId[],
    }, 'Skeptic');
    expect(text).toContain('a key term');
  });
});

describe('checkInterventionCompliance — CRUX_FOCUS', () => {
  it('passes when crux_focus_response has type and evidence_or_tradeoff', () => {
    const result = checkInterventionCompliance('CRUX_FOCUS' as InterventionMove, {
      crux_focus_response: {
        type: 'empirical',
        evidence_or_tradeoff: 'Study by Smith 2025 shows alignment scales sublinearly',
      },
    });
    expect(result.compliant).toBe(true);
  });

  it('fails when crux_focus_response is missing', () => {
    const result = checkInterventionCompliance('CRUX_FOCUS' as InterventionMove, {});
    expect(result.compliant).toBe(false);
    expect(result.missing_field).toBe('crux_focus_response');
  });

  it('fails when type is invalid', () => {
    const result = checkInterventionCompliance('CRUX_FOCUS' as InterventionMove, {
      crux_focus_response: { type: 'unknown', evidence_or_tradeoff: 'something' },
    });
    expect(result.compliant).toBe(false);
    expect(result.missing_field).toContain('type');
  });

  it('fails when evidence_or_tradeoff is empty', () => {
    const result = checkInterventionCompliance('CRUX_FOCUS' as InterventionMove, {
      crux_focus_response: { type: 'values', evidence_or_tradeoff: '   ' },
    });
    expect(result.compliant).toBe(false);
    expect(result.missing_field).toContain('evidence_or_tradeoff');
  });
});

// ── detectNearMisses ─────────────────────────────────────

describe('detectNearMisses', () => {
  it('returns empty for signal at 79% of threshold', () => {
    const state = makeState();
    const result = detectNearMisses(state, { PIN: 0.79 });
    expect(result).toHaveLength(0);
  });

  it('flags signal at 80% as near-miss', () => {
    const state = makeState();
    const result = detectNearMisses(state, { PIN: 0.8 });
    expect(result).toHaveLength(1);
    expect(result[0].move).toBe('PIN');
    expect(result[0].signal_value).toBe(0.8);
    expect(result[0].effective_threshold).toBe(1.0);
    expect(result[0].ratio).toBeCloseTo(0.8);
  });

  it('flags signal at 99% as near-miss', () => {
    const state = makeState();
    const result = detectNearMisses(state, { PROBE: 0.99 });
    expect(result).toHaveLength(1);
    expect(result[0].move).toBe('PROBE');
    expect(result[0].ratio).toBeCloseTo(0.99);
  });

  it('does not flag signal at 100%+ (triggered, not near-miss)', () => {
    const state = makeState();
    const result = detectNearMisses(state, { CHALLENGE: 1.0 });
    expect(result).toHaveLength(0);
  });

  it('detects multiple near-misses across moves', () => {
    const state = makeState();
    const result = detectNearMisses(state, { PIN: 0.85, PROBE: 0.92, CHALLENGE: 0.5, REDIRECT: 1.1 });
    expect(result).toHaveLength(2);
    const moves = result.map(r => r.move);
    expect(moves).toContain('PIN');
    expect(moves).toContain('PROBE');
  });

  it('returns empty for empty signal values', () => {
    const state = makeState();
    const result = detectNearMisses(state, {});
    expect(result).toHaveLength(0);
  });
});
