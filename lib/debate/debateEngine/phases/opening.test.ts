// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../turnPipeline.js', () => ({
  runOpeningPipelineWithRepair: vi.fn(async (input: Record<string, unknown>) => ({
    stage_diagnostics: [],
    total_time_ms: 100,
    draft: {},
    plan: { framing_choices: [] },
  })),
  assembleOpeningPipelineResult: vi.fn(() => ({
    statement: 'Mock opening statement.',
    taxonomyRefs: [],
    meta: { policy_refs: [], key_assumptions: [], my_claims: [], turn_symbols: [] },
  })),
}));
vi.mock('./narrativeVoicing.js', () => ({
  runNarrativeVoicing: vi.fn(async () => {}),
  finalizeNarrativeReference: vi.fn(async () => {}),
}));
vi.mock('../taxonomyContext.js', () => ({
  getRelevantTaxonomyContext: vi.fn(async () => ''),
  formatDebaterEdgeContext: vi.fn(() => ({ text: '', edges_used: [] })),
  enrichTaxonomyRefs: vi.fn(),
}));
vi.mock('../context.js', () => ({
  getCommitmentContext: vi.fn(() => ''),
  getEstablishedPointsContext: vi.fn(() => ''),
}));
vi.mock('../../narrativeVoicing.js', () => ({
  narrativeBlockForDebater: vi.fn(() => undefined),
  extractNarrativeCheck: vi.fn(() => undefined),
}));
vi.mock('../../../ai-client/index.js', () => ({
  getModelMinTimeout: vi.fn(() => 30000),
}));
vi.mock('../modelResolution.js', () => ({
  resolveModelForSpeaker: vi.fn(() => 'test-model'),
}));
vi.mock('../adaptiveStaging.js', () => ({
  accumulateContextManifest: vi.fn(),
}));
vi.mock('../../../embeddings/onnxEmbedding.js', () => ({
  computeEmbeddings: vi.fn(async () => [[]]),
}));
vi.mock('../../../flight-recorder/index.js', () => ({
  getGlobalRecorder: vi.fn(() => ({ record: vi.fn(), setEventContext: vi.fn() })),
}));

import { runOpeningStatements } from './opening.js';
import { runOpeningPipelineWithRepair } from '../../turnPipeline.js';
import type { DebateEngineInternals } from '../internals.js';
import { type TranscriptEntry, POVER_INFO } from '../../types.js';

const POVER_ID_ACC = 'accelerationist';
const POVER_ID_SAF = 'safetyist';
const POVER_ID_SKP = 'skeptic';

function fakeEngine(transcriptEntries: TranscriptEntry[] = []) {
  const transcript: TranscriptEntry[] = [...transcriptEntries];
  const engine = {
    config: {
      activePovers: [POVER_ID_ACC, POVER_ID_SAF, POVER_ID_SKP],
      narrativeVoicing: false,
      vocabulary: undefined,
      sourceContent: undefined,
      audience: undefined,
      temperature: undefined,
      stageModels: undefined,
      briefTimeoutMs: undefined,
      briefMaxRetries: undefined,
    },
    session: {
      id: 'debate-test',
      topic: { final: 'AI safety', background: '' },
      transcript,
      argument_network: { nodes: [] },
      phase: 'opening',
      narrative_voicing: undefined,
      document_analysis: undefined,
    },
    progress: vi.fn(),
    briefProgress: vi.fn(),
    warn: vi.fn(),
    recordDiagnostic: vi.fn(),
    summarizeEntry: vi.fn(async () => {}),
    getKnownNodeIds: vi.fn(() => new Set<string>()),
    addEntry: vi.fn((e: Partial<TranscriptEntry>) => {
      const full = { id: `e${transcript.length}`, timestamp: 't', ...e } as TranscriptEntry;
      transcript.push(full);
      return full;
    }),
    executeWithModelFailover: vi.fn(async (_speaker: string, fn: (model: string) => Promise<unknown>) => fn('test-model')),
    stageGenerate: vi.fn(async () => ''),
    adapter: { registry: {} },
    _claimPipeline: {
      extractClaims: vi.fn(async () => {}),
      validateSteelmans: vi.fn(async () => {}),
      verifyPreciseClaims: vi.fn(async () => {}),
    },
    _pendingClaimVerifications: [] as Promise<void>[],
    _lastInjectionManifest: undefined,
    getSoulForSpeaker: vi.fn((poverId: string) => POVER_INFO[poverId as keyof typeof POVER_INFO]),
  };
  return engine as unknown as DebateEngineInternals;
}

describe('runOpeningStatements — t/3770 prior-context rehydration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('first speaker on a fresh run sees isFirst:true with no priorSpeakerLabels', async () => {
    const engine = fakeEngine();
    // Force deterministic order by controlling shuffle — stub config to single speaker for simplicity
    (engine.config as any).activePovers = [POVER_ID_ACC];
    await runOpeningStatements(engine);

    const calls = vi.mocked(runOpeningPipelineWithRepair).mock.calls;
    expect(calls).toHaveLength(1);
    const input = calls[0][0] as Record<string, unknown>;
    expect(input['isFirst']).toBe(true);
    expect(input['priorSpeakerLabels']).toBeUndefined();
  });

  it('on a resumed run, remaining speaker sees isFirst:false and priorSpeakerLabels from transcript', async () => {
    // Accelerationist already delivered their opening in a prior run_id
    const existingEntry: TranscriptEntry = {
      id: 'e0',
      timestamp: '2026-09-29T21:00:00Z',
      type: 'opening',
      speaker: POVER_ID_ACC,
      content: 'The accelerationist position is clear.\nMore details follow.',
    } as TranscriptEntry;

    const engine = fakeEngine([existingEntry]);
    // Only accelerationist + safetyist in scope; acc is already done
    (engine.config as any).activePovers = [POVER_ID_ACC, POVER_ID_SAF];

    await runOpeningStatements(engine);

    // Only safetyist should have been called (accelerationist was skipped)
    const calls = vi.mocked(runOpeningPipelineWithRepair).mock.calls;
    expect(calls).toHaveLength(1);
    const input = calls[0][0] as Record<string, unknown>;

    // Must see the prior speaker
    expect(input['isFirst']).toBe(false);
    expect(input['priorSpeakerLabels']).toBeDefined();
    expect((input['priorSpeakerLabels'] as string[]).length).toBe(1);
    // Label should be the accelerationist's display name from POVER_INFO
    expect((input['priorSpeakerLabels'] as string[])[0]).toMatch(/accelerationist/i);
  });

  it('priorStatements block contains the rehydrated content', async () => {
    const existingContent = 'Accelerationist position line one.\nLine two.';
    const existingEntry: TranscriptEntry = {
      id: 'e0',
      timestamp: '2026-09-29T21:00:00Z',
      type: 'opening',
      speaker: POVER_ID_ACC,
      content: existingContent,
    } as TranscriptEntry;

    const engine = fakeEngine([existingEntry]);
    (engine.config as any).activePovers = [POVER_ID_ACC, POVER_ID_SAF];

    await runOpeningStatements(engine);

    const calls = vi.mocked(runOpeningPipelineWithRepair).mock.calls;
    const input = calls[0][0] as Record<string, unknown>;
    // priorStatements is serialised into the priorStatements string field
    expect(typeof input['priorStatements']).toBe('string');
    expect((input['priorStatements'] as string).length).toBeGreaterThan(0);
  });
});
