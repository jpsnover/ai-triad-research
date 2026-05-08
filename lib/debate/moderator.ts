// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  SpeakerId,
  DebatePhase,
  InterventionFamily,
  InterventionMove,
  InteractionalForce,
  ModeratorState,
  ModeratorIntervention,
  SelectionResult,
  EngineValidationResult,
  DebateHealthScore,
  ConvergenceSignals,
  InterventionResponseFields,
} from './types.js';
import {
  MOVE_TO_FAMILY,
  MOVE_TO_FORCE,
  FAMILY_BURDEN_WEIGHT,
} from './types.js';

// ── Constants ──────────────────────────────────────────

const ALL_MOVES: InterventionMove[] = [
  'REDIRECT', 'BALANCE', 'SEQUENCE',
  'PIN', 'PROBE', 'CHALLENGE',
  'CLARIFY', 'CHECK', 'SUMMARIZE',
  'ACKNOWLEDGE', 'REVOICE',
  'META-REFLECT',
  'COMPRESS', 'COMMIT',
];

const PERSONA_PRIOR_MODIFIERS: Record<string, Partial<Record<InterventionMove, number>>> = {
  prometheus: { PIN: 0.85, PROBE: 0.85, COMPRESS: 1.15 },
  sentinel: { COMPRESS: 0.85, CHALLENGE: 1.2, ACKNOWLEDGE: 0.85 },
  cassandra: { BALANCE: 0.85, PIN: 1.3, ACKNOWLEDGE: 0.85 },
};

const DECAY_RATE = 0.15;

// High-value moves that directly improve debate quality cost 1/3 budget.
// Lower-value or routine moves cost full budget.
const MOVE_BUDGET_COST: Record<InterventionMove, number> = {
  PIN: 0.34,
  PROBE: 0.34,
  CHALLENGE: 0.34,
  REDIRECT: 0.34,
  CLARIFY: 0.34,
  CHECK: 0.34,
  BALANCE: 0.67,
  SEQUENCE: 0.67,
  SUMMARIZE: 1.0,
  ACKNOWLEDGE: 1.0,
  REVOICE: 1.0,
  'META-REFLECT': 0.34,
  COMPRESS: 1.0,
  COMMIT: 0,
};

const PHASE_ALLOWED_FAMILIES: Record<DebatePhase, Set<InterventionFamily>> = {
  'confrontation': new Set(['procedural', 'repair', 'reconciliation']),
  'argumentation': new Set(['procedural', 'elicitation', 'repair', 'reconciliation', 'reflection']),
  'concluding': new Set(['synthesis', 'reconciliation']),
};

const PHASE_SECONDARY_FAMILIES: Record<DebatePhase, Set<InterventionFamily>> = {
  'confrontation': new Set(),
  'argumentation': new Set(['synthesis']),
  'concluding': new Set(['repair']),
};

const DEFAULT_PRIORITY: InterventionMove[] = [
  'COMMIT', 'PIN', 'CHALLENGE', 'CHECK', 'ACKNOWLEDGE', 'REVOICE',
  'REDIRECT', 'PROBE', 'META-REFLECT', 'CLARIFY', 'BALANCE',
  'COMPRESS', 'SEQUENCE', 'SUMMARIZE',
];

const HEALTH_WEIGHTS = {
  engagement: 0.25,
  novelty: 0.25,
  responsiveness: 0.20,
  coverage: 0.15,
  balance: 0.15,
};

const SLI_FLOORS: Record<string, { floor: number; consecutive: number; family: InterventionFamily }> = {
  engagement: { floor: 0.25, consecutive: 2, family: 'elicitation' },
  novelty: { floor: 0.25, consecutive: 2, family: 'elicitation' },
  responsiveness: { floor: 0.15, consecutive: 2, family: 'elicitation' },
  coverage: { floor: 0.20, consecutive: 2, family: 'procedural' },
  balance: { floor: 0.30, consecutive: 2, family: 'procedural' },
};

const TRAJECTORY_MODIFIERS: Record<number, number> = {
  0: 1.0,
  1: 0.95,
  2: 0.85,
  3: 0.75,
};

// ── Response field mapping ─────────────────────────────

interface MoveResponseConfig {
  field: keyof InterventionResponseFields | null;
  hardCompliance: boolean;
  schema: string;
}

