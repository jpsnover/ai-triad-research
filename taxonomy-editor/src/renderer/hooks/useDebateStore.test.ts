// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks (available before vi.mock factories execute) ──

const { mockApi, mockTaxonomyState } = vi.hoisted(() => {
  const mockApi = {
    generateText: vi.fn().mockResolvedValue({ text: '{}' }),
    generateTextWithSearch: vi.fn().mockResolvedValue({ text: '', searchQueries: [], citations: [] }),
    onGenerateTextProgress: vi.fn().mockReturnValue(() => {}),
    listDebateSessions: vi.fn().mockResolvedValue([]),
    loadDebateSession: vi.fn().mockResolvedValue({}),
    saveDebateSession: vi.fn().mockResolvedValue(undefined),
    deleteDebateSession: vi.fn().mockResolvedValue(undefined),
    setDebateTemperature: vi.fn().mockResolvedValue(undefined),
    sendDiagnosticsState: vi.fn(),
    openDiagnosticsWindow: vi.fn().mockResolvedValue(undefined),
    closeDiagnosticsWindow: vi.fn(),
    computeEmbeddings: vi.fn().mockResolvedValue({ vectors: [] }),
    computeQueryEmbedding: vi.fn().mockResolvedValue({ vector: [] }),
    nliClassify: vi.fn().mockResolvedValue({ results: [] }),
    loadEdges: vi.fn().mockResolvedValue({ edges: [] }),
    loadDictionary: vi.fn().mockResolvedValue({ standardized: [], colloquial: [], lintViolations: [] }),
    exportDebateToFile: vi.fn().mockResolvedValue({ cancelled: true }),
  };

  const mockTaxonomyState = {
    accelerationist: { nodes: [] as unknown[] },
    safetyist: { nodes: [] as unknown[] },
    skeptic: { nodes: [] as unknown[] },
    situations: { nodes: [] as unknown[] },
    edgesFile: { edges: [] as unknown[] },
    policyRegistry: [] as unknown[],
    conflicts: [] as unknown[],
    getLabelForId: vi.fn().mockReturnValue('mock-label'),
    loadEdges: vi.fn().mockResolvedValue(undefined),
    createPovNode: vi.fn().mockReturnValue('new-node-id'),
    updatePovNode: vi.fn(),
    save: vi.fn(),
  };

  return { mockApi, mockTaxonomyState };
});

// ── Mock dependencies BEFORE importing the store ────────────

vi.mock('@bridge', () => ({ api: mockApi }));

