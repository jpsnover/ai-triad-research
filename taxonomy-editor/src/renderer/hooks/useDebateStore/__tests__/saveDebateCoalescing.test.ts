import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
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