const MOVE_RESPONSE_CONFIG: Record<InterventionMove, MoveResponseConfig> = {
  PIN: {
    field: 'pin_response',
    hardCompliance: true,
    schema: '{ "position": "agree" | "disagree" | "conditional", "condition": "...", "brief_reason": "..." }',
  },
  PROBE: {
    field: 'probe_response',
    hardCompliance: true,
    schema: '{ "evidence_type": "empirical" | "precedent" | "theoretical" | "conceded_gap", "evidence": "...", "critical_question_addressed": "..." }',
  },
  CHALLENGE: {
    field: 'challenge_response',
    hardCompliance: true,
    schema: '{ "type": "evolved" | "consistent" | "conceded", "explanation": "..." }',
  },
  CLARIFY: {
    field: 'clarification',
    hardCompliance: true,
    schema: '{ "term": "...", "definition": "...", "example": "..." }',
  },
  CHECK: {
    field: 'check_response',
    hardCompliance: true,
    schema: '{ "understood_correctly": true | false, "actual_target": "...", "revised_response": "..." }',
  },
  REVOICE: {
    field: 'revoice_response',
    hardCompliance: true,
    schema: '{ "accurate": true | false, "correction": "..." }',
  },
  'META-REFLECT': {
    field: 'reflection',
    hardCompliance: true,
    schema: '{ "type": "crux" | "assumption_check" | "reasoning_audit", "crux_condition": "...", "assumption_examined": "...", "conclusion": "..." }',
  },
  COMPRESS: {
    field: 'compressed_thesis',
    hardCompliance: true,
    schema: '"single sentence, max 40 words"',
  },
  COMMIT: {
    field: 'commitment',
    hardCompliance: true,
    schema: '{ "concessions": [...], "conditions_for_change": [...], "sharpest_disagreements": { "opponent": "..." } }',
  },
  ACKNOWLEDGE: { field: null, hardCompliance: false, schema: '' },
  BALANCE: { field: null, hardCompliance: false, schema: '' },
  REDIRECT: { field: null, hardCompliance: false, schema: '' },
  SEQUENCE: { field: null, hardCompliance: false, schema: '' },
  SUMMARIZE: { field: null, hardCompliance: false, schema: '' },
};

// ── Initialization ─────────────────────────────────────

export function initModeratorState(totalRounds: number, activePovers: SpeakerId[]): ModeratorState {
  const argumentationRounds = Math.max(totalRounds - 3, 1);
  const burdenMap: Record<string, number> = {};
  const triggerMap: Record<string, Partial<Record<InterventionMove, number>>> = {};
  for (const p of activePovers) {
    burdenMap[p] = 0;
    triggerMap[p] = {};
  }

  return {
    interventions_fired: 0,
    budget_total: Math.ceil(argumentationRounds / 2.5),
    budget_remaining: Math.ceil(argumentationRounds / 2.5),
    rounds_since_last_intervention: 0,
    required_gap: 1,
    last_target: null,
    last_family: null,
    burden_per_debater: burdenMap,
    avg_burden: 0,
    persona_trigger_counts: triggerMap,
    health_history: [],
    consecutive_decline: 0,
    consecutive_rise: 0,
    trajectory_freeze_until: -1,
    sli_consecutive_breaches: {},
    phase: 'confrontation',
    round: 0,
    total_rounds: totalRounds,
    argumentation_rounds: argumentationRounds,
    intervention_history: [],
    cooldown_blocked_count: 0,
    budget_epoch: 0,
    refill_gap: 1,
  };
}

// ── Phase appropriateness ──────────────────────────────

export function isPhaseAppropriate(move: InterventionMove, phase: DebatePhase): boolean {
  // COMMIT only in concluding — checked first to prevent secondary-family leak
  if (move === 'COMMIT') return phase === 'concluding';

  const family = MOVE_TO_FAMILY[move];
  if (PHASE_ALLOWED_FAMILIES[phase].has(family)) return true;
  if (PHASE_SECONDARY_FAMILIES[phase].has(family)) return true;

  // META-REFLECT only in argumentation (rounds 4 through N-2, handled by caller)
  if (move === 'META-REFLECT' && phase === 'argumentation') return true;

  // Elicitation allowed in confrontation with restriction (only after round 2)
  if (family === 'elicitation' && phase === 'confrontation') return true;

  return false;
}

// ── Prerequisite graph ─────────────────────────────────

interface PrerequisiteResult {
  overridden_move: InterventionMove | null;
  reason: string | null;
}

