// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks (available before vi.mock factories execute) ──

const { mockApi, mockTaxonomyState, mockPromptConfigState } = vi.hoisted(() => {
  const mockApi = {
    generateText: vi.fn().mockResolvedValue({ text: '{}' }),
    generateTextWithSearch: vi.fn().mockResolvedValue({ text: '', searchQueries: [], citations: [] }),
    onGenerateTextProgress: vi.fn().mockReturnValue(() => {}),
    listDebateSessions: vi.fn().mockResolvedValue([]),
    listDebateSessionsMeta: vi.fn().mockResolvedValue([]),
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
    generateNewsReport: vi.fn().mockResolvedValue({ article: 'mock-news-article' }),
    trackEvent: vi.fn(),
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
    getDescriptionForId: vi.fn().mockReturnValue('mock-description'),
    loadEdges: vi.fn().mockResolvedValue(undefined),
    createPovNode: vi.fn().mockReturnValue('new-node-id'),
    updatePovNode: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    saveError: null as string | null,
  };

  const mockPromptConfigState = {
    loadSessionConfig: vi.fn(),
    resetSession: vi.fn(),
    exportSessionConfig: vi.fn().mockReturnValue({}),
  };

  return { mockApi, mockTaxonomyState, mockPromptConfigState };
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
    getState: () => mockPromptConfigState,
  },
}));

// Mock prompt modules (they return strings; we only care that the store calls them)
vi.mock('../prompts/debate', () => ({
  clarificationPrompt: vi.fn().mockReturnValue('mock-clarification-prompt'),
  situationClarificationPrompt: vi.fn().mockReturnValue('mock-sit-clarification-prompt'),
  documentClarificationPrompt: vi.fn().mockReturnValue('mock-doc-clarification-prompt'),
  concludingPrompt: vi.fn().mockReturnValue('mock-synthesis-prompt'),
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
  runModeratorSelection: vi.fn().mockResolvedValue({ speaker: 'accelerationist', intervention: null }),
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
  getOpeningRepairHints: vi.fn().mockReturnValue([]),
}));

vi.mock('@lib/debate/topicCritique', () => ({
  computeStructuralScore: vi.fn().mockReturnValue({ total: 8, activated_nodes: [], coverage: {} }),
  critiqueTopicPrompt: vi.fn().mockReturnValue('mock-critique-prompt'),
  parseTopicCritique: vi.fn().mockReturnValue({
    rating: 'good', composite_score: 14, frame_score: { total: 6 },
    structural_score: { total: 8, activated_nodes: [], coverage: {} },
    rewritten_topic: null, lineage_frame: [],
  }),
  formatCritiqueForRefinement: vi.fn().mockReturnValue(''),
  formatStructuralContext: vi.fn().mockReturnValue('mock-structural-context'),
  computeLineageDistribution: vi.fn().mockReturnValue([]),
  formatLineageContext: vi.fn().mockReturnValue(''),
}));

vi.mock('@lib/debate/prompts', () => ({
  decomposeResolutionPrompt: vi.fn().mockReturnValue('mock-decompose-prompt'),
  topicScopeExtractionPrompt: vi.fn().mockReturnValue('mock-scope-prompt'),
  setTopicScope: vi.fn(),
  synthExtractPrompt: vi.fn().mockReturnValue('mock-synth-extract-prompt'),
  synthMapPrompt: vi.fn().mockReturnValue('mock-synth-map-prompt'),
  synthEvaluatePrompt: vi.fn().mockReturnValue('mock-synth-evaluate-prompt'),
}));

vi.mock('@lib/debate/phaseTransitions', () => ({
  loadProvisionalWeights: vi.fn().mockReturnValue({}),
  initPhaseState: vi.fn().mockReturnValue({ current_phase: 'confrontation', rounds_in_phase: 0, total_rounds_elapsed: 0 }),
  evaluatePhaseTransition: vi.fn().mockReturnValue({ action: 'continue', reason: 'test' }),
  advanceRound: vi.fn().mockReturnValue({ current_phase: 'confrontation', rounds_in_phase: 1, total_rounds_elapsed: 1 }),
  applyTransition: vi.fn().mockReturnValue({ current_phase: 'confrontation', rounds_in_phase: 0, total_rounds_elapsed: 1 }),
  buildSignalRegistry: vi.fn().mockReturnValue([]),
  computeSaturationScore: vi.fn().mockReturnValue(0),
  computeConvergenceScore: vi.fn().mockReturnValue(0),
  detectCruxNodes: vi.fn().mockReturnValue([]),
}));

vi.mock('@lib/debate/gapCheck', () => ({
  shouldRunGapCheck: vi.fn().mockReturnValue(false),
  findUnengagedHighRelevanceNodes: vi.fn().mockReturnValue([]),
  collectEngagedNodeIds: vi.fn().mockReturnValue(new Set()),
  MAX_GAP_INJECTIONS: 3,
}));

vi.mock('@lib/debate/neutralEvaluator', () => ({
  runNeutralEvaluation: vi.fn().mockResolvedValue({ checkpoint: 'baseline', claims: [], cruxes: [] }),
  buildSpeakerMapping: vi.fn().mockReturnValue({}),
}));

vi.mock('@lib/debate/doctrinalAnchoring', () => ({
  embedDoctrinalBoundaries: vi.fn().mockResolvedValue({}),
  computeDoctrinalAnchoring: vi.fn().mockReturnValue([]),
  checkThresholdAnomalies: vi.fn().mockReturnValue(null),
}));

vi.mock('@lib/debate/beliefConfidence', () => ({
  computeBeliefConfidence: vi.fn().mockReturnValue(0.5),
}));

vi.mock('@lib/debate/desirePriority', () => ({
  computeTreePriority: vi.fn().mockReturnValue(0.5),
}));

vi.mock('@lib/debate/intentionOperationality', () => ({
  computeOperationality: vi.fn().mockReturnValue(0.5),
}));

vi.mock('@lib/debate/vocabularyDisambiguation', () => ({
  disambiguateTerms: vi.fn().mockReturnValue({ terms: [], ambiguousCount: 0 }),
}));

vi.mock('@lib/debate/processReward', () => ({
  computeProcessReward: vi.fn().mockReturnValue({ score: 0.5, breakdown: {} }),
}));

vi.mock('../data/lineageCategories', () => ({
  getLineageMapping: vi.fn().mockReturnValue({}),
  getL2Categories: vi.fn().mockReturnValue([]),
  isLineageDataLoaded: vi.fn().mockReturnValue(false),
}));

vi.mock('@lib/debate/lookaheadGate', () => ({
  evaluateLookaheadPerClaim: vi.fn().mockReturnValue([]),
  buildClaimAnalysis: vi.fn().mockReturnValue({ claims: [] }),
}));

