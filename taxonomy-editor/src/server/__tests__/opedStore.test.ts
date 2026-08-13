// @vitest-environment node
// Tests for opedStore.ts — t/2572

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Inline mock backend ──────────────────────────────────────────────────────

type Blob = { content: string } | null;
const _store = new Map<string, string>();

const mockBackend = {
  readFile: vi.fn(async (p: string) => _store.get(p) ?? null),
  writeFile: vi.fn(async (p: string, c: string) => { _store.set(p, c); }),
  deleteFile: vi.fn(async (p: string) => { _store.delete(p); }),
  listDirectory: vi.fn(async (dir: string) => {
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    return [..._store.keys()]
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length).split('/')[0])
      .filter((v, i, a) => a.indexOf(v) === i);
  }),
  fileExists: vi.fn(async (p: string) => _store.has(p)),
  readBinaryFile: vi.fn(),
  writeBinaryFile: vi.fn(),
};

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  resolveDataPath: (rel: string) => `/data/${rel}`,
  getDataRoot: () => '/data',
}));

vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), warn: vi.fn() } },
}));

vi.mock('../security/userContext.js', () => ({
  getStorageUserId: vi.fn(() => 'user-abc'),
  isAnonymousUser: vi.fn(() => false),
}));

vi.mock('./fileIO.js', () => ({
  getUserContentBackend: () => mockBackend,
  assertSafeId: (value: string, label: string) => {
    if (!value || !/^[a-zA-Z0-9_-]+$/.test(value))
      throw Object.assign(new Error(`Invalid ${label}: "${value}"`), { statusCode: 400 });
  },
}));

import {
  listOpedSets,
  loadOpedSet,
  saveOpedSetInProgress,
  loadOpedSetInProgress,
  finalizeOpedSet,
  deleteOpedSet,
} from '../storage/opedStore.js';
import type { OpEdSet } from '../../../../lib/oped/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSet(id: string, overrides: Partial<OpEdSet> = {}): OpEdSet {
  return {
    schema_version: 1,
    set_id: id,
    topic: 'AI Safety policy',
    params: { wordCount: 800, model: 'claude-sonnet-5' },
    created_at: '2026-08-13T10:00:00.000Z',
    opeds: [
      { pov: 'accelerationist', status: 'complete', headline: 'H1', subtitle: 'S1', body: 'B1', wordCount: 800, grounding: [] },
      { pov: 'safetyist', status: 'complete', headline: 'H2', subtitle: 'S2', body: 'B2', wordCount: 800, grounding: [] },
    ],
    ...overrides,
  };
}

const DIR = '/data/users/user-abc/oped-sets';
const indexPath = `${DIR}/_index.json`;

beforeEach(() => {
  _store.clear();
  vi.clearAllMocks();
  // Reset the _sweptUsers set between tests by re-importing isn't possible with vi.mock,
  // so we rely on mock.calls tracking for sweep assertions instead.
});

// ── 1. Round-trip ─────────────────────────────────────────────────────────────

describe('round-trip (t/2572)', () => {
  it('finalizeOpedSet then loadOpedSet returns deep-equal doc', async () => {
    const set = makeSet('set-001');
    await finalizeOpedSet(set);
    const loaded = await loadOpedSet('set-001');
    expect(loaded).toEqual(set);
  });
});

// ── 2. Partial-set persists ───────────────────────────────────────────────────

describe('partial-set (t/2572)', () => {
  it('finalizes a set with failed/cancelled members and lists it correctly', async () => {
    const set = makeSet('set-002', {
      opeds: [
        { pov: 'accelerationist', status: 'complete', headline: 'H', subtitle: 'S', body: 'B', wordCount: 700, grounding: [] },
        { pov: 'safetyist', status: 'failed', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] },
        { pov: 'skeptic', status: 'cancelled', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] },
      ],
    });
    await finalizeOpedSet(set);
    const list = await listOpedSets();
    const entry = list.find(e => e.set_id === 'set-002');
    expect(entry).toBeDefined();
    expect(entry!.voice_count).toBe(3);
    expect(entry!.camps).toContain('accelerationist');
    expect(entry!.camps).toContain('safetyist');
    expect(entry!.camps).toContain('skeptic');
  });
});

// ── 3. List does not load individual docs ─────────────────────────────────────

describe('list without full-doc load (t/2572)', () => {
  it('listOpedSets succeeds even when individual set-doc reads would throw', async () => {
    const set = makeSet('set-003');
    await finalizeOpedSet(set);

    // Poison individual set-doc reads; index reads still work
    const setDocPath = `${DIR}/oped-set-set-003.json`;
    mockBackend.readFile.mockImplementation(async (p: string) => {
      if (p === setDocPath) throw new Error('Should not read individual set doc');
      return _store.get(p) ?? null;
    });

    const list = await listOpedSets();
    const entry = list.find(e => e.set_id === 'set-003');
    expect(entry).toBeDefined();
    expect(entry!.topic).toBe('AI Safety policy');

    // Restore default implementation
    mockBackend.readFile.mockImplementation(async (p: string) => _store.get(p) ?? null);
  });
});

// ── 4. In-progress lifecycle ──────────────────────────────────────────────────

describe('in-progress lifecycle (t/2572)', () => {
  it('saveOpedSetInProgress → loadOpedSetInProgress → finalizeOpedSet → null', async () => {
    const partial = { set_id: 'set-004', opeds: [{ pov: 'accelerationist', status: 'complete' }] };
    await saveOpedSetInProgress('set-004', partial);
    const loaded = await loadOpedSetInProgress('set-004');
    expect(loaded).toEqual(partial);

    const set = makeSet('set-004');
    await finalizeOpedSet(set);
    // Allow the best-effort delete to settle
    await new Promise(r => setTimeout(r, 10));

    const inprogPath = `${DIR}/oped-set-set-004.json.inprogress`;
    expect(_store.has(inprogPath)).toBe(false);
  });
});

// ── 5. assertSafeId at entry points ──────────────────────────────────────────

describe('assertSafeId guards (t/2572)', () => {
  const badIds = ['../evil', 'bad/path', '', 'a b'];
  const ops: Array<[string, () => Promise<unknown>]> = [
    ['loadOpedSet', () => loadOpedSet('../evil')],
    ['saveOpedSetInProgress', () => saveOpedSetInProgress('../evil', {})],
    ['loadOpedSetInProgress', () => loadOpedSetInProgress('../evil')],
    ['finalizeOpedSet', () => finalizeOpedSet(makeSet('../evil'))],
    ['deleteOpedSet', () => deleteOpedSet('../evil')],
  ];

  for (const [name, op] of ops) {
    it(`${name} rejects unsafe setId`, async () => {
      await expect(op()).rejects.toMatchObject({ statusCode: 400 });
    });
  }
});

// ── 6. Delete round-trip ──────────────────────────────────────────────────────

describe('delete round-trip (t/2572)', () => {
  it('deleteOpedSet removes doc from load and list; no throw if .inprogress absent', async () => {
    const set = makeSet('set-006');
    await finalizeOpedSet(set);
    await deleteOpedSet('set-006');
    // Allow best-effort operations to settle
    await new Promise(r => setTimeout(r, 10));

    expect(await loadOpedSet('set-006')).toBeNull();
    const list = await listOpedSets();
    expect(list.find(e => e.set_id === 'set-006')).toBeUndefined();
    // .inprogress delete on absent file must not throw (deleteFile is best-effort)
  });
});