export function applyPrerequisites(
  suggestedMove: InterventionMove,
  state: ModeratorState,
  concessionJustTaken: boolean,
  semanticDivergenceHigh: boolean,
  misunderstandingDetected: boolean,
): PrerequisiteResult {
  // P1: ACKNOWLEDGE concessions immediately (time-sensitive)
  if (concessionJustTaken && suggestedMove !== 'ACKNOWLEDGE') {
    return { overridden_move: 'ACKNOWLEDGE', reason: 'P1: concession just occurred — ACKNOWLEDGE before further pressure' };
  }

  // P2: REPAIR before ELICITATION when semantic divergence is high
  if (semanticDivergenceHigh && MOVE_TO_FAMILY[suggestedMove] === 'elicitation') {
    return { overridden_move: 'CLARIFY', reason: 'P2: semantic divergence — CLARIFY before elicitation' };
  }

  // P3: CHECK before CHALLENGE when misunderstanding detected
  if (misunderstandingDetected && suggestedMove === 'CHALLENGE') {
    return { overridden_move: 'CHECK', reason: 'P3: misunderstanding detected — CHECK before CHALLENGE' };
  }

  return { overridden_move: null, reason: null };
}

// ── Adaptive persona modifiers ─────────────────────────

export function adaptiveModifier(prior: number, observedTriggerCount: number): number {
  const decay = Math.pow(1 - DECAY_RATE, observedTriggerCount);
  return prior * decay + 1.0 * (1 - decay);
}

export function getPersonaModifier(debater: SpeakerId, move: InterventionMove, triggerCounts: Record<string, Partial<Record<InterventionMove, number>>>): number {
  const priors = PERSONA_PRIOR_MODIFIERS[debater];
  if (!priors) return 1.0;
  const prior = priors[move] ?? 1.0;
  if (prior === 1.0) return 1.0;
  const observed = triggerCounts[debater]?.[move] ?? 0;
  return adaptiveModifier(prior, observed);
}

// ── Trajectory modifier ────────────────────────────────

export function getTrajectoryModifier(state: ModeratorState): number {
  if (state.consecutive_rise >= 2) return 1.15;
  const decline = Math.min(state.consecutive_decline, 3);
  return TRAJECTORY_MODIFIERS[decline] ?? 0.75;
}

// ── SLI floor breach modifier ──────────────────────────

export function getSliModifier(family: InterventionFamily, state: ModeratorState): number {
  for (const [component, config] of Object.entries(SLI_FLOORS)) {
    if (config.family === family) {
      const breachCount = state.sli_consecutive_breaches[component] ?? 0;
      if (breachCount >= config.consecutive) return 0.75;
    }
  }
  return 1.0;
}

// ── Combined effective threshold ───────────────────────

export function computeEffectiveThreshold(
  baseThreshold: number,
  debater: SpeakerId,
  move: InterventionMove,
  state: ModeratorState,
): number {
  const personaMod = getPersonaModifier(debater, move, state.persona_trigger_counts);
  const trajectoryMod = getTrajectoryModifier(state);
  const family = MOVE_TO_FAMILY[move];
  const sliMod = getSliModifier(family, state);
  const combined = personaMod * trajectoryMod * sliMod;
  const clamped = Math.max(0.6, Math.min(1.4, combined));
  return baseThreshold * clamped;
}

// ── Debate Health Score ────────────────────────────────

export function computeDebateHealthScore(
  recentSignals: ConvergenceSignals[],
  turnCounts: Record<string, number>,
  citedNodeCount: number,
  relevantNodeCount: number,
): DebateHealthScore {
  const window = recentSignals.slice(-3);
  if (window.length === 0) {
    return {
      value: 1.0,
      trend: 0,
      consecutive_decline: 0,
      components: { engagement: 1.0, novelty: 1.0, responsiveness: 1.0, coverage: 1.0, balance: 1.0 },
    };
  }

  const engagement = window.reduce((sum, s) => sum + s.dialectical_engagement.ratio, 0) / window.length;
  const novelty = 1 - window.reduce((sum, s) => sum + s.argument_redundancy.avg_self_overlap, 0) / window.length;
  const concessionOpps = window.filter(s => s.concession_opportunity.outcome !== 'none');
  const responsiveness = concessionOpps.length > 0
    ? concessionOpps.filter(s => s.concession_opportunity.outcome === 'taken').length / concessionOpps.length
    : 1.0;
  const coverage = relevantNodeCount > 0 ? Math.min(citedNodeCount / relevantNodeCount, 1.0) : 1.0;

  const turns = Object.values(turnCounts);
  const totalTurns = turns.reduce((a, b) => a + b, 0);
  const maxTurns = Math.max(...turns, 0);
  const minTurns = Math.min(...turns, 0);
  const balance = totalTurns > 0 ? 1 - (maxTurns - minTurns) / totalTurns : 1.0;

  const value =
    engagement * HEALTH_WEIGHTS.engagement +
    novelty * HEALTH_WEIGHTS.novelty +
    responsiveness * HEALTH_WEIGHTS.responsiveness +
    coverage * HEALTH_WEIGHTS.coverage +
    balance * HEALTH_WEIGHTS.balance;

  return {
    value: Math.max(0, Math.min(1, value)),
    trend: 0, // set by caller from history
    consecutive_decline: 0, // managed by updateModeratorState
    components: {
      engagement: Math.max(0, Math.min(1, engagement)),
      novelty: Math.max(0, Math.min(1, novelty)),
      responsiveness: Math.max(0, Math.min(1, responsiveness)),
      coverage: Math.max(0, Math.min(1, coverage)),
      balance: Math.max(0, Math.min(1, balance)),
    },
  };
}

