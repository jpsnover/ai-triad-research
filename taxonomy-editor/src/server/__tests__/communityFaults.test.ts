// @vitest-environment node
//
// Community library fault injection tests (t/1149 Gap 2). FaultHarness-style
// coverage for storage-backend (GitHub API) failures during the submit and
// approve flows. Pattern: a controllable mock StorageBackend injected via
// getUserContentBackend(), following storageFaults.test.ts. Each test validates
// the Coherent Experience Checklist: no hang, no silent swallowing (errors
// propagate / are logged), no state corruption (submissions never lost or
// left in a half-written state). Reuses makeStorageError from the shared harness.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeStorageError } from '../../../../lib/debate/__tests__/faultInjection.js';

// A GitHub-API-style HTTP failure, built on the shared storage-error helper.
function githubApiError(status: number, message: string): Error {
  return Object.assign(makeStorageError('EGITHUB', `GitHub API ${status}: ${message}`), { statusCode: status });
}

// ── Controllable in-memory backend (the fault-injection surface) ──
interface FaultBackendOpts {
  failWriteOnPath?: (p: string) => Error | null;
  failReadFile?: Error | null;
  failListDirectory?: Error | null;
}
function makeFaultBackend(seed: Record<string, string> = {}, opts: FaultBackendOpts = {}) {
  // community.ts builds paths with path.join (OS separator), so normalize to '/'
  // so seeded keys + comparisons match regardless of platform (Windows uses '\').
  const norm = (p: string) => p.replace(/\\/g, '/');
  const store: Record<string, string> = {};
  for (const [k, v] of Object.entries(seed)) store[norm(k)] = v;
  return {
    store,
    writeFile: vi.fn(async (p: string, content: string) => {
      const np = norm(p);
      const e = opts.failWriteOnPath?.(np);
      if (e) throw e;
      store[np] = content;
    }),
    readFile: vi.fn(async (p: string) => {
      if (opts.failReadFile) throw opts.failReadFile;
      return store[norm(p)] ?? null;
    }),
    listDirectory: vi.fn(async (_dir: string) => {
      if (opts.failListDirectory) throw opts.failListDirectory;
      return Object.keys(store).map(k => k.split('/').pop() as string);
    }),
  };
}

// Mutable bindings the mocks close over (reset per test).
let backend = makeFaultBackend();
let currentUser = 'test-user';
const mockRecorder = { record: vi.fn() };

vi.mock('../storage/fileIO.js', () => ({
  getUserContentBackend: () => backend,
  assertSafeId: () => { /* validity not under test here */ },
}));
vi.mock('../security/userContext.js', () => ({
  getStorageUserId: () => currentUser,
  isAnonymousUser: () => false,
}));
vi.mock('../security/contentSanitizer.js', () => ({
  sanitizeUserText: (s: unknown) => s,
  // t/2031: community.ts now wraps its sanitize walk in withSanitizeBudget; the
  // mock must expose it. Faithful stub — just runs the fn (the real one seeds an
  // ALS budget, irrelevant to these GitHub-API fault assertions).
  withSanitizeBudget: <T>(fn: () => T): T => fn(),
}));
vi.mock('../config.js', () => ({ resolveDataPath: (p: string) => p }));
vi.mock('../runtimeConfig.js', () => ({
  getConfig: () => ({ community: { maxPendingPerUser: 20, globalPendingCap: 500 } }),
}));
vi.mock('../logger.js', () => ({
  log: { server: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => mockRecorder }));

import { submitToCommunity, approveSubmission, listSubmissions } from '../community/community.js';

const SUBS_DIR = 'community/_submissions';
const subPathFor = (id: string) => `${SUBS_DIR}/sub-${id}.json`;

function pendingSubmission(id: string): string {
  return JSON.stringify({
    id, type: 'chat', originalId: 'orig-1', submittedBy: 'test-user',
    submittedAt: new Date(0).toISOString(), status: 'pending', data: { id: 'orig-1', title: 'X' },
  });
}

describe('Community library fault injection — GitHub API failures (t/1149 Gap 2)', () => {
  beforeEach(() => { backend = makeFaultBackend(); currentUser = 'test-user'; mockRecorder.record.mockClear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // AC#4: GitHub API failure during submit.
  it('submit: a GitHub API failure on the submission write propagates — no orphaned submission', async () => {
    backend = makeFaultBackend({}, { failWriteOnPath: () => githubApiError(503, 'Service Unavailable') });

    await expect(submitToCommunity('chat', { id: 'orig-1', title: 'My chat' }))
      .rejects.toThrow(/GitHub API 503/); // propagated, not swallowed

    // No state corruption: nothing was persisted.
    expect(Object.keys(backend.store).filter(k => k.includes('sub-'))).toEqual([]);
  });

  // AC#4: GitHub API failure during approve — submission stays pending, not lost.
  it('approve: a GitHub API failure on the publish write leaves the submission pending (not lost)', async () => {
    const subPath = subPathFor('abc');
    backend = makeFaultBackend(
      { [subPath]: pendingSubmission('abc') },
      { failWriteOnPath: (p) => p.startsWith('community/chats') ? githubApiError(500, 'Internal Server Error') : null },
    );

    await expect(approveSubmission('abc')).rejects.toThrow(/GitHub API 500/);

    // The submission must NOT be flipped or lost — still pending on disk.
    expect(JSON.parse(backend.store[subPath]).status).toBe('pending');
    // And nothing was half-published.
    expect(Object.keys(backend.store).some(k => k.startsWith('community/chats'))).toBe(false);
  });

  it('approve: a failure on the status-update write keeps the submission pending (recoverable retry)', async () => {
    const subPath = subPathFor('def');
    backend = makeFaultBackend(
      { [subPath]: pendingSubmission('def') },
      // Publish succeeds; only the status-flip write (to the submission file) fails.
      { failWriteOnPath: (p) => p === subPath ? githubApiError(503, 'Service Unavailable') : null },
    );

    await expect(approveSubmission('def')).rejects.toThrow(/GitHub API 503/);

    // The status flip didn't persist → the submission is still pending, so a retry
    // can safely re-run (no lost submission, no silent corruption of its status).
    expect(JSON.parse(backend.store[subPath]).status).toBe('pending');
  });

  it('listSubmissions: a corrupt submission file degrades gracefully — skips it and logs, no throw', async () => {
    backend = makeFaultBackend({
      [subPathFor('good')]: pendingSubmission('good'),
      [subPathFor('bad')]: '{ corrupt json !!!',
    });

    const subs = await listSubmissions('pending') as Array<{ id: string }>;

    expect(subs.map(s => s.id)).toContain('good');
    expect(subs.map(s => s.id)).not.toContain('bad');
    // Not silently swallowed — the skip is recorded to the flight recorder.
    expect(mockRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'community', level: 'warn', message: expect.stringContaining('malformed submission') }),
    );
  });

  it('submit: a GitHub API failure rejects promptly — no hang', async () => {
    backend = makeFaultBackend({}, { failWriteOnPath: () => githubApiError(500, 'boom') });

    const start = Date.now();
    await expect(submitToCommunity('chat', { id: 'orig-1' })).rejects.toBeTruthy();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
