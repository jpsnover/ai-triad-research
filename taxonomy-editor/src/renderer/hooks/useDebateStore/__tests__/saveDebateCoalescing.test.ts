import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { create } from 'zustand';
import type { DebateStore } from '../types';
import { createSessionSlice } from '../slices/sessionSlice';
import type { ActionableError } from '@lib/errors/ActionableError';

const mockSaveDebateSession = vi.fn<(session: unknown) => Promise<void>>();
const mockRecords: Array<Record<string, unknown>> = [];
const mockRecord = vi.fn((event: Record<string, unknown>) => { mockRecords.push(event); });

vi.mock('@bridge', () => ({
  api: {
    saveDebateSession: (...args: unknown[]) => mockSaveDebateSession(...args),
    listDebateSessionsMeta: vi.fn().mockResolvedValue([]),
    loadDebateSession: vi.fn().mockResolvedValue(null),
    deleteDebateSession: vi.fn().mockResolvedValue(undefined),
  },
  setActiveDebateId: vi.fn(),
  // These pre-delta tests assert the always-full-save path (saveDebateSession per
  // save; identical repeats are not coalesced). That is the Electron branch of the
  // t/1637 delta rework — web mode coalesces an unchanged repeat to a no-op. Pin
  // Electron mode so behavior is unchanged; the web/delta path is covered by
  // saveDebateDelta.test.ts.
  isElectronMode: () => true,
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

vi.mock('../../../lib/analyticsEmitter', () => ({
  trackDebateAbandon: vi.fn(),
  trackDebateStart: vi.fn(),
}));

vi.mock('../../usePromptConfigStore', () => ({
  usePromptConfigStore: { getState: () => ({ exportSessionConfig: () => ({}) }) },
}));

vi.mock('../../useTaxonomyStore', () => ({
  useTaxonomyStore: { getState: () => ({ aiBackend: 'gemini', geminiModel: 'gemini-3.5-flash-lite-preview' }) },
}));

vi.mock('../shared/taxonomyContext', () => ({ resetDoctrinalAnchoringCache: vi.fn() }));
vi.mock('../shared/neutralCheckpoint', () => ({ resetNeutralMapping: vi.fn() }));
vi.mock('../shared/diagnostics', () => ({
  resetSignalHistory: vi.fn(),
  resetGapInjectionCount: vi.fn(),
  setGapInjectionCount: vi.fn(),
}));

function makeMinimalDebate(id = 'test-debate-1') {
  return {
    id,
    title: 'Test debate',
    topic: { text: 'Test topic' },
    phase: 'confrontation' as const,
    transcript: [],
    updated_at: new Date().toISOString(),
    povers: [],
    active_povers: [],
    created_at: new Date().toISOString(),
  };
}

function createTestStore() {
  return create<Pick<DebateStore, keyof ReturnType<typeof createSessionSlice>>>()((set, get, store) => ({
    ...createSessionSlice(
      set as Parameters<typeof createSessionSlice>[0],
      get as Parameters<typeof createSessionSlice>[1],
      store as Parameters<typeof createSessionSlice>[2],
    ),
    debateError: null,
  }));
}

describe('saveDebate coalescing', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecords.length = 0;
    store = createTestStore();
  });

  it('AC#1/AC#5: rapid-fire saves produce exactly 1 in-flight + 1 follow-up', async () => {
    let resolveFirst!: () => void;
    const firstSave = new Promise<void>(r => { resolveFirst = r; });
    let callCount = 0;
    mockSaveDebateSession.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return firstSave;
      return Promise.resolve();
    });

    store.setState({ activeDebate: makeMinimalDebate() as unknown as DebateStore['activeDebate'] });

    const p1 = store.getState().saveDebate('caller-1');
    store.getState().saveDebate('caller-2');
    store.getState().saveDebate('caller-3');
    store.getState().saveDebate('caller-4');
    store.getState().saveDebate('caller-5');

    expect(mockSaveDebateSession).toHaveBeenCalledTimes(1);
    expect(store.getState()._saveInFlight).toBe(true);
    expect(store.getState()._saveDirty).toBe(true);

    resolveFirst();
    await p1;
    await vi.waitFor(() => {
      expect(mockSaveDebateSession).toHaveBeenCalledTimes(2);
    });

    expect(store.getState()._saveInFlight).toBe(false);
    expect(store.getState()._saveDirty).toBe(false);

    const coalescedEvents = mockRecords.filter(r => r.type === 'state.save-coalesced');
    expect(coalescedEvents.length).toBe(4);
  });

  it('AC#2: guard state is per-store instance, not shared', () => {
    const store1 = createTestStore();
    const store2 = createTestStore();

    store1.setState({ _saveInFlight: true });
    expect(store2.getState()._saveInFlight).toBe(false);
  });

  it('AC#4/AC#6: server 409 save_in_progress is treated as benign', async () => {
    let resolveFirst!: () => void;
    const firstSave = new Promise<void>(r => { resolveFirst = r; });
    let callCount = 0;
    mockSaveDebateSession.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return firstSave;
      return Promise.resolve();
    });

    store.setState({ activeDebate: makeMinimalDebate() as unknown as DebateStore['activeDebate'] });

    const p1 = store.getState().saveDebate('initial');

    const err409 = new Error('Another save is already in progress for this debate.') as Error & { errorCode: string; httpStatus: number };
    err409.errorCode = 'save_in_progress';
    err409.httpStatus = 409;
    resolveFirst();
    mockSaveDebateSession.mockRejectedValueOnce(err409);

    await p1;

    store.getState().saveDebate('trigger-409');
    await vi.waitFor(() => {
      expect(store.getState()._saveInFlight).toBe(false);
    });

    const errorEvents = mockRecords.filter(r => r.type === 'state.error');
    expect(errorEvents.length).toBe(0);

    const coalescedEvents = mockRecords.filter(r =>
      r.type === 'state.save-coalesced' && typeof r.message === 'string' && r.message.includes('409'),
    );
    expect(coalescedEvents.length).toBe(1);
  });

  it('non-409 errors still surface as failures', async () => {
    mockSaveDebateSession.mockRejectedValueOnce(new Error('Network failure'));

    store.setState({ activeDebate: makeMinimalDebate() as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate('fail-test');

    const errorEvents = mockRecords.filter(r => r.type === 'state.error');
    expect(errorEvents.length).toBe(1);
    expect(store.getState()._saveInFlight).toBe(false);
  });

  it('follow-up fires even after a non-409 failure when dirty', async () => {
    let resolveFirst!: () => void;
    const firstSave = new Promise<void>((_r, rej) => { resolveFirst = () => rej(new Error('Server error')); });
    let callCount = 0;
    mockSaveDebateSession.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return firstSave;
      return Promise.resolve();
    });

    store.setState({ activeDebate: makeMinimalDebate() as unknown as DebateStore['activeDebate'] });

    const p1 = store.getState().saveDebate('first');
    store.getState().saveDebate('second');

    resolveFirst();
    await p1.catch(() => {});
    await vi.waitFor(() => {
      expect(mockSaveDebateSession).toHaveBeenCalledTimes(2);
    });

    expect(store.getState()._saveInFlight).toBe(false);
  });
});

