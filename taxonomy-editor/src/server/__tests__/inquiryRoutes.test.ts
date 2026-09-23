// @vitest-environment node
//
// t/3581 — POST /api/inquiry + GET /api/inquiry/:jobId route behavior. The job-store internals are
// covered by inquiryJobs.test.ts; here the collaborators are mocked so we test the ROUTE logic:
// authenticated-only gate (ADR-0002 #8), strict validation, model-override registry check, rate
// limit, concurrency cap, idempotency, and the GET state / persisted-result / 404 paths.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const h = vi.hoisted(() => ({
  user: null as { principalName: string; idp: string; isAnonymous: boolean } | null,
  storageUserId: 'alice',
  rpmAllowed: true,
  backendBlocked: false,
  registered: true,
  running: 0,
  idempotent: null as { jobId: string } | null,
  jobById: new Map<string, Record<string, unknown>>(),
  hasById: new Set<string>(),
  persisted: new Map<string, unknown>(),
}));

vi.mock('../security/userContext.js', () => ({
  getCurrentUser: () => h.user,
  getStorageUserId: () => h.storageUserId,
}));
vi.mock('../security/rateLimiter.js', () => ({
  checkRequestRate: () => ({ allowed: h.rpmAllowed, retryAfterMs: 1000 }),
}));
vi.mock('../routes/generationContext.js', () => ({
  resolveGenerationContext: () => ({ tier: { limits: { requestsPerMinute: 100 } }, limitKey: 'alice', backend: 'gemini' }),
  enforceBackendAllowed: (res: ServerResponse) => { if (h.backendBlocked) { (res as unknown as { writeHead: (n: number) => void }).writeHead(403); (res as unknown as { end: (s?: string) => void }).end(JSON.stringify({ error: 'backend' })); return true; } return false; },
}));
vi.mock('../ai/aiBackends.js', () => ({ isRegisteredModel: () => h.registered }));
const startInquiryJob = vi.fn((args: { userId: string }) => { const jobId = 'job-new'; h.jobById.set(jobId, { jobId, status: 'queued' }); return { jobId, userId: args.userId, status: 'queued', progressPct: 0, resultId: null, error: null }; });
vi.mock('../inquiryJobs.js', () => ({
  MAX_CONCURRENT_INQUIRY_JOBS: 1,
  startInquiryJob: (args: { userId: string }) => startInquiryJob(args),
  getInquiryJob: (jobId: string, userId: string) => { const j = h.jobById.get(jobId); return j && (j.userId === userId || j.userId === undefined) ? j : null; },
  hasInquiryJob: (jobId: string) => h.hasById.has(jobId) || h.jobById.has(jobId),
  countRunningInquiryJobs: () => h.running,
  findIdempotentInquiryJob: () => h.idempotent,
  deriveTruncation: (r: { truncated?: boolean }) => ({ truncated: !!r.truncated, terminationReason: r.truncated ? 'api_ceiling' : undefined }),
}));
vi.mock('../storage/inquiryResultStore.js', () => ({ loadInquiryResult: async (jobId: string) => h.persisted.get(jobId) ?? null }));
vi.mock('../inquiryPipelineDeps.js', () => ({ buildInquiryRunPipeline: () => vi.fn() }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { createRouter, type Handler } from '../httpKit.js';
import { registerInquiryRoutes } from '../routes/inquiry.js';

function res() {
  const r = { statusCode: 0, body: '', writableEnded: false, headersSent: false,
    writeHead(s: number) { r.statusCode = s; r.headersSent = true; return r; },
    setHeader() {}, write() { return true; },
    end(b?: string) { r.body = b ?? ''; r.writableEnded = true; return r; } };
  return r as unknown as ServerResponse & { statusCode: number; body: string };
}
function req(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, method: 'POST', headers } as unknown as IncomingMessage;
}
function handler(method: string, path: string): Handler {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerInquiryRoutes(createRouter(routes as never), {} as never);
  return routes.find(r => r.method === method && r.path === path)!.handler;
}
const AUTHED = { principalName: 'alice@example.com', idp: 'aad', isAnonymous: false };
const VALID = { question: 'What counts as an AI harm?', fidelity: 'standard' };

beforeEach(() => {
  h.user = AUTHED; h.storageUserId = 'alice'; h.rpmAllowed = true; h.backendBlocked = false;
  h.registered = true; h.running = 0; h.idempotent = null;
  h.jobById.clear(); h.hasById.clear(); h.persisted.clear();
  startInquiryJob.mockClear();
});

describe('t/3581 — POST /api/inquiry', () => {
  const post = () => handler('POST', '/api/inquiry');

  it('401 when anonymous (authenticated-only, ADR-0002 #8)', async () => {
    h.user = { ...AUTHED, isAnonymous: true };
    const r = res(); await post()(req('/api/inquiry'), r, VALID);
    expect(r.statusCode).toBe(401);
    expect(startInquiryJob).not.toHaveBeenCalled();
  });

  it('401 when no user context at all', async () => {
    h.user = null;
    const r = res(); await post()(req('/api/inquiry'), r, VALID);
    expect(r.statusCode).toBe(401);
  });

  it('400 on an unknown key (strict schema)', async () => {
    const r = res(); await post()(req('/api/inquiry'), r, { ...VALID, situationID: 'x' }); // wrong case
    expect(r.statusCode).toBe(400);
    expect(startInquiryJob).not.toHaveBeenCalled();
  });

  it('400 on an unregistered model override', async () => {
    h.registered = false;
    const r = res(); await post()(req('/api/inquiry'), r, { ...VALID, models: { debaters: 'gemini-retired' } });
    expect(r.statusCode).toBe(400);
    expect(startInquiryJob).not.toHaveBeenCalled();
  });

  it('429 when the concurrency cap is already reached', async () => {
    h.running = 1;
    const r = res(); await post()(req('/api/inquiry'), r, VALID);
    expect(r.statusCode).toBe(429);
    expect(startInquiryJob).not.toHaveBeenCalled();
  });

  it('429 when rate-limited', async () => {
    h.rpmAllowed = false;
    const r = res(); await post()(req('/api/inquiry'), r, VALID);
    expect(r.statusCode).toBe(429);
  });

  it('idempotency: returns the in-window jobId without starting a new job', async () => {
    h.idempotent = { jobId: 'job-existing' };
    const r = res(); await post()(req('/api/inquiry', { 'idempotency-key': 'k1' }), r, VALID);
    expect(r.statusCode).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ jobId: 'job-existing' });
    expect(startInquiryJob).not.toHaveBeenCalled();
  });

  it('valid → 202 { jobId } and starts the job', async () => {
    const r = res(); await post()(req('/api/inquiry'), r, VALID);
    expect(r.statusCode).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ jobId: 'job-new' });
    expect(startInquiryJob).toHaveBeenCalledTimes(1);
  });
});

