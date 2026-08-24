// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2907 — slot-first opening lifecycle. A speaker's opening is a SINGLE transcript
// card that mutates generating→retrying→done/error in place, instead of appending a
// new card + a `type:'system'` retry toast per attempt. Harness FIRST so its hoisted
// mocks (runOpeningPipeline, assembleOpeningPipelineResult, …) register before the store.
import { describe, it, expect, vi } from 'vitest';
import { makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runOpeningPipeline, assembleOpeningPipelineResult, getOpeningRepairHints } from '@lib/debate/turnPipeline';

type Entry = { id: string; type: string; speaker: string; content: string; status?: string; errorMessage?: string };
function transcript(): Entry[] {
  return (useDebateStore.getState().activeDebate?.transcript ?? []) as unknown as Entry[];
}
function setActive(session: ReturnType<typeof makeSession>): void {
  useDebateStore.setState({
    activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
    activeDebateId: session.id,
  });
}

describe('upsertTranscriptEntry / updateTranscriptEntry (t/2907 store primitives)', () => {
  it('upsert inserts one opening slot and is idempotent per speaker (no duplicate)', () => {
    setActive(makeSession({ phase: 'opening' }));
    const id1 = useDebateStore.getState().upsertTranscriptEntry({ type: 'opening', speaker: 'skeptic', status: 'generating', content: '', taxonomy_refs: [] });
    const id2 = useDebateStore.getState().upsertTranscriptEntry({ type: 'opening', speaker: 'skeptic', status: 'generating', content: '', taxonomy_refs: [] });
    expect(id2).toBe(id1); // same slot returned, not a second card
    expect(transcript().filter(e => e.type === 'opening' && e.speaker === 'skeptic')).toHaveLength(1);
  });

  it('update merges a patch into the target entry and preserves the others', () => {
    setActive(makeSession({ phase: 'opening' }));
    const id = useDebateStore.getState().upsertTranscriptEntry({ type: 'opening', speaker: 'safetyist', status: 'generating', content: '', taxonomy_refs: [] });
    useDebateStore.getState().addTranscriptEntry({ type: 'system', speaker: 'system', content: 'unrelated', taxonomy_refs: [] });
    useDebateStore.getState().updateTranscriptEntry(id, { status: 'done', content: 'the final opening statement' });
    const slot = transcript().find(e => e.id === id)!;
    expect(slot.status).toBe('done');
    expect(slot.content).toBe('the final opening statement');
    expect(transcript().find(e => e.content === 'unrelated')).toBeTruthy(); // other entry untouched
  });

  it('update is a no-op when the id is gone (debate switched mid-generation)', () => {
    setActive(makeSession({ phase: 'opening' }));
    const before = transcript().length;
    useDebateStore.getState().updateTranscriptEntry('does-not-exist', { status: 'error' });
    expect(transcript().length).toBe(before);
  });

  it('a full generating→retrying→done lifecycle stays ONE card with zero system toasts', () => {
    setActive(makeSession({ phase: 'opening' }));
    const id = useDebateStore.getState().upsertTranscriptEntry({ type: 'opening', speaker: 'accelerationist', status: 'generating', content: '', taxonomy_refs: [] });
    useDebateStore.getState().updateTranscriptEntry(id, { status: 'retrying', errorMessage: 'Accelerationist rate limited — retrying automatically…' });
    // second attempt reuses the same slot (upsert returns the existing id)
    expect(useDebateStore.getState().upsertTranscriptEntry({ type: 'opening', speaker: 'accelerationist', status: 'generating', content: '', taxonomy_refs: [] })).toBe(id);
    useDebateStore.getState().updateTranscriptEntry(id, { status: 'done', errorMessage: undefined, content: 'the accelerationist opening statement' });
    const openings = transcript().filter(e => e.type === 'opening' && e.speaker === 'accelerationist');
    expect(openings).toHaveLength(1);
    expect(openings[0].status).toBe('done');
    expect(openings[0].errorMessage).toBeUndefined();
    // No system retry-toast entries accumulated.
    expect(transcript().filter(e => e.type === 'system')).toHaveLength(0);
  });
});

describe('runOpeningStatements slot-first integration (t/2907)', () => {
  const LONG = 'This is a sufficiently long opening statement that clears the 50-character minimum guard.';

  it('success completes ONE opening slot to status:done with content, no system toast', async () => {
    vi.mocked(runOpeningPipeline).mockResolvedValue({ stage_diagnostics: [], total_time_ms: 1, draft: {}, topicAlignmentResult: null, qualityGateResult: null } as never);
    vi.mocked(getOpeningRepairHints).mockReturnValue([]);
    vi.mocked(assembleOpeningPipelineResult).mockReturnValue({ statement: LONG, taxonomyRefs: [], meta: { policy_refs: [] } } as never);
    setActive(makeSession({ active_povers: ['skeptic'], phase: 'opening' }));

    await useDebateStore.getState().runOpeningStatements();

    const openings = transcript().filter(e => e.type === 'opening' && e.speaker === 'skeptic');
    expect(openings).toHaveLength(1);
    expect(openings[0].status).toBe('done');
    expect(openings[0].content).toBe(LONG);
    // No opening-retry system-toast entries.
    expect(transcript().some(e => e.type === 'system' && /retry|failed to deliver/i.test(e.content))).toBe(false);
  });

  it('a non-retryable failure settles the speaker slot to status:error inline — no new card, no system toast', async () => {
    vi.mocked(getOpeningRepairHints).mockReturnValue([]);
    // A plain 400 is classified non-retryable → the pass ends without a backoff retry.
    vi.mocked(runOpeningPipeline).mockRejectedValue(Object.assign(new Error('HTTP 400 Bad Request'), { httpStatus: 400 }));
    setActive(makeSession({ active_povers: ['skeptic'], phase: 'opening' }));

    await useDebateStore.getState().runOpeningStatements();

    const openings = transcript().filter(e => e.type === 'opening' && e.speaker === 'skeptic');
    expect(openings).toHaveLength(1);              // exactly one card, not a second panel
    expect(openings[0].status).toBe('error');
    expect(openings[0].content).toBe('');          // no delivered content
    expect(openings[0].errorMessage).toBeTruthy(); // friendly message inline on the card
    // The failure lives on the card, not as a standalone system entry.
    expect(transcript().some(e => e.type === 'system' && /failed to deliver/i.test(e.content))).toBe(false);
    // Run-level banner still summarizes the partial failure.
    expect(useDebateStore.getState().debateError).toBeTruthy();
  });
});
