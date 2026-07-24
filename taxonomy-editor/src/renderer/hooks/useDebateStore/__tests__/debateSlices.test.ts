// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// useDebateStore slice tests: loadSessions/saveDebate/inspectNode/proceedToOpening,
// config + session slices, topic critique, clarification, the debate loop, and
// synthesis. Split from useDebateStore.test.ts under the ADR-007 2000-LOC test
// budget (t/1690, epic t/1681). The shared mock harness (all vi.mock/vi.hoisted
// setup + fixtures + per-test reset) lives in ./storeTestHarness and is imported
// FIRST so its hoisted mocks register before the store import below resolves.
// Blocks moved verbatim — no coverage change.
import { describe, it, expect, vi } from 'vitest';
import { mockApi, mockTaxonomyState, makeSession, localStorageMock } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
import { executeTurnWithRetry, runModeratorSelection } from '@lib/debate/orchestration';

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