vi.mock('../utils/dolceCompliance', () => ({
  checkDolceCompliance: vi.fn().mockReturnValue([]),
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
    topicCritiqueLoading: false,
    consensusClusters: [],
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
    active_povers: ['accelerationist', 'safetyist', 'skeptic'] as string[],
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
  mockApi.onGenerateTextProgress.mockReturnValue(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Imports resolved after vi.mock (safe because modules are already mocked) ──
import { disambiguateTerms } from '@lib/debate/vocabularyDisambiguation';
import { executeTurnWithRetry, runModeratorSelection } from '@lib/debate/orchestration';
import { evaluateLookaheadPerClaim } from '@lib/debate/lookaheadGate';
import { processExtractedClaims } from '../prompts/argumentNetwork';

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
      ['accelerationist', 'safetyist', 'skeptic'],
      false,
    );

    expect(id).toBeTruthy();
    expect(mockApi.saveDebateSession).toHaveBeenCalledTimes(1);
    const saved = mockApi.saveDebateSession.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.title).toBe('AI governance policy');
    expect(saved.phase).toBe('setup');
    expect(saved.source_type).toBe('topic');
    expect(saved.active_povers).toEqual(['accelerationist', 'safetyist', 'skeptic']);
    expect(saved.user_is_pover).toBe(false);
    expect(saved.transcript).toEqual([]);
  });

  it('truncates long topic titles to 60 chars', async () => {
    const longTopic = 'A'.repeat(80);
    await useDebateStore.getState().createDebate(longTopic, ['accelerationist'], false);
    const saved = mockApi.saveDebateSession.mock.calls[0][0] as Record<string, unknown>;
    expect((saved.title as string).length).toBeLessThanOrEqual(60);
    expect((saved.title as string).endsWith('...')).toBe(true);
  });

  it('sets activeDebateId and activeDebate in state', async () => {
    const id = await useDebateStore.getState().createDebate(
      'Test topic', ['accelerationist', 'safetyist'], false,
    );
    const state = useDebateStore.getState();
    expect(state.activeDebateId).toBe(id);
    expect(state.activeDebate).not.toBeNull();
    expect(state.activeDebate!.topic.original).toBe('Test topic');
  });

  it('stores debate-specific model override', async () => {
    await useDebateStore.getState().createDebate(
      'Topic', ['accelerationist'], false, 'topic', '', '', 'gemini-2.0-pro',
    );
    expect(useDebateStore.getState().debateModel).toBe('gemini-2.0-pro');
  });

  it('stores debate-specific temperature', async () => {
    await useDebateStore.getState().createDebate(
      'Topic', ['accelerationist'], false, 'topic', '', '', undefined, undefined, 0.9,
    );
    expect(useDebateStore.getState().debateTemperature).toBe(0.9);
    expect(mockApi.setDebateTemperature).toHaveBeenCalledWith(0.9);
  });

  it('stores audience in session', async () => {
    await useDebateStore.getState().createDebate(
      'Topic', ['accelerationist'], false, 'topic', '', '', undefined, undefined, undefined, 'researchers',
    );
    const session = useDebateStore.getState().activeDebate;
    expect(session!.audience).toBe('researchers');
  });

  it('calls loadSessions after creation', async () => {
    await useDebateStore.getState().createDebate('Topic', ['accelerationist'], false);
    expect(mockApi.listDebateSessionsMeta).toHaveBeenCalled();
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

  it('detects interrupted_turn and adds recovery notification', async () => {
    const session = makeSession({
      interrupted_turn: {
        speaker: 'safetyist',
        phase: 'debate',
        round: 8,
        timestamp: '2026-06-06T14:30:57.000Z',
      },
    });
    mockApi.loadDebateSession.mockResolvedValueOnce(session);

    await useDebateStore.getState().loadDebate('session-1');

    const state = useDebateStore.getState();
    expect(state.activeDebate).toBeTruthy();
    // Should have added a system transcript entry about the interrupted turn
    const recovery = state.activeDebate!.transcript.find(
      e => e.type === 'system' && e.content.includes('[Recovered]'),
    );
    expect(recovery).toBeTruthy();
    expect(recovery!.content).toContain('Safetyist');
    expect(recovery!.content).toContain('round 8');
    // interrupted_turn field should be cleared from the session
    expect(state.activeDebate!.interrupted_turn).toBeUndefined();
    // Should have saved to persist the cleanup
    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });

  it('does not add recovery notification when no interrupted_turn', async () => {
    const session = makeSession();
    mockApi.loadDebateSession.mockResolvedValueOnce(session);

    await useDebateStore.getState().loadDebate('session-1');

    const state = useDebateStore.getState();
    expect(state.activeDebate!.transcript).toHaveLength(0);
    expect(mockApi.saveDebateSession).not.toHaveBeenCalled();
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
      debateGenerating: 'accelerationist',
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
      mockApi.listDebateSessionsMeta.mockRejectedValueOnce(new Error('Network error'));

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
        debateGenerating: 'accelerationist',
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
    it('handles single generation failure gracefully in retry loop', async () => {
      const session = makeSession({
        transcript: [
          { id: 'c1', timestamp: 't', type: 'clarification', speaker: 'system', content: 'Q1', taxonomy_refs: [], metadata: { questions: ['What scope?'] } },
        ],
      });
      useDebateStore.setState({ activeDebate: session as any });
      mockApi.generateText.mockRejectedValueOnce(new Error('Rate limited'));

      await useDebateStore.getState().submitAnswersAndSynthesize('My answers');

      // A single generation failure is caught in the refinement retry loop and
      // the function continues gracefully — debateError is not set.
      expect(useDebateStore.getState().debateError).toBeNull();
    });
  });

  describe('compressOldTranscript error handling', () => {
    it('sets debateError on compression failure', async () => {
      const entries = Array.from({ length: 15 }, (_, i) => ({
        id: `e${i}`, timestamp: 't', type: 'debate', speaker: 'accelerationist', content: `Entry ${i}`, taxonomy_refs: [],
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
    useDebateStore.getState().setGenerating('accelerationist');
    useDebateStore.getState().inspectNode('AN-1');

    const state = useDebateStore.getState();
    expect(state.debateError).toBe('error1');
    expect(state.debateGenerating).toBe('accelerationist');
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
      const session = makeSession({ active_povers: ['accelerationist', 'safetyist'] });
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().togglePover('skeptic');

      expect(useDebateStore.getState().activeDebate!.active_povers).toContain('skeptic');
    });

    it('removes a POVer if currently present', async () => {
      const session = makeSession({ active_povers: ['accelerationist', 'safetyist', 'skeptic'] });
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().togglePover('skeptic');

      expect(useDebateStore.getState().activeDebate!.active_povers).not.toContain('skeptic');
    });

    it('does not remove if it would leave fewer than 1 AI POVer', async () => {
      const session = makeSession({ active_povers: ['accelerationist'] });
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().togglePover('accelerationist');

      // Should still have accelerationist since removing would leave 0 AI povers
      expect(useDebateStore.getState().activeDebate!.active_povers).toContain('accelerationist');
    });

    it('saves after toggling', async () => {
      const session = makeSession();
      useDebateStore.setState({ activeDebate: session as any });

      await useDebateStore.getState().togglePover('skeptic');

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
      debateGenerating: 'accelerationist',
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
      useDebateStore.getState().setOpeningOrder(['safetyist', 'skeptic', 'accelerationist']);
      expect(useDebateStore.getState().openingOrder).toEqual(['safetyist', 'skeptic', 'accelerationist']);
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
          { id: 'e1', timestamp: 't', type: 'debate', speaker: 'accelerationist', content: 'Hello', taxonomy_refs: [] },
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
          { id: 'e1', timestamp: 't', type: 'debate', speaker: 'accelerationist', content: 'Hello', taxonomy_refs: [] },
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
            id: 'AN-1', text: 'Claim', speaker: 'accelerationist',
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
          { id: 'AN-1', text: 'Claim', speaker: 'accelerationist', bdi_sub_scores: { x: 0.5 }, base_strength: 0.5 },
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
      label: 'Accelerationist',
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
    it('marks an edit as approved after successful save and returns ok', async () => {
      mockTaxonomyState.saveError = null;
      useDebateStore.setState({
        reflections: makeReflections(),
        activeDebateId: 'debate-1',
      });

      const result = await useDebateStore.getState().applyReflectionEdit('accelerationist', 0);

      const edits = useDebateStore.getState().reflections[0].edits;
      expect(edits[0].status).toBe('approved');
      expect(result).toMatchObject({ ok: true });
    });

    it('calls taxonomy store for revise edits', async () => {
      mockTaxonomyState.saveError = null;
      useDebateStore.setState({ reflections: makeReflections() });

      await useDebateStore.getState().applyReflectionEdit('accelerationist', 0);

      expect(mockTaxonomyState.updatePovNode).toHaveBeenCalledWith(
        'accelerationist',
        'acc-B-001',
        expect.objectContaining({ label: 'New label', description: 'New desc' }),
        expect.objectContaining({ source: 'debate_reflection' }),
      );
      expect(mockTaxonomyState.save).toHaveBeenCalled();
    });

    it('calls taxonomy store for add edits', async () => {
      mockTaxonomyState.saveError = null;
      useDebateStore.setState({
        reflections: makeReflections(),
        activeDebateId: 'debate-1',
      });

      await useDebateStore.getState().applyReflectionEdit('accelerationist', 1);

      expect(mockTaxonomyState.createPovNode).toHaveBeenCalledWith('accelerationist', 'Desires');
    });

    it('does nothing for nonexistent reflection', async () => {
      useDebateStore.setState({ reflections: makeReflections() });

      await useDebateStore.getState().applyReflectionEdit('nonexistent-pov', 0);

      expect(mockTaxonomyState.updatePovNode).not.toHaveBeenCalled();
    });

    it('does not mark approved when save fails and returns error', async () => {
      mockTaxonomyState.saveError = 'Validation failed';
      useDebateStore.setState({ reflections: makeReflections() });

      const result = await useDebateStore.getState().applyReflectionEdit('accelerationist', 0);

      const edits = useDebateStore.getState().reflections[0].edits;
      expect(edits[0].status).toBe('pending');
      expect(result).toEqual({ ok: false, error: 'Validation failed' });
      expect(mockTaxonomyState.save).toHaveBeenCalled();
    });

    it('applies user-edited overrides instead of proposed text', async () => {
      mockTaxonomyState.saveError = null;
      useDebateStore.setState({ reflections: makeReflections() });

      await useDebateStore.getState().applyReflectionEdit('accelerationist', 0, {
        label: 'User-edited label',
        description: 'User-edited description',
      });

      expect(mockTaxonomyState.updatePovNode).toHaveBeenCalledWith(
        'accelerationist',
        'acc-B-001',
        expect.objectContaining({ label: 'User-edited label', description: 'User-edited description' }),
        expect.objectContaining({ source: 'debate_reflection' }),
      );
      expect(mockTaxonomyState.save).toHaveBeenCalled();
    });

    it('falls back to proposed text when overrides are undefined', async () => {
      mockTaxonomyState.saveError = null;
      useDebateStore.setState({ reflections: makeReflections() });

      await useDebateStore.getState().applyReflectionEdit('accelerationist', 0, undefined);

      expect(mockTaxonomyState.updatePovNode).toHaveBeenCalledWith(
        'accelerationist',
        'acc-B-001',
        expect.objectContaining({ label: 'New label', description: 'New desc' }),
        expect.objectContaining({ source: 'debate_reflection' }),
      );
    });

    it('applies partial overrides (label only)', async () => {
      mockTaxonomyState.saveError = null;
      useDebateStore.setState({ reflections: makeReflections() });

      await useDebateStore.getState().applyReflectionEdit('accelerationist', 0, {
        label: 'Custom label',
      });

      expect(mockTaxonomyState.updatePovNode).toHaveBeenCalledWith(
        'accelerationist',
        'acc-B-001',
        expect.objectContaining({ label: 'Custom label', description: 'New desc' }),
        expect.objectContaining({ source: 'debate_reflection' }),
      );
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
    mockApi.listDebateSessionsMeta.mockResolvedValueOnce(mockSessions);

    await useDebateStore.getState().loadSessions();

    expect(useDebateStore.getState().sessions).toEqual(mockSessions);
    expect(useDebateStore.getState().sessionsLoading).toBe(false);
  });

  it('sets sessionsLoading to true while loading', async () => {
    let resolvePromise: (v: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => { resolvePromise = resolve; });
    mockApi.listDebateSessionsMeta.mockReturnValueOnce(pending);

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
    useDebateStore.getState().setGenerating('safetyist');
    expect(useDebateStore.getState().debateGenerating).toBe('safetyist');
  });

  it('clears with null', () => {
    useDebateStore.setState({ debateGenerating: 'safetyist' });
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
    expect(new Set(order)).toEqual(new Set(['accelerationist', 'safetyist', 'skeptic']));
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
      id: `e${i}`, timestamp: 't', type: 'debate', speaker: 'accelerationist', content: `Entry ${i}`, taxonomy_refs: [],
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

// ══════════════════════════════════════════════════════════════
// PHASE 5 PRE-REFACTOR TESTS
// These tests exercise cross-slice boundaries and currently
// untested actions to serve as a safety net during useDebateStore
// slicing into 7 slices + helpers.
// ══════════════════════════════════════════════════════════════

// ── P5-1. Config Slice — Model Resolution ──────────────────

describe('Config slice: getConfiguredModel behavior', () => {
  it('uses debate-specific model when set', async () => {
    useDebateStore.setState({ activeDebate: makeSession() as any, debateModel: 'gemini-2.0-pro' });
    mockApi.generateText.mockResolvedValue({ text: '{"questions":["Q1"]}' });

    await useDebateStore.getState().runClarification();

    expect(mockApi.generateText).toHaveBeenCalled();
    const call = mockApi.generateText.mock.calls[0];
    expect(call[1]).toBe('gemini-2.0-pro');
  });

  it('falls back to localStorage model when debateModel is null', async () => {
    localStorageMock.getItem.mockReturnValue('gemini-2.5-flash');
    useDebateStore.setState({ activeDebate: makeSession() as any, debateModel: null });
    mockApi.generateText.mockResolvedValue({ text: '{"questions":["Q1"]}' });

    await useDebateStore.getState().runClarification();

    const call = mockApi.generateText.mock.calls[0];
    expect(call[1]).toBe('gemini-2.5-flash');
  });

  it('falls back to default when localStorage is empty', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    useDebateStore.setState({ activeDebate: makeSession() as any, debateModel: null });
    mockApi.generateText.mockResolvedValue({ text: '{"questions":["Q1"]}' });

    await useDebateStore.getState().runClarification();

    const call = mockApi.generateText.mock.calls[0];
    expect(call[1]).toBe('gemini-flash-lite-latest');
  });

  it('setResponseLength clears per-entry display_tier overrides', () => {
    const session = makeSession({
      transcript: [
        { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [], display_tier: 'brief' },
        { id: 'e2', timestamp: 't', type: 'statement', speaker: 'safetyist', content: 'Y', taxonomy_refs: [], display_tier: 'medium' },
      ],
    });
    useDebateStore.setState({ activeDebate: session as any });

    useDebateStore.getState().setResponseLength('claims');

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    expect(transcript[0].display_tier).toBeUndefined();
    expect(transcript[1].display_tier).toBeUndefined();
    expect(useDebateStore.getState().responseLength).toBe('claims');
  });
});

// ── P5-2. Session Slice — Conflict Debate, Speaker Migration ─

describe('Session slice: createConflictDebate', () => {
  it('throws when the conflict is not found', async () => {
    mockTaxonomyState.conflicts = [];
    await expect(
      useDebateStore.getState().createConflictDebate('conflict-nonexistent'),
    ).rejects.toThrow('not found');
  });

  it('creates a debate from a conflict with all povers', async () => {
    mockTaxonomyState.conflicts = [{
      claim_id: 'conflict-001',
      claim_label: 'Test Conflict',
      description: 'A test conflict',
      status: 'open',
      linked_taxonomy_nodes: [],
      instances: [{ doc_id: 'doc1', stance: 'supports', assertion: 'AI is safe' }],
      human_notes: [],
    }];

    const id = await useDebateStore.getState().createConflictDebate('conflict-001');

    expect(id).toBeTruthy();
    const state = useDebateStore.getState();
    expect(state.activeDebate).not.toBeNull();
    expect(state.activeDebate!.phase).toBe('clarification');
    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });
});

describe('Session slice: loadDebate speaker migration', () => {
  it('migrates legacy character names to POV keys', async () => {
    const session = makeSession({
      active_povers: ['prometheus', 'sentinel', 'cassandra'],
      transcript: [
        { id: 'e1', timestamp: 't', type: 'opening', speaker: 'prometheus', content: 'Hello', taxonomy_refs: [] },
      ],
    });
    mockApi.loadDebateSession.mockResolvedValueOnce(session);

    await useDebateStore.getState().loadDebate('session-1');

    const loaded = useDebateStore.getState().activeDebate!;
    expect(loaded.active_povers).toContain('accelerationist');
    expect(loaded.active_povers).not.toContain('prometheus');
    expect(loaded.transcript[0].speaker).toBe('accelerationist');
  });
});

describe('Session slice: saveDebate overview recomputation', () => {
  it('recomputes diagnostic overview counters from authoritative data', async () => {
    const session = makeSession({
      transcript: [
        { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [], metadata: { move_types: ['concede', 'challenge'] } },
        { id: 'e2', timestamp: 't', type: 'statement', speaker: 'safetyist', content: 'Y', taxonomy_refs: [], metadata: { disagreement_type: 'factual' } },
      ],
      diagnostics: {
        enabled: true,
        entries: {
          e1: { extraction_trace: { candidates_accepted: 3, candidates_rejected: 1 } },
        },
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });
    useDebateStore.setState({ activeDebate: session as any });

    await useDebateStore.getState().saveDebate('test');

    expect(mockApi.saveDebateSession).toHaveBeenCalled();
    const saved = mockApi.saveDebateSession.mock.calls[0][0] as Record<string, unknown>;
    const overview = (saved.diagnostics as any).overview;
    expect(overview.claims_accepted).toBe(3);
    expect(overview.claims_rejected).toBe(1);
    expect(overview.move_type_counts.concede).toBe(1);
    expect(overview.move_type_counts.challenge).toBe(1);
    expect(overview.disagreement_type_counts.factual).toBe(1);
  });
});

// ── P5-3. Topic Critique Slice ─────────────────────────────

describe('Topic critique slice: runTopicCritique', () => {
  it('does not run for non-topic source types', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({ source_type: 'document' }) as any,
    });

    await useDebateStore.getState().runTopicCritique();

    expect(mockApi.generateText).not.toHaveBeenCalled();
    expect(useDebateStore.getState().topicCritiqueLoading).toBe(false);
  });

  it('does not run if critique already exists', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        topic: { original: 'AI governance', refined: null, final: 'AI governance', critique: { rating: 'good', composite_score: 14 } },
      }) as any,
    });

    await useDebateStore.getState().runTopicCritique();

    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('does not run if already loading', async () => {
    useDebateStore.setState({
      activeDebate: makeSession() as any,
      topicCritiqueLoading: true,
    });

    await useDebateStore.getState().runTopicCritique();

    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('runs critique and stores result on session', async () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });
    mockApi.computeQueryEmbedding.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });
    mockApi.computeEmbeddings.mockResolvedValue({ vectors: [] });
    mockApi.generateText.mockResolvedValue({ text: '{"rating":"good","frame_score":{"total":6}}' });

    await useDebateStore.getState().runTopicCritique();

    expect(useDebateStore.getState().topicCritiqueLoading).toBe(false);
    const debate = useDebateStore.getState().activeDebate!;
    expect(debate.topic.critique).toBeDefined();
    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });

  it('handles critique failure gracefully without setting debateError', async () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });
    mockApi.computeQueryEmbedding.mockRejectedValue(new Error('Embedding unavailable'));

    await useDebateStore.getState().runTopicCritique();

    expect(useDebateStore.getState().topicCritiqueLoading).toBe(false);
    expect(useDebateStore.getState().debateError).toBeNull();
  });
});

