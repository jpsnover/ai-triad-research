// Delta debate save — client dirty-tracking + delta save path (t/1637, parent t/1470).
//
// Exercises the save-path fork in sessionSlice.saveDebate(): Electron and
// first-save always full-PUT; web 2nd+ saves ship a minimal DebateDelta via
// api.saveDebateDelta; a 409 version_conflict falls back to an unconditional
// full PUT; and — the load-bearing case — the sync snapshot installed on a
// successful save is the state that was SENT (captured before the await), so an
// edit landing mid-flight survives into the next delta rather than being lost.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { create } from 'zustand';
import type { DebateStore } from '../types';
import { createSessionSlice } from '../slices/sessionSlice';
import type { DebateSession, DebateDelta } from '@lib/debate/types';

const mockSaveDebateSession = vi.fn<(session: unknown) => Promise<void>>();
const mockSaveDebateDelta = vi.fn<(delta: DebateDelta) => Promise<{ newVersion: number }>>();
const mockIsElectronMode = vi.fn<() => boolean>(() => false);
const mockRecords: Array<Record<string, unknown>> = [];
const mockRecord = vi.fn((event: Record<string, unknown>) => { mockRecords.push(event); });

vi.mock('@bridge', () => ({
  api: {
    saveDebateSession: (...args: unknown[]) => mockSaveDebateSession(...args),
    saveDebateDelta: (delta: DebateDelta) => mockSaveDebateDelta(delta),
    listDebateSessionsMeta: vi.fn().mockResolvedValue([]),
    loadDebateSession: vi.fn().mockResolvedValue(null),
    deleteDebateSession: vi.fn().mockResolvedValue(undefined),
  },
  setActiveDebateId: vi.fn(),
  isElectronMode: () => mockIsElectronMode(),
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
  useTaxonomyStore: { getState: () => ({ aiBackend: 'gemini', geminiModel: 'gemini-3.1-flash-lite-preview' }) },
}));

vi.mock('../shared/taxonomyContext', () => ({ resetDoctrinalAnchoringCache: vi.fn() }));
vi.mock('../shared/neutralCheckpoint', () => ({ resetNeutralMapping: vi.fn() }));
vi.mock('../shared/diagnostics', () => ({
  resetSignalHistory: vi.fn(),
  resetGapInjectionCount: vi.fn(),
  setGapInjectionCount: vi.fn(),
}));

