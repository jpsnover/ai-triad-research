// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Single source of truth for debate phase ordering. Shared by the t/194
// state-guard (store.ts — detects phase regression / transcript shrinkage after
// the fact) and the t/2326 load-guard (sessionSlice.loadDebate — refuses to apply
// a loaded snapshot that is behind the in-memory state). Keeping one PHASE_ORDER
// and one comparison keeps the two guards consistent.

export const PHASE_ORDER: Record<string, number> = {
  setup: 0,
  clarification: 1,
  'edit-claims': 2,
  opening: 3,
  debate: 4,
  closed: 5,
};

/** Ordinal for a phase, or -1 for an unknown/unordered phase. */
export function phaseIndex(phase: string): number {
  return PHASE_ORDER[phase] ?? -1;
}

/**
 * True when `current` is strictly AHEAD of `candidate` — applying `candidate` over
 * `current` would be a phase regression or a transcript shrinkage. This is the
 * load-side analog of the t/194 state-guard's two checks, combined: refuse the
 * apply if EITHER the candidate's phase is earlier OR its transcript is shorter.
 * Unknown phases (idx -1) never trigger a phase regression on their own.
 */
export function isStateAhead(
  current: { phase: string; transcript: unknown[] },
  candidate: { phase: string; transcript: unknown[] },
): boolean {
  const curPhaseIdx = phaseIndex(current.phase);
  const candPhaseIdx = phaseIndex(candidate.phase);
  const phaseRegression = curPhaseIdx >= 0 && candPhaseIdx >= 0 && candPhaseIdx < curPhaseIdx;
  const transcriptShrinkage = candidate.transcript.length < current.transcript.length;
  return phaseRegression || transcriptShrinkage;
}