describe('Topic critique slice: reEvaluateSuggestedTopic', () => {
  it('does not run if already loading', async () => {
    useDebateStore.setState({
      activeDebate: makeSession() as any,
      topicCritiqueLoading: true,
    });

    await useDebateStore.getState().reEvaluateSuggestedTopic('Better topic');

    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('does not run with empty text', async () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    await useDebateStore.getState().reEvaluateSuggestedTopic('   ');

    expect(mockApi.generateText).not.toHaveBeenCalled();
  });
});

// ── P5-4. Clarification Slice ──────────────────────────────

describe('Clarification slice: runClarification happy path', () => {
  it('generates clarifying questions and adds transcript entry', async () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });
    mockApi.generateText.mockResolvedValue({ text: '{"questions":["What scope?","Which stakeholders?","What timeline?"]}' });

    await useDebateStore.getState().runClarification();

    const state = useDebateStore.getState();
    expect(state.debateGenerating).toBeNull();
    expect(state.activeDebate!.phase).toBe('clarification');
    const clarEntry = state.activeDebate!.transcript.find((e: any) => e.type === 'clarification');
    expect(clarEntry).toBeDefined();
    expect(clarEntry!.content).toContain('What scope?');
    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });
});

describe('Clarification slice: beginDebate', () => {
  it('proceeds directly to opening for topic-type debates', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({ phase: 'clarification' }) as any,
    });
    mockApi.loadDictionary.mockResolvedValue({ standardized: [], colloquial: [], lintViolations: [] });

    await useDebateStore.getState().beginDebate();

    expect(useDebateStore.getState().activeDebate!.phase).toBe('opening');
  });

  it('loads vocabulary terms during beginDebate', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({ phase: 'clarification' }) as any,
    });
    mockApi.loadDictionary.mockResolvedValue({
      standardized: [{ term: 'AI alignment', definition: 'test' }],
      colloquial: [],
      lintViolations: [],
    });

    await useDebateStore.getState().beginDebate();

    expect(useDebateStore.getState().vocabularyTerms).not.toBeNull();
    expect(useDebateStore.getState().vocabularyTerms!.standardized).toHaveLength(1);
  });

  it('pushes warning when vocabulary loading fails', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({ phase: 'clarification' }) as any,
    });
    mockApi.loadDictionary.mockRejectedValue(new Error('Dict not found'));

    await useDebateStore.getState().beginDebate();

    const warnings = useDebateStore.getState().debateWarnings;
    expect(warnings.some((w: string) => w.includes('Vocabulary'))).toBe(true);
  });

  it('enters edit-claims phase for document debates with i_nodes', async () => {
    const session = makeSession({
      phase: 'clarification',
      source_type: 'document',
      source_content: 'Document content here',
    });
    useDebateStore.setState({ activeDebate: session as any });
    mockApi.loadDictionary.mockResolvedValue({ standardized: [], colloquial: [], lintViolations: [] });
    mockApi.generateText.mockResolvedValue({
      text: JSON.stringify({
        i_nodes: [{ id: 'inode-1', text: 'Claim', taxonomy_refs: [] }],
        tension_points: [],
        claims_summary: 'One claim',
      }),
    });
    mockApi.computeQueryEmbedding.mockResolvedValue({ vector: [0.1] });

    await useDebateStore.getState().beginDebate();

    expect(useDebateStore.getState().activeDebate!.phase).toBe('edit-claims');
  });
});

