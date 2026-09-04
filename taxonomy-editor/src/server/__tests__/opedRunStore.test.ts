// @vitest-environment node
// Tests for opedRunStore.ts — t/2893 (blob-backed shared run-control)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// ── Hoisted mock backend ──────────────────────────────────────────────────────

const { _store, mockBackend } = vi.hoisted(() => {
  // Normalize any path separator to '/' for cross-platform mock consistency.
  const norm = (p: string) => p.replace(/\\/g, '/');
  const _store = new Map<string, string>();
  const readFile = vi.fn(async (p: string) => _store.get(norm(p)) ?? null);
  const writeFile = vi.fn(async (p: string, c: string) => { _store.set(norm(p), c); });
  const deleteFile = vi.fn(async (p: string) => { _store.delete(norm(p)); });
  const listDirectory = vi.fn(async (dir: string) => {
    const nd = norm(dir);
    const prefix = nd.endsWith('/') ? nd : nd + '/';
    return [..._store.keys()]
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length).split('/')[0])
      .filter((v, i, a) => a.indexOf(v) === i);
  });
  const fileExists = vi.fn(async (p: string) => _store.has(p));
  const mockBackend = {
    readFile, writeFile, deleteFile, listDirectory, fileExists,
    readBinaryFile: vi.fn(), writeBinaryFile: vi.fn(),
  };
  return { _store, mockBackend };
});

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  resolveDataPath: (rel: string) => `/data/${rel}`,
  getDataRoot: () => '/data',
}));

vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), warn: vi.fn() } },
}));

const mockIsAnonymousUser = vi.fn(() => false);
const mockGetStorageUserId = vi.fn(() => 'user-abc');

vi.mock('../security/userContext.js', () => ({
  isAnonymousUser: () => mockIsAnonymousUser(),
  getStorageUserId: () => mockGetStorageUserId(),
}));

vi.mock('../storage/fileIO.js', () => ({
  getUserContentBackend: () => mockBackend,
  assertSafeId: (value: string, label: string) => {
    if (!value || !/^[a-zA-Z0-9_-]+$/.test(value))
      throw Object.assign(new Error(`Invalid ${label}: "${value}"`), { statusCode: 400 });
  },
}));

import {
  upsertOpedRun,
  countRunningOpedRuns,
  getOpedRun,
  type RunControlRecord,
} from '../storage/opedRunStore.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<RunControlRecord> = {}): RunControlRecord {
  return {
    runId: 'run-001',
    userId: 'user-abc',
    setId: 'set-001',
    status: 'running',
    perVoice: { acc: 'pending' },
    startedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  _store.clear();
  vi.clearAllMocks();
  mockIsAnonymousUser.mockReturnValue(false);
  mockGetStorageUserId.mockReturnValue('user-abc');
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('upsertOpedRun', () => {
  it('writes the blob with the correct path and JSON content', async () => {
    const record = makeRecord();
    await upsertOpedRun(record);

    expect(mockBackend.writeFile).toHaveBeenCalledOnce();
    const [calledPath, calledContent] = mockBackend.writeFile.mock.calls[0];
    const expectedPath = path.join('/data', 'users', 'user-abc', 'oped-runs', 'oped-run-run-001.json');
    expect(calledPath).toBe(expectedPath);
    const parsed = JSON.parse(calledContent);
    expect(parsed).toEqual(record);
  });

  it('is a no-op for anonymous users', async () => {
    mockIsAnonymousUser.mockReturnValue(true);
    await upsertOpedRun(makeRecord());
    expect(mockBackend.writeFile).not.toHaveBeenCalled();
  });
});

describe('countRunningOpedRuns', () => {
  it('returns 1 for a single fresh running blob', async () => {
    const record = makeRecord({ startedAt: Date.now() });
    await upsertOpedRun(record);

    const count = await countRunningOpedRuns('user-abc');
    expect(count).toBe(1);
  });

  it('counts fresh running blob but not stale running blob (both arms)', async () => {
    // Fresh running blob
    const fresh = makeRecord({ runId: 'run-fresh', startedAt: Date.now() });
    await upsertOpedRun(fresh);

    // Stale running blob — started 20 min ago (beyond 15 min TTL)
    const stale = makeRecord({ runId: 'run-stale', startedAt: Date.now() - 20 * 60_000 });
    await upsertOpedRun(stale);

    // Verify both blobs exist before counting
    expect(_store.size).toBe(2);

    const count = await countRunningOpedRuns('user-abc');

    // Fresh blob counted; stale blob not counted
    expect(count).toBe(1);

    // Stale blob deleted lazily (fire-and-forget — wait a tick)
    await new Promise(resolve => setTimeout(resolve, 0));
    const staleKey = '/data/users/user-abc/oped-runs/oped-run-run-stale.json';
    expect(_store.has(staleKey)).toBe(false);
  });

  it('does not count terminal states (complete/cancelled/error)', async () => {
    await upsertOpedRun(makeRecord({ runId: 'run-complete', status: 'complete' }));
    await upsertOpedRun(makeRecord({ runId: 'run-cancelled', status: 'cancelled' }));
    await upsertOpedRun(makeRecord({ runId: 'run-error', status: 'error' }));

    const count = await countRunningOpedRuns('user-abc');
    expect(count).toBe(0);
  });

  it('returns 0 for anonymous users', async () => {
    mockIsAnonymousUser.mockReturnValue(true);
    const count = await countRunningOpedRuns('user-abc');
    expect(count).toBe(0);
  });

  it('returns 0 when directory is empty', async () => {
    const count = await countRunningOpedRuns('user-abc');
    expect(count).toBe(0);
  });
});

describe('getOpedRun', () => {
  it('returns the parsed record when it exists', async () => {
    const record = makeRecord({ status: 'complete' });
    await upsertOpedRun(record);

    const result = await getOpedRun('run-001');
    expect(result).toEqual(record);
  });

  it('returns null when the file does not exist', async () => {
    const result = await getOpedRun('run-missing');
    expect(result).toBeNull();
  });

  it('returns null when user context is unavailable', async () => {
    mockGetStorageUserId.mockReturnValue(null as unknown as string);
    const result = await getOpedRun('run-001');
    expect(result).toBeNull();
  });
});
