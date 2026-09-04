// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3315 — POST/DELETE /api/community/opeds/:id/share. Verifies the route handler wiring against
// the (mocked) Server Community registry + Server Storage projection: mint returns {shareId,url},
// presence/rate-limit/404 guards, and the admin/submitter revoke-auth (condition 3). The projection's
// identity-exclusion (condition 1) is proven in communityOpedShareStore.test.ts; here we assert the
// endpoint returns ONLY {shareId,url} (no item/identity data crosses the wire).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getCommunityOpEd = vi.fn();
const isAdmin = vi.fn(() => false);
const mintCommunityOpedShare = vi.fn(async () => 'share-xyz');
const revokeCommunityOpedShare = vi.fn();
const getCommunityOpedShareEntry = vi.fn();
const writePublicCommunityOpEd = vi.fn(async () => {});
const deletePublicCommunityOpEd = vi.fn(async () => {});
const checkRate = vi.fn(() => ({ allowed: true, retryAfterMs: 0 }));
const getStorageUserId = vi.fn(() => 'user-1');

vi.mock('../community/community.js', () => ({ getCommunityOpEd: (...a: unknown[]) => getCommunityOpEd(...a), isAdmin: (...a: unknown[]) => isAdmin(...a) }));
vi.mock('../community/communityOpedShares.js', () => ({
  mintCommunityOpedShare: (...a: unknown[]) => mintCommunityOpedShare(...a),
  revokeCommunityOpedShare: (...a: unknown[]) => revokeCommunityOpedShare(...a),
  getCommunityOpedShareEntry: (...a: unknown[]) => getCommunityOpedShareEntry(...a),
}));
vi.mock('../storage/communityOpedShareStore.js', () => ({
  writePublicCommunityOpEd: (...a: unknown[]) => writePublicCommunityOpEd(...a),
  deletePublicCommunityOpEd: (...a: unknown[]) => deletePublicCommunityOpEd(...a),
}));
vi.mock('../security/rateLimiter.js', () => ({ checkRate: (...a: unknown[]) => checkRate(...a) }));
vi.mock('../security/userContext.js', () => ({ getStorageUserId: () => getStorageUserId() }));
vi.mock('../security/rateLimitResponse.js', () => ({ rateLimitResponseBody: () => ({ error: 'rate_limited', retryAfter: 1 }) }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../logger.js', () => ({
  log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
  getRequestId: () => 'test-req', getRequestContext: () => undefined,
}));

import { registerCommunityRoutes } from '../routes/community.js';
import type { ServerCtx } from '../routes/context.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void> | void;
function makeRouter() {
  const handlers: Record<string, Handler> = {};
  const reg = (m: string) => (p: string, h: Handler) => { handlers[`${m} ${p}`] = h; };
  return { router: { get: reg('GET'), put: reg('PUT'), post: reg('POST'), patch: reg('PATCH'), del: reg('DELETE') }, handlers };
}
function fakeRes() {
  const res: Record<string, unknown> = {
    writableEnded: false, headersSent: false, _status: 200, _body: undefined, _headers: {} as Record<string, string>,
    writeHead: vi.fn((c: number) => { res._status = c; res.headersSent = true; }),
    end: vi.fn((b?: string) => { res._body = b !== undefined ? JSON.parse(b) : undefined; res.writableEnded = true; }),
    setHeader: vi.fn((k: string, v: string) => { (res._headers as Record<string, string>)[k] = v; }),
  };
  return res as unknown as ServerResponse & { _body: Record<string, unknown>; _status: number; _headers: Record<string, string> };
}
const req = (url: string) => ({ url, method: 'POST' } as unknown as IncomingMessage);
const GOOD_ITEM = { topic: 'AI progress', opeds: [{ pov: 'accelerationist', body: 'x' }], community_metadata: { submitted_by_display: 'author-9' } };