// ── SLI floor breach tracking ──────────────────────────

export function updateSliBreaches(health: DebateHealthScore, state: ModeratorState): void {
  for (const [component, config] of Object.entries(SLI_FLOORS)) {
    const value = health.components[component as keyof typeof health.components];
    if (value < config.floor) {
      state.sli_consecutive_breaches[component] = (state.sli_consecutive_breaches[component] ?? 0) + 1;
    } else {
      state.sli_consecutive_breaches[component] = 0;
    }
  }
}

// ── Validation ─────────────────────────────────────────

export function validateRecommendation(
  selection: SelectionResult,
  state: ModeratorState,
): EngineValidationResult {
  if (!selection.intervene || !selection.suggested_move || !selection.target_debater) {
    return {
      proceed: false,
      validated_move: selection.suggested_move ?? 'PIN',
      validated_family: MOVE_TO_FAMILY[selection.suggested_move ?? 'PIN'],
      validated_target: selection.target_debater ?? selection.responder,
      suppressed_reason: 'engine_override',
    };
  }

  const move = selection.suggested_move;
  if (!ALL_MOVES.includes(move)) {
    return suppress(move, selection.target_debater, 'engine_override');
  }

  const family = MOVE_TO_FAMILY[move];

  // Budget check with refill (COMMIT is off-budget)
  if (move !== 'COMMIT' && state.budget_remaining <= 0) {
    // Refill: grant a smaller budget with a longer cooldown gap
    state.budget_epoch = (state.budget_epoch ?? 0) + 1;
    const newBudget = Math.max(1, Math.ceil(state.budget_total / (1 + state.budget_epoch)));
    state.budget_remaining = newBudget;
    state.refill_gap = 1 + state.budget_epoch;
    state.required_gap = state.refill_gap;
  }

  // Cooldown check (Reconciliation and COMMIT exempt)
  if (family !== 'reconciliation' && move !== 'COMMIT' && state.rounds_since_last_intervention < state.required_gap) {
    return suppress(move, selection.target_debater, 'cooldown_active');
  }

  // Phase check
  if (!isPhaseAppropriate(move, state.phase)) {
    return suppress(move, selection.target_debater, 'phase_mismatch');
  }

  // P4: Block CHALLENGE in confrontation before round 4 — positions still being established
  if (move === 'CHALLENGE' && state.phase === 'confrontation' && state.round < 4) {
    return suppress(move, selection.target_debater, 'phase_mismatch');
  }

  // Same-debater consecutive rule (Reconciliation exempt)
  if (state.last_target === selection.target_debater && family !== 'reconciliation') {
    return suppress(move, selection.target_debater, 'same_debater_consecutive');
  }

  // Burden cap: debater with cumulative burden > 1.5× average blocks high-burden moves
  const debaterBurden = state.burden_per_debater[selection.target_debater] ?? 0;
  if (state.avg_burden > 0 && debaterBurden > state.avg_burden * 1.5 && FAMILY_BURDEN_WEIGHT[family] > 0.5) {
    return suppress(move, selection.target_debater, 'burden_cap');
  }

  return {
    proceed: true,
    validated_move: move,
    validated_family: family,
    validated_target: selection.target_debater,
  };
}