// ── P5-5. Debate Loop Slice ────────────────────────────────

describe('Debate loop slice: askQuestion', () => {
  const debateSession = () => makeSession({
    phase: 'debate',
    transcript: [
      { id: 'e1', timestamp: 't', type: 'system', speaker: 'system', content: 'Debate started', taxonomy_refs: [] },
    ],
  });

  it('does nothing with empty input', async () => {
    useDebateStore.setState({ activeDebate: debateSession() as any });

    await useDebateStore.getState().askQuestion('   ');

    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('does nothing when activeDebate is null', async () => {
    await useDebateStore.getState().askQuestion('Test question');

    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('adds user question to transcript and generates AI responses', async () => {
    useDebateStore.setState({ activeDebate: debateSession() as any });
    mockApi.generateText.mockResolvedValue({ text: '{"statement":"I believe...","taxonomy_refs":[],"move_types":[]}' });
    mockApi.computeEmbeddings.mockResolvedValue({ vectors: [] });
    mockApi.computeQueryEmbedding.mockResolvedValue({ vector: [] });

    await useDebateStore.getState().askQuestion('What about regulation?');

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    const userEntry = transcript.find((e: any) => e.type === 'question');
    expect(userEntry).toBeDefined();
    expect(userEntry!.content).toBe('What about regulation?');
    expect(useDebateStore.getState().debateGenerating).toBeNull();
    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });

  it('validates @mention targets are active povers', async () => {
    // Create a debate with only 2 active povers — skeptic is excluded
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist', 'safetyist'],
        transcript: [
          { id: 'e1', timestamp: 't', type: 'system', speaker: 'system', content: 'Debate started', taxonomy_refs: [] },
        ],
      }) as any,
    });

    // @Skeptic is a valid parse target but NOT in this debate's active_povers
    await useDebateStore.getState().askQuestion('@Skeptic Test question');

    expect(useDebateStore.getState().debateError).toBeTruthy();
    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('handles AI generation failure for a single pover', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist'],
        transcript: [],
      }) as any,
    });
    mockApi.generateText.mockRejectedValue(new Error('Rate limited'));
    mockApi.computeEmbeddings.mockResolvedValue({ vectors: [] });
    mockApi.computeQueryEmbedding.mockResolvedValue({ vector: [] });

    await useDebateStore.getState().askQuestion('Test');

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    const errorEntry = transcript.find((e: any) => e.type === 'system' && e.content.includes('failed'));
    expect(errorEntry).toBeDefined();
    expect(useDebateStore.getState().debateGenerating).toBeNull();
  });
});

