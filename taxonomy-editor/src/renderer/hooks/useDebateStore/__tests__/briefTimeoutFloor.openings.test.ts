// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3518 (reopened): the opening flow is orchestrated twice — engine phases/opening.ts and
// this slice's own runOpeningStatements. #2245/#2249 fixed the engine path with
// openingBriefTimeoutFloor(model), but the renderer's pipelineInput construction (the path
// live debates actually use) never got briefTimeoutMs at all, so DEFAULT_BRIEF_TIMEOUT_MS
// (60s) silently applied regardless of model — the exact escape that reopened this ticket.
//
// t/3521: the floor arithmetic (Math.max(DEFAULT_BRIEF_TIMEOUT_MS, getMinTimeout(model)))
// and the repair-retry sequence both moved into lib/debate/turnPipeline/opening.ts's
// runOpeningPipelineWithRepair — single source of truth shared with the engine path, tested
// there. What's left to prove AT THIS LAYER is narrower but still real: clarificationSlice.ts
// must pass a `getMinTimeout` callback that correctly resolves via the actual bundled
// ai-models.json registry — a wrong or stubbed-out callback would silently zero the floor
// again, reproducing t/3518 one level up. So these tests capture the REAL callback
// clarificationSlice.ts constructs and invoke it directly (not a re-implementation).
// Harness FIRST so its hoisted mocks register before the store.
import { describe, it, expect, vi } from 'vitest';
import { makeSession, mockApi } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runOpeningPipelineWithRepair, assembleOpeningPipelineResult, getOpeningRepairHints } from '@lib/debate/turnPipeline';

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
  vi.mocked(runOpeningPipelineWithRepair).mockResolvedValue({
    stage_diagnostics: [], total_time_ms: 1, topicAlignmentResult: null, qualityGateResult: null,
  } as never);
  vi.mocked(assembleOpeningPipelineResult).mockReturnValue({ statement: LONG, taxonomyRefs: [], meta: { policy_refs: [] } } as never);
}

/** The real getMinTimeout closure clarificationSlice.ts passes as the 5th arg. */
function capturedGetMinTimeout(): (model: string) => number {
  const call = vi.mocked(runOpeningPipelineWithRepair).mock.calls[0];
  const fn = call[4];
  expect(fn).toBeTypeOf('function');
  return fn as (model: string) => number;
}

describe('runOpeningStatements — getMinTimeout callback passed to runOpeningPipelineWithRepair (t/3521)', () => {
  it('resolves the registry floor for a slow-model brief (fable) via the real bundled ai-models.json', async () => {
    arrange();
    setActive({ stage_models: { brief: 'claude-fable-5' } });

    await useDebateStore.getState().runOpeningStatements();

    expect(vi.mocked(runOpeningPipelineWithRepair)).toHaveBeenCalledTimes(1);
    expect(capturedGetMinTimeout()('claude-fable-5')).toBe(300_000);
  });

  it('resolves the same floor for opus', async () => {
    arrange();
    setActive({ stage_models: { brief: 'claude-opus-5' } });

    await useDebateStore.getState().runOpeningStatements();

    expect(capturedGetMinTimeout()('claude-opus-5')).toBe(300_000);
  });

  it('resolves 0 (no floor entry — DEFAULT_BRIEF_TIMEOUT_MS applies inside the shared helper) for a non-flagship model', async () => {
    arrange();
    setActive({ stage_models: { brief: 'claude-haiku-4-5' } });

    await useDebateStore.getState().runOpeningStatements();

    expect(capturedGetMinTimeout()('claude-haiku-4-5')).toBe(0);
  });
});