vi.mock('./useTaxonomyStore', () => ({
  useTaxonomyStore: {
    getState: () => mockTaxonomyState,
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('./usePromptConfigStore', () => ({
  usePromptConfigStore: {
    getState: () => ({
      loadSessionConfig: vi.fn(),
      resetSession: vi.fn(),
      exportSessionConfig: vi.fn().mockReturnValue({}),
    }),
  },
}));

// Mock prompt modules (they return strings; we only care that the store calls them)
vi.mock('../prompts/debate', () => ({
  clarificationPrompt: vi.fn().mockReturnValue('mock-clarification-prompt'),
  situationClarificationPrompt: vi.fn().mockReturnValue('mock-sit-clarification-prompt'),
  documentClarificationPrompt: vi.fn().mockReturnValue('mock-doc-clarification-prompt'),
  synthesisPrompt: vi.fn().mockReturnValue('mock-synthesis-prompt'),
  userSeedClaimsPrompt: vi.fn().mockReturnValue('mock-seed-prompt'),
  openingStatementPrompt: vi.fn().mockReturnValue('mock-opening-prompt'),
  debateResponsePrompt: vi.fn().mockReturnValue('mock-response-prompt'),
  crossRespondPrompt: vi.fn().mockReturnValue('mock-cross-respond-prompt'),
  debateSynthesisPrompt: vi.fn().mockReturnValue('mock-debate-synthesis-prompt'),
  probingQuestionsPrompt: vi.fn().mockReturnValue('mock-probing-prompt'),
  factCheckPrompt: vi.fn().mockReturnValue('mock-fact-check-prompt'),
  contextCompressionPrompt: vi.fn().mockReturnValue('mock-compression-prompt'),
  entrySummarizationPrompt: vi.fn().mockReturnValue('mock-summarization-prompt'),
  missingArgumentsPrompt: vi.fn().mockReturnValue('mock-missing-args-prompt'),
  taxonomyRefinementPrompt: vi.fn().mockReturnValue('mock-taxonomy-refinement-prompt'),
  reflectionPrompt: vi.fn().mockReturnValue('mock-reflection-prompt'),
  midDebateGapPrompt: vi.fn().mockReturnValue('mock-gap-prompt'),
  crossCuttingNodePrompt: vi.fn().mockReturnValue('mock-cc-prompt'),
  formatSituationDebateContext: vi.fn().mockReturnValue('mock-situation-context'),
}));

vi.mock('../prompts/argumentNetwork', () => ({
  extractClaimsPrompt: vi.fn().mockReturnValue('mock-extract-prompt'),
  classifyClaimsPrompt: vi.fn().mockReturnValue('mock-classify-prompt'),
  formatArgumentNetworkContext: vi.fn().mockReturnValue(''),
  formatCommitments: vi.fn().mockReturnValue(''),
  formatEstablishedPoints: vi.fn().mockReturnValue(''),
  updateUnansweredLedger: vi.fn().mockReturnValue([]),
  formatConcessionCandidatesHint: vi.fn().mockReturnValue(''),
  processExtractedClaims: vi.fn().mockReturnValue({
    newNodes: [], newEdges: [], accepted: [], rejected: [],
    commitments: { asserted: [], conceded: [], challenged: [] },
    rejectionReasons: {}, rejectedOverlapPcts: [], maxOverlapVsExisting: 0,
  }),
}));

vi.mock('@lib/debate/documentAnalysis', () => ({
  documentAnalysisPrompt: vi.fn().mockReturnValue({ prompt: 'mock-doc-analysis-prompt' }),
  buildTaxonomySample: vi.fn().mockReturnValue('mock-taxonomy-sample'),
  documentAnalysisContext: vi.fn().mockReturnValue(''),
}));

vi.mock('../utils/convergenceScoring', () => ({
  updateConvergenceTracker: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../utils/taxonomyRelevance', () => ({
  cosineSimilarity: vi.fn().mockReturnValue(0),
  scoreNodeRelevance: vi.fn().mockReturnValue(0),
  selectRelevantNodes: vi.fn().mockReturnValue([]),
  selectRelevantSituationNodes: vi.fn().mockReturnValue([]),
  buildRelevanceQuery: vi.fn().mockReturnValue('mock-query'),
}));

vi.mock('../utils/taxonomyContext', () => ({
  formatTaxonomyContext: vi.fn().mockReturnValue('mock-taxonomy-context'),
}));

vi.mock('../utils/errorMessages', () => ({
  mapErrorToUserMessage: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

vi.mock('../lib/trace', () => ({
  trace: vi.fn(),
  newCallId: vi.fn().mockReturnValue('call-001'),
  TraceEventName: new Proxy({}, { get: (_, prop) => String(prop) }),
}));

vi.mock('@lib/debate', () => ({
  normalizeBdiLayer: vi.fn((x: string) => x),
}));

vi.mock('@lib/debate/nodeIdUtils', () => ({
  nodeTypeFromId: vi.fn().mockReturnValue('pov'),
}));

vi.mock('@lib/debate/qbaf', () => ({
  computeQbafStrengths: vi.fn().mockReturnValue({ strengths: new Map() }),
}));

vi.mock('@lib/debate/argumentNetwork', () => ({
  factCheckToBaseStrength: vi.fn().mockReturnValue(0.5),
}));

vi.mock('@lib/debate/networkGc', () => ({
  needsGc: vi.fn().mockReturnValue(false),
  pruneArgumentNetwork: vi.fn().mockReturnValue({ nodes: [], edges: [], prunedNodes: [], before: 0, after: 0 }),
  GC_TRIGGER: 200,
  GC_TARGET: 150,
}));

vi.mock(import('@lib/debate/types'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getDebatePhase: vi.fn().mockReturnValue('setup'),
  };
});

vi.mock(import('@lib/debate/helpers'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateId: vi.fn().mockReturnValue('test-id-default'),
    nowISO: vi.fn().mockReturnValue('2026-05-01T00:00:00.000Z'),
    formatRecentTranscript: vi.fn().mockReturnValue('mock-transcript'),
  };
});

// Make generateId return unique IDs on each call
let idCounter = 0;
const { generateId, nowISO } = await import('@lib/debate/helpers');
vi.mocked(generateId).mockImplementation(() => `test-id-${++idCounter}`);

vi.mock('@lib/debate/turnValidator', () => ({
  resolveTurnValidationConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('@lib/debate/convergenceSignals', () => ({
  computeConvergenceSignals: vi.fn().mockReturnValue({ round: 1, signals: {} }),
}));

vi.mock('@lib/debate/cruxResolution', () => ({
  updateCruxTracker: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@lib/debate/taxonomyGapAnalysis', () => ({
  computeTaxonomyGapAnalysis: vi.fn().mockReturnValue(null),
}));

vi.mock('@lib/debate/moderator', () => ({
  updateModeratorState: vi.fn().mockReturnValue({}),
  MOVE_RESPONSE_CONFIG: {},
  DIRECT_RESPONSE_PATTERNS: [],
}));

vi.mock('@lib/debate/orchestration', () => ({
  runModeratorSelection: vi.fn().mockResolvedValue({ speaker: 'prometheus', intervention: null }),
  executeTurnWithRetry: vi.fn().mockResolvedValue({ text: '{}', attempts: 1 }),
}));

vi.mock('@lib/debate/sessionPruning', () => ({
  pruneSessionData: vi.fn((x: unknown) => x),
  pruneModeratorState: vi.fn((x: unknown) => x),
}));

vi.mock('@lib/debate/turnPipeline', () => ({
  runTurnPipeline: vi.fn().mockResolvedValue({}),
  assemblePipelineResult: vi.fn().mockReturnValue({}),
  runOpeningPipeline: vi.fn().mockResolvedValue({}),
  assembleOpeningPipelineResult: vi.fn().mockReturnValue({}),
}));

vi.mock('@lib/debate/vocabularyContext', () => ({
  formatVocabularyContext: vi.fn().mockReturnValue(''),
}));

// Global __APP_VERSION__
vi.stubGlobal('__APP_VERSION__', '0.7.4');

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
vi.stubGlobal('localStorage', localStorageMock);

// ── Import the store under test ─────────────────────────────

import { useDebateStore } from './useDebateStore';

// ── Helpers ─────────────────────────────────────────────────

/** Reset the store to initial state between tests */
function resetStore(): void {
  useDebateStore.setState({
    sessions: [],
    sessionsLoading: false,
    activeDebateId: null,
    activeDebate: null,
    debateLoading: false,
    debateGenerating: null,
    debateError: null,
    responseLength: 'detailed',
    audience: 'policymakers',
    debateProgress: null,
    debateActivity: null,
    gapInjections: [],
    crossCuttingProposals: [],
    taxonomyGapAnalysis: null,
    reflections: [],
    inspectedNodeId: null,
    debateModel: null,
    debateTemperature: null,
    vocabularyTerms: null,
    diagnosticsEnabled: false,
    selectedDiagEntry: null,
    diagPopoutOpen: false,
    debateWarnings: [],
    openingOrder: [],
    initialCrossRespondRounds: 3,
  });
}

/** Create a minimal valid DebateSession for testing */
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    title: 'Test Debate',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    phase: 'setup' as const,
    topic: { original: 'AI governance', refined: null, final: 'AI governance' },
    source_type: 'topic' as const,
    source_ref: '',
    source_content: '',
    active_povers: ['prometheus', 'sentinel', 'cassandra'] as string[],
    user_is_pover: false,
    transcript: [] as Array<{ id: string; timestamp: string; type: string; speaker: string; content: string; taxonomy_refs: string[]; metadata?: Record<string, unknown>; display_tier?: string; summaries?: { brief: string; medium: string } }>,
    context_summaries: [] as Array<{ up_to_entry_id: string; summary: string }>,
    generated_with_prompt_version: 'dolce-phase-1',
    audience: 'policymakers' as const,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
  idCounter = 0;
  vi.clearAllMocks();
  vi.mocked(generateId).mockImplementation(() => `test-id-${++idCounter}`);
  vi.mocked(nowISO).mockReturnValue('2026-05-01T00:00:00.000Z');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. Store Initialization ─────────────────────────────────

describe('Store initialization', () => {
  it('has null activeDebate on init', () => {
    const state = useDebateStore.getState();
    expect(state.activeDebate).toBeNull();
    expect(state.activeDebateId).toBeNull();
  });

  it('has empty sessions list on init', () => {
    expect(useDebateStore.getState().sessions).toEqual([]);
    expect(useDebateStore.getState().sessionsLoading).toBe(false);
  });

  it('defaults debateLoading to false', () => {
    expect(useDebateStore.getState().debateLoading).toBe(false);
  });

  it('defaults debateGenerating to null', () => {
    expect(useDebateStore.getState().debateGenerating).toBeNull();
  });

  it('defaults debateError to null', () => {
    expect(useDebateStore.getState().debateError).toBeNull();
  });

  it('defaults responseLength to detailed', () => {
    expect(useDebateStore.getState().responseLength).toBe('detailed');
  });

  it('defaults audience to policymakers', () => {
    expect(useDebateStore.getState().audience).toBe('policymakers');
  });

  it('defaults diagnosticsEnabled to false', () => {
    expect(useDebateStore.getState().diagnosticsEnabled).toBe(false);
  });

  it('defaults debateWarnings to empty array', () => {
    expect(useDebateStore.getState().debateWarnings).toEqual([]);
  });

  it('defaults gap analysis state to null/empty', () => {
    const state = useDebateStore.getState();
    expect(state.gapInjections).toEqual([]);
    expect(state.crossCuttingProposals).toEqual([]);
    expect(state.taxonomyGapAnalysis).toBeNull();
  });

  it('defaults reflections to empty array', () => {
    expect(useDebateStore.getState().reflections).toEqual([]);
  });

  it('defaults debateModel and debateTemperature to null', () => {
    const state = useDebateStore.getState();
    expect(state.debateModel).toBeNull();
    expect(state.debateTemperature).toBeNull();
  });

  it('defaults openingOrder to empty array', () => {
    expect(useDebateStore.getState().openingOrder).toEqual([]);
  });

  it('defaults initialCrossRespondRounds to 3', () => {
    expect(useDebateStore.getState().initialCrossRespondRounds).toBe(3);
  });
});

// ── 2. Debate Lifecycle ─────────────────────────────────────

describe('createDebate', () => {
  it('creates a session with correct fields and saves via IPC', async () => {
    const id = await useDebateStore.getState().createDebate(
      'AI governance policy',
      ['prometheus', 'sentinel', 'cassandra'],
      false,
    );

    expect(id).toBeTruthy();
    expect(mockApi.saveDebateSession).toHaveBeenCalledTimes(1);
    const saved = mockApi.saveDebateSession.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.title).toBe('AI governance policy');
    expect(saved.phase).toBe('setup');
    expect(saved.source_type).toBe('topic');
    expect(saved.active_povers).toEqual(['prometheus', 'sentinel', 'cassandra']);
    expect(saved.user_is_pover).toBe(false);
    expect(saved.transcript).toEqual([]);
  });

  it('truncates long topic titles to 60 chars', async () => {
    const longTopic = 'A'.repeat(80);
    await useDebateStore.getState().createDebate(longTopic, ['prometheus'], false);
    const saved = mockApi.saveDebateSession.mock.calls[0][0] as Record<string, unknown>;
    expect((saved.title as string).length).toBeLessThanOrEqual(60);
    expect((saved.title as string).endsWith('...')).toBe(true);
  });

  it('sets activeDebateId and activeDebate in state', async () => {
    const id = await useDebateStore.getState().createDebate(
      'Test topic', ['prometheus', 'sentinel'], false,
    );
    const state = useDebateStore.getState();
    expect(state.activeDebateId).toBe(id);
    expect(state.activeDebate).not.toBeNull();
    expect(state.activeDebate!.topic.original).toBe('Test topic');
  });

  it('stores debate-specific model override', async () => {
    await useDebateStore.getState().createDebate(
      'Topic', ['prometheus'], false, 'topic', '', '', 'gemini-2.0-pro',
    );
    expect(useDebateStore.getState().debateModel).toBe('gemini-2.0-pro');
  });

  it('stores debate-specific temperature', async () => {
    await useDebateStore.getState().createDebate(
      'Topic', ['prometheus'], false, 'topic', '', '', undefined, undefined, 0.9,
    );
    expect(useDebateStore.getState().debateTemperature).toBe(0.9);
    expect(mockApi.setDebateTemperature).toHaveBeenCalledWith(0.9);
  });

  it('stores audience in session', async () => {
    await useDebateStore.getState().createDebate(
      'Topic', ['prometheus'], false, 'topic', '', '', undefined, undefined, undefined, 'researchers',
    );
    const session = useDebateStore.getState().activeDebate;
    expect(session!.audience).toBe('researchers');
  });

  it('calls loadSessions after creation', async () => {
    await useDebateStore.getState().createDebate('Topic', ['prometheus'], false);
    expect(mockApi.listDebateSessions).toHaveBeenCalled();
  });
});

describe('loadDebate', () => {
  it('loads a session from IPC and sets activeDebate', async () => {
    const session = makeSession();
    mockApi.loadDebateSession.mockResolvedValueOnce(session);

    await useDebateStore.getState().loadDebate('session-1');

    const state = useDebateStore.getState();
    expect(state.activeDebateId).toBe('session-1');
    expect(state.activeDebate).toBeTruthy();
    expect(state.debateLoading).toBe(false);
  });

  it('sets debateError on load failure', async () => {
    mockApi.loadDebateSession.mockRejectedValueOnce(new Error('File not found'));

    await useDebateStore.getState().loadDebate('nonexistent');

    const state = useDebateStore.getState();
    expect(state.debateError).toBeTruthy();
    expect(state.debateLoading).toBe(false);
  });

  it('clears warnings when loading', async () => {
    useDebateStore.setState({ debateWarnings: ['old warning'] });
    mockApi.loadDebateSession.mockResolvedValueOnce(makeSession());

    await useDebateStore.getState().loadDebate('session-1');

    expect(useDebateStore.getState().debateWarnings).toEqual([]);
  });

  it('restores debateModel from session', async () => {
    const session = makeSession({ debate_model: 'gemini-2.0-pro' });
    mockApi.loadDebateSession.mockResolvedValueOnce(session);

    await useDebateStore.getState().loadDebate('session-1');

    expect(useDebateStore.getState().debateModel).toBe('gemini-2.0-pro');
  });

  it('restores audience from session', async () => {
    const session = makeSession({ audience: 'researchers' });
    mockApi.loadDebateSession.mockResolvedValueOnce(session);

    await useDebateStore.getState().loadDebate('session-1');

    expect(useDebateStore.getState().audience).toBe('researchers');
  });
});

describe('deleteDebate', () => {
  it('deletes via IPC and clears activeDebate if it was active', async () => {
    useDebateStore.setState({
      activeDebateId: 'session-1',
      activeDebate: makeSession() as any,
    });

    await useDebateStore.getState().deleteDebate('session-1');

    expect(mockApi.deleteDebateSession).toHaveBeenCalledWith('session-1');
    expect(useDebateStore.getState().activeDebateId).toBeNull();
    expect(useDebateStore.getState().activeDebate).toBeNull();
  });

  it('does not clear activeDebate if deleting a different session', async () => {
    useDebateStore.setState({
      activeDebateId: 'session-1',
      activeDebate: makeSession() as any,
    });

    await useDebateStore.getState().deleteDebate('session-2');

    expect(useDebateStore.getState().activeDebateId).toBe('session-1');
  });

  it('sets debateError on delete failure', async () => {
    mockApi.deleteDebateSession.mockRejectedValueOnce(new Error('Permission denied'));

    await useDebateStore.getState().deleteDebate('session-1');

    expect(useDebateStore.getState().debateError).toBeTruthy();
  });
});

describe('renameDebate', () => {
  it('renames a session and updates active debate', async () => {
    const session = makeSession();
    useDebateStore.setState({ activeDebateId: 'session-1', activeDebate: session as any });
    mockApi.loadDebateSession.mockResolvedValueOnce({ ...session });

    await useDebateStore.getState().renameDebate('session-1', 'New Title');

    expect(mockApi.saveDebateSession).toHaveBeenCalled();
    const saved = mockApi.saveDebateSession.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.title).toBe('New Title');
  });

  it('sets debateError on rename failure', async () => {
    mockApi.loadDebateSession.mockRejectedValueOnce(new Error('Not found'));

    await useDebateStore.getState().renameDebate('session-1', 'New Title');

    expect(useDebateStore.getState().debateError).toBeTruthy();
  });
});

describe('closeDebate', () => {
  it('clears all debate state', () => {
    useDebateStore.setState({
      activeDebateId: 'session-1',
      activeDebate: makeSession() as any,
      debateError: 'some error',
      debateWarnings: ['warning1'],
      debateGenerating: 'prometheus',
      debateModel: 'gemini-2.0-pro',
      debateTemperature: 0.8,
      vocabularyTerms: { standardized: [], colloquial: [] },
    });

    useDebateStore.getState().closeDebate();

    const state = useDebateStore.getState();
    expect(state.activeDebateId).toBeNull();
    expect(state.activeDebate).toBeNull();
    expect(state.debateError).toBeNull();
    expect(state.debateWarnings).toEqual([]);
    expect(state.debateGenerating).toBeNull();
    expect(state.debateModel).toBeNull();
    expect(state.debateTemperature).toBeNull();
    expect(state.vocabularyTerms).toBeNull();
  });

  it('calls setDebateTemperature(null) on close', () => {
    useDebateStore.setState({ activeDebateId: 'x', activeDebate: makeSession() as any });
    useDebateStore.getState().closeDebate();
    expect(mockApi.setDebateTemperature).toHaveBeenCalledWith(null);
  });
});

// ── 3. Phase Management ─────────────────────────────────────

describe('updatePhase', () => {
  it('sets the phase on activeDebate', () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    useDebateStore.getState().updatePhase('clarification');

    expect(useDebateStore.getState().activeDebate!.phase).toBe('clarification');
  });

  it('does nothing when activeDebate is null', () => {
    useDebateStore.getState().updatePhase('opening');
    expect(useDebateStore.getState().activeDebate).toBeNull();
  });

  it('updates updated_at timestamp', () => {
    useDebateStore.setState({ activeDebate: makeSession({ updated_at: 'old' }) as any });

    useDebateStore.getState().updatePhase('debate');

    expect(useDebateStore.getState().activeDebate!.updated_at).toBe('2026-05-01T00:00:00.000Z');
  });
});

// ── 4. Turn Processing / Transcript ─────────────────────────

describe('addTranscriptEntry', () => {
  it('adds an entry with generated id and timestamp', () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    const entryId = useDebateStore.getState().addTranscriptEntry({
      type: 'user',
      speaker: 'user',
      content: 'What about regulation?',
      taxonomy_refs: [],
    });

    expect(entryId).toBeTruthy();
    const transcript = useDebateStore.getState().activeDebate!.transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0].content).toBe('What about regulation?');
    expect(transcript[0].timestamp).toBeTruthy();
    expect(transcript[0].id).toBe(entryId);
  });

  it('returns an id even when activeDebate is null (no-op)', () => {
    const entryId = useDebateStore.getState().addTranscriptEntry({
      type: 'user',
      speaker: 'user',
      content: 'test',
      taxonomy_refs: [],
    });
    expect(entryId).toBeTruthy();
  });

  it('appends to existing transcript', () => {
    const session = makeSession({
      transcript: [
        { id: 'e1', timestamp: '2026-05-01T00:00:00.000Z', type: 'user', speaker: 'user', content: 'First', taxonomy_refs: [] },
      ],
    });
    useDebateStore.setState({ activeDebate: session as any });

    useDebateStore.getState().addTranscriptEntry({
      type: 'user',
      speaker: 'user',
      content: 'Second',
      taxonomy_refs: [],
    });

    expect(useDebateStore.getState().activeDebate!.transcript).toHaveLength(2);
    expect(useDebateStore.getState().activeDebate!.transcript[1].content).toBe('Second');
  });

  it('preserves existing transcript entries (immutable append)', () => {
    const existingEntry = { id: 'e1', timestamp: 't1', type: 'user', speaker: 'user', content: 'Existing', taxonomy_refs: [] as string[] };
    const session = makeSession({ transcript: [existingEntry] });
    useDebateStore.setState({ activeDebate: session as any });

    useDebateStore.getState().addTranscriptEntry({
      type: 'system', speaker: 'system', content: 'New', taxonomy_refs: [],
    });

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    expect(transcript[0].content).toBe('Existing');
    expect(transcript[1].content).toBe('New');
  });
});

describe('deleteTranscriptEntries', () => {
  it('removes specified entries by id', async () => {
    const session = makeSession({
      transcript: [
        { id: 'e1', timestamp: 't', type: 'user', speaker: 'user', content: 'Keep', taxonomy_refs: [] },
        { id: 'e2', timestamp: 't', type: 'user', speaker: 'user', content: 'Remove', taxonomy_refs: [] },
        { id: 'e3', timestamp: 't', type: 'user', speaker: 'user', content: 'Keep too', taxonomy_refs: [] },
      ],
    });
    useDebateStore.setState({ activeDebate: session as any });

    await useDebateStore.getState().deleteTranscriptEntries(['e2']);

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    expect(transcript).toHaveLength(2);
    expect(transcript.map((e: any) => e.id)).toEqual(['e1', 'e3']);
  });

  it('calls saveDebate after deletion', async () => {
    const session = makeSession({
      transcript: [{ id: 'e1', timestamp: 't', type: 'user', speaker: 'user', content: 'x', taxonomy_refs: [] }],
    });
    useDebateStore.setState({ activeDebate: session as any });

    await useDebateStore.getState().deleteTranscriptEntries(['e1']);

    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });
});

// ── 5. Error Handling ───────────────────────────────────────

describe('Error handling', () => {
  describe('setError', () => {
    it('sets debateError state', () => {
      useDebateStore.getState().setError('Something went wrong');
      expect(useDebateStore.getState().debateError).toBe('Something went wrong');
    });

    it('clears debateError with null', () => {
      useDebateStore.setState({ debateError: 'existing error' });
      useDebateStore.getState().setError(null);
      expect(useDebateStore.getState().debateError).toBeNull();
    });
  });

  describe('loadSessions error handling', () => {
    it('sets sessionsLoading false on error (does not throw)', async () => {
      mockApi.listDebateSessions.mockRejectedValueOnce(new Error('Network error'));

      await useDebateStore.getState().loadSessions();

      expect(useDebateStore.getState().sessionsLoading).toBe(false);
    });
  });

  describe('saveDebate error handling', () => {
    it('sets debateError when save fails', async () => {
      useDebateStore.setState({ activeDebate: makeSession() as any });
      mockApi.saveDebateSession.mockRejectedValueOnce(new Error('Disk full'));

      await useDebateStore.getState().saveDebate();

      expect(useDebateStore.getState().debateError).toBeTruthy();
    });

    it('does nothing when activeDebate is null', async () => {
      await useDebateStore.getState().saveDebate();
      expect(mockApi.saveDebateSession).not.toHaveBeenCalled();
    });
  });

  describe('runClarification error handling', () => {
    it('adds error transcript entry when AI generation fails', async () => {
      useDebateStore.setState({ activeDebate: makeSession() as any });
      mockApi.generateText.mockRejectedValueOnce(new Error('API timeout'));

      await useDebateStore.getState().runClarification();

      const transcript = useDebateStore.getState().activeDebate!.transcript;
      const errorEntry = transcript.find((e: any) => e.type === 'system' && e.content.includes('Failed'));
      expect(errorEntry).toBeTruthy();
      // Must clear generating state
      expect(useDebateStore.getState().debateGenerating).toBeNull();
    });

    it('does not run if already generating', async () => {
      useDebateStore.setState({
        activeDebate: makeSession() as any,
        debateGenerating: 'prometheus',
      });

      await useDebateStore.getState().runClarification();

      expect(mockApi.generateText).not.toHaveBeenCalled();
    });

    it('does not run if clarification already exists in transcript', async () => {
      const session = makeSession({
        transcript: [
          { id: 'c1', timestamp: 't', type: 'clarification', speaker: 'system', content: 'Q1', taxonomy_refs: [] },
        ],
      });
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().runClarification();

      expect(mockApi.generateText).not.toHaveBeenCalled();
    });
  });

  describe('submitAnswersAndSynthesize error handling', () => {
    it('sets debateError on synthesis failure', async () => {
      const session = makeSession({
        transcript: [
          { id: 'c1', timestamp: 't', type: 'clarification', speaker: 'system', content: 'Q1', taxonomy_refs: [], metadata: { questions: ['What scope?'] } },
        ],
      });
      useDebateStore.setState({ activeDebate: session as any });
      mockApi.generateText.mockRejectedValueOnce(new Error('Rate limited'));

      await useDebateStore.getState().submitAnswersAndSynthesize('My answers');

      expect(useDebateStore.getState().debateError).toContain('Rate limited');
    });
  });

  describe('compressOldTranscript error handling', () => {
    it('sets debateError on compression failure', async () => {
      const entries = Array.from({ length: 15 }, (_, i) => ({
        id: `e${i}`, timestamp: 't', type: 'debate', speaker: 'prometheus', content: `Entry ${i}`, taxonomy_refs: [],
      }));
      useDebateStore.setState({ activeDebate: makeSession({ transcript: entries }) as any });
      mockApi.generateText.mockRejectedValueOnce(new Error('Compression failed'));

      await useDebateStore.getState().compressOldTranscript();

      expect(useDebateStore.getState().debateError).toContain('Context compression failed');
      expect(useDebateStore.getState().debateGenerating).toBeNull();
    });
  });
});

// ── 6. Concurrent Mutations ─────────────────────────────────

describe('Concurrent mutations', () => {
  it('multiple set() calls accumulate correctly', () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    // Simulate rapid state updates
    useDebateStore.getState().setError('error1');
    useDebateStore.getState().setGenerating('prometheus');
    useDebateStore.getState().inspectNode('AN-1');

    const state = useDebateStore.getState();
    expect(state.debateError).toBe('error1');
    expect(state.debateGenerating).toBe('prometheus');
    expect(state.inspectedNodeId).toBe('AN-1');
  });

  it('multiple addTranscriptEntry calls produce distinct entries', () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    const id1 = useDebateStore.getState().addTranscriptEntry({
      type: 'user', speaker: 'user', content: 'First', taxonomy_refs: [],
    });
    const id2 = useDebateStore.getState().addTranscriptEntry({
      type: 'user', speaker: 'user', content: 'Second', taxonomy_refs: [],
    });

    expect(id1).not.toBe(id2);
    expect(useDebateStore.getState().activeDebate!.transcript).toHaveLength(2);
  });
});

