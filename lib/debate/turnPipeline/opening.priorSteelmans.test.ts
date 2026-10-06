// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3766 prevention test: second/third opening speakers must expose prior_steelmans
// from their draft work product. Maps to failure class: type/schema wired, prompt not
// updated — field present in type but silently absent at runtime (t/3758 root cause).

import { describe, it, expect } from 'vitest';
import { runOpeningPipeline } from './opening.js';
import type { OpeningPipelineInput } from './opening.js';
import { POVER_INFO } from '../types.js';

const BASE_STUB = {
  statement: 'test statement',
  claim_sketches: [],
  key_assumptions: [],
  beliefs: [],
  values: [],
  reasoning: [],
  plan: [],
  topics: [],
  taxonomy_refs: [],
  policy_refs: [],
};

const DRAFT_WITH_STEELMANS = JSON.stringify({
  ...BASE_STUB,
  prior_steelmans: [
    { speaker: 'Accelerationist', steelman_claim: 'Rapid AI development accelerates economic growth' },
    { speaker: 'Safetyist', steelman_claim: 'Careful deployment prevents catastrophic misalignment' },
  ],
});

const PLAIN_STUB = JSON.stringify(BASE_STUB);

function makeSecondSpeakerInput(overrides: Partial<OpeningPipelineInput> = {}): OpeningPipelineInput {
  return {
    label: 'Skeptic',
    pov: 'skp',
    soul: POVER_INFO['skeptic'],
    personality: 'test',
    soul: POVER_INFO.skeptic,
    topic: 'AI safety policy',
    taxonomyContext: '',
    priorStatements: 'Accelerationist and Safetyist have spoken.',
    isFirst: false,
    priorSpeakerLabels: ['Accelerationist', 'Safetyist'],
    model: 'test-model',
    ...overrides,
  };
}

describe('opening pipeline — prior_steelmans preservation (t/3766)', () => {
  it('exposes prior_steelmans from draft when second speaker LLM returns them', async () => {
    const generate = async (
      _prompt: string,
      _model: string,
      _opts: Record<string, unknown> = {},
      label?: string,
    ) => {
      return label?.includes('draft') ? DRAFT_WITH_STEELMANS : PLAIN_STUB;
    };

    const result = await runOpeningPipeline(makeSecondSpeakerInput(), generate as any);

    expect(result.draft.prior_steelmans).toBeDefined();
    expect(result.draft.prior_steelmans!.length).toBeGreaterThan(0);
    for (const entry of result.draft.prior_steelmans!) {
      expect(entry.speaker).toBeTruthy();
      expect(entry.steelman_claim).toBeTruthy();
    }
  });

  it('exposes prior_steelmans for third speaker (isFirst: false, 2 priorSpeakerLabels)', async () => {
    const generate = async (
      _prompt: string,
      _model: string,
      _opts: Record<string, unknown> = {},
      label?: string,
    ) => {
      return label?.includes('draft') ? DRAFT_WITH_STEELMANS : PLAIN_STUB;
    };

    const result = await runOpeningPipeline(
      makeSecondSpeakerInput({ priorSpeakerLabels: ['Accelerationist', 'Safetyist'] }),
      generate as any,
    );

    expect(result.draft.prior_steelmans).toBeDefined();
    expect(result.draft.prior_steelmans!.length).toBe(2);
    expect(result.draft.prior_steelmans![0].speaker).toBe('Accelerationist');
    expect(result.draft.prior_steelmans![0].steelman_claim).toBeTruthy();
    expect(result.draft.prior_steelmans![1].speaker).toBe('Safetyist');
    expect(result.draft.prior_steelmans![1].steelman_claim).toBeTruthy();
  });

  it('does not require prior_steelmans from first speaker (isFirst: true)', async () => {
    const generate = async () => PLAIN_STUB;

    const result = await runOpeningPipeline(
      { ...makeSecondSpeakerInput(), isFirst: true, priorSpeakerLabels: [] },
      generate as any,
    );

    // First speaker has no prior statements to steelman — absence is correct
    expect(result.draft.prior_steelmans ?? []).toHaveLength(0);
  });
});