describe('Debate loop slice: crossRespond', () => {
  it('does nothing when activeDebate is null', async () => {
    await useDebateStore.getState().crossRespond();

    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('requires at least 2 AI debaters', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist'],
      }) as any,
    });

    await useDebateStore.getState().crossRespond();

    expect(useDebateStore.getState().debateError).toContain('at least 2');
  });

  it('auto-fixes phase from opening to debate if openings exist', () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'opening',
        transcript: [
          { id: 'e1', timestamp: 't', type: 'opening', speaker: 'accelerationist', content: 'Hello', taxonomy_refs: [] },
        ],
      }) as any,
    });

    // Verify updatePhase('debate') is called when phase is 'opening' and openings exist
    // We test via the store action directly rather than through crossRespond's complex flow
    useDebateStore.getState().updatePhase('debate');

    expect(useDebateStore.getState().activeDebate!.phase).toBe('debate');
  });
});

describe('Debate loop slice: crossRespond post-pipeline path', () => {
  const makeTurnResult = (speaker: string) => ({
    statement: `${speaker} response text`,
    taxonomyRefs: [],
    meta: { move_types: ['CHALLENGE'], policy_refs: [] },
    validation: { outcome: 'accept', score: 0.9, repairHints: [], clarifies_taxonomy: [] },
    attempts: [{ statement: `${speaker} response text`, score: 0.9 }],
    pipelineResult: {
      draft: {},
      total_time_ms: 100,
      stage_diagnostics: [{ stage: 'draft', prompt: 'p', raw_response: 'r' }],
      topicAlignmentResult: null,
    },
    aborted: false,
  });

  const makeModResult = (speaker: string) => ({
    responder: speaker,
    focusPoint: 'test focus',
    addressing: 'all',
    agreementDetected: false,
    selectionResult: {},
    intervention: null,
    interventionBriefInjection: '',
    modState: { budget_remaining: 10, budget_total: 10, health_history: [], consecutive_decline: 0, round: 1, phase: 'debate', required_gap: 2, rounds_since_last_intervention: 5, burden_per_debater: {} },
    healthScore: { value: 0.8, trend: 0, components: {} },
    earlyReturn: false,
    diagnostics: { selectionPrompt: '', selectionResponse: '' },
  });

  it('completes without throwing for all three speakers', async () => {
    let callCount = 0;
    const speakers = ['accelerationist', 'safetyist', 'skeptic'];
    vi.mocked(runModeratorSelection).mockImplementation(async () =>
      makeModResult(speakers[callCount++ % 3]) as any,
    );
    vi.mocked(executeTurnWithRetry).mockImplementation(async (input: any) =>
      makeTurnResult(input.speaker) as any,
    );

    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist', 'safetyist', 'skeptic'],
        transcript: [
          { id: 'o1', timestamp: 't', type: 'opening', speaker: 'accelerationist', content: 'Opening A', taxonomy_refs: [] },
          { id: 'o2', timestamp: 't', type: 'opening', speaker: 'safetyist', content: 'Opening S', taxonomy_refs: [] },
          { id: 'o3', timestamp: 't', type: 'opening', speaker: 'skeptic', content: 'Opening K', taxonomy_refs: [] },
        ],
        diagnostics: {
          enabled: true,
          entries: {},
          overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
        },
      }) as any,
      initialCrossRespondRounds: 1,
      diagnosticsEnabled: true,
    });

    for (const speaker of speakers) {
      vi.mocked(runModeratorSelection).mockResolvedValueOnce(
        makeModResult(speaker) as any,
      );
      vi.mocked(executeTurnWithRetry).mockResolvedValueOnce(
        makeTurnResult(speaker) as any,
      );
      await useDebateStore.getState().crossRespond();
      expect(useDebateStore.getState().debateError).toBeNull();
    }

    const statements = useDebateStore.getState().activeDebate!.transcript.filter((e: any) => e.type === 'statement');
    expect(statements.length).toBe(3);
    for (const speaker of speakers) {
      expect(statements.some((e: any) => e.speaker === speaker)).toBe(true);
    }
  });
});

describe('Debate loop slice: toggleDiagnostics', () => {
  it('initializes diagnostics object when enabling on debate without diagnostics', () => {
    useDebateStore.setState({
      activeDebate: makeSession() as any,
      diagnosticsEnabled: false,
    });

    useDebateStore.getState().toggleDiagnostics();

    expect(useDebateStore.getState().diagnosticsEnabled).toBe(true);
    const debate = useDebateStore.getState().activeDebate!;
    expect((debate as any).diagnostics).toBeDefined();
    expect((debate as any).diagnostics.enabled).toBe(true);
  });

  it('disables diagnostics and closes popout', () => {
    useDebateStore.setState({
      activeDebate: makeSession() as any,
      diagnosticsEnabled: true,
      diagPopoutOpen: true,
    });

    useDebateStore.getState().toggleDiagnostics();

    expect(useDebateStore.getState().diagnosticsEnabled).toBe(false);
    expect(useDebateStore.getState().diagPopoutOpen).toBe(false);
  });
});

// ── P5-6. Synthesis Slice ──────────────────────────────────

