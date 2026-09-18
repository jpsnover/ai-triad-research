// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Deterministic intervention floor for the active moderator (t/3513).
//
// Interventions were LLM-only: the selection prompt returns `intervene`, and the engine merely
// validates. Since the June "intervention cost test" and the move to gemini-3.5-flash-lite as the
// default debate model, the moderator LLM returns `intervene: false` on every argumentation turn —
// 0 responsive interventions across all 46 Aug–Sep 2026 debates (606 in May). A new move added to
// the menu would share that fate.
//
// This module is the floor under the model's judgment: when the LLM declines but a MEASURED
// problem is present, the engine proposes the intervention itself. It never overrides an LLM
// recommendation, and its proposal still goes through validateRecommendation (budget, cooldown,
// phase, alternation) — so the engine cannot exceed the existing rate limits. deriveEngineTrigger
// is pure; the orchestration glue at the bottom records to the flight recorder.

import type { ConvergenceSignals } from './types/convergence.js';
import type { ModeratorState, UnansweredClaimEntry, InterventionMove, SelectionResult } from './types/moderator.js';
import type { DebatePhase, SpeakerId } from './types/phase.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';

export type EngineTriggerSignal = 'entrenchment' | 'unanswered_claim' | 'sli_breach';

export interface EngineTrigger {
  signal: EngineTriggerSignal;
  move: InterventionMove;
  target: SpeakerId;
  reasoning: string;
  evidence: { signal_name: string; observed_behavior: string; source_claim?: string; source_round?: number };
}

export interface EngineTriggerInput {
  phase: DebatePhase;
  /** The debater the moderator chose to speak next — the intervention precedes their turn. */
  responder: SpeakerId;
  convergenceSignals: ReadonlyArray<ConvergenceSignals>;
  unansweredLedger: ReadonlyArray<UnansweredClaimEntry>;
  modState: ModeratorState;
  /** Display label for a debater id, for the trigger text the stage-2 prompt receives. */
  labelOf: (id: string) => string;
}

/** Thresholds — stipulated; registered in metric-provenance-register.md (t/3513). */
export const ENGINE_TRIGGER = {
  /** Consecutive own turns with a missed concession (strong attacks, nothing conceded). */
  ENTRENCHMENT_CONSECUTIVE_MISSED: 2,
  /** Later debater turns an opponent's open ledger claim must survive before a PIN. */
  UNANSWERED_MIN_AGE_TURNS: 6,
} as const;

/** SLI components the floor acts on, and the move each one maps to. Balance/coverage are
 *  procedural and already well handled by selection; they stay LLM-only. */
const SLI_MOVES: Partial<Record<string, InterventionMove>> = {
  novelty: 'CHALLENGE',        // stagnation: the debate is repeating itself
  responsiveness: 'CHALLENGE', // strong attacks going unconceded, debate-wide
  engagement: 'PIN',           // debaters talking past each other instead of answering
};
const SLI_CONSECUTIVE = 2;

/** Phases where a responsive floor applies. Opening statements and concluding COMMITs are
 *  scripted elsewhere and must not be interrupted. */
const RESPONSIVE_PHASES: ReadonlySet<DebatePhase> = new Set(['confrontation', 'argumentation'] as DebatePhase[]);

/**
 * The engine's own intervention proposal for this turn, or null when nothing measured warrants
 * one. Priority: entrenchment of the next speaker, then their oldest aged unanswered opponent
 * claim, then a sustained debate-wide SLI breach.
 */
