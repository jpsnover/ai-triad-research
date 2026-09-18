// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// h3 — opening narrative voicing in the app's renderer-orchestrated opening flow.
// Harness FIRST so its hoisted mocks register before the store.
import { describe, it, expect, vi } from 'vitest';
import { makeSession, mockApi } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runOpeningPipeline, assembleOpeningPipelineResult, getOpeningRepairHints } from '@lib/debate/turnPipeline';
import type { OpeningPipelineInput } from '@lib/debate/turnPipeline';
import type { NarrativeVoicing } from '@lib/debate/types';

const LONG = 'This is a sufficiently long opening statement that clears the 50-character minimum guard.';
const VOICING = JSON.stringify({
  narratives: ['skeptic', 'safetyist'].map(p => ({
    pov: p, fears_losing: 'f', history_carried: 'h', narrative: `If I were a ${p}, I would remember.`,
  })),
});

function setActive(overrides: Record<string, unknown>): void {
  const session = makeSession({ active_povers: ['skeptic', 'safetyist'], phase: 'opening', ...overrides });
  useDebateStore.setState({
    activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
    activeDebateId: session.id,
    // Scope to the opening phase: don't auto-run cross-respond rounds afterwards.
    initialCrossRespondRounds: 0,
  });
}

function arrange(): void {
  mockApi.generateText.mockImplementation(async (prompt: string) =>
    ({ text: prompt === 'mock-narrative-voicing-prompt' ? VOICING : '{}' }));
  mockApi.computeEmbeddings.mockImplementation(async (texts: string[]) =>
    ({ vectors: texts.map(() => [1, 0]) }));
  vi.mocked(getOpeningRepairHints).mockReturnValue([]);
  vi.mocked(runOpeningPipeline).mockImplementation(async (input: OpeningPipelineInput) => ({
    stage_diagnostics: [], total_time_ms: 1, topicAlignmentResult: null, qualityGateResult: null,
    draft: input.pov === 'skeptic'
      ? { narrative_check: { verdict: 'amend', amendment: 'We also remember the last hype cycle.' } }
      : { narrative_check: { verdict: 'affirm', amendment: '' } },
  }) as never);
  vi.mocked(assembleOpeningPipelineResult).mockReturnValue({ statement: LONG, taxonomyRefs: [], meta: { policy_refs: [] } } as never);
}

function voicing(): NarrativeVoicing | undefined {
  return useDebateStore.getState().activeDebate?.narrative_voicing;
}

describe('runOpeningStatements with narrative voicing (h3)', () => {
  it('flag on: moderator voices every camp before the openings and each debater sees it', async () => {
    arrange();
    setActive({ narrative_voicing_enabled: true });

    await useDebateStore.getState().runOpeningStatements();

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    const voicingIdx = transcript.findIndex(e => e.speaker === 'moderator' && e.metadata?.kind === 'narrative_voicing');
    const firstOpeningIdx = transcript.findIndex(e => e.type === 'opening');
    expect(voicingIdx).toBeGreaterThanOrEqual(0);
    expect(transcript[voicingIdx].type).toBe('system');
    expect(voicingIdx).toBeLessThan(firstOpeningIdx);
    expect(voicing()?.entry_id).toBe(transcript[voicingIdx].id);

    const inputs = vi.mocked(runOpeningPipeline).mock.calls.map(c => c[0]);
    expect(inputs.find(i => i.pov === 'skeptic')?.narrativeVoicing).toContain('YOUR camp (Skeptic)');
    expect(inputs.find(i => i.pov === 'safetyist')?.narrativeVoicing).toContain('YOUR camp (Safetyist)');
  });

  it('records each debater\'s check and scores the openings against the (amended) reference', async () => {
    arrange();
    setActive({ narrative_voicing_enabled: true });

    await useDebateStore.getState().runOpeningStatements();

    const v = voicing()!;
    expect(v.narratives.find(n => n.speaker === 'skeptic')?.acknowledgment)
      .toEqual({ verdict: 'amend', amendment: 'We also remember the last hype cycle.' });
    expect(v.narratives.find(n => n.speaker === 'safetyist')?.acknowledgment).toEqual({ verdict: 'affirm' });
    // The skeptic's reference embeds its amendment.
    expect(mockApi.computeEmbeddings.mock.calls[0][0]).toContain('If I were a skeptic, I would remember. We also remember the last hype cycle.');
    expect(v.narratives.every(n => n.embedding?.length === 2)).toBe(true);

    const openingIds = useDebateStore.getState().activeDebate!.transcript.filter(e => e.type === 'opening').map(e => e.id);
    expect(Object.keys(v.similarity_series ?? {}).sort()).toEqual([...openingIds].sort());
  });

  it('flag off: no voicing call, no moderator entry, prompts unchanged', async () => {
    arrange();
    setActive({});

    await useDebateStore.getState().runOpeningStatements();

    expect(mockApi.generateText.mock.calls.some(c => c[0] === 'mock-narrative-voicing-prompt')).toBe(false);
    expect(useDebateStore.getState().activeDebate!.transcript.some(e => e.speaker === 'moderator')).toBe(false);
    expect(voicing()).toBeUndefined();
    expect(vi.mocked(runOpeningPipeline).mock.calls.every(c => c[0].narrativeVoicing === undefined)).toBe(true);
  });

  it('an unusable voicing response still lets the openings run', async () => {
    arrange();
    mockApi.generateText.mockResolvedValue({ text: 'not json' });
    setActive({ narrative_voicing_enabled: true });

    await useDebateStore.getState().runOpeningStatements();

    expect(voicing()).toBeUndefined();
    expect(useDebateStore.getState().debateWarnings.some(w => /narrative voicing/i.test(w))).toBe(true);
    const openings = useDebateStore.getState().activeDebate!.transcript.filter(e => e.type === 'opening');
    expect(openings).toHaveLength(2);
    expect(openings.every(o => o.status === 'done')).toBe(true);
  });
});