// t/1639 — degraded-save UX. debateIO (t/1638) throws an enriched ActionableError
// on durable-save total-loss; Electron IPC strips its structured fields but the
// composed `.message` survives with stable markers (the debateIO Location line +
// the preserved-copy wording). The renderer must surface a distinct at-risk state,
// with the turn count recomputed locally from the transcript (not scraped from the
// message), rather than a generic failure.
describe('saveDebate degraded-save surfacing (t/1639)', () => {
  let store: ReturnType<typeof createTestStore>;

  // Mirrors debateIO's composed ActionableError message after IPC strips the
  // structured fields: only `.message` reaches the renderer.
  const durableLossMessage =
    '\n  Goal:     Persist the debate session to disk so no turns are lost\n' +
    '  Error:    Could not durably save debate test-debate-1 (run r-99); 3 turns are at risk of being lost.\n' +
    '  Location: taxonomy-editor/src/main/debateIO.ts saveDebateSession\n' +
    '  Resolve:\n' +
    '    1. The recovery copy was preserved at C:\\Users\\me\\AppData\\debate.json.tmp and was NOT deleted — it is the only durable copy. Do not remove it.\n';

  function makeDebateWithTurns() {
    return {
      ...makeMinimalDebate(),
      transcript: [
        { type: 'opening' },
        { type: 'statement' },
        { type: 'statement' },
        { type: 'clarification' }, // not counted — mirrors debateIO's filter
      ],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecords.length = 0;
    store = createTestStore();
  });

  it('AC1/AC2: durable-save loss surfaces a distinct at-risk message with the locally-computed turn count', async () => {
    mockSaveDebateSession.mockRejectedValueOnce(new Error(durableLossMessage));
    store.setState({ activeDebate: makeDebateWithTurns() as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate('durable-loss');

    const err = store.getState().debateError ?? '';
    // AC1: distinct degraded state (not the generic permission/save-failed string).
    expect(err).toContain('at risk');
    // AC2: turn count recomputed locally (opening+statement = 3), and that a copy survives.
    expect(err).toContain('3 turns');
    expect(err.toLowerCase()).toContain('recovery copy');
    // Does not leak the raw .tmp path to the user.
    expect(err).not.toContain('.tmp');

    // Flight recorder distinguishes the degraded case (ADR-003).
    const errorEvents = mockRecords.filter(r => r.type === 'state.error');
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data).toMatchObject({ save_degraded: true, at_risk_turns: 3 });
  });

  it('AC3: an ordinary save failure does NOT get the degraded treatment', async () => {
    mockSaveDebateSession.mockRejectedValueOnce(new Error('Network failure'));
    store.setState({ activeDebate: makeDebateWithTurns() as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate('ordinary-fail');

    const err = store.getState().debateError ?? '';
    expect(err).not.toContain('recovery copy was preserved');

    const errorEvents = mockRecords.filter(r => r.type === 'state.error');
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data).toMatchObject({ save_degraded: false });
  });

  it.each([401, 402, 403])('HTTP %i on saveDebateSession sets save_degraded with at-risk message (t/2231)', async (httpStatus) => {
    const httpErr = Object.assign(new Error('Forbidden'), { httpStatus });
    mockSaveDebateSession.mockRejectedValueOnce(httpErr);
    store.setState({ activeDebate: makeDebateWithTurns() as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate('auth-fail');

    const err = store.getState().debateError ?? '';
    expect(err).toContain(`HTTP ${httpStatus}`);
    expect(err).toContain('at risk of being lost');
    expect(err).toContain('3 turns');
    expect(err).not.toContain('recovery copy');

    const errorEvents = mockRecords.filter(r => r.type === 'state.error');
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data).toMatchObject({ save_degraded: true, at_risk_turns: 3 });
  });
});

// t/3073 — a save rejected because the 'save' circuit breaker is OPEN must never be
// silently dropped. The incident recorded save_degraded:false on a breaker-blocked save
// and queued nothing. It must now: flag save_degraded:true (observable), surface a paused
// message, queue a cooldown retry that flushes on recovery, and — after the retry cap —
// escalate to a LOUD, actionable terminal state rather than a silent give-up.
describe('saveDebate breaker-blocked durability (t/3073)', () => {
  let store: ReturnType<typeof createTestStore>;

  // Mirrors the typed circuit-open ActionableError from web-bridge/resilience — the
  // discriminator is the structured `circuitOpen` field, never a message substring (t/2952).
  const breakerError = () => Object.assign(new Error('save circuit breaker OPEN'), { circuitOpen: true, circuitCategory: 'save' });

  function debateWithTurns() {
    return {
      ...makeMinimalDebate(),
      transcript: [{ type: 'opening' }, { type: 'statement' }, { type: 'statement' }],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecords.length = 0;
    vi.useFakeTimers();
    store = createTestStore();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('arm2a: flags save_degraded=true (not false) + surfaces a paused message + queues a retry — never silent', async () => {
    mockSaveDebateSession.mockRejectedValueOnce(breakerError());
    store.setState({ activeDebate: debateWithTurns() as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate('breaker-block');

    const err = store.getState().debateError ?? '';
    expect(err.toLowerCase()).toContain('saving is paused');
    expect(err).toContain('3 turns');
    const errorEvents = mockRecords.filter(r => r.type === 'state.error');
    expect(errorEvents.length).toBe(1);
    // The incident's exact defect: a breaker-blocked save recorded save_degraded:false.
    expect(errorEvents[0].data).toMatchObject({ save_degraded: true, at_risk_turns: 3 });
    // A cooldown retry is queued (not dropped).
    expect(store.getState()._breakerRetryScheduled).toBe(true);
    expect(store.getState()._breakerRetryCount).toBe(1);
  });

  it('arm2b: flushes the queued save on cooldown and clears the degraded state on success', async () => {
    mockSaveDebateSession
      .mockRejectedValueOnce(breakerError())   // first attempt — breaker OPEN
      .mockResolvedValueOnce(undefined);        // cooldown retry — server recovered
    store.setState({ activeDebate: debateWithTurns() as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate('breaker-block');
    expect(store.getState().debateError).toBeTruthy();

    // Advance past the breaker cooldown so the scheduled retry fires.
    await vi.advanceTimersByTimeAsync(61_000);

    expect(mockSaveDebateSession).toHaveBeenCalledTimes(2);
    expect(store.getState().debateError).toBeNull();       // cleared on the recovered save
    expect(store.getState()._breakerRetryCount).toBe(0);   // counter reset
  });

  it('arm3: escalates to a LOUD, actionable terminal state after the retry cap — never a silent give-up', async () => {
    mockSaveDebateSession.mockRejectedValue(breakerError());   // every attempt blocked
    // Preset the counter at the cap so this attempt is the terminal one.
    store.setState({ activeDebate: debateWithTurns() as unknown as DebateStore['activeDebate'], _breakerRetryCount: 5 });

    await store.getState().saveDebate('breaker-block-final');

    const err = store.getState().debateError ?? '';
    // Loud + actionable: exact unsaved-turn count + local-export escape hatch.
    expect(err).toContain('3 turns');
    expect(err.toLowerCase()).toContain('export');
    const exhausted = mockRecords.filter(r => r.type === 'state.error' && (r.data as Record<string, unknown> | undefined)?.breaker_retry_exhausted === true);
    expect(exhausted.length).toBe(1);
    expect((exhausted[0].data as Record<string, unknown>).save_degraded).toBe(true);
    // Terminal: auto-retry stops (no new timer scheduled).
    expect(store.getState()._breakerRetryScheduled).toBe(false);
  });
});
