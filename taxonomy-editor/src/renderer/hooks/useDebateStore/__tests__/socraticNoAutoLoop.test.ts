// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression guard for t/2536: a socratic debate has a single AI debater but
// `adaptive_staging.enabled === true` (step mode). Before the fix,
// runInitialCrossRespondRounds checked `adaptive?.enabled` but not `protocol_id`,
// so it entered the adaptive branch and fired crossRespond() — which requires ≥2
// AI debaters, bailed with "Need at least 2 AI debaters for cross-response", and
// stalled the debate after opening statements. The fix early-returns from the
// auto-loop when protocol_id === 'socratic' (socratic is user-driven: ask/probe/
// summarize). This test drives runOpeningStatements to completion (openings are
// pre-seeded so the idempotent opening loop skips generation and the flow reaches
// the auto-loop call site) and asserts crossRespond is NOT called for socratic.
//
// Import the harness FIRST so its hoisted mocks register before the store graph.
import { describe, it, expect, vi } from 'vitest';
import { makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { loadProvisionalWeights } from '@lib/debate/phaseTransitions';

/** A pre-delivered opening entry for `speaker` (≥50 chars so the delivery check passes). */
function opening(id: string, speaker: string) {
  return {
    id,
    timestamp: '2026-05-01T00:00:00.000Z',
    type: 'opening',
    speaker,
    content: `${speaker} opening statement — a sufficiently long body of prose to clear the delivery-length guard.`,
    taxonomy_refs: [] as string[],
  };
}

describe('runInitialCrossRespondRounds — socratic protocol guard (t/2536)', () => {
  it('does NOT fire crossRespond for a socratic debate even when adaptive_staging is enabled', async () => {
    // Real pacing presets so that WITHOUT the guard the auto-loop would proceed all
    // the way to crossRespond() (matching prod, where the loop then errors "Need at
    // least 2 AI debaters"). This makes the crossRespond assertion a faithful witness:
    // remove the guard and this test fails because crossRespond IS called — not
    // because of an incidental crash before the call site.
    vi.mocked(loadProvisionalWeights).mockReturnValue({
      pacing_presets: { moderate: { maxTotalRounds: 1, argumentationExit: 0.6, concludingExit: 0.7 } },
    } as unknown as ReturnType<typeof loadProvisionalWeights>);

    // Single AI debater + adaptive staging enabled = the exact socratic shape that
    // used to trip the "Need at least 2 AI debaters" error.
    const session = makeSession({
      phase: 'opening',
      protocol_id: 'socratic',
      active_povers: ['skeptic'],
      adaptive_staging: { enabled: true, pacing: 'moderate' },
      transcript: [opening('o1', 'skeptic')],
    });
    useDebateStore.setState({
      activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
      activeDebateId: session.id,
    });

    const crossRespondSpy = vi
      .spyOn(useDebateStore.getState(), 'crossRespond')
      .mockResolvedValue(undefined);

    await useDebateStore.getState().runOpeningStatements();

    // The auto-loop must not have run at all for socratic…
    expect(crossRespondSpy).not.toHaveBeenCalled();
    // …and no "Need at least 2 AI debaters" error leaked through.
    expect(useDebateStore.getState().debateError ?? '').not.toContain('at least 2');

    // Witness that the flow actually REACHED the guarded call site (not a vacuous
    // pass from an early bail): openings completed → phase advanced to 'debate'
    // and the "floor is open" marker was written just before the auto-loop call.
    const debate = useDebateStore.getState().activeDebate!;
    expect(debate.phase).toBe('debate');
    expect(debate.transcript.some(e => e.type === 'system' && e.content.includes('floor is open'))).toBe(true);
  });

  it('control: a non-socratic adaptive debate with ≥2 debaters DOES fire the auto-loop', async () => {
    // Proves the socratic assertion above is not vacuous: with the same setup minus
    // the socratic protocol_id, the guard is skipped and crossRespond IS called.
    vi.mocked(loadProvisionalWeights).mockReturnValue({
      pacing_presets: { moderate: { maxTotalRounds: 1, argumentationExit: 0.6, concludingExit: 0.7 } },
    } as unknown as ReturnType<typeof loadProvisionalWeights>);

    const session = makeSession({
      phase: 'opening',
      active_povers: ['accelerationist', 'safetyist'],
      adaptive_staging: { enabled: true, pacing: 'moderate' },
      transcript: [opening('o1', 'accelerationist'), opening('o2', 'safetyist')],
    });
    useDebateStore.setState({
      activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
      activeDebateId: session.id,
    });

    const crossRespondSpy = vi
      .spyOn(useDebateStore.getState(), 'crossRespond')
      .mockResolvedValue(undefined);

    await useDebateStore.getState().runOpeningStatements();

    expect(crossRespondSpy).toHaveBeenCalled();
  });
});
