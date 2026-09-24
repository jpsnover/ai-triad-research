// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { getGlobalRecorder } from '@lib/flight-recorder/index';

interface ClarificationGuardStore {
  activeDebate: { id: string; user_is_pover: boolean; source_type: string } | null;
  updatePhase: (phase: 'clarification') => void;
  beginDebate: () => Promise<void>;
  runOpeningStatements: () => Promise<void>;
}

/**
 * Route a freshly-created debate into clarification or straight to opening (t/3629).
 *
 * The `clarification` phase exists for a PARTICIPATING user to refine a topic they're
 * about to argue — it waits for a user event (answer questions / "Skip — Start Debating")
 * via ClarificationPanel.tsx. A watch-only debate (`user_is_pover === false`) has no such
 * user, so entering clarification stalls forever: the debate sits at "REFINING · 0 turns"
 * and the AI debaters never speak (t/3629 — 3+ creation sites hit this independently).
 *
 * Call this immediately after createDebate()+loadDebate() instead of a bare
 * `updatePhase('clarification')` at every debate-creation site, so a new site can't
 * reintroduce the stall. Mirrors ClarificationPanel.tsx's proven-safe `handleExploreFirst`
 * sequence (beginDebate() + runOpeningStatements()) for the auto-start branch.
 *
 * `opts.refineOptIn` keeps refinement available as an explicit opt-in for a watcher who
 * wants to shape what they observe — they must not be *blocked* on it, but they may choose it.
 */
export async function enterClarificationOrBegin(
  get: () => ClarificationGuardStore,
  opts?: { refineOptIn?: boolean },
): Promise<void> {
  const debate = get().activeDebate;
  if (!debate) return;

  const shouldClarify = debate.user_is_pover || !!opts?.refineOptIn;

  // Observability (t/3629 AC #4): every entry point is marked with the facts that decided
  // it, so a future dump distinguishes "legitimately awaiting user refinement" from
  // "stalled watch-only" without having to re-derive it from surrounding events.
  getGlobalRecorder()?.record({
    type: 'debate.phase',
    component: 'debate-store',
    level: 'info',
    debate_id: debate.id,
    message: shouldClarify ? 'clarification.entered' : 'clarification.skipped-watch-only',
    data: { user_is_pover: debate.user_is_pover, source_type: debate.source_type, refine_opt_in: !!opts?.refineOptIn },
  });

  if (shouldClarify) {
    get().updatePhase('clarification');
    return;
  }

  await get().beginDebate();
  await get().runOpeningStatements();
}
