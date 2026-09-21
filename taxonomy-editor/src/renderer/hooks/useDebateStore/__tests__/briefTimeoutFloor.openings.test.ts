// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3518 (reopened): the opening flow is orchestrated twice — engine phases/opening.ts and
// this slice's own runOpeningStatements. #2245/#2249 fixed the engine path with
// openingBriefTimeoutFloor(model), but the renderer's pipelineInput construction (the path
// live debates actually use) never got briefTimeoutMs at all, so DEFAULT_BRIEF_TIMEOUT_MS
// (60s) silently applied regardless of model — the exact escape that reopened this ticket.
// These tests assert briefTimeoutMs on the ACTUAL runOpeningPipeline call args, not just
// that the helper exists, so a future regression here fails loudly instead of silently.
//
// Phase 2: openingBriefTimeoutFloor is retired — clarificationSlice.ts now computes
// briefTimeoutMs via Math.max(120_000, getModelMinTimeout(model, registry)), reading the
// real bundled ai-models.json (minTimeoutMs: 300_000 on fable/opus/sonnet-5). Assertions
// below use the literal expected values instead of calling a helper that no longer exists.
// Harness FIRST so its hoisted mocks register before the store.
import { describe, it, expect, vi } from 'vitest';
import { makeSession, mockApi } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runOpeningPipeline, assembleOpeningPipelineResult, getOpeningRepairHints } from '@lib/debate/turnPipeline';
import type { OpeningPipelineInput } from '@lib/debate/turnPipeline';

const LONG = 'This is a sufficiently long opening statement that clears the 50-character minimum guard.';

function setActive(overrides: Record<string, unknown>): void {
  const session = makeSession({ active_povers: ['skeptic'], phase: 'opening', ...overrides });
  useDebateStore.setState({
    activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
    activeDebateId: session.id,
    initialCrossRespondRounds: 0,
  });
}

function arrange(): void {
  mockApi.generateText.mockResolvedValue({ text: '{}' });
  vi.mocked(getOpeningRepairHints).mockReturnValue([]);
  vi.mocked(runOpeningPipeline).mockResolvedValue({
    stage_diagnostics: [], total_time_ms: 1, topicAlignmentResult: null, qualityGateResult: null,
  } as never);
  vi.mocked(assembleOpeningPipelineResult).mockReturnValue({ statement: LONG, taxonomyRefs: [], meta: { policy_refs: [] } } as never);
}

function inputs(): OpeningPipelineInput[] {
  return vi.mocked(runOpeningPipeline).mock.calls.map(c => c[0]);
}

describe('runOpeningStatements — briefTimeoutMs on the live pipelineInput (t/3518 reopened)', () => {
  it('a slow-model brief (fable) gets the 300s floor, not the 60s default', async () => {
    arrange();
    setActive({ stage_models: { brief: 'claude-fable-5' } });

    await useDebateStore.getState().runOpeningStatements();

    expect(inputs()).toHaveLength(1);
    expect(inputs()[0].briefTimeoutMs).toBe(300_000);
  });

  it('an opus brief also gets the 300s floor', async () => {
    arrange();
    setActive({ stage_models: { brief: 'claude-opus-5' } });

    await useDebateStore.getState().runOpeningStatements();

    expect(inputs()[0].briefTimeoutMs).toBe(300_000);
  });

  it('a non-flagship brief gets the 120s floor, still well above the 60s default', async () => {
    arrange();
    setActive({ stage_models: { brief: 'claude-haiku-4-5' } });

    await useDebateStore.getState().runOpeningStatements();

    expect(inputs()[0].briefTimeoutMs).toBe(120_000);
  });

  it('the repair-hints retry call inherits the same briefTimeoutMs via the pipelineInput spread', async () => {
    arrange();
    vi.mocked(getOpeningRepairHints)
      .mockReturnValueOnce([{ field: 'statement', issue: 'too short' } as never])
      .mockReturnValue([]);
    setActive({ stage_models: { brief: 'claude-fable-5' } });

    await useDebateStore.getState().runOpeningStatements();

    expect(inputs().length).toBeGreaterThanOrEqual(2);
    expect(inputs().every(i => i.briefTimeoutMs === 300_000)).toBe(true);
  });
});
