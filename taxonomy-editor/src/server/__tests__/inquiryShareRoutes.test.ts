// @vitest-environment node
//
// t/3626 (mint/revoke) + t/3653 (public read) — route LOGIC for the inquiry public-share surface.
// Collaborators are mocked so we test the handlers: mint auth/rate-limit/owner-404/idempotency,
// revoke auth/idempotency, and the public GET's control ORDER (rate-limit FIRST, traversal guard,
// uniform 404). The SO-mandated cache-level revoke E2E (real store + TTL) lives in
// inquiryShareRevokeE2E.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const h = vi.hoisted(() => ({
  user: null as { principalName: string; idp: string; isAnonymous: boolean } | null,
  storageUserId: 'alice',
  writeRateAllowed: true,
  publicRateAllowed: true,
  safeId: true,
  publishResult: { shareId: 'share-xyz' } as { shareId: string } | null,
  unpublishResult: true,
  publicRecord: { schemaVersion: 1, request: { question: 'q' } } as unknown,
  invalidParam: null as string | null,
}));

vi.mock('../security/userContext.js', () => ({
  getCurrentUser: () => h.user,
  getStorageUserId: () => h.storageUserId,
}));
// mint uses checkRate (write-limit); other inquiry routes use checkRequestRate — mock both.
vi.mock('../security/rateLimiter.js', () => ({
  checkRate: (key: string) => ({ allowed: key.startsWith('public-inquiry') ? h.publicRateAllowed : h.writeRateAllowed, retryAfterMs: 1000 }),
  checkRequestRate: () => ({ allowed: true, retryAfterMs: 1000 }),
}));
// clientSafeMessage is used by httpKit.error() — must stay a real passthrough or every error() path throws.
vi.mock('../security/accessControl.js', () => ({ invalidRouteParam: () => h.invalidParam, clientSafeMessage: (m: string) => m }));
vi.mock('../routes/generationContext.js', () => ({
  resolveGenerationContext: () => ({ tier: { limits: { requestsPerMinute: 100 } }, limitKey: 'alice', backend: 'gemini' }),
  enforceBackendAllowed: () => false,
}));
vi.mock('../ai/aiBackends.js', () => ({ isRegisteredModel: () => true }));
vi.mock('../inquiryJobs.js', () => ({
  MAX_CONCURRENT_INQUIRY_JOBS: 1, startInquiryJob: vi.fn(), getInquiryJob: () => null,
  hasInquiryJob: () => false, countRunningInquiryJobs: () => 0, findIdempotentInquiryJob: () => null,
  deriveTruncation: () => ({ truncated: false }),
}));
vi.mock('../storage/inquiryResultStore.js', () => ({ loadInquiryResult: async () => null, listInquiryResults: async () => [] }));
vi.mock('../storage/inquiryShareStore.js', () => ({
  publishInquiryShare: vi.fn(async () => h.publishResult),
  unpublishInquiryShare: vi.fn(async () => h.unpublishResult),
  loadPublicInquiryShare: vi.fn(async () => h.publicRecord),
}));
vi.mock('../storage/fileIO.js', () => ({ isSafeId: () => h.safeId }));
vi.mock('../inquiryPipelineDeps.js', () => ({ buildInquiryRunPipeline: () => vi.fn() }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { createRouter, type Handler } from '../httpKit.js';
import { registerInquiryRoutes } from '../routes/inquiry.js';
import { registerInquiryShareRoutes } from '../routes/inquiryShare.js';

function res() {
  const r = { statusCode: 0, body: '', writableEnded: false, headersSent: false, headers: {} as Record<string, string>,
    writeHead(s: number) { r.statusCode = s; r.headersSent = true; return r; },
    setHeader(k: string, v: string) { r.headers[k] = v; }, write() { return true; },
    end(b?: string) { r.body = b ?? ''; r.writableEnded = true; return r; } };
  return r as unknown as ServerResponse & { statusCode: number; body: string; headers: Record<string, string> };
}
function req(url: string): IncomingMessage {
  return { url, method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.1' } } as unknown as IncomingMessage;
}
function handler(register: (r: never, c: never) => void, method: string, path: string): Handler {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  register(createRouter(routes as never) as never, {} as never);
  return routes.find(r => r.method === method && r.path === path)!.handler;
}
const AUTHED = { principalName: 'alice@example.com', idp: 'aad', isAnonymous: false };

beforeEach(() => {
  h.user = AUTHED; h.storageUserId = 'alice'; h.writeRateAllowed = true; h.publicRateAllowed = true;
  h.safeId = true; h.publishResult = { shareId: 'share-xyz' }; h.unpublishResult = true;
  h.publicRecord = { schemaVersion: 1, request: { question: 'q' } }; h.invalidParam = null;
});

describe('t/3626 — POST /api/inquiry/:jobId/share (mint)', () => {
  const post = () => handler(registerInquiryRoutes, 'POST', '/api/inquiry/:jobId/share');

  it('401 when anonymous', async () => {
    h.user = { ...AUTHED, isAnonymous: true };
    const r = res(); await post()(req('/api/inquiry/job-1/share'), r, undefined);
    expect(r.statusCode).toBe(401);
  });

  it('400 on an unsafe (traversal) jobId', async () => {
    h.safeId = false;
    const r = res(); await post()(req('/api/inquiry/..%2Fx/share'), r, undefined);
    expect(r.statusCode).toBe(400);
  });

  it('429 when the per-user write rate limit is exceeded', async () => {
    h.writeRateAllowed = false;
    const r = res(); await post()(req('/api/inquiry/job-1/share'), r, undefined);
    expect(r.statusCode).toBe(429);
  });

  it('owner mint → { shareId, url } with the /inquiries/ SPA path', async () => {
    const r = res(); await post()(req('/api/inquiry/job-1/share'), r, undefined);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ shareId: 'share-xyz', url: '/inquiries/share-xyz' });
  });

  it('non-owner / absent job → indistinguishable 404 (publishInquiryShare returned null)', async () => {
    h.publishResult = null;
    const r = res(); await post()(req('/api/inquiry/not-mine/share'), r, undefined);
    expect(r.statusCode).toBe(404);
  });
});

describe('t/3626 — DELETE /api/inquiry/:jobId/share (revoke)', () => {
  const del = () => handler(registerInquiryRoutes, 'DELETE', '/api/inquiry/:jobId/share');

  it('401 when anonymous', async () => {
    h.user = null;
    const r = res(); await del()(req('/api/inquiry/job-1/share'), r, undefined);
    expect(r.statusCode).toBe(401);
  });

  it('owner revoke → { ok: true }', async () => {
    const r = res(); await del()(req('/api/inquiry/job-1/share'), r, undefined);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
  });

  it('idempotent: revoking a never-shared inquiry → { ok: false } (no error)', async () => {
    h.unpublishResult = false;
    const r = res(); await del()(req('/api/inquiry/job-1/share'), r, undefined);
    expect(JSON.parse(r.body)).toEqual({ ok: false });
  });
});

describe('t/3653 — GET /api/public/inquiry/:shareId (public read, anon)', () => {
  const get = () => handler(registerInquiryShareRoutes, 'GET', '/api/public/inquiry/:shareId');

  it('rate-limit FIRST: 429 before any lookup when the per-IP limit is exceeded', async () => {
    h.publicRateAllowed = false;
    const { loadPublicInquiryShare } = await import('../storage/inquiryShareStore.js');
    const r = res(); await get()(req('/api/public/inquiry/share-xyz'), r, undefined);
    expect(r.statusCode).toBe(429);
    expect(r.headers['Retry-After']).toBeDefined();
    expect(loadPublicInquiryShare).not.toHaveBeenCalled(); // proves rate-limit precedes the read
  });

  it('400 on a traversal-unsafe :shareId (invalidRouteParam)', async () => {
    h.invalidParam = 'bad shareId';
    const r = res(); await get()(req('/api/public/inquiry/..%2Fx'), r, undefined);
    expect(r.statusCode).toBe(400);
  });

  it('uniform 404 when the share is absent/revoked', async () => {
    h.publicRecord = null;
    const r = res(); await get()(req('/api/public/inquiry/gone'), r, undefined);
    expect(r.statusCode).toBe(404);
  });

  it('200 with the projected public record when present', async () => {
    const r = res(); await get()(req('/api/public/inquiry/share-xyz'), r, undefined);
    expect(JSON.parse(r.body)).toMatchObject({ schemaVersion: 1 });
  });
});
