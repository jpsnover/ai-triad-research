// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3975, half 1 of 2: the store hands the opening pipeline the seat's resolved souls. Half 2
// (shared/seatSoulsPipeline.test.ts) runs those souls through the REAL pipelines to the prompt the model
// is sent; it can't live here because the harness mocks @lib/debate/prompts.
// Harness FIRST so its hoisted mocks register before the store.
import { describe, it, expect, vi } from 'vitest';
import { makeSession, mockApi } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { runOpeningPipelineWithRepair, assembleOpeningPipelineResult, getOpeningRepairHints } from '@lib/debate/turnPipeline';
import type { OpeningPipelineInput } from '@lib/debate/turnPipeline';
import { POVER_INFO } from '@lib/debate/poverInfo';
import skepticCritical from '@lib/debate/soul-docs/skeptic.critical.soul.json';

const LONG = 'This is a sufficiently long opening statement that clears the 50-character minimum guard.';
const TAG_DISPOSITION = skepticCritical.voice.disposition;

async function openingInputs(overrides: Record<string, unknown>): Promise<OpeningPipelineInput[]> {
  mockApi.generateText.mockResolvedValue({ text: '{}' });
  vi.mocked(getOpeningRepairHints).mockReturnValue([]);
  vi.mocked(runOpeningPipelineWithRepair).mockResolvedValue({
    stage_diagnostics: [], total_time_ms: 1, topicAlignmentResult: null, qualityGateResult: null, draft: {},
  } as never);
  vi.mocked(assembleOpeningPipelineResult).mockReturnValue({ statement: LONG, taxonomyRefs: [], meta: { policy_refs: [] } } as never);
  const session = makeSession({ active_povers: ['skeptic', 'safetyist'], phase: 'opening', ...overrides });
  useDebateStore.setState({
    activeDebate: session as unknown as ReturnType<typeof useDebateStore.getState>['activeDebate'],
    activeDebateId: session.id,
    initialCrossRespondRounds: 0,
  });
  await useDebateStore.getState().runOpeningStatements();
  return vi.mocked(runOpeningPipelineWithRepair).mock.calls.map(c => c[0]);
}

const TAGGED = { seat_tags: { skeptic: { pov_tag: 'critical', tag_mode: 'scope' } } };

describe('openings hand the pipeline each seat\'s souls (t/3975)', () => {
  it('the tagged seat gets its tag soul', async () => {
    const skeptic = (await openingInputs(TAGGED)).find(i => i.pov === 'skeptic')!;
    expect(skeptic.soul?.voice.disposition).toBe(TAG_DISPOSITION);
    expect(skeptic.personality).toBe(skepticCritical.personality);
  });

  it('an untagged seat in the same debate gets its base soul and the tagged opponent\'s soul', async () => {
    const safetyist = (await openingInputs(TAGGED)).find(i => i.pov === 'safetyist')!;
    expect(safetyist.soul).toBe(POVER_INFO.safetyist);
    expect(safetyist.opponentSouls?.skeptic?.voice.disposition).toBe(TAG_DISPOSITION);
  });

  it('untagged debate: base souls and no opponentSouls, so the prompts are what they were', async () => {
    const inputs = await openingInputs({});
    expect(inputs).toHaveLength(2);
    for (const i of inputs) {
      expect(i.soul).toBe(POVER_INFO[i.pov as 'skeptic' | 'safetyist']);
      expect(i.opponentSouls).toBeUndefined();
    }
  });
});
