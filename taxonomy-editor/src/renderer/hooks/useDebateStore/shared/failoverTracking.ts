// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4044 (SO e/281#2; rules e/275#7-#8): per-turn failover tracking for debates the renderer runs.
// generateText now reports servedModel (t/4048), the registry id that actually answered. A session earns
// failover_tracking 'tracked' only while every speaker turn carried it. 'tracked' means FAILOVER-tracked,
// NOT provider-identity-verified: a provider silently substituting a model is the ai.model_identity
// flight-recorder event's job (t/3731), and providerReportedModel is deliberately not read (#3061).
//
// failover_untracked is the sticky latch. Once set it is never cleared, so a later observed turn cannot
// promote a session whose earlier turns went unobserved. Only this module and the store read it; the
// calibration gate reads failover_tracking alone.

import { AI_POVERS } from '@lib/debate/types';

/** The session fields this reads and writes. Structural, so it fits DebateSession. */
export interface FailoverTrackingState {
  failover_tracking?: 'tracked' | 'unavailable';
  failover_untracked?: boolean;
  speaker_model_failovers?: Record<string, string>;
  transcript?: ReadonlyArray<{ speaker: string }>;
}

/**
 * The session after one speaker turn. `requested` is the model the store asked for; `served` is the
 * generateText result's servedModel (undefined when the backend didn't report it). Returns the input
 * object unchanged when nothing changes, so callers can skip a store write.
 */
export function applyServedTurn<T extends FailoverTrackingState>(session: T, speaker: string, requested: string, served: string | undefined): T {
  if (served === undefined) {
    if (session.failover_untracked && session.failover_tracking === 'unavailable') return session;
    return { ...session, failover_untracked: true, failover_tracking: 'unavailable' };
  }
  let next = session;
  if (served !== requested && session.speaker_model_failovers?.[speaker] !== served) {
    // The engine's shape (debateEngine.ts): speaker → the model that actually answered. The gate
    // excludes any row carrying speaker_model_failovers.
    next = { ...next, speaker_model_failovers: { ...next.speaker_model_failovers, [speaker]: served } };
  }
  const tracking = next.failover_untracked ? 'unavailable' : 'tracked';
  return next.failover_tracking === tracking ? next : { ...next, failover_tracking: tracking };
}

const AI_SPEAKERS: ReadonlySet<string> = new Set(AI_POVERS);

/**
 * SO e/281#2 condition 1, applied on load: a session saved before per-turn tracking existed has speaker
 * turns nobody observed. If it has any speaker turn, isn't already tracked, and has no latch, set the
 * latch (history unknown) so a resumed run can never certify those turns. A session created by the new
 * code always has either 'tracked' or the latch once it has a turn, so this only catches older sessions.
 */
export function latchUnobservedHistory<T extends FailoverTrackingState>(session: T): T {
  if (session.failover_tracking === 'tracked' || session.failover_untracked) return session;
  const hasSpeakerTurn = (session.transcript ?? []).some(e => AI_SPEAKERS.has(e.speaker));
  return hasSpeakerTurn ? { ...session, failover_untracked: true, failover_tracking: 'unavailable' } : session;
}
