// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateSession, SpeakerId, PhaseState, PhaseTransitionConfig, ModeratorState } from '../types.js';
import { initModeratorState } from '../moderator.js';
import { initPhaseState } from '../phaseTransitions.js';

/**
 * Hydrates moderator state from the session on engine construction (t/3761).
 * Persisted by the explicit write-back at crossRespond.ts:1298 after each round.
 * _moderatorState is reassigned at crossRespond.ts:430 — do NOT rely on reference aliasing
 * to carry writes back to session.moderator_state.
 */
export function hydrateModeratorState(
  session: DebateSession,
  rounds: number,
  activePovers: SpeakerId[],
): ModeratorState {
  const state = session.moderator_state ?? initModeratorState(rounds, activePovers);
  if (!session.moderator_state) {
    session.moderator_state = state;
  }
  return state;
}

/**
 * Hydrates phase state from the session on engine construction (t/3761).
 * Also ensures session.adaptive_staging exists so crossRespond.ts can safely write phase_state back.
 * Without this guard, a session pre-dating adaptive staging passes the debateEngine.ts:531 gate
 * (which checks config + _phaseState, not session.adaptive_staging) and crashes on the write.
 */
export function hydratePhaseState(
  session: DebateSession,
  adaptiveConfig: PhaseTransitionConfig,
): PhaseState {
  if (!session.adaptive_staging) {
    // 'quick' is in DebatePacing but not in the session pacing union; safe to cast since
    // this path only runs in adaptive mode where pacing is always tight/moderate/thorough.
    session.adaptive_staging = { enabled: true, pacing: adaptiveConfig.pacing as 'tight' | 'moderate' | 'thorough' };
  }
  return session.adaptive_staging.phase_state ?? initPhaseState(adaptiveConfig);
}
