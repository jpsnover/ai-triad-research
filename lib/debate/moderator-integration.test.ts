// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  initModeratorState,
  validateRecommendation,
  updateModeratorState,
  computeDebateHealthScore,
  updateSliBreaches,
  buildIntervention,
  buildInterventionBriefInjection,
  checkInterventionCompliance,
  getSynthesisResponder,
} from './moderator';
import type {
  ModeratorState,
  SelectionResult,
  InterventionMove,
  DebatePhase,
  ConvergenceSignals,
} from './types';
import { MOVE_TO_FAMILY } from './types';

// ── Helpers ───────────────────────────────────────────────

function makeSignals(overrides: Partial<ConvergenceSignals> = {}): ConvergenceSignals {
  return {
    entry_id: 'test',
    round: 1,
    speaker: 'prometheus',
    move_disposition: { confrontational: 1, collaborative: 0, ratio: 1 },
    engagement_depth: { targeted: 1, standalone: 0, ratio: 0.8 },
    recycling_rate: { avg_self_overlap: 0.1, max_self_overlap: 0.2 },
    strongest_opposing: null,
    concession_opportunity: { strong_attacks_faced: 0, concession_used: false, outcome: 'none' },
    position_delta: { overlap_with_opening: 0.8 },
    ...overrides,
  };
}

function transcript(...speakers: string[]) {
  return speakers.map((s, i) => ({
    id: `e-${i}`,
    speaker: s,
    type: 'statement' as const,
    content: `Statement by ${s}`,
  }));
}

// ── Full pipeline: Stage 1 parse → Engine validate → Stage 2 build → Compliance ──

describe('moderator pipeline integration', () => {
  it('runs a normal intervention pipeline (PIN in exploration)', () => {
    const state = initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']);
    state.phase = 'exploration';
    state.round = 4;
    state.rounds_since_last_intervention = 2;

    // Simulate Stage 1 selection result
    const selection: SelectionResult = {
      responder: 'sentinel',
      addressing: 'prometheus',
      focus_point: 'Test whether prometheus actually supports open-source mandates',
      agreement_detected: false,
      intervene: true,
      suggested_move: 'PIN',
      target_debater: 'sentinel',
      trigger_reasoning: 'Sentinel has been evasive on open-source position',
      trigger_evidence: { signal_name: 'evasion', source_claim: 'claim-1', source_round: 3 },
    };

    // Engine validation
    const validation = validateRecommendation(selection, state);
    expect(validation.proceed).toBe(true);
    expect(validation.validated_move).toBe('PIN');
    expect(validation.validated_family).toBe('elicitation');

    // Stage 2 build
    const intervention = buildIntervention(
      validation,
      'Sentinel, you have referenced open-source several times but never stated whether you support mandatory open-source requirements. Do you support or oppose them, and under what conditions?',
      selection.trigger_reasoning!,
      { signal: 'evasion', claim: 'claim-1', round: 3 },
    );
    expect(intervention.move).toBe('PIN');
    expect(intervention.family).toBe('elicitation');
    expect(intervention.force).toBe('interrogative');
    expect(intervention.burden).toBe(1.0);

    // BRIEF injection
    const brief = buildInterventionBriefInjection(intervention);
    expect(brief).toContain('pin_response');
    expect(brief).toContain('MUST include');

    // Simulate debater response compliance
    const compliant = checkInterventionCompliance('PIN', {
      pin_response: { position: 'conditional', condition: 'Only for safety-critical systems', brief_reason: 'General mandates stifle innovation' },
    });
    expect(compliant.compliant).toBe(true);

    // Non-compliant response
    const nonCompliant = checkInterventionCompliance('PIN', {});
    expect(nonCompliant.compliant).toBe(false);
    expect(nonCompliant.repair_hint).toContain('pin_response');

    // Update state
    updateModeratorState(state, intervention, validation, 4, 'exploration');
    expect(state.interventions_fired).toBe(1);
    expect(state.budget_remaining).toBe(state.budget_total - 1);
    expect(state.rounds_since_last_intervention).toBe(0);
    expect(state.last_target).toBe('sentinel');
    expect(state.burden_per_debater.sentinel).toBe(1.0);
    expect(state.intervention_history).toHaveLength(1);
  });

  it('suppresses intervention due to cooldown, then allows after waiting', () => {
    const state = initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']);
    state.phase = 'exploration';
    state.round = 4;
    state.rounds_since_last_intervention = 0;
    state.required_gap = 1;

    // Attempt intervention while in cooldown
    const selection: SelectionResult = {
      responder: 'cassandra',
      addressing: 'prometheus',
      focus_point: 'test',
      agreement_detected: false,
      intervene: true,
      suggested_move: 'PROBE',
      target_debater: 'cassandra',
      trigger_reasoning: 'test',
    };

    const v1 = validateRecommendation(selection, state);
    expect(v1.proceed).toBe(false);
    expect(v1.suppressed_reason).toBe('cooldown_active');

    // Track the cooldown block
    updateModeratorState(state, undefined, v1, 4, 'exploration');
    expect(state.cooldown_blocked_count).toBe(1);
    expect(state.rounds_since_last_intervention).toBe(1);

    // Next round — cooldown expired
    state.round = 5;
    const v2 = validateRecommendation(selection, state);
    expect(v2.proceed).toBe(true);
  });

  it('allows reconciliation through cooldown', () => {
    const state = initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']);
    state.phase = 'exploration';
    state.round = 5;
    state.rounds_since_last_intervention = 0;
    state.required_gap = 2;

    const selection: SelectionResult = {
      responder: 'sentinel',
      addressing: 'prometheus',
      focus_point: 'test',
      agreement_detected: false,
      intervene: true,
      suggested_move: 'ACKNOWLEDGE',
      target_debater: 'prometheus',
      trigger_reasoning: 'concession just occurred',
    };

    const v = validateRecommendation(selection, state);
    expect(v.proceed).toBe(true);
    expect(v.validated_move).toBe('ACKNOWLEDGE');
  });

  it('health score drives trajectory modifier', () => {
    const state = initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']);
    state.phase = 'exploration';

    // Simulate 3 rounds of declining health
    const sigs = [
      makeSignals({ engagement_depth: { targeted: 1, standalone: 0, ratio: 0.8 } }),
      makeSignals({ engagement_depth: { targeted: 1, standalone: 0, ratio: 0.6 } }),
      makeSignals({ engagement_depth: { targeted: 1, standalone: 0, ratio: 0.4 } }),
    ];

    const turnCounts = { prometheus: 3, sentinel: 3, cassandra: 3 };
    for (let i = 0; i < sigs.length; i++) {
      const health = computeDebateHealthScore(sigs.slice(0, i + 1), turnCounts, 5, 20);
      if (state.health_history.length > 0) {
        const prev = state.health_history[state.health_history.length - 1];
        health.trend = health.value - prev.value;
      }
      state.health_history.push(health);
      updateSliBreaches(health, state);

      const noInterventionValidation = {
        proceed: false as const,
        validated_move: 'PIN' as InterventionMove,
        validated_family: 'elicitation' as const,
        validated_target: 'prometheus' as const,
      };
      updateModeratorState(state, undefined, noInterventionValidation, i + 3, 'exploration');
    }

    // Health should have declined
    expect(state.health_history.length).toBe(3);
    expect(state.health_history[2].value).toBeLessThan(state.health_history[0].value);
    // Consecutive decline should be tracked (at least 1, depends on freeze)
    expect(state.consecutive_decline).toBeGreaterThanOrEqual(1);
  });
});