describe('t/3581 — GET /api/inquiry/:jobId', () => {
  const get = () => handler('GET', '/api/inquiry/:jobId');

  it('401 when anonymous', async () => {
    h.user = null;
    const r = res(); await get()(req('/api/inquiry/job-1'), r, undefined);
    expect(r.statusCode).toBe(401);
  });

  it('returns the job state for a running job', async () => {
    h.jobById.set('job-1', { jobId: 'job-1', userId: 'alice', status: 'debating', progressPct: 40, resultId: null, error: null });
    const r = res(); await get()(req('/api/inquiry/job-1'), r, undefined);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).status).toBe('debating');
  });

  it('includes the persisted result on a terminal job', async () => {
    h.jobById.set('job-1', { jobId: 'job-1', userId: 'alice', status: 'done', progressPct: 100, resultId: 'job-1', error: null });
    h.persisted.set('job-1', { schemaVersion: 1, singleRunCaveat: 'one run' });
    const r = res(); await get()(req('/api/inquiry/job-1'), r, undefined);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).result).toMatchObject({ schemaVersion: 1 });
  });

  it('cross-replica fallback: job absent from map → serves the persisted result', async () => {
    h.persisted.set('job-gone', { truncated: true, schemaVersion: 1 });
    const r = res(); await get()(req('/api/inquiry/job-gone'), r, undefined);
    expect(r.statusCode).toBe(200);
    const parsed = JSON.parse(r.body);
    expect(parsed.status).toBe('done_truncated');       // derived from the result's truncation
    expect(parsed.terminationReason).toBe('api_ceiling');
    expect(parsed.result).toBeTruthy();
  });

  it('404 when neither a job nor a persisted result exists', async () => {
    const r = res(); await get()(req('/api/inquiry/nope'), r, undefined);
    expect(r.statusCode).toBe(404);
  });
});
