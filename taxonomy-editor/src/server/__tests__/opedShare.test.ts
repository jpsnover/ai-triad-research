// @vitest-environment node
//
// t/2727 — GET /api/public/oped/:shareId: the public, no-login op-ed share endpoint
// (second tenant of /api/public/*). Mirrors publicShare.test.ts: the security-weighted
// controls of an unauthenticated surface — rate-limit (429 + Retry-After), path-param
// validation / traversal guard (400), uniform 404, no Set-Cookie, the short-TTL parse
// cache DoS bound, the 500 error path, and the /api/public/ auth-exemption. The real
// invalidRouteParam (isSafeId) and the real checkRate run; loadPublicOpedShare is mocked.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { computeIsPublicPath, PUBLIC_PATH_PREFIXES } from '../publicPaths.js';

const { loadMock, recordMock, listOpedsMock, getShareEntryMock, warnMock } = vi.hoisted(() => ({
  loadMock: vi.fn(), recordMock: vi.fn(), listOpedsMock: vi.fn(), getShareEntryMock: vi.fn(), warnMock: vi.fn(),
}));
vi.mock('../storage/opedShareStore.js', () => ({ loadPublicOpedShare: loadMock }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordMock }) }));
vi.mock('../community/community.js', () => ({ listCommunityOpEds: (...a: unknown[]) => listOpedsMock(...a) }));
vi.mock('../community/communityOpedShares.js', () => ({ getCommunityOpedShareEntry: (...a: unknown[]) => getShareEntryMock(...a) }));
vi.mock('../logger.js', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    server: { info: vi.fn(), warn: (...a: unknown[]) => warnMock(...a), error: vi.fn(), debug: vi.fn() },
    fr: { info: vi.fn(), warn: vi.fn() },
  },
  getRequestId: () => 'test-req', getRequestContext: () => undefined, LOG_MAX_LINE_BYTES: 65536,
}));

import type { ServerCtx } from '../routes/context.js';
import { createRouter, type Handler } from '../httpKit.js';
import { registerOpedShareRoutes, _resetPublicOpedCache, shortDisplayTitle } from '../routes/opedShare.js';

const ROUTE = '/api/public/oped/:shareId';

interface InvokeResult { status: number; body: unknown; headers: Record<string, unknown> }

// shareId is inserted verbatim (caller controls encoding) so a test can send an
// encoded-traversal segment. `ip` seeds x-forwarded-for → the rate key.
async function invoke(shareId: string, ip = `2.3.4.${Math.floor(Math.random() * 1e6)}`): Promise<InvokeResult> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerOpedShareRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.path === ROUTE);
  if (!route) throw new Error('oped share route not registered');

  const req = {
    url: `/api/public/oped/${shareId}`, method: 'GET',
    headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;

  const headers: Record<string, unknown> = {};
  const result: InvokeResult = { status: 200, body: undefined, headers };
  const res = {
    writableEnded: false, headersSent: false, req,
    setHeader(name: string, val: unknown) { headers[name.toLowerCase()] = val; },
    getHeader(name: string) { return headers[name.toLowerCase()]; },
    writeHead(s: number, hdrs?: Record<string, unknown>) {
      result.status = s;
      if (hdrs) for (const k of Object.keys(hdrs)) headers[k.toLowerCase()] = hdrs[k];
      this.headersSent = true; return this;
    },
    end(b?: string) { result.body = b ? JSON.parse(b) : undefined; this.writableEnded = true; },
  } as unknown as ServerResponse;

  await route.handler(req, res, undefined);
  return result;
}

const PUB = { schema_version: 1, shareId: 'abc123', topic: 'T', outlet: null, created_at: 'c', opeds: [{ pov: 'accelerationist', status: 'complete', headline: 'H', subtitle: 'S', body: 'B', wordCount: 10 }] };

describe('GET /api/public/oped/:shareId (t/2727)', () => {
  beforeEach(() => {
    loadMock.mockReset();
    recordMock.mockReset();
    _resetPublicOpedCache();
  });

  it('returns 200 + the stored public record for a shared op-ed', async () => {
    loadMock.mockResolvedValue(PUB);
    const { status, body } = await invoke('abc123');
    expect(status).toBe(200);
    expect(body).toEqual(PUB);
  });

  it('sets NO Set-Cookie header for a logged-out request', async () => {
    loadMock.mockResolvedValue(PUB);
    const { headers } = await invoke('abc123');
    expect(headers['set-cookie']).toBeUndefined();
  });

  it('returns a uniform 404 when the shareId is not shared (or revoked)', async () => {
    loadMock.mockResolvedValue(null);
    const { status, body } = await invoke('never-shared');
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: 'not_found' });
  });

  it('returns 400 for an encoded path-traversal shareId (%2e%2e) — before any read', async () => {
    const { status } = await invoke('%2e%2e');
    expect(status).toBe(400);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('rate-limits after 30 requests in the window (429 + Retry-After)', async () => {
    loadMock.mockResolvedValue(PUB);
    const ip = '8.8.8.8';
    for (let i = 0; i < 30; i++) expect((await invoke('abc123', ip)).status).toBe(200);
    const blocked = await invoke('abc123', ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: 'rate_limited' });
    expect(blocked.headers['retry-after']).toBe(String((blocked.body as { retryAfter: number }).retryAfter));
  });

  it('TTL cache collapses a forged-IP burst for one shareId to a single read', async () => {
    loadMock.mockResolvedValue(PUB);
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => invoke('abc123', `10.1.0.${i}`)));
    for (const { status } of results) expect(status).toBe(200);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a failed read — the next request retries', async () => {
    loadMock.mockRejectedValueOnce(new Error('transient'));
    expect((await invoke('abc123')).status).toBe(500);
    loadMock.mockResolvedValue(PUB);
    expect((await invoke('abc123')).status).toBe(200);
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it('records to the flight recorder and returns 500 when the read throws', async () => {
    loadMock.mockRejectedValue(new Error('blob unreachable'));
    const { status } = await invoke('abc123');
    expect(status).toBe(500);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', type: 'system.error' }));
  });

  it('the /api/public/ auth exemption covers the op-ed share path', () => {
    expect(PUBLIC_PATH_PREFIXES).toContain('/api/public/');
    expect(computeIsPublicPath('/api/public/oped/abc123')).toBe(true);
  });
});