// ── Synthesis COMMIT automation pipeline ──────────────────

describe('synthesis COMMIT automation', () => {
  it('fires COMMIT for each debater in first-appearance order', () => {
    const state = initModeratorState(10, ['prometheus', 'sentinel', 'cassandra']);
    state.phase = 'synthesis';
    state.round = 9;
    state.rounds_since_last_intervention = 3;

    const trans = transcript('prometheus', 'sentinel', 'cassandra', 'prometheus', 'sentinel', 'cassandra');

    // Round 1: prometheus gets COMMIT
    const target1 = getSynthesisResponder(state, ['prometheus', 'sentinel', 'cassandra'], trans);
    expect(target1).toBe('prometheus');

    const sel1: SelectionResult = {
      responder: target1!,
      addressing: 'general',
      focus_point: 'Final commitment',
      agreement_detected: false,
      intervene: true,
      suggested_move: 'COMMIT',
      target_debater: target1!,
      trigger_reasoning: 'Automatic COMMIT in synthesis phase',
    };

    const v1 = validateRecommendation(sel1, state);
    expect(v1.proceed).toBe(true);
    expect(v1.validated_move).toBe('COMMIT');

    const int1 = buildIntervention(v1, 'Prometheus, provide your final commitment.', 'synthesis COMMIT', { signal: 'synthesis_phase', round: 9 });
    updateModeratorState(state, int1, v1, 9, 'synthesis');

    // COMMIT should NOT consume budget
    expect(state.interventions_fired).toBe(0);
    expect(state.budget_remaining).toBe(state.budget_total);

    // Round 2: sentinel gets COMMIT
    const target2 = getSynthesisResponder(state, ['prometheus', 'sentinel', 'cassandra'], trans);
    expect(target2).toBe('sentinel');

    const v2Result = validateRecommendation({
      ...sel1, responder: target2!, target_debater: target2!,
    } as SelectionResult, state);
    expect(v2Result.proceed).toBe(true);
    const int2 = buildIntervention(v2Result, 'Sentinel, provide your final commitment.', 'synthesis COMMIT', { signal: 'synthesis_phase', round: 10 });
    updateModeratorState(state, int2, v2Result, 10, 'synthesis');

    // Round 3: cassandra gets COMMIT
    const target3 = getSynthesisResponder(state, ['prometheus', 'sentinel', 'cassandra'], trans);
    expect(target3).toBe('cassandra');

    // After all committed
    const v3Result = validateRecommendation({
      ...sel1, responder: target3!, target_debater: target3!,
    } as SelectionResult, state);
    const int3 = buildIntervention(v3Result, 'Cassandra, provide your final commitment.', 'synthesis COMMIT', { signal: 'synthesis_phase', round: 11 });
    updateModeratorState(state, int3, v3Result, 11, 'synthesis');

    const target4 = getSynthesisResponder(state, ['prometheus', 'sentinel', 'cassandra'], trans);
    expect(target4).toBeNull();

    // Still no budget consumed
    expect(state.interventions_fired).toBe(0);
    expect(state.intervention_history).toHaveLength(3);
    expect(state.intervention_history.every(h => h.move === 'COMMIT')).toBe(true);
  });

  it('COMMIT compliance requires concessions, conditions, and sharpest_disagreements', () => {
    // Full commitment
    const full = checkInterventionCompliance('COMMIT', {
      commitment: {
        concessions: ['I concede that alignment research is underfunded'],
        conditions_for_change: ['If empirical evidence shows existential risk probability > 10%'],
        sharpest_disagreements: { sentinel: 'We fundamentally disagree on whether open-source helps or hurts safety' },
      },
    });
    expect(full.compliant).toBe(true);

    // Missing sub-fields
    const partial = checkInterventionCompliance('COMMIT', {
      commitment: { concessions: [] },
    });
    expect(partial.compliant).toBe(false);
    expect(partial.repair_hint).toContain('concessions');
    expect(partial.repair_hint).toContain('conditions_for_change');
  });

  it('COMMIT BRIEF injection includes commitment field requirement', () => {
    const intervention = buildIntervention(
      { proceed: true, validated_move: 'COMMIT', validated_family: 'synthesis', validated_target: 'prometheus' },
      'Prometheus, state your final position.',
      'synthesis phase',
      { signal: 'synthesis_phase', round: 9 },
    );
    const brief = buildInterventionBriefInjection(intervention);
    expect(brief).toContain('commitment');
    expect(brief).toContain('MUST include');
    expect(brief).toContain('concessions');
  });
});