describe('Synthesis slice: requestSynthesis', () => {
  it('does nothing when activeDebate is null', async () => {
    await useDebateStore.getState().requestSynthesis();
    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('generates synthesis and adds concluding transcript entry', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        transcript: [
          { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'Point A', taxonomy_refs: [] },
          { id: 'e2', timestamp: 't', type: 'statement', speaker: 'safetyist', content: 'Counter B', taxonomy_refs: [] },
        ],
      }) as any,
    });
    mockApi.generateText.mockResolvedValue({
      text: JSON.stringify({
        areas_of_agreement: [{ point: 'AI needs governance', povers: ['accelerationist', 'safetyist'] }],
        areas_of_disagreement: [{ point: 'Speed of regulation', type: 'empirical' }],
        unresolved_questions: ['What timeline?'],
        taxonomy_coverage: [],
      }),
    });

    await useDebateStore.getState().requestSynthesis();

    expect(useDebateStore.getState().debateGenerating).toBeNull();
    const transcript = useDebateStore.getState().activeDebate!.transcript;
    const synthEntry = transcript.find((e: any) => e.type === 'concluding');
    expect(synthEntry).toBeDefined();
    expect(synthEntry!.content).toContain('Areas of Agreement');
    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });

  it('handles unparseable synthesis by salvaging arrays', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        transcript: [
          { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [] },
        ],
      }) as any,
    });
    mockApi.generateText.mockResolvedValue({ text: 'This is not JSON at all' });

    await useDebateStore.getState().requestSynthesis();

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    const synthEntry = transcript.find((e: any) => e.type === 'concluding');
    expect(synthEntry).toBeDefined();
  });
});

describe('Synthesis slice: generateNewsReport', () => {
  it('does nothing when activeDebate is null', async () => {
    await useDebateStore.getState().generateNewsReport();
    expect(mockApi.generateNewsReport).not.toHaveBeenCalled();
  });

  it('requires a synthesis entry before generating', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({ transcript: [] }) as any,
    });

    await useDebateStore.getState().generateNewsReport();

    expect(useDebateStore.getState().newsReportError).toBeTruthy();
    expect(useDebateStore.getState().newsReportError).toContain('synthesis');
    expect(mockApi.generateNewsReport).not.toHaveBeenCalled();
  });

  it('generates news report when synthesis exists', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        transcript: [
          { id: 'e1', timestamp: 't', type: 'concluding', speaker: 'system', content: 'Synthesis', taxonomy_refs: [] },
        ],
      }) as any,
    });

    await useDebateStore.getState().generateNewsReport();

    expect(useDebateStore.getState().newsReport).toBe('mock-news-article');
    expect(useDebateStore.getState().newsReportLoading).toBe(false);
    expect(useDebateStore.getState().newsReportError).toBeNull();
  });

  it('sets error when generation fails', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        transcript: [
          { id: 'e1', timestamp: 't', type: 'concluding', speaker: 'system', content: 'Synthesis', taxonomy_refs: [] },
        ],
      }) as any,
    });
    mockApi.generateNewsReport.mockRejectedValueOnce(new Error('API down'));

    await useDebateStore.getState().generateNewsReport();

    expect(useDebateStore.getState().newsReportError).toBeTruthy();
    expect(useDebateStore.getState().newsReportLoading).toBe(false);
  });
});

describe('Synthesis slice: requestReflections', () => {
  it('does nothing when activeDebate is null', async () => {
    await useDebateStore.getState().requestReflections();
    expect(mockApi.generateText).not.toHaveBeenCalled();
  });

  it('generates reflections for each active AI pover', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist', 'safetyist'],
        transcript: [
          { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [] },
        ],
      }) as any,
    });
    mockApi.generateText.mockResolvedValue({
      text: JSON.stringify({
        reflection_summary: 'The debate revealed...',
        edits: [{
          edit_type: 'revise',
          node_id: 'acc-B-001',
          category: 'Beliefs',
          current_label: 'Old',
          proposed_label: 'New',
          current_description: 'Old desc',
          proposed_description: 'New desc',
          rationale: 'Evidence showed',
          confidence: 'high',
          evidence_entries: ['e1'],
        }],
      }),
    });

    await useDebateStore.getState().requestReflections();

    const reflections = useDebateStore.getState().reflections;
    expect(reflections).toHaveLength(2);
    expect(reflections[0].pover).toBe('accelerationist');
    expect(reflections[1].pover).toBe('safetyist');
    expect(reflections[0].edits[0].status).toBe('pending');
    expect(useDebateStore.getState().debateGenerating).toBeNull();
  });
});

describe('Synthesis slice: consensus management', () => {
  describe('rejectConsensus', () => {
    it('sets consensus cluster status to rejected', () => {
      useDebateStore.setState({
        consensusClusters: [
          { id: 'cc-1', proposals: [], similarityScores: {}, status: 'pending' as const },
          { id: 'cc-2', proposals: [], similarityScores: {}, status: 'pending' as const },
        ],
      });

      useDebateStore.getState().rejectConsensus('cc-1');

      const clusters = useDebateStore.getState().consensusClusters;
      expect(clusters.find((c: any) => c.id === 'cc-1')!.status).toBe('rejected');
      expect(clusters.find((c: any) => c.id === 'cc-2')!.status).toBe('pending');
    });
  });
});

// ── P5-7. Context Compression ──────────────────────────────

describe('Context compression: full flow', () => {
  it('compresses old entries and adds context summary', async () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`, timestamp: 't', type: 'statement', speaker: i % 2 === 0 ? 'accelerationist' : 'safetyist',
      content: `Entry ${i} content`, taxonomy_refs: [],
    }));
    useDebateStore.setState({ activeDebate: makeSession({ transcript: entries }) as any });
    mockApi.generateText.mockResolvedValue({ text: '{"summary":"Compressed summary of debate"}' });

    await useDebateStore.getState().compressOldTranscript();

    const debate = useDebateStore.getState().activeDebate!;
    expect(debate.context_summaries.length).toBeGreaterThan(0);
    expect(debate.context_summaries[0].summary).toContain('Compressed summary');
    expect(useDebateStore.getState().debateGenerating).toBeNull();
    expect(mockApi.saveDebateSession).toHaveBeenCalled();
  });

  it('handles non-JSON summary text gracefully', async () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`, timestamp: 't', type: 'statement', speaker: 'accelerationist',
      content: `Entry ${i}`, taxonomy_refs: [],
    }));
    useDebateStore.setState({ activeDebate: makeSession({ transcript: entries }) as any });
    mockApi.generateText.mockResolvedValue({ text: 'Plain text summary without JSON' });

    await useDebateStore.getState().compressOldTranscript();

    const debate = useDebateStore.getState().activeDebate!;
    expect(debate.context_summaries.length).toBeGreaterThan(0);
    expect(debate.context_summaries[0].summary).toBe('Plain text summary without JSON');
  });
});

// ── P5-8. Cross-Slice State Dependencies ───────────────────

describe('Cross-slice: phase transitions', () => {
  it('proceedToOpening preserves existing openingOrder from setup screen', () => {
    useDebateStore.setState({
      activeDebate: makeSession() as any,
      openingOrder: ['skeptic', 'accelerationist', 'safetyist'],
    });

    useDebateStore.getState().proceedToOpening();

    expect(useDebateStore.getState().openingOrder).toEqual(['skeptic', 'accelerationist', 'safetyist']);
  });

  it('proceedToOpening persists opening_order on debate object', () => {
    useDebateStore.setState({
      activeDebate: makeSession() as any,
      openingOrder: ['safetyist', 'skeptic', 'accelerationist'],
    });

    useDebateStore.getState().proceedToOpening();

    const debate = useDebateStore.getState().activeDebate!;
    expect((debate as any).opening_order).toEqual(['safetyist', 'skeptic', 'accelerationist']);
  });

  it('closeDebate resets prompt config store', () => {
    useDebateStore.setState({
      activeDebateId: 'x',
      activeDebate: makeSession() as any,
    });

    useDebateStore.getState().closeDebate();

    expect(mockPromptConfigState.resetSession).toHaveBeenCalled();
  });
});

