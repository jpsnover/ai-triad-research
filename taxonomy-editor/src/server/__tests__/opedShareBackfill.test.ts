// @vitest-environment node
//
// t/3490 — backfillOwnOpedShares(): the own-share sweep that re-projects every
// existing users/{id}/oped-shares.json entry so pre-t/3488 shares (schema_version 1,
// no grounding) pick up the embedded grounding on re-projection. projectPublicOpEd is
// a full overwrite (SO cond 2), so replaying publishOpedShare() per registry entry is
// the whole mechanism — this test covers the sweep's enumeration + per-item outcomes,
// not projection content (already covered by opedShareStore.test.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { serverWarn, serverInfo, mockLoadOpedSet } = vi.hoisted(() => ({
  serverWarn: vi.fn(),
  serverInfo: vi.fn(),
  mockLoadOpedSet: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    server: { info: serverInfo, warn: serverWarn, error: vi.fn(), debug: vi.fn() },
  },
  getRequestId: () => 'req-test',
  LOG_MAX_LINE_BYTES: 65536,
  writeFramedNdjson: vi.fn(),
}));

vi.mock('../storage/opedStore.js', () => ({ loadOpedSet: mockLoadOpedSet }));

// In-memory fake backend keyed by absolute path, seeded per test.
const files = new Map<string, string>();
const fakeBackend = {
  backendName: 'fake',
  async readFile(p: string) { return files.has(p) ? files.get(p)! : null; },
  async writeFile(p: string, content: string) { files.set(p, content); },
  async listDirectory(dir: string) {
    const norm = (s: string) => s.replace(/\\/g, '/');
    const prefix = norm(dir).replace(/\/$/, '') + '/';
    const names = new Set<string>();
    for (const p of files.keys()) {
      const np = norm(p);
      if (!np.startsWith(prefix)) continue;
      names.add(np.slice(prefix.length).split('/')[0]);
    }
    return [...names];
  },
  async deleteFile(p: string) { files.delete(p); },
  async fileExists(p: string) { return files.has(p); },
  async readBinaryFile() { return null; },
  async writeBinaryFile() { /* unused */ },
};

vi.mock('../storage/fileIO.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getUserContentBackend: () => fakeBackend, readTaxonomyFile: async () => ({ nodes: [] }) };
});

import { backfillOwnOpedShares } from '../storage/opedShareStore.js';
import { resolveDataPath } from '../config.js';
import path from 'path';

function registryPath(userId: string): string {
  return path.join(resolveDataPath(`users/${userId}`), 'oped-shares.json');
}
function publicPath(shareId: string): string {
  return path.join(resolveDataPath('public/opeds'), `${shareId}.json`);
}

function makeSet(topic: string) {
  return {
    set_id: 'irrelevant',
    topic,
    params: { outlet: null },
    created_at: '2026-08-01T00:00:00Z',
    opeds: [],
  };
}

describe('backfillOwnOpedShares (t/3490)', () => {
  beforeEach(() => {
    files.clear();
    serverWarn.mockClear();
    serverInfo.mockClear();
    mockLoadOpedSet.mockReset();
  });

  it('re-projects every registry entry across every user, keeping the same shareId', async () => {
    files.set(registryPath('user-a'), JSON.stringify({ 'set-1': 'share-aaa' }));
    files.set(registryPath('user-b'), JSON.stringify({ 'set-2': 'share-bbb', 'set-3': 'share-ccc' }));
    files.set(publicPath('share-aaa'), JSON.stringify({ schema_version: 1, shareId: 'share-aaa', topic: 'old', outlet: null, created_at: '', opeds: [] }));

    mockLoadOpedSet.mockImplementation(async (setId: string) => {
      if (setId === 'set-1') return makeSet('Topic 1');
      if (setId === 'set-2') return makeSet('Topic 2');
      if (setId === 'set-3') return makeSet('Topic 3');
      return null;
    });

    const result = await backfillOwnOpedShares();
    expect(result).toEqual({ reprojected: 3, skipped: 0, skippedDetails: [] });

    const upgraded = JSON.parse(files.get(publicPath('share-aaa'))!);
    expect(upgraded.schema_version).toBe(2);
    expect(upgraded.topic).toBe('Topic 1');
    // shareId is stable — same public URL, no dup copy.
    expect(upgraded.shareId).toBe('share-aaa');

    expect(JSON.parse(files.get(publicPath('share-bbb'))!).schema_version).toBe(2);
    expect(JSON.parse(files.get(publicPath('share-ccc'))!).schema_version).toBe(2);
  });

  it('skips (with a WARN) a registry entry whose set was deleted, and keeps going', async () => {
    files.set(registryPath('user-a'), JSON.stringify({ 'set-gone': 'share-gone', 'set-1': 'share-aaa' }));
    mockLoadOpedSet.mockImplementation(async (setId: string) => (setId === 'set-1' ? makeSet('Topic 1') : null));

    const result = await backfillOwnOpedShares();
    expect(result.reprojected).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skippedDetails).toEqual([{ userId: 'user-a', setId: 'set-gone', reason: 'set-not-found' }]);
    expect(serverWarn).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'own-oped-share-backfill-set-missing' }),
      expect.any(String),
    );
  });

  it('is a no-op returning zero counts when no users have a share registry', async () => {
    const result = await backfillOwnOpedShares();
    expect(result).toEqual({ reprojected: 0, skipped: 0, skippedDetails: [] });
  });

  it('records a per-item failure without aborting the rest of the sweep', async () => {
    files.set(registryPath('user-a'), JSON.stringify({ 'set-1': 'share-aaa', 'set-2': 'share-bbb' }));
    mockLoadOpedSet.mockImplementation(async (setId: string) => {
      if (setId === 'set-1') throw new Error('backend unreachable');
      if (setId === 'set-2') return makeSet('Topic 2');
      return null;
    });

    const result = await backfillOwnOpedShares();
    expect(result.reprojected).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skippedDetails[0]).toMatchObject({ userId: 'user-a', setId: 'set-1' });
    expect(result.skippedDetails[0].reason).toContain('backend unreachable');
  });
});
