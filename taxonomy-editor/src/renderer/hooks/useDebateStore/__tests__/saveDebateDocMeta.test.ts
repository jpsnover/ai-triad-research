// doc_meta stamping at debate save time (t/1779). `saveDebate` stamps
// `session.doc_meta` from the client-side doc catalog (getDocTitles), keyed to the
// doc_ids actually CITED in the argument network — so source-authority calibration
// resolves on both the Electron-save and web-POST paths. Doc-less debates cite no
// source docs and leave `doc_meta` undefined (back-compat, AC#3).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { create } from 'zustand';
import type { DebateStore } from '../types';
import { createSessionSlice } from '../slices/sessionSlice';
import type { DebateSession } from '@lib/debate/types';

const mockSaveDebateSession = vi.fn<(session: unknown) => Promise<void>>();
const mockLoadDocTitles = vi.fn<() => Promise<Record<string, unknown> | null>>();

vi.mock('@bridge', () => ({
  api: {
    saveDebateSession: (...args: unknown[]) => mockSaveDebateSession(...args),
    saveDebateDelta: vi.fn().mockResolvedValue({ newVersion: 3 }),
    listDebateSessionsMeta: vi.fn().mockResolvedValue([]),
    loadDebateSession: vi.fn().mockResolvedValue(null),
    deleteDebateSession: vi.fn().mockResolvedValue(undefined),
    loadDocTitles: () => mockLoadDocTitles(),
  },
  setActiveDebateId: vi.fn(),
  isElectronMode: () => true, // exercise the simple Electron full-save path
}));

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../../../lib/analyticsEmitter', () => ({ trackDebateAbandon: vi.fn(), trackDebateStart: vi.fn() }));
vi.mock('../../usePromptConfigStore', () => ({ usePromptConfigStore: { getState: () => ({ exportSessionConfig: () => ({}) }) } }));
vi.mock('../../useTaxonomyStore', () => ({ useTaxonomyStore: { getState: () => ({ aiBackend: 'gemini', geminiModel: 'x' }) } }));
vi.mock('../shared/taxonomyContext', () => ({ resetDoctrinalAnchoringCache: vi.fn() }));
vi.mock('../shared/neutralCheckpoint', () => ({ resetNeutralMapping: vi.fn() }));
vi.mock('../shared/diagnostics', () => ({ resetSignalHistory: vi.fn(), resetGapInjectionCount: vi.fn(), setGapInjectionCount: vi.fn() }));

/** Minimal session; `evidenceDocIds=null` → no evidence_graph (doc-less debate). */
function makeSession(evidenceDocIds: string[] | null): DebateSession {
  const nodes = evidenceDocIds
    ? [{ id: 'n1', label: 'A', evidence_graph: { evidence_items: evidenceDocIds.map((d) => ({ source_doc_id: d })) } }]
    : [{ id: 'n1', label: 'A' }];
  return {
    id: 'd1', title: 'T', topic: { text: 'x' }, phase: 'confrontation',
    transcript: [{ type: 'opening', id: 't0' }],
    updated_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z',
    povers: [], active_povers: [],
    argument_network: { nodes, edges: [], mutations: [] },
    _saveVersion: 2,
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

function docMetaOf(store: ReturnType<typeof createTestStore>): Record<string, unknown> | undefined {
  return (store.getState().activeDebate as unknown as { doc_meta?: Record<string, unknown> }).doc_meta;
}

describe('saveDebate doc_meta stamping (t/1779)', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDebateSession.mockResolvedValue(undefined);
    store = createTestStore();
  });

  it('stamps doc_meta with ONLY the doc_ids cited in the argument network', async () => {
    // Catalog holds two docs; the debate cites only doc1 → doc2 must be excluded.
    // (getDocTitles caches module-locally; this is the only test in the file that
    // triggers it, so the cached catalog is deterministic.)
    mockLoadDocTitles.mockResolvedValue({
      doc1: { title: 'Doc One', resolved_url: 'https://example/1', provenance_label: 'arXiv 2023' },
      doc2: { title: 'Doc Two' },
    });
    store.setState({ activeDebate: makeSession(['doc1']) as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate();

    expect(docMetaOf(store)).toEqual({
      doc1: { title: 'Doc One', resolved_url: 'https://example/1', provenance_label: 'arXiv 2023' },
    });
    // The saved payload carries it too (both save paths PUT the full activeDebate).
    const saved = mockSaveDebateSession.mock.calls[0][0] as { doc_meta?: Record<string, unknown> };
    expect(saved.doc_meta).toEqual(docMetaOf(store));
  });

  it('leaves doc_meta undefined for a doc-less debate (no cited source docs)', async () => {
    mockLoadDocTitles.mockResolvedValue({ doc1: { title: 'Doc One' } });
    store.setState({ activeDebate: makeSession(null) as unknown as DebateStore['activeDebate'] });

    await store.getState().saveDebate();

    expect(docMetaOf(store)).toBeUndefined();
  });
});
