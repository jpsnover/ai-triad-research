// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3767 prevention test: debate must accumulate COMMIT interventions across run_ids
// (process boundaries) and transition to closure only after all 3 povers receive COMMIT.
//
// Failure class: per-run_id state reset silently clears accumulated condition.
// Root cause of t/3761: DebateEngine always fresh-inited _moderatorState, discarding
// prior runs' COMMIT history stored in session.moderator_state.intervention_history.
// Fix (t/3761): hydrateModeratorState reads from session if moderator_state is present.
//
// Tests MUST span multiple simulated run_ids — a single-run_id test would not catch the bug.

import { describe, it, expect } from 'vitest';
import { hydrateModeratorState } from './hydrateState.js';
import { initModeratorState, getConcludingResponder } from '../moderator.js';
import type { DebateSession, ModeratorState } from '../types.js';

const ACTIVE_POVERS = ['acc', 'saf', 'skp'] as const;
type Pover = typeof ACTIVE_POVERS[number];

// Minimal DebateSession shape for hydration tests — only moderator_state matters
function makeSession(interventionHistory: ModeratorState['intervention_history']): DebateSession {
  const base = initModeratorState(8, ACTIVE_POVERS as unknown as string[]);
  return {
    moderator_state: { ...base, phase: 'concluding', intervention_history: interventionHistory },
  } as unknown as DebateSession;
}

function commitEntry(target: Pover, round: number): ModeratorState['intervention_history'][number] {
  return { round, move: 'COMMIT', family: 'reconciliation', target, burden: 0 };
}

// Empty transcript: getConcludingResponder falls back to activePovers order
const EMPTY_TRANSCRIPT: { speaker: string; type: string }[] = [];

describe('cross-run COMMIT accumulation — t/3767 prevention', () => {
  it('hydrateModeratorState preserves prior-run COMMIT history from session', () => {
    // Simulate: run_id 1 committed acc and saf; session was saved
    const session = makeSession([
      commitEntry('acc', 5),
      commitEntry('saf', 6),
    ]);

    // Simulate: engine construction for run_id 2 (new run, same session)
    const state = hydrateModeratorState(
      session,
      8,
      ACTIVE_POVERS as unknown as string[],
    );

    // State must carry the prior-run history, not start fresh
    expect(state.intervention_history).toHaveLength(2);
    expect(state.intervention_history[0].target).toBe('acc');
    expect(state.intervention_history[1].target).toBe('saf');
  });

  it('getConcludingResponder returns remaining pover (skp) after acc+saf committed in prior runs', () => {
    const session = makeSession([
      commitEntry('acc', 5),
      commitEntry('saf', 6),
    ]);

    const state = hydrateModeratorState(
      session,
      8,
      ACTIVE_POVERS as unknown as string[],
    );

    const next = getConcludingResponder(
      state,
      ACTIVE_POVERS as unknown as string[],
      EMPTY_TRANSCRIPT,
    );

    expect(next).toBe('skp');
  });

  it('getConcludingResponder returns null (closure eligible) after all 3 povers committed across runs', () => {
    const session = makeSession([
      commitEntry('acc', 5),
      commitEntry('saf', 6),
    ]);

    const state = hydrateModeratorState(
      session,
      8,
      ACTIVE_POVERS as unknown as string[],
    );

    // Simulate run_id 2 firing the COMMIT for skp
    state.intervention_history.push(commitEntry('skp', 7));

    const result = getConcludingResponder(
      state,
      ACTIVE_POVERS as unknown as string[],
      EMPTY_TRANSCRIPT,
    );

    expect(result).toBeNull();
  });

  it('regression guard: fresh-init (the bug) loses prior-run COMMITs and re-selects acc', () => {
    const session = makeSession([
      commitEntry('acc', 5),
      commitEntry('saf', 6),
    ]);

    // Simulate the bug: fresh-init ignores session.moderator_state
    const freshState = initModeratorState(8, ACTIVE_POVERS as unknown as string[]);
    void session; // session is unused — the bug is that we never read it

    const buggyNext = getConcludingResponder(
      freshState,
      ACTIVE_POVERS as unknown as string[],
      EMPTY_TRANSCRIPT,
    );

    // Bug: fresh state has no history → acc is selected again instead of skp
    expect(buggyNext).toBe('acc');
    expect(buggyNext).not.toBe('skp');
  });
});