// ── 7. Session Data Management ──────────────────────────────

describe('Session data management', () => {
  describe('updateTopic', () => {
    it('updates topic fields on activeDebate', () => {
      useDebateStore.setState({ activeDebate: makeSession() as any });

      useDebateStore.getState().updateTopic({ refined: 'Refined AI governance' });

      const topic = useDebateStore.getState().activeDebate!.topic;
      expect(topic.refined).toBe('Refined AI governance');
      expect(topic.original).toBe('AI governance'); // unchanged
    });

    it('does nothing when activeDebate is null', () => {
      useDebateStore.getState().updateTopic({ refined: 'test' });
      expect(useDebateStore.getState().activeDebate).toBeNull();
    });
  });

  describe('togglePover', () => {
    it('adds a POVer to active_povers', async () => {
      const session = makeSession({ active_povers: ['prometheus', 'sentinel'] });
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().togglePover('cassandra');

      expect(useDebateStore.getState().activeDebate!.active_povers).toContain('cassandra');
    });

    it('removes a POVer if currently present', async () => {
      const session = makeSession({ active_povers: ['prometheus', 'sentinel', 'cassandra'] });
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().togglePover('cassandra');

      expect(useDebateStore.getState().activeDebate!.active_povers).not.toContain('cassandra');
    });

    it('does not remove if it would leave fewer than 1 AI POVer', async () => {
      const session = makeSession({ active_povers: ['prometheus'] });
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().togglePover('prometheus');

      // Should still have prometheus since removing would leave 0 AI povers
      expect(useDebateStore.getState().activeDebate!.active_povers).toContain('prometheus');
    });

    it('saves after toggling', async () => {
      const session = makeSession();
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().togglePover('cassandra');

      expect(mockApi.saveDebateSession).toHaveBeenCalled();
    });
  });

  describe('setResponseLength', () => {
    it('updates the responseLength state', () => {
      useDebateStore.getState().setResponseLength('brief');
      expect(useDebateStore.getState().responseLength).toBe('brief');
    });
  });

  describe('setAudience', () => {
    it('updates audience state', () => {
      useDebateStore.getState().setAudience('researchers');
      expect(useDebateStore.getState().audience).toBe('researchers');
    });

    it('also updates audience on activeDebate if present', () => {
      useDebateStore.setState({ activeDebate: makeSession() as any });

      useDebateStore.getState().setAudience('general_public');

      expect(useDebateStore.getState().activeDebate!.audience).toBe('general_public');
    });
  });
});

