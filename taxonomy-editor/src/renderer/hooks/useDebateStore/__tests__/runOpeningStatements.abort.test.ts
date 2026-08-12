// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Negative assertion for the Switch-model abort fix (t/2505): when a run is superseded
// mid-pipeline (Switch-model restart aborts it and installs a fresh controller), the
// abandoned run must bail at the post-pipeline guard and write NO opening transcript
// entry after the interrupted-line — otherwise a duplicate/mixed-model opening lands.
// Import the harness FIRST so its hoisted mocks (incl. runOpeningPipeline) register
// before the store graph is imported.
import { describe, it, expect, vi } from 'vitest';
import { makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runOpeningPipeline } from '@lib/debate/turnPipeline';
import { newAbortController, cancelAndResetAbort } from '../shared/guards';

describe('runOpeningStatements — superseded run writes no opening (t/2505)', () => {
  it('does not write an opening transcript entry after being aborted during the pipeline', async () => {
    const session = makeSession({ active_povers: ['skeptic'], phase: 'opening' });
    useDebateStore.setState({
      activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
      activeDebateId: session.id,
    });

    // Simulate a Switch-model restart happening DURING the opening pipeline: abort this
    // run's captured controller, then install a fresh (un-aborted) one — exactly what
    // retryWithModel → runOpeningStatements does. With the captured-controller guard fix,
    // this run's isStillValid() must now return false and bail before writing an opening.
    vi.mocked(runOpeningPipeline).mockImplementation(async () => {
      cancelAndResetAbort();
      newAbortController();
      return {} as unknown as Awaited<ReturnType<typeof runOpeningPipeline>>;
    });

    await useDebateStore.getState().runOpeningStatements();

    const transcript = useDebateStore.getState().activeDebate?.transcript ?? [];

    // The superseded run must reach the post-pipeline guard, write its single "interrupted"
    // system marker, and bail. This entry is written ONLY on the isStillValid()-false path
    // (clarificationSlice.ts:993) — so asserting it is present makes this a real regression
    // guard: without the captured-controller fix, isStillValid() would return true (the live
    // global points at the fresh controller), the run would fall through to assemble an
    // opening, and this marker would never appear.
    const interrupted = transcript.filter(
      (e) => e.type === 'system' && typeof e.content === 'string' && e.content.includes('Opening generation interrupted'),
    );
    expect(interrupted).toHaveLength(1);

    // …and NO opening is written, and nothing follows the interrupted line (the TL's
    // negative assertion): the abandoned run does not produce a duplicate/mixed-model opening.
    expect(transcript.filter((e) => e.type === 'opening')).toHaveLength(0);
    expect(transcript[transcript.length - 1]).toBe(interrupted[0]);

    // Pipeline entered exactly once (aborted on the first speaker; the run bails, no re-loop).
    expect(vi.mocked(runOpeningPipeline)).toHaveBeenCalledTimes(1);
  });
});