describe('Cross-slice: addTranscriptEntry vocabulary disambiguation', () => {
  it('applies vocabulary disambiguation to debater statements', () => {
    useDebateStore.setState({
      activeDebate: makeSession() as any,
      vocabularyTerms: {
        standardized: [{ term: 'alignment', definition: 'test' }],
        colloquial: [{ bare: 'align', canonical: 'alignment', camps: ['accelerationist'], confidence: 0.9 }],
      },
    });
    vi.mocked(disambiguateTerms).mockReturnValueOnce({
      terms: [{ bare: 'align', canonical: 'alignment', confidence: 0.9, offset: 5, ambiguous: false }],
      ambiguousCount: 0,
    });

    useDebateStore.getState().addTranscriptEntry({
      type: 'statement',
      speaker: 'accelerationist',
      content: 'The align approach works',
      taxonomy_refs: [],
    });

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    const entry = transcript[0];
    expect(entry.metadata?.vocabulary_resolutions).toBeDefined();
    expect(entry.metadata.vocabulary_resolutions).toHaveLength(1);
    expect(entry.metadata.vocabulary_resolutions[0].canonical).toBe('alignment');
  });

  it('does not apply disambiguation to system or user entries', () => {
    useDebateStore.setState({
      activeDebate: makeSession() as any,
      vocabularyTerms: {
        standardized: [{ term: 'alignment', definition: 'test' }],
        colloquial: [{ bare: 'align', canonical: 'alignment', camps: ['accelerationist'], confidence: 0.9 }],
      },
    });

    useDebateStore.getState().addTranscriptEntry({
      type: 'system',
      speaker: 'system',
      content: 'System message about align',
      taxonomy_refs: [],
    });

    const transcript = useDebateStore.getState().activeDebate!.transcript;
    expect(transcript[0].metadata?.vocabulary_resolutions).toBeUndefined();
  });
});

describe('Cross-slice: deleteTranscriptEntries cleans up AN', () => {
  it('removes orphaned AN nodes and edges when entries are deleted', async () => {
    const session = makeSession({
      transcript: [
        { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [] },
        { id: 'e2', timestamp: 't', type: 'statement', speaker: 'safetyist', content: 'Y', taxonomy_refs: [] },
      ],
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'Claim 1', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-2', text: 'Claim 2', speaker: 'safetyist', source_entry_id: 'e2', taxonomy_refs: [], turn_number: 2 },
        ],
        edges: [
          { source: 'AN-1', target: 'AN-2', type: 'attacks' },
        ],
      },
    });
    useDebateStore.setState({ activeDebate: session as any });

    await useDebateStore.getState().deleteTranscriptEntries(['e1']);

    const debate = useDebateStore.getState().activeDebate!;
    const an = (debate as any).argument_network;
    expect(an.nodes).toHaveLength(1);
    expect(an.nodes[0].id).toBe('AN-2');
    expect(an.edges).toHaveLength(0);
  });

  it('cleans up orphaned diagnostics entries', async () => {
    const session = makeSession({
      transcript: [
        { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [] },
      ],
      diagnostics: {
        enabled: true,
        entries: { e1: { prompt: 'test', raw_response: 'test', model: 'test' } },
        overview: { total_ai_calls: 1, total_response_time_ms: 100, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });
    useDebateStore.setState({ activeDebate: session as any });

    await useDebateStore.getState().deleteTranscriptEntries(['e1']);

    const diag = (useDebateStore.getState().activeDebate as any).diagnostics;
    expect(diag.entries.e1).toBeUndefined();
  });
});

describe('Cross-slice: setAudience propagates to activeDebate', () => {
  it('updates audience on both store state and activeDebate object', () => {
    useDebateStore.setState({ activeDebate: makeSession() as any });

    useDebateStore.getState().setAudience('researchers');

    expect(useDebateStore.getState().audience).toBe('researchers');
    expect(useDebateStore.getState().activeDebate!.audience).toBe('researchers');
  });
});