// ── 8. Abort/Cancel ─────────────────────────────────────────

describe('cancelDebate', () => {
  it('clears debateGenerating and debateActivity', () => {
    useDebateStore.setState({
      debateGenerating: 'prometheus',
      debateActivity: 'Generating response...',
    });

    useDebateStore.getState().cancelDebate();

    expect(useDebateStore.getState().debateGenerating).toBeNull();
    expect(useDebateStore.getState().debateActivity).toBeNull();
  });
});

// ── 9. Config Management ────────────────────────────────────

describe('Config management', () => {
  describe('setOpeningOrder', () => {
    it('sets the opening order for debate statements', () => {
      useDebateStore.getState().setOpeningOrder(['sentinel', 'cassandra', 'prometheus']);
      expect(useDebateStore.getState().openingOrder).toEqual(['sentinel', 'cassandra', 'prometheus']);
    });
  });

  describe('setInitialCrossRespondRounds', () => {
    it('sets the cross-respond rounds count', () => {
      useDebateStore.getState().setInitialCrossRespondRounds(5);
      expect(useDebateStore.getState().initialCrossRespondRounds).toBe(5);
    });
  });

  describe('setEntryDisplayTier', () => {
    it('sets the display tier for a transcript entry', () => {
      const session = makeSession({
        transcript: [
          { id: 'e1', timestamp: 't', type: 'debate', speaker: 'prometheus', content: 'Hello', taxonomy_refs: [] },
        ],
      });
      useDebateStore.setState({ activeDebate: session as any });

      useDebateStore.getState().setEntryDisplayTier('e1', 'brief');

      const entry = useDebateStore.getState().activeDebate!.transcript.find((e: any) => e.id === 'e1');
      expect(entry!.display_tier).toBe('brief');
    });

    it('does nothing for nonexistent entry id', () => {
      const session = makeSession({
        transcript: [
          { id: 'e1', timestamp: 't', type: 'debate', speaker: 'prometheus', content: 'Hello', taxonomy_refs: [] },
        ],
      });
      useDebateStore.setState({ activeDebate: session as any });

      useDebateStore.getState().setEntryDisplayTier('nonexistent', 'brief');

      // Should not throw; transcript unchanged
      expect(useDebateStore.getState().activeDebate!.transcript).toHaveLength(1);
    });
  });
});