export function deriveEngineTrigger(input: EngineTriggerInput): EngineTrigger | null {
  if (!RESPONSIVE_PHASES.has(input.phase)) return null;
  const { responder, labelOf } = input;
  const who = labelOf(responder);

  // 1. Entrenchment — the next speaker faced strong attacks and conceded nothing, repeatedly.
  const own = input.convergenceSignals.filter(s => s.speaker === responder);
  const recent = own.slice(-ENGINE_TRIGGER.ENTRENCHMENT_CONSECUTIVE_MISSED);
  if (
    recent.length === ENGINE_TRIGGER.ENTRENCHMENT_CONSECUTIVE_MISSED
    && recent.every(s => s.concession_opportunity?.outcome === 'missed')
  ) {
    const attacks = recent.reduce((n, s) => n + (s.concession_opportunity?.strong_attacks_faced ?? 0), 0);
    return {
      signal: 'entrenchment',
      move: 'CHALLENGE',
      target: responder,
      reasoning: `${who} has faced ${attacks} strong attack(s) across their last ${recent.length} turns without conceding or answering them — the position is hardening rather than being defended.`,
      evidence: {
        signal_name: 'entrenchment',
        observed_behavior: `concession_opportunity.outcome = missed on ${recent.length} consecutive turns`,
        source_round: recent[0].round,
      },
    };
  }

  // 2. Aged unanswered claim — an opponent's strong claim nobody has engaged for several turns.
  const latestRound = input.convergenceSignals.reduce((m, s) => Math.max(m, s.round ?? 0), 0);
  const turnsSince = (round: number): number =>
    input.convergenceSignals.filter(s => (s.round ?? 0) > round).length;
  // A claim is pinned at most once: if the pinned debater still ignores it, repeating the same
  // PIN is the heavy-handed churn the June cost test was added to stop.
  const alreadyPinned = new Set(input.modState.engine_pinned_claims ?? []);
  const aged = input.unansweredLedger
    .filter(u => u.addressed_round == null && u.speaker !== responder && !alreadyPinned.has(u.claim_id))
    .filter(u => turnsSince(u.first_unanswered_round) >= ENGINE_TRIGGER.UNANSWERED_MIN_AGE_TURNS)
    .sort((a, b) => a.first_unanswered_round - b.first_unanswered_round || a.claim_id.localeCompare(b.claim_id));
  if (aged.length > 0) {
    const claim = aged[0];
    return {
      signal: 'unanswered_claim',
      move: 'PIN',
      target: responder,
      reasoning: `${labelOf(claim.speaker)}'s claim ${claim.claim_id} has gone unanswered for ${turnsSince(claim.first_unanswered_round)} debater turns. ${who} should answer it directly: "${claim.claim_text.slice(0, 200)}"`,
      evidence: {
        signal_name: 'unanswered_claim',
        observed_behavior: `open ledger entry since round ${claim.first_unanswered_round} (latest round ${latestRound})`,
        source_claim: claim.claim_id,
        source_round: claim.first_unanswered_round,
      },
    };
  }

  // 3. Sustained SLI breach — a debate-wide health component below its floor for 2+ turns.
  for (const [component, move] of Object.entries(SLI_MOVES)) {
    const count = input.modState.sli_consecutive_breaches?.[component] ?? 0;
    if (count >= SLI_CONSECUTIVE && move) {
      return {
        signal: 'sli_breach',
        move,
        target: responder,
        reasoning: `Debate ${component} has been below its floor for ${count} consecutive turns; ${who} should break the pattern this turn.`,
        evidence: { signal_name: `sli_${component}`, observed_behavior: `${component} below floor for ${count} consecutive turns` },
      };
    }
  }

  return null;
}

/** Responsive (non-COMMIT) interventions fired so far — the dormancy check's measure. */
export function countResponsiveInterventions(state: ModeratorState): number {
  return state.intervention_history.filter(h => h.move !== 'COMMIT').length;
}

// ── Orchestration glue (records to the flight recorder; the decision above stays pure) ──

export interface EngineFloorContext extends Omit<EngineTriggerInput, 'phase'> {
  round: number;
  phase: DebatePhase;
  moderatorMode?: string;
  dialecticalStyle?: string;
}

/**
 * When the moderator LLM declined, attach the engine's own proposal (if any) to the selection.
 * Never overrides an LLM recommendation; socratic/talmudic modes run their own
 * single-interlocutor structure and are left alone. The result still goes through
 * validateRecommendation in the caller.
 */
export function applyEngineFloor<T extends Partial<SelectionResult>>(selection: T, ctx: EngineFloorContext): T {
  if (selection.intervene) return selection;
  if (ctx.moderatorMode === 'socratic' || ctx.moderatorMode === 'talmudic' || ctx.dialecticalStyle === 'socratic') return selection;
  const trigger = deriveEngineTrigger(ctx);
  if (!trigger) return selection;
  getGlobalRecorder()?.record({
    type: 'debate.moderate', component: 'moderator-engine-floor', level: 'info',
    message: `Round ${ctx.round}: moderator declined; engine floor proposes ${trigger.move} → ${trigger.target} (${trigger.signal})`,
    data: { round: ctx.round, phase: ctx.phase, signal: trigger.signal, move: trigger.move, target: trigger.target, evidence: trigger.evidence },
  });
  return {
    ...selection,
    intervene: true,
    suggested_move: trigger.move,
    target_debater: trigger.target,
    trigger_reasoning: trigger.reasoning,
    trigger_evidence: trigger.evidence,
    trigger_source: 'engine',
  };
}

/** After a validated engine PIN, remember the claim so the floor never pins it again. */
export function recordEnginePin(selection: Partial<SelectionResult>, state: ModeratorState): void {
  const claimId = selection.trigger_evidence?.source_claim;
  if (selection.trigger_source === 'engine' && selection.trigger_evidence?.signal_name === 'unanswered_claim' && claimId) {
    state.engine_pinned_claims = [...(state.engine_pinned_claims ?? []), claimId];
  }
}

/**
 * Reaching the concluding phase with zero responsive interventions is how three months of a
 * silent moderator went unnoticed (t/3513). Warn once per debate.
 */
export function checkModeratorDormancy(state: ModeratorState, phase: DebatePhase): void {
  if (phase !== 'concluding' || state.dormancy_checked) return;
  state.dormancy_checked = true;
  if (countResponsiveInterventions(state) > 0) return;
  getGlobalRecorder()?.record({
    type: 'debate.moderate', component: 'moderator-dormancy', level: 'warn',
    message: 'Moderator made zero responsive interventions before the concluding phase',
    data: { rounds: state.round, argumentation_rounds: state.argumentation_rounds, budget_total: state.budget_total, cooldown_blocked: state.cooldown_blocked_count, health_samples: state.health_history.length },
  });
}
