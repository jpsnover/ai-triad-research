// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// useDebateStore slice tests: loadSessions/saveDebate/inspectNode/proceedToOpening,
// config + session slices, topic critique, clarification, the debate loop, and
// synthesis. Split from useDebateStore.test.ts under the ADR-007 2000-LOC test
// budget (t/1690, epic t/1681). The shared mock harness (all vi.mock/vi.hoisted
// setup + fixtures + per-test reset) lives in ./storeTestHarness and is imported
// FIRST so its hoisted mocks register before the store import below resolves.
// Blocks moved verbatim — no coverage change.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mockApi, mockTaxonomyState, makeSession, localStorageMock } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';
// Mocked by the harness — imported here so propose_new apply tests can assert on the
// atomic edges `setState` (node + edges persisted together, t/1773 AC2).
import { useTaxonomyStore } from '../../useTaxonomyStore';
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

    await useDebateStore.getState().saveDebate('test');

    expect(mockApi.saveDebateSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-1' }),
    );
  });

  it('updates sessions list summary after save', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({ title: 'Updated Title' }) as any,
      sessions: [{ id: 'session-1', title: 'Old Title', updated_at: 'old', phase: 'setup' }],
    });

    await useDebateStore.getState().saveDebate('test');

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

  it('falls back to global AI settings model when debateModel is null', async () => {
    mockTaxonomyState.geminiModel = 'gemini-2.5-flash';
    useDebateStore.setState({ activeDebate: makeSession() as any, debateModel: null });
    mockApi.generateText.mockResolvedValue({ text: '{"questions":["Q1"]}' });

    await useDebateStore.getState().runClarification();

    const call = mockApi.generateText.mock.calls[0];
    expect(call[1]).toBe('gemini-2.5-flash');
  });

  it('falls back to DEFAULT_MODEL when global AI settings model is empty', async () => {
    mockTaxonomyState.geminiModel = '';
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

  it('setDefaultDisplayTier sets the display default and clears overrides without touching responseLength (t/2318)', () => {
    const session = makeSession({
      transcript: [
        { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [], display_tier: 'brief' },
      ],
    });
    useDebateStore.setState({ activeDebate: session as any, defaultDisplayTier: 'detailed', responseLength: 'detailed' });

    useDebateStore.getState().setDefaultDisplayTier('medium');

    expect(useDebateStore.getState().defaultDisplayTier).toBe('medium');
    // The header control targets the display tier only — generation verbosity is untouched.
    expect(useDebateStore.getState().responseLength).toBe('detailed');
    expect(useDebateStore.getState().activeDebate!.transcript[0].display_tier).toBeUndefined();
  });

  it('stamps debateStepStartedAt when a production generation action starts, not only setGenerating (t/2319)', async () => {
    useDebateStore.setState({ activeDebate: makeSession() as any, debateStepStartedAt: null });
    mockApi.generateText.mockResolvedValue({ text: '{"questions":["Q1"]}' });

    await useDebateStore.getState().runClarification();

    // runClarification sets debateGenerating at step start; the fix stamps the step
    // timer there so StatementProgressIndicator counts up instead of sticking at 0:00.
    expect(useDebateStore.getState().debateStepStartedAt).not.toBeNull();
  });

  // t/2269 (TL Option 2): the debate-step view default is Medium, but that must NOT
  // shorten generation. defaultDisplayTier (view fallback) and responseLength
  // (generation verbosity) are independent store fields — guard against re-coupling.
  it('defaults defaultDisplayTier to medium while responseLength stays detailed (t/2269)', () => {
    useDebateStore.setState({ responseLength: 'detailed', defaultDisplayTier: 'medium' });
    // Changing generation length must not move the view default…
    useDebateStore.getState().setResponseLength('brief');
    expect(useDebateStore.getState().responseLength).toBe('brief');
    expect(useDebateStore.getState().defaultDisplayTier).toBe('medium');
  });
});