// ── 10. Diagnostics ─────────────────────────────────────────

describe('Diagnostics', () => {
  describe('selectDiagEntry', () => {
    it('sets selectedDiagEntry', () => {
      useDebateStore.getState().selectDiagEntry('entry-42');
      expect(useDebateStore.getState().selectedDiagEntry).toBe('entry-42');
    });

    it('clears selectedDiagEntry with null', () => {
      useDebateStore.setState({ selectedDiagEntry: 'entry-42' });
      useDebateStore.getState().selectDiagEntry(null);
      expect(useDebateStore.getState().selectedDiagEntry).toBeNull();
    });
  });

  describe('setDiagPopoutOpen', () => {
    it('sets diagPopoutOpen flag', () => {
      useDebateStore.getState().setDiagPopoutOpen(true);
      expect(useDebateStore.getState().diagPopoutOpen).toBe(true);
    });
  });
});

// ── 11. Warnings ────────────────────────────────────────────

describe('Warnings', () => {
  describe('clearWarnings', () => {
    it('clears all debate warnings', () => {
      useDebateStore.setState({ debateWarnings: ['w1', 'w2', 'w3'] });

      useDebateStore.getState().clearWarnings();

      expect(useDebateStore.getState().debateWarnings).toEqual([]);
    });
  });
});