function suppress(move: InterventionMove, target: SpeakerId, reason: EngineValidationResult['suppressed_reason']): EngineValidationResult {
  return {
    proceed: false,
    validated_move: move,
    validated_family: MOVE_TO_FAMILY[move],
    validated_target: target,
    suppressed_reason: reason,
  };
}

// ── State updates ──────────────────────────────────────

export function updateModeratorState(
  state: ModeratorState,
  intervention: ModeratorIntervention | undefined,
  validation: EngineValidationResult,
  round: number,
  phase: DebatePhase,
): void {
  state.round = round;
  state.phase = phase;

  if (intervention) {
    const family = MOVE_TO_FAMILY[intervention.move];
    const isBudgeted = intervention.move !== 'COMMIT';

    if (isBudgeted) {
      state.interventions_fired++;
      const cost = MOVE_BUDGET_COST[intervention.move] ?? 1.0;
      state.budget_remaining = Math.max(0, state.budget_remaining - cost);
    }

    if (family !== 'reconciliation') {
      state.required_gap = 1;
    }

    state.rounds_since_last_intervention = 0;
    state.last_target = intervention.target_debater;
    state.last_family = family;

    // Burden tracking
    const burden = FAMILY_BURDEN_WEIGHT[family];
    state.burden_per_debater[intervention.target_debater] =
      (state.burden_per_debater[intervention.target_debater] ?? 0) + burden;
    const burdens = Object.values(state.burden_per_debater);
    state.avg_burden = burdens.reduce((a, b) => a + b, 0) / burdens.length;

    // Post-intervention trajectory freeze
    state.trajectory_freeze_until = round + 1;

    state.intervention_history.push({
      round,
      move: intervention.move,
      family,
      target: intervention.target_debater,
      burden,
    });
  } else {
    state.rounds_since_last_intervention++;
  }

  // Cooldown conflict tracking
  if (!validation.proceed && validation.suppressed_reason === 'cooldown_active') {
    state.cooldown_blocked_count++;
  }

  // Health trajectory
  if (state.health_history.length >= 2) {
    const curr = state.health_history[state.health_history.length - 1];
    const prev = state.health_history[state.health_history.length - 2];
    if (curr.value < prev.value) {
      if (round <= state.trajectory_freeze_until) {
        // Freeze active — hold consecutive_decline
      } else {
        state.consecutive_decline++;
      }
      state.consecutive_rise = 0;
    } else if (curr.value > prev.value) {
      state.consecutive_rise++;
      state.consecutive_decline = 0;
    } else {
      state.consecutive_decline = 0;
      state.consecutive_rise = 0;
    }
  }
}

// ── Trigger evaluation context ─────────────────────────

export interface TriggerEvaluationContext {
  round: number;
  phase: DebatePhase;
  budget_remaining: number;
  budget_total: number;
  cooldown_rounds_left: number;
  last_intervention_move: InterventionMove | null;
  last_intervention_family: InterventionFamily | null;
  last_intervention_target: SpeakerId | null;
  burden_per_debater: Record<string, number>;
  avg_burden: number;
  health_score: DebateHealthScore | null;
  trajectory_modifier: number;
  intervention_count: number;
  intervention_history_summary: string;
  turn_counts: Record<string, number>;
  sli_breaches: string[];
  budget_epoch: number;
  refill_gap: number;
  convergence_signal_count: number;
}

export function computeTriggerEvaluationContext(
  state: ModeratorState,
  turnCounts: Record<string, number>,
): TriggerEvaluationContext {
  const cooldownLeft = Math.max(0, state.required_gap - state.rounds_since_last_intervention);
  const lastHealth = state.health_history.length > 0
    ? state.health_history[state.health_history.length - 1]
    : null;

  const breaches: string[] = [];
  for (const [component, count] of Object.entries(state.sli_consecutive_breaches)) {
    const config = SLI_FLOORS[component];
    if (config && count >= config.consecutive) {
      breaches.push(`${component} (${count} consecutive turns below ${config.floor})`);
    }
  }

  const historySummary = state.intervention_history
    .slice(-5)
    .map(h => `R${h.round}: ${h.move} → ${h.target}`)
    .join('; ') || 'none';

  return {
    round: state.round,
    phase: state.phase,
    budget_remaining: state.budget_remaining,
    budget_total: state.budget_total,
    cooldown_rounds_left: cooldownLeft,
    last_intervention_move: state.intervention_history.length > 0
      ? state.intervention_history[state.intervention_history.length - 1].move
      : null,
    last_intervention_family: state.last_family,
    last_intervention_target: state.last_target,
    burden_per_debater: { ...state.burden_per_debater },
    avg_burden: state.avg_burden,
    health_score: lastHealth,
    trajectory_modifier: getTrajectoryModifier(state),
    intervention_count: state.interventions_fired,
    intervention_history_summary: historySummary,
    turn_counts: { ...turnCounts },
    sli_breaches: breaches,
    budget_epoch: state.budget_epoch ?? 0,
    refill_gap: state.refill_gap ?? 1,
    convergence_signal_count: state.health_history.length,
  };
}

