// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateSession, ModeratorState } from './types.js';

const MAX_CONVERGENCE_SIGNALS = 30;
const MAX_POSITION_DRIFT = 30;
const MAX_HEALTH_HISTORY = 20;
const MAX_TURN_EMBEDDINGS = 20;
const MAX_DIAGNOSTIC_ENTRIES = 15;

export function pruneSessionData(session: DebateSession): void {
  if (session.convergence_signals && session.convergence_signals.length > MAX_CONVERGENCE_SIGNALS) {
    session.convergence_signals = session.convergence_signals.slice(-MAX_CONVERGENCE_SIGNALS);
  }

  if (session.position_drift && session.position_drift.length > MAX_POSITION_DRIFT) {
    session.position_drift = session.position_drift.slice(-MAX_POSITION_DRIFT);
  }

  if (session.turn_embeddings) {
    const keys = Object.keys(session.turn_embeddings);
    if (keys.length > MAX_TURN_EMBEDDINGS) {
      const transcript = session.transcript;
      const recentIds = new Set(
        transcript
          .filter(e => e.type === 'statement' || e.type === 'opening')
          .slice(-MAX_TURN_EMBEDDINGS)
          .map(e => e.id),
      );
      for (const key of keys) {
        if (!recentIds.has(key)) {
          delete session.turn_embeddings[key];
        }
      }
    }
  }

  if (session.diagnostics && session.diagnostics.entries) {
    const entryIds = Object.keys(session.diagnostics.entries);
    if (entryIds.length > MAX_DIAGNOSTIC_ENTRIES) {
      const transcript = session.transcript;
      const recentIds = new Set(
        transcript.slice(-MAX_DIAGNOSTIC_ENTRIES).map(e => e.id),
      );
      for (const id of entryIds) {
        if (!recentIds.has(id)) {
          delete session.diagnostics.entries[id];
        }
      }
    }
  }
}

export function pruneModeratorState(state: ModeratorState): void {
  if (state.health_history.length > MAX_HEALTH_HISTORY) {
    state.health_history = state.health_history.slice(-MAX_HEALTH_HISTORY);
  }
}