// ── t/3481: GET /api/public/opeds (public index of shared community op-eds) ───────────────────
async function invokeIndex(ip = `3.4.5.${Math.floor(Math.random() * 1e6)}`): Promise<InvokeResult> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerOpedShareRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.path === '/api/public/opeds');
  if (!route) throw new Error('public opeds index route not registered');

  const req = {
    url: '/api/public/opeds', method: 'GET',
    headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;

  const headers: Record<string, unknown> = {};
  const result: InvokeResult = { status: 200, body: undefined, headers };
  const res = {
    writableEnded: false, headersSent: false, req,
    setHeader(name: string, val: unknown) { headers[name.toLowerCase()] = val; },
    getHeader(name: string) { return headers[name.toLowerCase()]; },
    writeHead(s: number, hdrs?: Record<string, unknown>) {
      result.status = s;
      if (hdrs) for (const k of Object.keys(hdrs)) headers[k.toLowerCase()] = hdrs[k];
      this.headersSent = true; return this;
    },
    end(b?: string) { result.body = b ? JSON.parse(b) : undefined; this.writableEnded = true; },
  } as unknown as ServerResponse;

  await route.handler(req, res, undefined);
  return result;
}

describe('GET /api/public/opeds (t/3481)', () => {
  beforeEach(() => {
    listOpedsMock.mockReset(); getShareEntryMock.mockReset(); recordMock.mockReset(); warnMock.mockReset();
  });

  it('lists ONLY already-shared community op-eds, projecting {shareId,title,outlet,camps}', async () => {
    listOpedsMock.mockResolvedValue([
      { id: 'oped-1', topic: 'AI progress and its discontents', camps: ['accelerationist', 'safetyist'], outlet: 'The Atlantic' },
      { id: 'oped-2', topic: 'Unshared set', camps: ['skeptic'], outlet: 'Wired' },
    ]);
    getShareEntryMock.mockImplementation(async (id: string) =>
      id === 'oped-1' ? { shareId: 'share-aaa', submittedBy: 'author-9' } : null);
    const { status, body } = await invokeIndex();
    expect(status).toBe(200);
    expect(body).toEqual({ opeds: [
      { shareId: 'share-aaa', title: 'AI progress and its discontents', outlet: 'The Atlantic', camps: ['accelerationist', 'safetyist'] },
    ] });
    // no identity/metadata crosses the wire — only the projected fields
    expect(JSON.stringify(body)).not.toContain('author-9');
  });

  it('truncates a long / multi-paragraph topic to a short display title (t/3477)', async () => {
    const longTopic = 'A very long situation topic that goes well beyond eighty characters and would otherwise become a wall of text on the index card\n\nsecond paragraph';
    listOpedsMock.mockResolvedValue([{ id: 'oped-1', topic: longTopic, camps: [], outlet: '' }]);
    getShareEntryMock.mockResolvedValue({ shareId: 'share-aaa', submittedBy: 'x' });
    const title = ((await invokeIndex()).body as { opeds: { title: string }[] }).opeds[0].title;
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('\n');
  });

  it('ADR-001 graceful-empty: loaded-0 corpus → {opeds:[]} AND a WARN (silent-degradation rule)', async () => {
    listOpedsMock.mockResolvedValue([]);
    const { status, body } = await invokeIndex();
    expect(status).toBe(200);
    expect(body).toEqual({ opeds: [] });
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'public-opeds' }),
      expect.stringContaining('loaded 0'),
    );
  });

  it('items present but none shared yet → {opeds:[]} with NO warn (normal steady state)', async () => {
    listOpedsMock.mockResolvedValue([{ id: 'oped-1', topic: 'T', camps: [], outlet: '' }]);
    getShareEntryMock.mockResolvedValue(null);
    const { status, body } = await invokeIndex();
    expect(status).toBe(200);
    expect(body).toEqual({ opeds: [] });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('records to the flight recorder and returns 500 when the listing throws', async () => {
    listOpedsMock.mockRejectedValue(new Error('index unreachable'));
    const { status } = await invokeIndex();
    expect(status).toBe(500);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', type: 'system.error' }));
  });

  it('the /api/public/ auth exemption covers the index path', () => {
    expect(computeIsPublicPath('/api/public/opeds')).toBe(true);
  });
});

describe('shortDisplayTitle (t/3481 / t/3477)', () => {
  it('returns the first non-empty line, whitespace-collapsed', () => {
    expect(shortDisplayTitle('  Hello   world  \n\nignored')).toBe('Hello world');
  });
  it('caps at TITLE_MAX (80) chars with a trailing ellipsis', () => {
    const t = shortDisplayTitle('x'.repeat(200));
    expect(t.length).toBe(80);
    expect(t.endsWith('…')).toBe(true);
  });
  it('empty/whitespace topic → empty string', () => {
    expect(shortDisplayTitle('')).toBe('');
    expect(shortDisplayTitle('   \n  ')).toBe('');
  });
});