export function formatTriggerContext(ctx: TriggerEvaluationContext): string {
  const lines: string[] = [
    `Round: ${ctx.round} | Phase: ${ctx.phase}`,
    `Budget: ${Number.isInteger(ctx.budget_remaining) ? ctx.budget_remaining : ctx.budget_remaining.toFixed(1)}/${ctx.budget_total} interventions remaining${ctx.budget_epoch ? ` (refill #${ctx.budget_epoch}, gap ${ctx.refill_gap})` : ''} — high-value moves (PIN, PROBE, CHALLENGE, REDIRECT, CLARIFY, CHECK, META-REFLECT) cost ⅓`,
    `Cooldown: ${ctx.cooldown_rounds_left > 0 ? `${ctx.cooldown_rounds_left} round(s) before next intervention allowed` : 'ready'}`,
  ];

  if (ctx.last_intervention_move) {
    lines.push(`Last intervention: ${ctx.last_intervention_move} (${ctx.last_intervention_family}) → ${ctx.last_intervention_target}`);
  }

  const burdenLines = Object.entries(ctx.burden_per_debater)
    .map(([d, b]) => `${d}: ${b.toFixed(2)}`)
    .join(', ');
  lines.push(`Burden: ${burdenLines} (avg: ${ctx.avg_burden.toFixed(2)})`);

  if (ctx.health_score && ctx.convergence_signal_count >= 3) {
    const h = ctx.health_score;
    lines.push(`Health: ${h.value.toFixed(2)} (engagement=${h.components.engagement.toFixed(2)}, novelty=${h.components.novelty.toFixed(2)}, responsiveness=${h.components.responsiveness.toFixed(2)}, coverage=${h.components.coverage.toFixed(2)}, balance=${h.components.balance.toFixed(2)})`);
    lines.push(`Trajectory: modifier=${ctx.trajectory_modifier.toFixed(2)}`);
  } else if (ctx.health_score) {
    lines.push(`Health: suppressed (${ctx.convergence_signal_count}/3 signals — too early to diagnose)`);
  }

  if (ctx.sli_breaches.length > 0) {
    lines.push(`SLI breaches: ${ctx.sli_breaches.join('; ')}`);
  }

  const turnLines = Object.entries(ctx.turn_counts)
    .map(([d, c]) => `${d}: ${c}`)
    .join(', ');
  lines.push(`Turn counts: ${turnLines}`);
  lines.push(`Intervention history: ${ctx.intervention_history_summary}`);

  return lines.join('\n');
}

// ── Build intervention from validated result ───────────

export function buildIntervention(
  validation: EngineValidationResult,
  text: string,
  triggerReason: string,
  sourceEvidence: ModeratorIntervention['source_evidence'],
  originalClaimText?: string,
): ModeratorIntervention {
  return {
    family: validation.validated_family,
    move: validation.validated_move,
    force: MOVE_TO_FORCE[validation.validated_move],
    burden: FAMILY_BURDEN_WEIGHT[validation.validated_family],
    target_debater: validation.validated_target,
    text,
    original_claim_text: originalClaimText,
    trigger_reason: triggerReason,
    prerequisite_applied: validation.prerequisite_applied,
    source_evidence: sourceEvidence,
  };
}

// ── BRIEF injection for debater ────────────────────────

const DIRECT_RESPONSE_PATTERNS: Record<InterventionMove, string> = {
  PIN: 'Your first paragraph MUST begin with "I agree that [restate the specific claim]" OR "I disagree that [restate the specific claim]" OR "I conditionally agree: [specific aspect you accept], but [specific aspect you reject]." Follow with ONE sentence of reasoning. Then a paragraph break before your substantive argument.',
  PROBE: 'Your first paragraph MUST begin with "The evidence is [type]: [specific citation or data point]." Follow with ONE sentence connecting the evidence to the claim. Then a paragraph break before your substantive argument.',
  CHALLENGE: 'Your first paragraph MUST begin with "My position has evolved: I now hold [X] instead of [Y] because [Z]" OR "My position is consistent: [X] and [Y] are compatible because [Z]" OR "I concede [what you concede] because [reason]." Then a paragraph break before your substantive argument.',
  CLARIFY: 'Your first paragraph MUST begin with "By \'[term]\' I mean [precise operational definition]." Follow with "For example, [one concrete real-world case]." Then a paragraph break before your substantive argument.',
  CHECK: 'Your first paragraph MUST begin with "I was responding to [opponent]\'s point about [specific claim]" OR "I was not responding to that point — the point I was addressing was [X]." Then a paragraph break before your substantive argument.',
  REVOICE: 'Your first paragraph MUST begin with "That restates my point accurately" OR "That restates my point inaccurately — what I actually meant was [correction]." Then a paragraph break before your substantive argument.',
  'META-REFLECT': 'Your first paragraph MUST begin with "I would change my position if [specific, falsifiable condition]" OR "The assumption we are all relying on without examining it is [X]." Then a paragraph break before your substantive argument.',
  COMPRESS: 'Your ENTIRE statement must be a single sentence of 40 words or fewer. No preamble, no qualification, no additional paragraphs. Just the core thesis.',
  COMMIT: 'Your first paragraph MUST state three things in three sentences: "I concede [X]." "I still hold [Y]." "I would change if [Z]." Then a paragraph break before elaboration.',
  REDIRECT: '',
  BALANCE: '',
  SEQUENCE: 'Structure your response with explicit numbered sections: "On [sub-topic 1]: [argument]. On [sub-topic 2]: [argument]."',
  ACKNOWLEDGE: '',
  SUMMARIZE: '',
};

export function buildInterventionBriefInjection(intervention: ModeratorIntervention, responderLabel?: string): string {
  const config = MOVE_RESPONSE_CONFIG[intervention.move];
  const targetLabel = intervention.target_debater;
  const isTargeted = !responderLabel || responderLabel.toLowerCase() === targetLabel.toLowerCase();
  const responsePattern = DIRECT_RESPONSE_PATTERNS[intervention.move] || '';

  if (!config.field) {
    return `\nMODERATOR INTERVENTION (this round):
The moderator has issued a ${intervention.move} [${intervention.family}] intervention${!isTargeted ? ` directed at ${targetLabel}` : ''}.

Moderator's text:
"${intervention.text}"

${!isTargeted
    ? `This intervention is directed at ${targetLabel}, not you. However, you must acknowledge it. Your first paragraph should briefly address the moderator's point as it relates to your position before continuing with your substantive argument.`
    : responsePattern
      ? `MANDATORY RESPONSE FORMAT:\n${responsePattern}`
      : 'Consider the moderator\'s guidance in your response.'}
`;
  }

  return `\nMODERATOR INTERVENTION (this round):
The moderator has issued a ${intervention.move} [${intervention.family}] intervention${!isTargeted ? ` directed at ${targetLabel}` : ''}.

Moderator's text:
"${intervention.text}"

${!isTargeted
    ? `This intervention is directed at ${targetLabel}, not you. However, you must acknowledge it. Your first paragraph should briefly address the moderator's point as it relates to your position (1-2 sentences) before continuing with your substantive argument. You do NOT need to include the \`${config.field}\` structured field since you are not the target.`
    : `MANDATORY RESPONSE FORMAT:
${responsePattern}

BREVITY RULE: The response paragraph must be SHORT — 2-3 sentences maximum. Do not hedge, qualify, or dilute your answer across multiple paragraphs. State your position, give one reason, then move on. The reader must know your answer from the first paragraph alone.

You MUST also include a \`${config.field}\` field in your response JSON.
Schema: ${config.schema}`}

After the response paragraph, continue with your substantive argument in separate paragraphs.
`;
}

// ── Compliance checking ────────────────────────────────

export interface ComplianceResult {
  compliant: boolean;
  missing_field?: string;
  repair_hint?: string;
}

export function checkInterventionCompliance(
  move: InterventionMove,
  responseFields: Record<string, unknown>,
): ComplianceResult {
  const config = MOVE_RESPONSE_CONFIG[move];
  if (!config.hardCompliance || !config.field) {
    return { compliant: true };
  }

  const field = config.field;
  const value = responseFields[field];

  if (value === undefined || value === null) {
    return {
      compliant: false,
      missing_field: field,
      repair_hint: `You must include a \`${field}\` field in your response to address the moderator's ${move} intervention. Schema: ${config.schema}`,
    };
  }

  // Move-specific substance checks
  if (move === 'PIN' && typeof value === 'object') {
    const pin = value as Record<string, unknown>;
    if (!pin.position) {
      return {
        compliant: false,
        missing_field: `${field}.position`,
        repair_hint: 'Your pin_response must include a "position" field (agree, disagree, or conditional).',
      };
    }
  }

  if (move === 'PROBE' && typeof value === 'object') {
    const probe = value as Record<string, unknown>;
    if (!probe.evidence || (typeof probe.evidence === 'string' && probe.evidence.trim().length === 0)) {
      return {
        compliant: false,
        missing_field: `${field}.evidence`,
        repair_hint: 'Your probe_response must include non-empty "evidence" — cite a specific study, dataset, or precedent.',
      };
    }
  }

  if (move === 'CLARIFY' && typeof value === 'object') {
    const clarify = value as Record<string, unknown>;
    if (!clarify.definition || (typeof clarify.definition === 'string' && clarify.definition.trim().length === 0)) {
      return {
        compliant: false,
        missing_field: `${field}.definition`,
        repair_hint: 'Your clarification must include a non-empty "definition" field with an operational definition.',
      };
    }
  }

  if (move === 'META-REFLECT' && typeof value === 'object') {
    const refl = value as Record<string, unknown>;
    if (!refl.conclusion || (typeof refl.conclusion === 'string' && refl.conclusion.trim().length === 0)) {
      return {
        compliant: false,
        missing_field: `${field}.conclusion`,
        repair_hint: 'Your reflection must include a non-empty "conclusion" field.',
      };
    }
  }

  if (move === 'COMPRESS' && typeof value === 'string') {
    const words = value.trim().split(/\s+/).length;
    if (words > 50) {
      return {
        compliant: false,
        missing_field: field,
        repair_hint: `Your compressed_thesis is ${words} words — it must be 50 words or fewer.`,
      };
    }
  }

  if (move === 'COMMIT' && typeof value === 'object') {
    const commit = value as Record<string, unknown>;
    if (!commit.concessions || !commit.conditions_for_change || !commit.sharpest_disagreements) {
      return {
        compliant: false,
        missing_field: field,
        repair_hint: 'Your commitment must include "concessions", "conditions_for_change", and "sharpest_disagreements" sub-fields.',
      };
    }
  }

  return { compliant: true };
}

