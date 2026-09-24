// @vitest-environment node
//
// t/3645 (SO parity retrofit, e/201, full context t/3623#6/t/3627#2): prove revoke
// end-to-end against the public route's short-TTL parse cache, rather than inheriting
// the assumption that revocation "just works." Neither existing test file drives this
// full round trip: opedShareStore.test.ts only covers projectPublicOpEd, and
// opedShare.test.ts mocks loadPublicOpedShare directly (never exercises a real
// publishOpedShare → unpublishOpedShare → the route's real cache together).
//
// Per the SO's own framing ("pre-written public JSON + a parse cache means revoke is
// eventually-consistent at best"), the contract under test is BOUNDED staleness, not
// instant revocation: a shareId already cached before revoke stays stale-positive
// until the cache's TTL elapses, then converges to 404. A shareId with no prior cache
// entry is immediately 404 post-revoke (the common case). Both are asserted below.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const { mockLoadOpedSet } = vi.hoisted(() => ({ mockLoadOpedSet: vi.fn() }));

vi.mock('../logger.js', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    fr: { info: vi.fn(), warn: vi.fn() },
  },
  getRequestId: () => 'req-test', getRequestContext: () => undefined, LOG_MAX_LINE_BYTES: 65536,
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../community/community.js', () => ({ listCommunityOpEds: vi.fn().mockResolvedValue([]) }));
vi.mock('../community/communityOpedShares.js', () => ({ getCommunityOpedShareEntry: vi.fn().mockResolvedValue(null) }));
vi.mock('../storage/opedStore.js', () => ({ loadOpedSet: mockLoadOpedSet }));

// In-memory fake backend keyed by absolute path — real opedShareStore functions run
// against this, so publish/unpublish do real reads/writes and the route's cache sees
// real load results (found → then genuinely absent after unpublish deletes the file).
const files = new Map<string, string>();
const fakeBackend = {
  backendName: 'fake',
  async readFile(p: string) { return files.has(p) ? files.get(p)! : null; },
  async writeFile(p: string, content: string) { files.set(p, content); },
  async deleteFile(p: string) { files.delete(p); },
  async listDirectory() { return []; },
  async fileExists(p: string) { return files.has(p); },
  async readBinaryFile() { return null; },
  async writeBinaryFile() { /* unused */ },
};
vi.mock('../storage/fileIO.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getUserContentBackend: () => fakeBackend };
});

import { runWithUser, type UserContext } from '../security/userContext.js';
import { publishOpedShare, unpublishOpedShare } from '../storage/opedShareStore.js';
import { createRouter, type Handler } from '../httpKit.js';
import { registerOpedShareRoutes, _resetPublicOpedCache } from '../routes/opedShare.js';
import type { ServerCtx } from '../routes/context.js';

const OWNER: UserContext = { principalName: 'owner-1', idp: 'github', storageUserId: 'owner-1', isAnonymous: false };

function makeSet(topic: string) {
  return { set_id: 'irrelevant', topic, params: { outlet: null }, created_at: '2026-09-24T00:00:00Z', opeds: [] };
}

async function invoke(shareId: string, ip: string): Promise<{ status: number; body: unknown }> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerOpedShareRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.path === '/api/public/oped/:shareId');
  if (!route) throw new Error('oped share route not registered');

  const req = {
    url: `/api/public/oped/${shareId}`, method: 'GET',
    headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;

  let status = 200;
  let body: unknown;
  const res = {
    writableEnded: false, headersSent: false, req,
    setHeader() { /* no-op */ }, getHeader() { return undefined; },
    writeHead(s: number) { status = s; this.headersSent = true; return this; },
    end(b?: string) { body = b ? JSON.parse(b) : undefined; this.writableEnded = true; },
  } as unknown as ServerResponse;

  await route.handler(req, res, undefined);
  return { status, body };
}

describe('publishOpedShare → unpublishOpedShare vs. the public route cache (t/3645)', () => {
  beforeEach(() => {
    files.clear();
    mockLoadOpedSet.mockReset();
    _resetPublicOpedCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a shareId revoked with NO prior cache entry is immediately 404 (the common case)', async () => {
    mockLoadOpedSet.mockResolvedValue(makeSet('Topic A'));
    const { shareId } = (await runWithUser(OWNER, () => publishOpedShare('set-a')))!;

    await runWithUser(OWNER, () => unpublishOpedShare('set-a'));

    const { status } = await invoke(shareId, '9.9.9.1');
    expect(status).toBe(404);
  });

  it('a shareId fetched BEFORE revoke stays stale-200 until the cache TTL elapses, then converges to 404', async () => {
    vi.useFakeTimers();
    mockLoadOpedSet.mockResolvedValue(makeSet('Topic B'));
    const { shareId } = (await runWithUser(OWNER, () => publishOpedShare('set-b')))!;

    // Populate the cache with a positive hit BEFORE revoke.
    const first = await invoke(shareId, '9.9.9.2');
    expect(first.status).toBe(200);

    await runWithUser(OWNER, () => unpublishOpedShare('set-b'));

    // Within the TTL window: the file is gone on disk, but the cached resolved
    // promise from the pre-revoke fetch is still being served — documented,
    // bounded staleness, not a bug.
    const stillCached = await invoke(shareId, '9.9.9.2');
    expect(stillCached.status).toBe(200);

    // Cross the TTL boundary (route's CACHE_TTL_MS = 5_000) — the cache entry
    // expires, the next request forces a fresh read, which now sees the deleted file.
    vi.advanceTimersByTime(5_001);
    const afterTtl = await invoke(shareId, '9.9.9.2');
    expect(afterTtl.status).toBe(404);
  });

  it('re-sharing after revoke (fresh publish) is immediately visible — no leftover cache poisoning', async () => {
    mockLoadOpedSet.mockResolvedValue(makeSet('Topic C'));
    const { shareId: shareId1 } = (await runWithUser(OWNER, () => publishOpedShare('set-c')))!;
    await invoke(shareId1, '9.9.9.3'); // cache a positive hit for the OLD shareId
    await runWithUser(OWNER, () => unpublishOpedShare('set-c'));

    const { shareId: shareId2 } = (await runWithUser(OWNER, () => publishOpedShare('set-c')))!;
    expect(shareId2).not.toBe(shareId1); // fresh-shareId revocation scheme (t/2727)

    const { status, body } = await invoke(shareId2, '9.9.9.3');
    expect(status).toBe(200);
    expect((body as { topic: string }).topic).toBe('Topic C');
  });
});