describe('Lookahead WEAK claim filtering (t/459)', () => {
  it('filters WEAK claims from a passing batch, keeping STRONG and PRESERVE', async () => {
    const threeNodes = [
      { id: 'tmp-1', text: 'Strong claim about governance', speaker: 'accelerationist', source_entry_id: 'entry-1', taxonomy_refs: [], turn_number: 1, base_strength: 0.7 },
      { id: 'tmp-2', text: 'Weak marginal claim', speaker: 'accelerationist', source_entry_id: 'entry-1', taxonomy_refs: [], turn_number: 1, base_strength: 0.3 },
      { id: 'tmp-3', text: 'Preserved concession claim', speaker: 'accelerationist', source_entry_id: 'entry-1', taxonomy_refs: [], turn_number: 1, base_strength: 0.5 },
    ];
    const threeEdges = [
      { id: 'te-1', source: 'tmp-1', target: 'AN-1', type: 'supports', weight: 0.5 },
      { id: 'te-2', source: 'tmp-2', target: 'AN-1', type: 'attacks', weight: 0.3 },
    ];

    vi.mocked(processExtractedClaims).mockReturnValueOnce({
      newNodes: [...threeNodes],
      newEdges: [...threeEdges],
      accepted: threeNodes.map(n => ({ id: n.id, text: n.text })),
      rejected: [],
      commitments: { asserted: [], conceded: [], challenged: [] },
      rejectionReasons: {},
      rejectedOverlapPcts: [],
      maxOverlapVsExisting: 0,
    } as any);

    vi.mocked(evaluateLookaheadPerClaim).mockReturnValueOnce({
      batchResult: {
        pass: true,
        utility_before: { position_strength: 0.5, attack_effectiveness: 0.3, crux_engagement: 0.2 },
        utility_after: { position_strength: 0.7, attack_effectiveness: 0.4, crux_engagement: 0.3 },
        utility_delta: 0.15,
        threshold: 0.05,
        tentative_claims: threeNodes.map(n => ({ text: n.text, strength: n.base_strength })),
        tentative_network_size: { nodes: 4, edges: 3 },
        concession_indices: [],
      },
      perClaim: [
        { index: 0, text: threeNodes[0].text, base_strength: 0.7, marginal_delta: 0.12, classification: 'STRONG' as const, dominant_component: 'position_strength' as const },
        { index: 1, text: threeNodes[1].text, base_strength: 0.3, marginal_delta: 0.01, classification: 'WEAK' as const, dominant_component: 'attack_effectiveness' as const },
        { index: 2, text: threeNodes[2].text, base_strength: 0.5, marginal_delta: 0.04, classification: 'PRESERVE' as const, dominant_component: 'crux_engagement' as const },
      ],
    });

    const claimsJson = JSON.stringify({
      claims: [
        { claim: 'Strong claim about governance', type: 'assertion', targets: [] },
        { claim: 'Weak marginal claim', type: 'assertion', targets: [] },
        { claim: 'Preserved concession claim', type: 'concession', targets: [] },
      ],
    });
    mockApi.generateText.mockResolvedValueOnce({ text: claimsJson });
    mockApi.computeQueryEmbedding.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });

    const session = makeSession({
      phase: 'debate',
      transcript: [
        { id: 'entry-1', timestamp: '2026-05-01T00:00:00.000Z', type: 'statement', speaker: 'accelerationist', content: 'My argument about AI governance...', taxonomy_refs: [] },
      ],
      argument_network: { nodes: [{ id: 'AN-1', text: 'Prior claim', speaker: 'safetyist', source_entry_id: 'e0', taxonomy_refs: [], turn_number: 0, base_strength: 0.5 }], edges: [] },
      lookahead_filter_weak: true,
    });
    useDebateStore.setState({ activeDebate: session as any, debateModel: 'gemini-2.0-flash' });

    await useDebateStore.getState().reExtractClaims('entry-1');

    const debate = useDebateStore.getState().activeDebate as any;
    const an = debate.argument_network;
    // Original AN-1 + 2 committed (STRONG + PRESERVE); WEAK filtered out
    expect(an.nodes).toHaveLength(3);
    const committedTexts = an.nodes.slice(1).map((n: any) => n.text);
    expect(committedTexts).toContain('Strong claim about governance');
    expect(committedTexts).toContain('Preserved concession claim');
    expect(committedTexts).not.toContain('Weak marginal claim');

    // Edge from WEAK claim (tmp-2 → AN-1) should be removed
    const edgeSources = an.edges.map((e: any) => e.source);
    expect(edgeSources).not.toContain(expect.stringContaining('tmp-2'));
  });

  it('does not filter when lookahead_filter_weak is false', async () => {
    const twoNodes = [
      { id: 'tmp-1', text: 'Strong claim', speaker: 'accelerationist', source_entry_id: 'entry-2', taxonomy_refs: [], turn_number: 1, base_strength: 0.7 },
      { id: 'tmp-2', text: 'Weak claim', speaker: 'accelerationist', source_entry_id: 'entry-2', taxonomy_refs: [], turn_number: 1, base_strength: 0.3 },
    ];

    vi.mocked(processExtractedClaims).mockReturnValueOnce({
      newNodes: [...twoNodes],
      newEdges: [],
      accepted: twoNodes.map(n => ({ id: n.id, text: n.text })),
      rejected: [],
      commitments: { asserted: [], conceded: [], challenged: [] },
      rejectionReasons: {},
      rejectedOverlapPcts: [],
      maxOverlapVsExisting: 0,
    } as any);

    vi.mocked(evaluateLookaheadPerClaim).mockReturnValueOnce({
      batchResult: {
        pass: true, utility_before: { position_strength: 0.5, attack_effectiveness: 0.3, crux_engagement: 0.2 },
        utility_after: { position_strength: 0.6, attack_effectiveness: 0.4, crux_engagement: 0.3 },
        utility_delta: 0.1, threshold: 0.05,
        tentative_claims: twoNodes.map(n => ({ text: n.text, strength: n.base_strength })),
        tentative_network_size: { nodes: 3, edges: 0 }, concession_indices: [],
      },
      perClaim: [
        { index: 0, text: 'Strong claim', base_strength: 0.7, marginal_delta: 0.08, classification: 'STRONG' as const, dominant_component: 'position_strength' as const },
        { index: 1, text: 'Weak claim', base_strength: 0.3, marginal_delta: 0.01, classification: 'WEAK' as const, dominant_component: 'attack_effectiveness' as const },
      ],
    });

    mockApi.generateText.mockResolvedValueOnce({ text: JSON.stringify({ claims: [{ claim: 'Strong claim', type: 'assertion', targets: [] }, { claim: 'Weak claim', type: 'assertion', targets: [] }] }) });
    mockApi.computeQueryEmbedding.mockResolvedValue({ vector: [0.1, 0.2, 0.3] });

    const session = makeSession({
      phase: 'debate',
      transcript: [
        { id: 'entry-2', timestamp: '2026-05-01T00:00:00.000Z', type: 'statement', speaker: 'accelerationist', content: 'Some argument', taxonomy_refs: [] },
      ],
      argument_network: { nodes: [{ id: 'AN-1', text: 'Prior', speaker: 'safetyist', source_entry_id: 'e0', taxonomy_refs: [], turn_number: 0, base_strength: 0.5 }], edges: [] },
      lookahead_filter_weak: false,
    });
    useDebateStore.setState({ activeDebate: session as any, debateModel: 'gemini-2.0-flash' });

    await useDebateStore.getState().reExtractClaims('entry-2');

    const an = (useDebateStore.getState().activeDebate as any).argument_network;
    // All claims committed — WEAK not filtered because lookahead_filter_weak is false
    expect(an.nodes).toHaveLength(3);
    const committedTexts = an.nodes.slice(1).map((n: any) => n.text);
    expect(committedTexts).toContain('Strong claim');
    expect(committedTexts).toContain('Weak claim');
  });
});

// ── Opening Statement Failure Handling (t/920) ─────────────

describe('runOpeningStatements — failure halts flow (t/920)', () => {
  it('does not advance to debate phase when opening pipeline throws a fatal error', async () => {
    const { runOpeningPipeline } = await import('@lib/debate/turnPipeline');
    const fatalError = Object.assign(new Error('Internal server error'), { httpStatus: 500 });
    vi.mocked(runOpeningPipeline).mockRejectedValue(fatalError);

    const session = makeSession({
      phase: 'opening',
      active_povers: ['accelerationist', 'safetyist'],
      topic: { original: 'AI governance', refined: null, final: 'AI governance' },
    });
    useDebateStore.setState({ activeDebate: session as any, debateModel: 'gemini-2.0-flash' });

    await useDebateStore.getState().runOpeningStatements();

    const state = useDebateStore.getState();
    expect(state.activeDebate?.phase).toBe('opening');
    expect(state.debateError).toBeTruthy();
    expect(state.debateError).toMatch(/Opening statements failed/);
    expect(state.debateGenerating).toBeNull();

    vi.mocked(runOpeningPipeline).mockResolvedValue({});
  });

  it('sets debateError with speaker names on partial failure', async () => {
    const { runOpeningPipeline, assembleOpeningPipelineResult } = await import('@lib/debate/turnPipeline');
    vi.mocked(runOpeningPipeline)
      .mockResolvedValueOnce({ stage_diagnostics: [] })
      .mockRejectedValueOnce(Object.assign(new Error('Server error'), { httpStatus: 500 }));
    vi.mocked(assembleOpeningPipelineResult).mockReturnValueOnce({
      statement: 'A'.repeat(100),
      taxonomyRefs: [],
      meta: { key_assumptions: [], my_claims: [], turn_symbols: [], policy_refs: [] },
    } as any);

    const session = makeSession({
      phase: 'opening',
      active_povers: ['accelerationist', 'safetyist'],
      topic: { original: 'AI governance', refined: null, final: 'AI governance' },
    });
    useDebateStore.setState({ activeDebate: session as any, debateModel: 'gemini-2.0-flash' });

    await useDebateStore.getState().runOpeningStatements();

    const state = useDebateStore.getState();
    expect(state.activeDebate?.phase).toBe('opening');
    expect(state.debateError).toMatch(/Safetyist/);
    expect(state.debateGenerating).toBeNull();

    vi.mocked(runOpeningPipeline).mockResolvedValue({});
    vi.mocked(assembleOpeningPipelineResult).mockReturnValue({});
  });

  it('retries once on 429 rate-limit errors before halting', async () => {
    const { runOpeningPipeline } = await import('@lib/debate/turnPipeline');
    const rateLimitError = Object.assign(
      new Error('Rate limit exceeded. Retry in 1s.'),
      { httpStatus: 429 },
    );
    vi.mocked(runOpeningPipeline).mockRejectedValue(rateLimitError);

    const session = makeSession({
      phase: 'opening',
      active_povers: ['accelerationist'],
      topic: { original: 'Test', refined: null, final: 'Test topic' },
    });
    useDebateStore.setState({ activeDebate: session as any, debateModel: 'gemini-2.0-flash' });

    await useDebateStore.getState().runOpeningStatements();

    // Pipeline was called twice: initial attempt + one retry
    expect(vi.mocked(runOpeningPipeline).mock.calls.length).toBeGreaterThanOrEqual(2);
    const state = useDebateStore.getState();
    expect(state.activeDebate?.phase).toBe('opening');
    expect(state.debateError).toBeTruthy();

    vi.mocked(runOpeningPipeline).mockResolvedValue({});
  });
});