// ── 12. Claims Management (Phase 2.5) ──────────────────────

describe('Claims management', () => {
  const sessionWithClaims = () => makeSession({
    document_analysis: {
      i_nodes: [
        { id: 'inode-1', text: 'AI is transformative', taxonomy_refs: [] },
        { id: 'inode-2', text: 'Regulation is needed', taxonomy_refs: [] },
      ],
      tension_points: [
        { id: 'tp-1', description: 'Innovation vs Safety', i_node_ids: ['inode-1', 'inode-2'] },
      ],
      claims_summary: 'Two key claims',
    },
    argument_network: {
      nodes: [
        { id: 'inode-1', text: 'AI is transformative', speaker: 'document', source_entry_id: '', taxonomy_refs: [], turn_number: 0 },
        { id: 'inode-2', text: 'Regulation is needed', speaker: 'document', source_entry_id: '', taxonomy_refs: [], turn_number: 0 },
      ],
      edges: [],
    },
  });

  describe('updateClaim', () => {
    it('updates claim text in document_analysis and argument_network', () => {
      useDebateStore.setState({ activeDebate: sessionWithClaims() as any });

      useDebateStore.getState().updateClaim('inode-1', 'AI is very transformative');

      const state = useDebateStore.getState().activeDebate!;
      const iNode = (state as any).document_analysis.i_nodes.find((n: any) => n.id === 'inode-1');
      expect(iNode.text).toBe('AI is very transformative');

      const anNode = (state as any).argument_network.nodes.find((n: any) => n.id === 'inode-1');
      expect(anNode.text).toBe('AI is very transformative');
    });

    it('does nothing when document_analysis is absent', () => {
      useDebateStore.setState({ activeDebate: makeSession() as any });
      useDebateStore.getState().updateClaim('inode-1', 'new text');
      // No error thrown
    });
  });

  describe('deleteClaim', () => {
    it('removes claim from document_analysis and argument_network', () => {
      useDebateStore.setState({ activeDebate: sessionWithClaims() as any });

      useDebateStore.getState().deleteClaim('inode-1');

      const state = useDebateStore.getState().activeDebate!;
      const iNodes = (state as any).document_analysis.i_nodes;
      expect(iNodes).toHaveLength(1);
      expect(iNodes[0].id).toBe('inode-2');

      const anNodes = (state as any).argument_network.nodes;
      expect(anNodes).toHaveLength(1);
    });

    it('removes tension points that become empty after deletion', () => {
      // Create a session where a tension point only refers to the claim being deleted
      const session = makeSession({
        document_analysis: {
          i_nodes: [
            { id: 'inode-1', text: 'Claim 1', taxonomy_refs: [] },
            { id: 'inode-2', text: 'Claim 2', taxonomy_refs: [] },
          ],
          tension_points: [
            { id: 'tp-solo', description: 'Solo tension', i_node_ids: ['inode-1'] },
            { id: 'tp-multi', description: 'Multi tension', i_node_ids: ['inode-1', 'inode-2'] },
          ],
          claims_summary: 'Two claims',
        },
        argument_network: { nodes: [], edges: [] },
      });
      useDebateStore.setState({ activeDebate: session as any });

      useDebateStore.getState().deleteClaim('inode-1');

      const tensions = (useDebateStore.getState().activeDebate as any).document_analysis.tension_points;
      // tp-solo should be removed (empty i_node_ids), tp-multi should remain with just inode-2
      expect(tensions).toHaveLength(1);
      expect(tensions[0].id).toBe('tp-multi');
      expect(tensions[0].i_node_ids).toEqual(['inode-2']);
    });
  });
});