// ── Config Slice — per-step debate timer (t/2266) ──
// A single step (one speaker turn) fans out into multiple generation phases, each
// calling setGenerating. The step-scoped debateStepStartedAt must be set once when
// the step begins and NOT be overwritten by later phases (the t/2266 bug), so the
// StatementProgressIndicator elapsed timer increments monotonically instead of
// resetting to 0 mid-step. Fake timers keep the timestamp assertions deterministic.

describe('Config slice: per-step timer (debateStepStartedAt) — t/2266', () => {
  afterEach(() => {
    vi.useRealTimers();
    useDebateStore.setState({ debateGenerating: null, debateGeneratingStartedAt: null, debateStepStartedAt: null });
  });

  it('sets debateStepStartedAt once per step and never overwrites it across phases', () => {
    useDebateStore.setState({ debateGenerating: null, debateGeneratingStartedAt: null, debateStepStartedAt: null });
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { setGenerating } = useDebateStore.getState();

    // Phase 1 of the step begins — the step marker is stamped.
    setGenerating('accelerationist');
    expect(useDebateStore.getState().debateStepStartedAt).toBe(1_000);

    // A later generation phase within the SAME step calls setGenerating again.
    vi.setSystemTime(5_000);
    setGenerating('safetyist');
    // The per-phase marker advances…
    expect(useDebateStore.getState().debateGeneratingStartedAt).toBe(5_000);
    // …but the step-scoped marker must stay put (the fix).
    expect(useDebateStore.getState().debateStepStartedAt).toBe(1_000);
  });

  it('clears the step marker at step end and starts fresh for the next step', () => {
    useDebateStore.setState({ debateGenerating: null, debateGeneratingStartedAt: null, debateStepStartedAt: null });
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { setGenerating } = useDebateStore.getState();

    setGenerating('accelerationist');
    expect(useDebateStore.getState().debateStepStartedAt).toBe(1_000);

    setGenerating(null); // step ends → marker cleared
    expect(useDebateStore.getState().debateStepStartedAt).toBeNull();

    vi.setSystemTime(9_000);
    setGenerating('skeptic'); // next step begins → fresh marker
    expect(useDebateStore.getState().debateStepStartedAt).toBe(9_000);
  });
});

// ── P5-1b. Session Slice — createDebate model resolution (t/2213) ──

describe('Session slice: createDebate model resolution', () => {
  it('uses explicit debateModel override when provided', async () => {
    mockTaxonomyState.geminiModel = 'gemini-flash-lite-latest';
    await useDebateStore.getState().createDebate('Topic', ['accelerationist', 'safetyist'], false, 'topic', '', '', 'moonshot-kimi-k3');
    expect(useDebateStore.getState().debateModel).toBe('moonshot-kimi-k3');
  });

  it('derives model from global AI settings (not prior run state) when no override', async () => {
    mockTaxonomyState.geminiModel = 'gemini-2.5-pro';
    await useDebateStore.getState().createDebate('Topic', ['accelerationist', 'safetyist'], false);
    expect(useDebateStore.getState().debateModel).toBe('gemini-2.5-pro');
  });

  it('AC3: new debate uses updated global model, not prior debate model', async () => {
    mockTaxonomyState.geminiModel = 'moonshot-kimi-k3';
    await useDebateStore.getState().createDebate('First debate', ['accelerationist', 'safetyist'], false, 'topic', '', '', 'moonshot-kimi-k3');
    expect(useDebateStore.getState().debateModel).toBe('moonshot-kimi-k3');

    mockTaxonomyState.geminiModel = 'gemini-2.5-flash';
    await useDebateStore.getState().createDebate('Second debate', ['accelerationist', 'safetyist'], false);
    expect(useDebateStore.getState().debateModel).toBe('gemini-2.5-flash');
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

  it('partitions propose_new out of edit_existing edits and wires new_item_proposals (t/1773)', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'debate',
        active_povers: ['accelerationist'],
        transcript: [
          { id: 'e1', timestamp: 't', type: 'statement', speaker: 'accelerationist', content: 'X', taxonomy_refs: [] },
        ],
      }) as any,
    });
    mockApi.generateText.mockResolvedValue({
      text: JSON.stringify({
        reflection_summary: 'summary',
        edits: [
          {
            disposition: 'edit_existing', edit_type: 'revise', node_id: 'acc-B-001', category: 'Beliefs',
            current_label: 'Old', proposed_label: 'Revised', current_description: 'd', proposed_description: 'nd',
            rationale: 'r', confidence: 'high', evidence_entries: ['e1'],
          },
          {
            disposition: 'propose_new', pov: 'accelerationist', category: 'Beliefs', label: 'Brand New Belief',
            proposed_description: 'A new belief', rationale: 'r', confidence: 'high', evidence_entries: ['e1'],
            proposed_edges: [{ target_node_id: 'acc-B-001', edge_type: 'supports', new_node_role: 'source', rationale: 'r', confidence: 0.8 }],
          },
        ],
      }),
    });

    await useDebateStore.getState().requestReflections();

    const r = useDebateStore.getState().reflections[0];
    // propose_new must NOT be mangled into an edit_existing edit — only the revise remains.
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0].edit_type).toBe('revise');
    expect(r.edits.some(e => e.proposed_label === 'Brand New Belief')).toBe(false);
    // new_item_proposals is wired (array present). Its contents depend on the live taxonomy
    // store's known node ids for edge validation (empty in this mock → validated to []).
    expect(Array.isArray(r.new_item_proposals)).toBe(true);
  });
});