/** A base session with one opening turn, one AN node, and one AN edge, at version `v`. */
function makeBaseSession(id = 'd1', v = 2): DebateSession {
  return {
    id,
    title: 'T',
    topic: { text: 'x' },
    phase: 'confrontation',
    transcript: [{ type: 'opening', id: 't0' }],
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    povers: [],
    active_povers: [],
    argument_network: {
      nodes: [{ id: 'n1', label: 'A' }],
      edges: [{ id: 'e1', from: 'n1', to: 'n1' }],
      mutations: [],
    },
    _saveVersion: v,
  } as unknown as DebateSession;
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

/** Seed an established sync baseline (as loadDebate does): snapshot == server state, version known. */
function seedBaseline(
  store: ReturnType<typeof createTestStore>,
  snapshot: DebateSession,
  version: number,
  active: DebateSession,
) {
  store.setState({
    activeDebate: active as unknown as DebateStore['activeDebate'],
    _lastSyncedSnapshot: snapshot,
    _lastSyncedVersion: version,
  });
}

describe('saveDebate delta path (t/1637)', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecords.length = 0;
    mockIsElectronMode.mockReturnValue(false);
    mockSaveDebateDelta.mockResolvedValue({ newVersion: 3 });
    mockSaveDebateSession.mockResolvedValue(undefined);
    store = createTestStore();
  });

  it('AC#1: builds the minimal delta from a dirty session (append turn + change node + remove edge)', async () => {
    const snapshot = makeBaseSession('d1', 2);
    const active = structuredClone(snapshot);
    active.transcript.push({ type: 'statement', id: 't1' } as never);
    (active.argument_network!.nodes[0] as { label: string }).label = 'B';
    active.argument_network!.edges = []; // remove e1

    seedBaseline(store, snapshot, 2, active);
    await store.getState().saveDebate('dirty');

    expect(mockSaveDebateSession).not.toHaveBeenCalled();
    expect(mockSaveDebateDelta).toHaveBeenCalledTimes(1);
    const delta = mockSaveDebateDelta.mock.calls[0][0];
    expect(delta.baseVersion).toBe(2);
    expect(delta.newTranscriptEntries).toEqual([{ type: 'statement', id: 't1' }]);
    expect(delta.changedNodes).toEqual([{ id: 'n1', label: 'B' }]);
    expect(delta.changedEdges).toEqual([]);
    expect(delta.removedEdgeIds).toEqual(['e1']);
    expect(delta.removedNodeIds ?? []).toEqual([]);
  });

  it('AC#2: first save of a freshly-created (never-synced) session is a full PUT', async () => {
    const fresh = makeBaseSession('d-new', 0);
    // No baseline seeded → _lastSyncedVersion / _lastSyncedSnapshot stay null.
    store.setState({ activeDebate: fresh as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate('first-save');

    expect(mockSaveDebateDelta).not.toHaveBeenCalled();
    expect(mockSaveDebateSession).toHaveBeenCalledTimes(1);
    // Client is the version authority for full PUTs: stamps baseVersion+1 and re-baselines.
    expect(store.getState()._lastSyncedVersion).toBe(1);
    expect(store.getState()._lastSyncedSnapshot).not.toBeNull();
    expect((fresh as unknown as { _saveVersion: number })._saveVersion).toBe(1);
  });

  it('AC#3: an established-baseline save issues a delta with baseVersion == _lastSyncedVersion', async () => {
    const snapshot = makeBaseSession('d1', 5);
    const active = structuredClone(snapshot);
    active.transcript.push({ type: 'statement', id: 't1' } as never);
    seedBaseline(store, snapshot, 5, active);

    mockSaveDebateDelta.mockResolvedValueOnce({ newVersion: 6 });
    await store.getState().saveDebate('second-save');

    expect(mockSaveDebateDelta).toHaveBeenCalledTimes(1);
    expect(mockSaveDebateDelta.mock.calls[0][0].baseVersion).toBe(5);
    // Server-authoritative newVersion becomes the new baseline.
    expect(store.getState()._lastSyncedVersion).toBe(6);
    expect((active as unknown as { _saveVersion: number })._saveVersion).toBe(6);
  });

  it('AC#4: 409 version_conflict falls back to an unconditional full PUT and re-syncs from currentVersion+1', async () => {
    const snapshot = makeBaseSession('d1', 2);
    const active = structuredClone(snapshot);
    active.transcript.push({ type: 'statement', id: 't1' } as never);
    seedBaseline(store, snapshot, 2, active);

    const conflict = new Error('stale baseVersion') as Error & { errorCode: string; currentVersion: number };
    conflict.errorCode = 'version_conflict';
    conflict.currentVersion = 9;
    mockSaveDebateDelta.mockRejectedValueOnce(conflict);

    await store.getState().saveDebate('conflict');

    expect(mockSaveDebateDelta).toHaveBeenCalledTimes(1);
    expect(mockSaveDebateSession).toHaveBeenCalledTimes(1); // full-PUT fallback
    // Stamped from the server's reported currentVersion (9) + 1.
    expect(store.getState()._lastSyncedVersion).toBe(10);
    expect((active as unknown as { _saveVersion: number })._saveVersion).toBe(10);
    const coalesced = mockRecords.filter(r => r.type === 'state.save-coalesced');
    expect(coalesced.some(r => typeof r.message === 'string' && (r.message as string).includes('version_conflict'))).toBe(true);
    // No user-facing error for a benign, self-healing conflict.
    expect(store.getState().debateError).toBeNull();
  });

  it('AC#5: a non-version_conflict delta error (409 save_in_progress) is NOT swallowed by the delta handler', async () => {
    const snapshot = makeBaseSession('d1', 2);
    const active = structuredClone(snapshot);
    active.transcript.push({ type: 'statement', id: 't1' } as never);
    seedBaseline(store, snapshot, 2, active);

    const inProgress = new Error('Another save is already in progress.') as Error & { errorCode: string };
    inProgress.errorCode = 'save_in_progress';
    // First delta rejects save_in_progress; the coalesced follow-up succeeds.
    mockSaveDebateDelta.mockRejectedValueOnce(inProgress).mockResolvedValue({ newVersion: 3 });

    await store.getState().saveDebate('in-progress');
    await vi.waitFor(() => {
      expect(store.getState()._saveInFlight).toBe(false);
    });

    // The delta handler rethrew (no full-PUT fallback for save_in_progress) → outer catch marked dirty.
    expect(mockSaveDebateSession).not.toHaveBeenCalled();
    const coalesced = mockRecords.filter(r =>
      r.type === 'state.save-coalesced' && typeof r.message === 'string' && (r.message as string).includes('save_in_progress'),
    );
    expect(coalesced.length).toBe(1);
    // No durable error surfaced.
    expect(store.getState().debateError).toBeNull();
  });

  it('AC#6: Electron mode always full-saves and never emits a delta', async () => {
    mockIsElectronMode.mockReturnValue(true);
    const snapshot = makeBaseSession('d1', 2);
    const active = structuredClone(snapshot);
    active.transcript.push({ type: 'statement', id: 't1' } as never);
    // Even WITH an established baseline, Electron takes the full-save path.
    seedBaseline(store, snapshot, 2, active);

    await store.getState().saveDebate('electron');

    expect(mockSaveDebateDelta).not.toHaveBeenCalled();
    expect(mockSaveDebateSession).toHaveBeenCalledTimes(1);
    const saved = mockRecords.filter(r => r.type === 'state.save' && (r.data as Record<string, unknown>)?.save_mode === 'electron');
    expect(saved.length).toBe(1);
  });

  it('AC#7: an empty delta skips the network round-trip entirely', async () => {
    const snapshot = makeBaseSession('d1', 2);
    const active = structuredClone(snapshot); // no mutations → nothing changed
    seedBaseline(store, snapshot, 2, active);

    await store.getState().saveDebate('noop');

    expect(mockSaveDebateDelta).not.toHaveBeenCalled();
    expect(mockSaveDebateSession).not.toHaveBeenCalled();
    const noop = mockRecords.filter(r => r.type === 'state.save' && (r.data as Record<string, unknown>)?.save_mode === 'noop');
    expect(noop.length).toBe(1);
    // Baseline untouched.
    expect(store.getState()._lastSyncedVersion).toBe(2);
  });

  it('AC#8: an edit landing mid-flight survives into the NEXT delta (sent-state snapshot timing)', async () => {
    const snapshot = makeBaseSession('d1', 2);
    const active = structuredClone(snapshot);
    active.transcript.push({ type: 'statement', id: 't1' } as never); // the edit being saved now
    seedBaseline(store, snapshot, 2, active);

    // Hold the first delta in flight so we can mutate mid-await.
    let resolveDelta!: (v: { newVersion: number }) => void;
    mockSaveDebateDelta.mockImplementationOnce(() => new Promise(r => { resolveDelta = r; }));

    const p = store.getState().saveDebate('first');
    // While the save is in flight, a new turn lands directly on activeDebate.
    const live = store.getState().activeDebate as unknown as DebateSession;
    live.transcript.push({ type: 'statement', id: 't2' } as never);

    resolveDelta({ newVersion: 3 });
    await p;

    // The installed snapshot must be the SENT state (t0,t1) — NOT a post-await
    // re-clone (which would already contain t2 and silently drop it).
    mockSaveDebateDelta.mockResolvedValueOnce({ newVersion: 4 });
    await store.getState().saveDebate('second');

    expect(mockSaveDebateDelta).toHaveBeenCalledTimes(2);
    const secondDelta = mockSaveDebateDelta.mock.calls[1][0];
    expect(secondDelta.baseVersion).toBe(3);
    expect(secondDelta.newTranscriptEntries).toEqual([{ type: 'statement', id: 't2' }]);
  });
});