// ── Response field name lookup ──────────────────────────

export function getResponseFieldForMove(move: InterventionMove): string | null {
  return MOVE_RESPONSE_CONFIG[move].field as string | null;
}

export function getMoveResponseConfig(move: InterventionMove): MoveResponseConfig {
  return MOVE_RESPONSE_CONFIG[move];
}

// ── Near-miss detection ────────────────────────────────

export interface NearMiss {
  move: InterventionMove;
  signal_value: number;
  effective_threshold: number;
  ratio: number;
}

export function detectNearMisses(
  _state: ModeratorState,
  _signalValues: Partial<Record<InterventionMove, number>>,
): NearMiss[] {
  // Near-miss detection compares each trigger's signal value against its effective
  // threshold and flags those at >= 80%. This is a placeholder for when signal
  // values are computed from convergence data.
  return [];
}

// ── Synthesis COMMIT automation ───────────────────────

export function getConcludingResponder(
  state: ModeratorState,
  activePovers: SpeakerId[],
  transcript: { speaker: string; type: string }[],
): SpeakerId | null {
  const committed = new Set(
    state.intervention_history
      .filter(h => h.move === 'COMMIT')
      .map(h => h.target),
  );
  const order: SpeakerId[] = [];
  const seen = new Set<string>();
  for (const e of transcript) {
    if (activePovers.includes(e.speaker as SpeakerId) && !seen.has(e.speaker)) {
      seen.add(e.speaker);
      order.push(e.speaker as SpeakerId);
    }
  }
  for (const p of activePovers) {
    if (!seen.has(p)) order.push(p);
  }
  for (const p of order) {
    if (!committed.has(p)) return p;
  }
  return null;
}

// ── Exports ────────────────────────────────────────────

export { ALL_MOVES, DEFAULT_PRIORITY, MOVE_RESPONSE_CONFIG, DIRECT_RESPONSE_PATTERNS, SLI_FLOORS, HEALTH_WEIGHTS };