// ── Multi-round simulation ────────────────────────────────

describe('multi-round simulation', () => {
  it('tracks full debate lifecycle through phases', () => {
    const state = initModeratorState(8, ['prometheus', 'sentinel', 'cassandra']);
    const phases: DebatePhase[] = [];
    const interventionLog: string[] = [];

    // Simulate 8 rounds
    for (let round = 1; round <= 8; round++) {
      let phase: DebatePhase;
      if (round <= 2) phase = 'thesis-antithesis';
      else if (round > 6) phase = 'synthesis';
      else phase = 'exploration';
      phases.push(phase);
      state.phase = phase;
      state.round = round;

      // Simulate health update
      const health = computeDebateHealthScore(
        [makeSignals({ engagement_depth: { targeted: 1, standalone: 0, ratio: 0.5 + round * 0.05 } })],
        { prometheus: round, sentinel: round, cassandra: round },
        round * 2,
        50,
      );
      state.health_history.push(health);
      updateSliBreaches(health, state);

      // Every other round, attempt an intervention
      if (round % 2 === 0 && phase === 'exploration') {
        const targets = ['prometheus', 'sentinel', 'cassandra'] as const;
        const target = targets[(round / 2 - 1) % 3];
        const moves: InterventionMove[] = ['PIN', 'PROBE', 'CHALLENGE'];
        const move = moves[(round / 2 - 1) % 3];

        const selection: SelectionResult = {
          responder: target,
          addressing: 'general',
          focus_point: `Round ${round} focus`,
          agreement_detected: false,
          intervene: true,
          suggested_move: move,
          target_debater: target,
          trigger_reasoning: `Round ${round} trigger`,
        };

        const validation = validateRecommendation(selection, state);
        if (validation.proceed) {
          const intervention = buildIntervention(validation, `R${round} text`, `R${round} reason`, { round });
          updateModeratorState(state, intervention, validation, round, phase);
          interventionLog.push(`R${round}: ${move} → ${target}`);
        } else {
          updateModeratorState(state, undefined, validation, round, phase);
          interventionLog.push(`R${round}: ${move} suppressed (${validation.suppressed_reason})`);
        }
      } else {
        const noOp = { proceed: false as const, validated_move: 'PIN' as InterventionMove, validated_family: 'elicitation' as const, validated_target: 'prometheus' as const };
        updateModeratorState(state, undefined, noOp, round, phase);
      }
    }

    // Verify phase progression
    expect(phases[0]).toBe('thesis-antithesis');
    expect(phases[2]).toBe('exploration');
    expect(phases[7]).toBe('synthesis');

    // Verify health history was tracked
    expect(state.health_history.length).toBe(8);

    // Verify budget was consumed (at most budget_total interventions)
    expect(state.interventions_fired).toBeLessThanOrEqual(state.budget_total);

    // Verify cooldown escalation happened if enough interventions fired
    if (state.interventions_fired >= 2) {
      expect(state.required_gap).toBe(2);
    }

    // Verify intervention history is coherent
    for (const h of state.intervention_history) {
      expect(h.round).toBeGreaterThanOrEqual(1);
      expect(h.round).toBeLessThanOrEqual(8);
      expect(h.burden).toBeGreaterThan(0);
    }
  });
});