// ── 13. Argument Network Sub-Scores ─────────────────────────

describe('updateAnNodeSubScore', () => {
  it('updates a sub-score and recalculates base_strength', () => {
    const session = makeSession({
      argument_network: {
        nodes: [
          {
            id: 'AN-1', text: 'Claim', speaker: 'prometheus',
            source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1,
            bdi_sub_scores: { evidence: 0.4, specificity: 0.6 },
            base_strength: 0.5,
          },
        ],
        edges: [],
      },
    });
    useDebateStore.setState({ activeDebate: session as any });

    useDebateStore.getState().updateAnNodeSubScore('AN-1', 'evidence', 0.8);

    const node = (useDebateStore.getState().activeDebate as any).argument_network.nodes[0];
    expect(node.bdi_sub_scores.evidence).toBe(0.8);
    // base_strength = average of (0.8, 0.6) = 0.7
    expect(node.base_strength).toBeCloseTo(0.7);
  });

  it('does nothing when argument_network is absent', () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });
    useDebateStore.getState().updateAnNodeSubScore('AN-1', 'evidence', 0.5);
    // No error thrown
  });

  it('does nothing for nonexistent node', () => {
    const session = makeSession({
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'Claim', speaker: 'prometheus', bdi_sub_scores: { x: 0.5 }, base_strength: 0.5 },
        ],
        edges: [],
      },
    });
    useDebateStore.setState({ activeDebate: session as any });

    useDebateStore.getState().updateAnNodeSubScore('AN-999', 'x', 0.9);

    // Original node unchanged
    const node = (useDebateStore.getState().activeDebate as any).argument_network.nodes[0];
    expect(node.bdi_sub_scores.x).toBe(0.5);
  });
});

// ── 14. Reflections ─────────────────────────────────────────

describe('Reflection edits', () => {
  const makeReflections = () => [
    {
      pover: 'accelerationist',
      label: 'Prometheus',
      reflection_summary: 'Reflections on AI acceleration',
      edits: [
        {
          edit_type: 'revise' as const,
          node_id: 'acc-B-001',
          category: 'Beliefs' as const,
          current_label: 'Old label',
          proposed_label: 'New label',
          current_description: 'Old desc',
          proposed_description: 'New desc',
          rationale: 'Better framing',
          confidence: 'high' as const,
          evidence_entries: ['e1'],
          status: 'pending' as const,
        },
        {
          edit_type: 'add' as const,
          node_id: null,
          category: 'Desires' as const,
          current_label: null,
          proposed_label: 'New desire',
          current_description: null,
          proposed_description: 'A new desired outcome',
          rationale: 'Identified in debate',
          confidence: 'medium' as const,
          evidence_entries: ['e2'],
          status: 'pending' as const,
        },
      ],
    },
  ];

  describe('dismissReflectionEdit', () => {
    it('marks an edit as dismissed', () => {
      useDebateStore.setState({ reflections: makeReflections() });

      useDebateStore.getState().dismissReflectionEdit('accelerationist', 0);

      const edits = useDebateStore.getState().reflections[0].edits;
      expect(edits[0].status).toBe('dismissed');
      expect(edits[1].status).toBe('pending'); // unchanged
    });
  });

  describe('applyReflectionEdit', () => {
    it('marks an edit as approved', () => {
      useDebateStore.setState({
        reflections: makeReflections(),
        activeDebateId: 'debate-1',
      });

      useDebateStore.getState().applyReflectionEdit('accelerationist', 0);

      const edits = useDebateStore.getState().reflections[0].edits;
      expect(edits[0].status).toBe('approved');
    });

    it('calls taxonomy store for revise edits', () => {
      useDebateStore.setState({ reflections: makeReflections() });

      useDebateStore.getState().applyReflectionEdit('accelerationist', 0);

      expect(mockTaxonomyState.updatePovNode).toHaveBeenCalledWith(
        'accelerationist',
        'acc-B-001',
        expect.objectContaining({ label: 'New label', description: 'New desc' }),
      );
      expect(mockTaxonomyState.save).toHaveBeenCalled();
    });

    it('calls taxonomy store for add edits', () => {
      useDebateStore.setState({
        reflections: makeReflections(),
        activeDebateId: 'debate-1',
      });

      useDebateStore.getState().applyReflectionEdit('accelerationist', 1);

      expect(mockTaxonomyState.createPovNode).toHaveBeenCalledWith('accelerationist', 'Desires');
    });

    it('does nothing for nonexistent reflection', () => {
      useDebateStore.setState({ reflections: makeReflections() });

      useDebateStore.getState().applyReflectionEdit('nonexistent-pov', 0);

      expect(mockTaxonomyState.updatePovNode).not.toHaveBeenCalled();
    });
  });
});