describe('Synthesis slice: propose_new apply (t/1773, ruling B)', () => {
  const makeProposalReflections = (targetId = 'acc-B-001') => [
    {
      pover: 'accelerationist',
      label: 'Accelerationist',
      reflection_summary: 's',
      edits: [],
      new_item_proposals: [
        {
          kind: 'propose_new' as const,
          source: 'reflection_new_item' as const,
          node_id: '',
          reason: 'r',
          debate_id: 'debate-1',
          requires_human_review: true,
          pov: 'accelerationist' as const,
          category: 'Beliefs' as const,
          label: 'New Belief',
          description: 'A brand-new belief',
          rationale: 'edge-connected rationale',
          proposed_edges: [
            { target_node_id: targetId, edge_type: 'SUPPORTS' as const, new_node_role: 'source' as const, rationale: 'why the edge', confidence: 0.8 },
          ],
        },
      ],
    },
  ];

  afterEach(() => {
    mockTaxonomyState.accelerationist.nodes = [];
    mockTaxonomyState.edgesFile = { edges: [] };
    mockTaxonomyState.saveError = null;
  });

  it('creates the node AND persists its edges atomically, marking the proposal approved (AC2)', async () => {
    mockTaxonomyState.saveError = null;
    mockTaxonomyState.accelerationist.nodes = [{ id: 'acc-B-001' }];
    useDebateStore.setState({ reflections: makeProposalReflections() as any, newItemProposalStatus: {}, activeDebateId: 'debate-1' });

    const result = await useDebateStore.getState().applyReflectionProposal('accelerationist', 0);

    expect(result).toMatchObject({ ok: true, createdNodeId: 'new-node-id' });
    expect(mockTaxonomyState.createPovNode).toHaveBeenCalledWith('accelerationist', 'Beliefs');
    expect(mockTaxonomyState.save).toHaveBeenCalled();
    // Edges + node persist in the SAME store update (atomic): the edges setState carries
    // the new edge with the freshly-minted node id substituted for the new-node endpoint.
    const edgeCall = vi.mocked(useTaxonomyStore.setState).mock.calls
      .map(c => c[0] as { edgesFile?: { edges: unknown[] } })
      .find(arg => arg && arg.edgesFile);
    expect(edgeCall).toBeTruthy();
    const persisted = edgeCall!.edgesFile!.edges as Array<Record<string, unknown>>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ source: 'new-node-id', target: 'acc-B-001', type: 'SUPPORTS', status: 'proposed' });
    expect(useDebateStore.getState().newItemProposalStatus['accelerationist#0']).toBe('approved');
  });

  it('refuses to create an orphan when no edge target resolves to a live node (AC2 anti-orphan)', async () => {
    mockTaxonomyState.saveError = null;
    mockTaxonomyState.accelerationist.nodes = []; // target 'acc-B-001' is NOT present
    useDebateStore.setState({ reflections: makeProposalReflections() as any, newItemProposalStatus: {}, activeDebateId: 'debate-1' });

    const result = await useDebateStore.getState().applyReflectionProposal('accelerationist', 0);

    expect(result.ok).toBe(false);
    expect(mockTaxonomyState.createPovNode).not.toHaveBeenCalled();
    expect(useDebateStore.getState().newItemProposalStatus['accelerationist#0']).toBeUndefined();
  });

  it('does not mark approved and returns error when the atomic save fails', async () => {
    mockTaxonomyState.accelerationist.nodes = [{ id: 'acc-B-001' }];
    mockTaxonomyState.saveError = 'Integrity check failed';
    useDebateStore.setState({ reflections: makeProposalReflections() as any, newItemProposalStatus: {}, activeDebateId: 'debate-1' });

    const result = await useDebateStore.getState().applyReflectionProposal('accelerationist', 0);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Integrity check failed');
    expect(useDebateStore.getState().newItemProposalStatus['accelerationist#0']).toBeUndefined();
  });

  it('resumed debate (edges never lazy-loaded): loads edges on demand, then persists node + edges (t/2055 AC1)', async () => {
    mockTaxonomyState.saveError = null;
    mockTaxonomyState.accelerationist.nodes = [{ id: 'acc-B-001' }];
    mockTaxonomyState.edgesFile = null; // resumed debate w/ no new turns: neither lazy-load trigger fired
    // loadEdges populates the file on demand, mirroring the real lazy load.
    mockTaxonomyState.loadEdges.mockImplementationOnce(async () => { mockTaxonomyState.edgesFile = { edges: [] }; });
    useDebateStore.setState({ reflections: makeProposalReflections() as any, newItemProposalStatus: {}, activeDebateId: 'debate-1' });

    const result = await useDebateStore.getState().applyReflectionProposal('accelerationist', 0);

    expect(mockTaxonomyState.loadEdges).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, createdNodeId: 'new-node-id' });
    expect(mockTaxonomyState.createPovNode).toHaveBeenCalledWith('accelerationist', 'Beliefs');
    const edgeCall = vi.mocked(useTaxonomyStore.setState).mock.calls
      .map(c => c[0] as { edgesFile?: { edges: unknown[] } })
      .find(arg => arg && arg.edgesFile);
    expect(edgeCall!.edgesFile!.edges).toHaveLength(1);
    expect(useDebateStore.getState().newItemProposalStatus['accelerationist#0']).toBe('approved');
  });

  it('load failure leaves NO partial node — guard runs before node creation (t/2055 AC3)', async () => {
    mockTaxonomyState.saveError = null;
    mockTaxonomyState.accelerationist.nodes = [{ id: 'acc-B-001' }];
    mockTaxonomyState.edgesFile = null; // loadEdges (default no-op mock) fails to populate it
    useDebateStore.setState({ reflections: makeProposalReflections() as any, newItemProposalStatus: {}, activeDebateId: 'debate-1' });

    const result = await useDebateStore.getState().applyReflectionProposal('accelerationist', 0);

    expect(mockTaxonomyState.loadEdges).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Edges file not loaded');
    // Guard bailed BEFORE createProposalNode → no node created, no save, nothing approved.
    expect(mockTaxonomyState.createPovNode).not.toHaveBeenCalled();
    expect(mockTaxonomyState.save).not.toHaveBeenCalled();
    expect(useDebateStore.getState().newItemProposalStatus['accelerationist#0']).toBeUndefined();
  });

  it('dismissReflectionProposal marks the proposal dismissed without touching the taxonomy', () => {
    useDebateStore.setState({ reflections: makeProposalReflections() as any, newItemProposalStatus: {} });

    useDebateStore.getState().dismissReflectionProposal('accelerationist', 0);

    expect(useDebateStore.getState().newItemProposalStatus['accelerationist#0']).toBe('dismissed');
    expect(mockTaxonomyState.createPovNode).not.toHaveBeenCalled();
  });
});

