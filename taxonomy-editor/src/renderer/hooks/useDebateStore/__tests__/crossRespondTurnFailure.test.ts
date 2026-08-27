// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression for t/3053 (facet B): the crossRespond pipeline-failure path appended a NEW
// system "…failed to cross-respond…" entry on every retry — the S6→S7 duplicate markers
// jsnover saw. It now keeps ONE idempotent marker per round (metadata.turn_failure + round),
// matched ANYWHERE in the transcript (not trailing-only) and updated in place on re-failure.
import { describe, it, expect, vi } from 'vitest';
import { makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runModeratorSelection, executeTurnWithRetry } from '@lib/debate/orchestration';
import { releaseDebateDriver } from '../shared/guards';

const makeModResult = (speaker: string) => ({
  responder: speaker,
  focusPoint: 'test focus',
  addressing: 'all',
  agreementDetected: false,
  selectionResult: {},
  intervention: null,
  interventionBriefInjection: '',
  modState: {
    budget_remaining: 10, budget_total: 10, health_history: [],
    consecutive_decline: 0, round: 1, phase: 'debate', required_gap: 2,
    rounds_since_last_intervention: 5, burden_per_debater: {},
  },
  healthScore: { value: 0.8, trend: 0, components: {} },
  earlyReturn: false,
  diagnostics: { selectionPrompt: '', selectionResponse: '' },
});

function turnFailureEntries() {
  return (useDebateStore.getState().activeDebate?.transcript ?? []).filter(
    e => e.type === 'system'
      && (e.metadata as Record<string, unknown> | undefined)?.turn_failure === true
      && (e.metadata as Record<string, unknown> | undefined)?.round === 1,
  );
}

describe('crossRespond turn-failure marker is idempotent per round (t/3053 facet B)', () => {
  it('updates the existing round-1 marker in place instead of appending a second', async () => {
    releaseDebateDriver();
    vi.mocked(runModeratorSelection).mockResolvedValue(makeModResult('accelerationist') as never);
    // Force the turn pipeline to fail → crossRespond hits the pipeline catch (the facet-B path).
    vi.mocked(executeTurnWithRetry).mockRejectedValue(new Error('pipeline boom'));

    useDebateStore.setState({
      debateGenerating: null, debateError: null,
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist', 'safetyist', 'skeptic'],
        transcript: [
          { id: 'o1', timestamp: 't', type: 'opening', speaker: 'accelerationist', content: 'Opening A', taxonomy_refs: [] },
          { id: 'o2', timestamp: 't', type: 'opening', speaker: 'safetyist', content: 'Opening S', taxonomy_refs: [] },
          { id: 'o3', timestamp: 't', type: 'opening', speaker: 'skeptic', content: 'Opening K', taxonomy_refs: [] },
          // A pre-existing round-1 failure marker from an earlier retry…
          { id: 'tf1', timestamp: 't', type: 'system', speaker: 'system', content: 'OLD failure text', taxonomy_refs: [], metadata: { turn_failure: true, round: 1 } },
          // …followed by an unrelated system entry, so the marker is NOT the trailing entry
          // (proves the dedupe matches anywhere, not just the last entry).
          { id: 'note', timestamp: 't', type: 'system', speaker: 'system', content: 'some later note', taxonomy_refs: [] },
        ],
      } as never),
    } as never);

    await useDebateStore.getState().crossRespond();

    const markers = turnFailureEntries();
    expect(markers, 'exactly one round-1 turn-failure marker (updated, not duplicated)').toHaveLength(1);
    expect(markers[0].id, 'the existing marker was reused').toBe('tf1');
    expect(markers[0].content, 'the marker content was refreshed').not.toBe('OLD failure text');
    expect(markers[0].content).toMatch(/failed to cross-respond/i);
    // The unrelated trailing system entry is untouched.
    const note = useDebateStore.getState().activeDebate?.transcript.find(e => e.id === 'note');
    expect(note?.content).toBe('some later note');
  });
});
