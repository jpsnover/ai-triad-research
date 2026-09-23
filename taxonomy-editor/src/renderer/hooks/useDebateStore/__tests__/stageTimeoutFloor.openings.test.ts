// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3612: only the opening brief carried a registry-floor timeout; plan/draft/cite fell through
// to the adapter's raw base (240s for xai) with no floor. The fix threads a plan/draft/cite
// `stageTimeoutMs` on `pipelineInput`, but the value MUST be computed here in the renderer, not
// left to the pipeline's `getMinTimeout` callback — on desktop that callback resolves to
// electronAIAdapter's stubbed `getModelMinTimeout => 0` (t/3612#2/#4), so a floor computed only
// inside the pipeline would silently vanish on the exact build Jeffrey runs. This test captures
// the REAL `pipelineInput.stageTimeoutMs` clarificationSlice.ts constructs against the actual
// bundled ai-models.json registry (not a re-implementation) and asserts RAISE semantics —
// Math.max(adapter default, registry floor) — never a bare floor that could lower the timeout.
// Harness FIRST so its hoisted mocks register before the store.
import { describe, it, expect, vi } from 'vitest';
import { makeSession, mockApi } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runOpeningPipelineWithRepair, assembleOpeningPipelineResult, getOpeningRepairHints } from '@lib/debate/turnPipeline';
import { getModelMinTimeout, getDefaultTimeout } from '@lib/ai-client/index';
import type { ModelRegistry } from '@lib/ai-client/registry';
import aiModelsRegistry from '../../../../../../ai-models.json';

const LONG = 'This is a sufficiently long opening statement that clears the 50-character minimum guard.';
const registry = aiModelsRegistry as unknown as ModelRegistry;

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

function capturedStageTimeoutMs(): number | undefined {
  const call = vi.mocked(runOpeningPipelineWithRepair).mock.calls[0];
  return (call[0] as { stageTimeoutMs?: number }).stageTimeoutMs;
}

describe('runOpeningStatements — stageTimeoutMs on pipelineInput (t/3612)', () => {
  it('raises to the registry floor for a model with a floor above the adapter default (grok-4.7-class)', async () => {
    arrange();
    setActive({ speaker_models: { skeptic: 'claude-fable-5' } });

    await useDebateStore.getState().runOpeningStatements();

    const expected = Math.max(getDefaultTimeout('claude-fable-5', registry), getModelMinTimeout('claude-fable-5', registry));
    expect(getModelMinTimeout('claude-fable-5', registry)).toBeGreaterThan(0); // sanity: this model DOES have a floor
    expect(capturedStageTimeoutMs()).toBe(expected);
  });

  it('never lowers below the adapter default when the model has no floor entry (raise, not replace)', async () => {
    arrange();
    setActive({ speaker_models: { skeptic: 'claude-haiku-4-5' } });

    await useDebateStore.getState().runOpeningStatements();

    expect(getModelMinTimeout('claude-haiku-4-5', registry)).toBe(0); // sanity: no floor for this model
    const adapterDefault = getDefaultTimeout('claude-haiku-4-5', registry);
    expect(capturedStageTimeoutMs()).toBe(adapterDefault);
    expect(capturedStageTimeoutMs()).toBeGreaterThan(0); // never silently zero (t/3612's original bug)
  });
});
