// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression guard for t/3760: a watch-only (user_is_pover: false), non-adaptive-staging
// debate (situations, conflicts) has no user to click "Cross-respond" again after each
// round. Before the fix, runInitialCrossRespondRounds's non-adaptive branch looped only
// `initialCrossRespondRounds` times (default 3) then returned, leaving every subsequent
// round waiting on a manual click. The fix raises that to a much higher ceiling
// (WATCH_ONLY_MAX_CROSS_RESPOND_ROUNDS) while keeping the branch's existing safety-exit
// checks (daily-limit pause / no transcript growth / no debater statement).
//
// Import the harness FIRST so its hoisted mocks register before the store graph.
import { describe, it, expect, vi } from 'vitest';
import { makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { loadProvisionalWeights } from '@lib/debate/phaseTransitions';

/** A pre-delivered opening entry for `speaker` (≥50 chars so the delivery-length guard passes). */
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

describe('runInitialCrossRespondRounds — watch-only non-adaptive ceiling (t/3760)', () => {
  it('keeps auto-invoking crossRespond well past the old 3-round cap when the transcript keeps growing', async () => {
    const session = makeSession({
      phase: 'opening',
      user_is_pover: false,
      active_povers: ['accelerationist', 'safetyist'],
      // adaptive_staging omitted — exercises the non-adaptive branch under test.
      transcript: [opening('o1', 'accelerationist'), opening('o2', 'safetyist')],
    });
    useDebateStore.setState({
      activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
      activeDebateId: session.id,
      initialCrossRespondRounds: 3, // old cap — the fix must not stop here
    });

    let callCount = 0;
    vi.spyOn(useDebateStore.getState(), 'crossRespond').mockImplementation(async () => {
      callCount++;
      // Simulate a real round: append a statement so the no-growth exit doesn't fire.
      const s = useDebateStore.getState();
      s.addTranscriptEntry({ type: 'statement', speaker: 'accelerationist', content: `round ${callCount} statement`, taxonomy_refs: [] });
    });

    await useDebateStore.getState().runOpeningStatements();

    // Must run well past the old 3-round cap — proves the ceiling was actually raised,
    // not merely renamed.
    expect(callCount).toBeGreaterThan(3);
  });

  it('still stops on the existing no-growth safety exit, not just the new ceiling', async () => {
    const session = makeSession({
      phase: 'opening',
      user_is_pover: false,
      active_povers: ['accelerationist', 'safetyist'],
      transcript: [opening('o1', 'accelerationist'), opening('o2', 'safetyist')],
    });
    useDebateStore.setState({
      activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
      activeDebateId: session.id,
      initialCrossRespondRounds: 3,
    });

    let callCount = 0;
    // No transcript growth on any call — the existing no-growth exit must still fire
    // after the first iteration, well short of the new ceiling.
    vi.spyOn(useDebateStore.getState(), 'crossRespond').mockImplementation(async () => { callCount++; });

    await useDebateStore.getState().runOpeningStatements();

    expect(callCount).toBe(1);
  });
});

describe('runInitialCrossRespondRounds — legacy adaptive_staging boolean coercion (t/3782)', () => {
  it('coerces adaptive_staging: true to {enabled:true, pacing:"moderate"} instead of falling to non-adaptive', async () => {
    vi.mocked(loadProvisionalWeights).mockReturnValue({
      pacing_presets: { moderate: { maxTotalRounds: 1, argumentationExit: 0.6, concludingExit: 0.7 } },
    } as unknown as ReturnType<typeof loadProvisionalWeights>);
    const session = makeSession({
      phase: 'opening',
      user_is_pover: false,
      active_povers: ['accelerationist', 'safetyist'],
      // Legacy shape written by SituationDebatePanel before its t/3782 fix.
      adaptive_staging: true as unknown as ReturnType<typeof makeSession>['adaptive_staging'],
      transcript: [opening('o1', 'accelerationist'), opening('o2', 'safetyist')],
    });
    useDebateStore.setState({
      activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
      activeDebateId: session.id,
    });

    vi.spyOn(useDebateStore.getState(), 'crossRespond').mockImplementation(async () => {
      const s = useDebateStore.getState();
      s.addTranscriptEntry({ type: 'statement', speaker: 'accelerationist', content: 'round statement', taxonomy_refs: [] });
    });

    await useDebateStore.getState().runOpeningStatements();

    const coerced = useDebateStore.getState().activeDebate?.adaptive_staging;
    expect(coerced).toEqual(expect.objectContaining({ enabled: true, pacing: 'moderate' }));
  });
});