// ── 15. loadSessions ────────────────────────────────────────

describe('loadSessions', () => {
  it('fetches sessions from IPC and stores them', async () => {
    const mockSessions = [
      { id: 's1', title: 'Debate 1', created_at: '2026-01-01', updated_at: '2026-01-01', phase: 'setup' },
      { id: 's2', title: 'Debate 2', created_at: '2026-01-02', updated_at: '2026-01-02', phase: 'debate' },
    ];
    mockApi.listDebateSessions.mockResolvedValueOnce(mockSessions);

    await useDebateStore.getState().loadSessions();

    expect(useDebateStore.getState().sessions).toEqual(mockSessions);
    expect(useDebateStore.getState().sessionsLoading).toBe(false);
  });

  it('sets sessionsLoading to true while loading', async () => {
    let resolvePromise: (v: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => { resolvePromise = resolve; });
    mockApi.listDebateSessions.mockReturnValueOnce(pending);

    const loadPromise = useDebateStore.getState().loadSessions();

    expect(useDebateStore.getState().sessionsLoading).toBe(true);

    resolvePromise!([]);
    await loadPromise;

    expect(useDebateStore.getState().sessionsLoading).toBe(false);
  });
});

// ── 16. saveDebate ──────────────────────────────────────────

describe('saveDebate', () => {
  it('saves current activeDebate via IPC', async () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    await useDebateStore.getState().saveDebate();

    expect(mockApi.saveDebateSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-1' }),
    );
  });

  it('updates sessions list summary after save', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({ title: 'Updated Title' }) as any,
      sessions: [{ id: 'session-1', title: 'Old Title', updated_at: 'old', phase: 'setup' }],
    });

    await useDebateStore.getState().saveDebate();

    const sessions = useDebateStore.getState().sessions;
    expect(sessions[0].title).toBe('Updated Title');
  });
});

// ── 17. inspectNode ─────────────────────────────────────────

describe('inspectNode', () => {
  it('sets the inspected node id', () => {
    useDebateStore.getState().inspectNode('AN-42');
    expect(useDebateStore.getState().inspectedNodeId).toBe('AN-42');
  });

  it('clears with null', () => {
    useDebateStore.setState({ inspectedNodeId: 'AN-42' });
    useDebateStore.getState().inspectNode(null);
    expect(useDebateStore.getState().inspectedNodeId).toBeNull();
  });
});

// ── 18. setGenerating ───────────────────────────────────────

describe('setGenerating', () => {
  it('sets the generating POVer', () => {
    useDebateStore.getState().setGenerating('sentinel');
    expect(useDebateStore.getState().debateGenerating).toBe('sentinel');
  });

  it('clears with null', () => {
    useDebateStore.setState({ debateGenerating: 'sentinel' });
    useDebateStore.getState().setGenerating(null);
    expect(useDebateStore.getState().debateGenerating).toBeNull();
  });
});

// ── 19. proceedToOpening ────────────────────────────────────

describe('proceedToOpening', () => {
  it('sets phase to opening and creates a system transcript entry', () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    useDebateStore.getState().proceedToOpening();

    expect(useDebateStore.getState().activeDebate!.phase).toBe('opening');
    const transcript = useDebateStore.getState().activeDebate!.transcript;
    expect(transcript.length).toBeGreaterThanOrEqual(1);
    const lastEntry = transcript[transcript.length - 1];
    expect(lastEntry.type).toBe('system');
    expect(lastEntry.content).toContain('debate begins');
  });

  it('sets a randomized openingOrder from active AI POVers', () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    useDebateStore.getState().proceedToOpening();

    const order = useDebateStore.getState().openingOrder;
    expect(order.length).toBe(3); // all 3 AI povers active
    expect(new Set(order)).toEqual(new Set(['prometheus', 'sentinel', 'cassandra']));
  });

  it('does nothing when activeDebate is null', () => {
    useDebateStore.getState().proceedToOpening();
    // No error thrown, state unchanged
    expect(useDebateStore.getState().activeDebate).toBeNull();
  });
});

// ── 20. Context compression guard ───────────────────────────

describe('compressOldTranscript guards', () => {
  it('does not compress with fewer than MIN_TO_COMPRESS entries', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`, timestamp: 't', type: 'debate', speaker: 'prometheus', content: `Entry ${i}`, taxonomy_refs: [],
    }));
    useDebateStore.setState({ activeDebate: makeSession({ transcript: entries }) as any });

    await useDebateStore.getState().compressOldTranscript();

    // Should not call AI since < 12 entries
    expect(mockApi.generateText).not.toHaveBeenCalled();
  });
});

// ── 22. createSituationDebate ───────────────────────────────

describe('createSituationDebate', () => {
  it('throws when the situation node is not found', async () => {
    // mockTaxonomyState.situations.nodes is empty by default
    await expect(
      useDebateStore.getState().createSituationDebate('cc-nonexistent'),
    ).rejects.toThrow('not found');
  });
});
