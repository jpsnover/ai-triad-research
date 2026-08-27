// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression for t/3053 (facet A): a transient 429 on moderator selection propagated straight
// to debate.ended(reason:'error') with no backoff, so the UI re-entered immediately → 3× in
// 130ms. runModeratorStep now backs off (MAX 2 / 2-min budget) and only ends on non-retryable
// or budget/cap exhaustion. These are the store-level arms TL required at merge (t/3053#3);
// t/3055 remains the separate FaultHarness gate.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runModeratorSelection, executeTurnWithRetry } from '@lib/debate/orchestration';
import { releaseDebateDriver } from '../shared/guards';

const mockRecords: Array<Record<string, unknown>> = [];
const mockRecord = vi.fn((event: Record<string, unknown>) => { mockRecords.push(event); });
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: mockRecord }) }));

const makeModResult = (speaker: string) => ({
  responder: speaker, focusPoint: 'f', addressing: 'all', agreementDetected: false,
  selectionResult: {}, intervention: null, interventionBriefInjection: '',
  modState: { budget_remaining: 10, budget_total: 10, health_history: [], consecutive_decline: 0, round: 1, phase: 'debate', required_gap: 2, rounds_since_last_intervention: 5, burden_per_debater: {} },
  healthScore: { value: 0.8, trend: 0, components: {} }, earlyReturn: false,
  diagnostics: { selectionPrompt: '', selectionResponse: '' },
});
const makeTurnResult = (speaker: string) => ({
  statement: `${speaker} response`, taxonomyRefs: [], meta: { move_types: ['CHALLENGE'], policy_refs: [] },
  validation: { outcome: 'accept', score: 0.9, repairHints: [], clarifies_taxonomy: [] },
  attempts: [{ statement: `${speaker} response`, score: 0.9 }],
  pipelineResult: { draft: {}, total_time_ms: 100, stage_diagnostics: [{ stage: 'draft', prompt: 'p', raw_response: 'r' }], topicAlignmentResult: null },
  aborted: false,
});
const rateLimit = (message: string, httpStatus = 429) => Object.assign(new Error(message), { httpStatus });
const endedErrors = () => mockRecords.filter(r => r.message === 'debate.ended' && (r.data as Record<string, unknown> | undefined)?.reason === 'error');

function seedDebate() {
  releaseDebateDriver();
  useDebateStore.setState({
    debateGenerating: null, debateError: null, debateProgress: null,
    activeDebate: makeSession({
      phase: 'debate', active_povers: ['accelerationist', 'safetyist', 'skeptic'],
      transcript: [
        { id: 'o1', timestamp: 't', type: 'opening', speaker: 'accelerationist', content: 'Opening A', taxonomy_refs: [] },
        { id: 'o2', timestamp: 't', type: 'opening', speaker: 'safetyist', content: 'Opening S', taxonomy_refs: [] },
        { id: 'o3', timestamp: 't', type: 'opening', speaker: 'skeptic', content: 'Opening K', taxonomy_refs: [] },
      ],
    } as never),
  } as never);
  mockRecords.length = 0;
}

describe('crossRespond moderator-selection 429 backoff (t/3053 facet A)', () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('429 then recover: backs off, retries after the cooldown, no debate.ended', async () => {
    vi.useFakeTimers();
    vi.mocked(runModeratorSelection)
      .mockRejectedValueOnce(rateLimit('Rate limited. Retry in 3s'))
      .mockResolvedValueOnce(makeModResult('accelerationist') as never);
    vi.mocked(executeTurnWithRetry).mockResolvedValue(makeTurnResult('accelerationist') as never);
    seedDebate();

    const pending = useDebateStore.getState().crossRespond();
    await vi.advanceTimersByTimeAsync(3200); // elapse the 3s cooldown → retry fires
    await pending;

    expect(vi.mocked(runModeratorSelection)).toHaveBeenCalledTimes(2); // failed once, retried once
    expect(endedErrors(), 'no debate.ended(reason:error) on a recovered 429').toHaveLength(0);
    expect(useDebateStore.getState().debateError, 'no failure banner after recovery').toBeNull();
  });

  it('cooldown beyond the 30s cap: terminal banner, never freezes (no sleep scheduled)', async () => {
    vi.useFakeTimers();
    vi.mocked(runModeratorSelection).mockRejectedValue(rateLimit('Retry in 60s')); // 60s > 30s cap
    seedDebate();

    // No timer advance: if a 60s sleep were scheduled this await would hang under fake timers.
    // Completing here IS the proof it fell through instead of freezing.
    await useDebateStore.getState().crossRespond();

    expect(vi.mocked(runModeratorSelection)).toHaveBeenCalledTimes(1); // no retry
    expect(useDebateStore.getState().debateError).toMatch(/Cross-respond selection failed/);
    expect(endedErrors()).toHaveLength(1);
  });

  it('non-retryable error: ends terminally exactly once, no retry', async () => {
    vi.useFakeTimers();
    vi.mocked(runModeratorSelection).mockRejectedValue(rateLimit('Bad request', 400));
    seedDebate();

    await useDebateStore.getState().crossRespond();

    expect(vi.mocked(runModeratorSelection)).toHaveBeenCalledTimes(1);
    expect(endedErrors()).toHaveLength(1);
    expect(useDebateStore.getState().debateError).toMatch(/Cross-respond selection failed/);
  });
});
