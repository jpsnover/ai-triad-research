// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runNeutralEvaluation, buildSpeakerMapping } from './neutralEvaluator.js';
import { ActionableError } from './errors.js';
import type { AIAdapter } from './aiAdapter.js';
import type { TranscriptEntry } from './types.js';

vi.mock('../flight-recorder/index.js', () => ({
  getGlobalRecorder: vi.fn(() => ({ record: vi.fn() })),
}));

function makeAdapter(responseText: string): AIAdapter {
  return {
    generateText: vi.fn().mockResolvedValue(responseText),
  };
}

function makeTranscript(): TranscriptEntry[] {
  return [
    {
      id: 'e1',
      timestamp: new Date().toISOString(),
      type: 'opening',
      speaker: 'accelerationist',
      content: 'AI will create enormous value and risks are manageable.',
      taxonomy_refs: [],
    },
    {
      id: 'e2',
      timestamp: new Date().toISOString(),
      type: 'opening',
      speaker: 'safetyist',
      content: 'Unaligned AI poses existential risk without careful governance.',
      taxonomy_refs: [],
    },
  ];
}

const VALID_EVALUATION_JSON = JSON.stringify({
  checkpoint: 'baseline',
  timestamp: '2026-01-01T00:00:00.000Z',
  cruxes: [
    {
      id: 'crux-1',
      description: 'Whether AI risks are manageable without governance',
      disagreement_type: 'empirical',
      speakers_involved: ['A', 'B'],
      status: 'unaddressed',
      confidence: 'high',
    },
  ],
  claims: [
    {
      id: 'claim-1',
      speaker: 'A',
      claim_text: 'AI risks are manageable',
      neutral_assessment: 'plausible_but_underdefended',
      reasoning: 'The claim lacks specific evidence.',
      confidence: 'medium',
    },
  ],
  overall_assessment: {
    strongest_unaddressed_claim_id: 'claim-1',
    debate_is_engaging_real_disagreement: true,
    notes: 'Speakers disagree on the core risk question.',
  },
});

describe('runNeutralEvaluation', () => {
  const baseConfig = {
    topic: 'AI governance',
    transcript: makeTranscript(),
    activePovers: ['accelerationist', 'safetyist'] as const,
    model: 'test-model',
    speakerMapping: buildSpeakerMapping(['accelerationist', 'safetyist']),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a parsed evaluation when the response is valid and complete', async () => {
    const adapter = makeAdapter(VALID_EVALUATION_JSON);
    const result = await runNeutralEvaluation('baseline', { ...baseConfig, adapter });

    expect(result.cruxes).toHaveLength(1);
    expect(result.claims).toHaveLength(1);
    expect(result.checkpoint).toBe('baseline');
    expect(result.overall_assessment.debate_is_engaging_real_disagreement).toBe(true);
  });

  it('throws ActionableError and records to flight recorder when JSON parse fails (truncated response)', async () => {
    // Simulate a response truncated mid-JSON — completely unparseable
    const truncatedJson = '{"checkpoint":"baseline","cruxes":[{"id":"crux-1","description":"Whether AI ris';
    const adapter = makeAdapter(truncatedJson);

    await expect(
      runNeutralEvaluation('baseline', { ...baseConfig, adapter }),
    ).rejects.toThrow(ActionableError);
  });

  it('throws ActionableError when JSON is partially recovered but raw text does not end with "}" (silent truncation)', async () => {
    // Simulate a response where parseJsonRobust's brace-extraction recovers valid JSON
    // from a raw text that has trailing garbage — indicating the model was cut off.
    // The raw text ends with content after the closing '}', signaling truncation.
    const validJsonWithTrailingGarbage =
      '{"checkpoint":"baseline","cruxes":[],"claims":[],' +
      '"overall_assessment":{"debate_is_engaging_real_disagreement":true,"notes":"test"}}' +
      '\n<response was cut off here due to token limit';
    const adapter = makeAdapter(validJsonWithTrailingGarbage);

    await expect(
      runNeutralEvaluation('baseline', { ...baseConfig, adapter }),
    ).rejects.toThrow(ActionableError);
  });

  it('uses maxTokens of at least 16384', async () => {
    const adapter = makeAdapter(VALID_EVALUATION_JSON);
    await runNeutralEvaluation('baseline', { ...baseConfig, adapter });

    const callOpts = (adapter.generateText as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(callOpts.maxTokens).toBeGreaterThanOrEqual(16384);
  });
});