describe('POST/DELETE /api/community/opeds/:id/share (t/3315)', () => {
  let post: Handler, del: Handler;
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin.mockReturnValue(false);
    checkRate.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    mintCommunityOpedShare.mockResolvedValue('share-xyz');
    getStorageUserId.mockReturnValue('user-1');
    const { router, handlers } = makeRouter();
    registerCommunityRoutes(router as never, { getGithubBackend: () => null } as unknown as ServerCtx);
    post = handlers['POST /api/community/opeds/:id/share'];
    del = handlers['DELETE /api/community/opeds/:id/share'];
  });

  it('mints: returns {shareId,url}, writes the public projection, response carries NO item/identity data', async () => {
    getCommunityOpEd.mockResolvedValue(GOOD_ITEM);
    const res = fakeRes();
    await post(req('/api/community/opeds/oped-1/share'), res, {});
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ shareId: 'share-xyz', url: '/share/oped/share-xyz' });
    expect(mintCommunityOpedShare).toHaveBeenCalledWith('oped-1', 'author-9'); // submitter tracked server-side
    expect(writePublicCommunityOpEd).toHaveBeenCalledWith(GOOD_ITEM, 'share-xyz');
    // no identity/metadata leaked in the response
    expect(JSON.stringify(res._body)).not.toContain('author-9');
  });

  it('404 when the community item does not exist', async () => {
    getCommunityOpEd.mockResolvedValue(null);
    const res = fakeRes();
    await post(req('/api/community/opeds/missing/share'), res, {});
    expect(res._status).toBe(404);
    expect(mintCommunityOpedShare).not.toHaveBeenCalled();
  });

  it('422 (assert-presence) when the item is empty/malformed — never mints a shareId for it', async () => {
    getCommunityOpEd.mockResolvedValue({ topic: '', opeds: [] });
    const res = fakeRes();
    await post(req('/api/community/opeds/empty/share'), res, {});
    expect(res._status).toBe(422);
    expect(mintCommunityOpedShare).not.toHaveBeenCalled();
    expect(writePublicCommunityOpEd).not.toHaveBeenCalled();
  });

  it('429 when rate-limited (mint = any authed user, RATE-LIMITED)', async () => {
    checkRate.mockReturnValue({ allowed: false, retryAfterMs: 5000 });
    const res = fakeRes();
    await post(req('/api/community/opeds/oped-1/share'), res, {});
    expect(res._status).toBe(429);
    expect(res._headers['Retry-After']).toBe('5');
    expect(getCommunityOpEd).not.toHaveBeenCalled();
  });

  it('DELETE 403 for a non-admin non-submitter', async () => {
    getCommunityOpedShareEntry.mockResolvedValue({ shareId: 'share-xyz', submittedBy: 'author-9' });
    getStorageUserId.mockReturnValue('someone-else');
    const res = fakeRes();
    await del(req('/api/community/opeds/oped-1/share'), res, {});
    expect(res._status).toBe(403);
    expect(revokeCommunityOpedShare).not.toHaveBeenCalled();
  });

  it('DELETE by admin revokes + deletes the public projection', async () => {
    isAdmin.mockReturnValue(true);
    getCommunityOpedShareEntry.mockResolvedValue({ shareId: 'share-xyz', submittedBy: 'author-9' });
    revokeCommunityOpedShare.mockResolvedValue({ shareId: 'share-xyz', submittedBy: 'author-9' });
    const res = fakeRes();
    await del(req('/api/community/opeds/oped-1/share'), res, {});
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ revoked: true });
    expect(deletePublicCommunityOpEd).toHaveBeenCalledWith('share-xyz');
  });

  it('DELETE by the original submitter is allowed (optional revoke path)', async () => {
    getCommunityOpedShareEntry.mockResolvedValue({ shareId: 'share-xyz', submittedBy: 'user-1' });
    getStorageUserId.mockReturnValue('user-1'); // current user IS the submitter
    revokeCommunityOpedShare.mockResolvedValue({ shareId: 'share-xyz', submittedBy: 'user-1' });
    const res = fakeRes();
    await del(req('/api/community/opeds/oped-1/share'), res, {});
    expect(res._status).toBe(200);
    expect(deletePublicCommunityOpEd).toHaveBeenCalledWith('share-xyz');
  });

  it('DELETE by admin on an unshared item is an idempotent no-op', async () => {
    isAdmin.mockReturnValue(true);
    getCommunityOpedShareEntry.mockResolvedValue(null);
    revokeCommunityOpedShare.mockResolvedValue(null);
    const res = fakeRes();
    await del(req('/api/community/opeds/never/share'), res, {});
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ revoked: false });
    expect(deletePublicCommunityOpEd).not.toHaveBeenCalled();
  });
});
