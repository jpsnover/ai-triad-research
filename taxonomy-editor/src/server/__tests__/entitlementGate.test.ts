// @vitest-environment node
//
// t/2625 — the shared backend-entitlement gate + its wiring into the two routes that
// previously bypassed it. A free/restricted tier must not be able to select a premium
// backend via body.model: resolveGenerationContext pins the free tier's model and
// enforceBackendAllowed 403s a disallowed backend BEFORE any generation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';

const h = vi.hoisted(() => ({
  tier: null as unknown,
}));
const FREE = { level: 'free', allowedBackends: ['gemini'], pinnedModel: 'gemini-2.5-flash', limits: { requestsPerMinute: 10, tokensPerDay: 1000 }, serverProvidedKey: true };
const PLATFORM = { level: 'platform', allowedBackends: ['gemini', 'claude'], pinnedModel: undefined, limits: { requestsPerMinute: 100, tokensPerDay: 1_000_000 }, serverProvidedKey: false };

vi.mock('../ai/proxyTiers.js', () => ({
  resolveTier: () => h.tier,
  isBackendAllowed: (tier: { allowedBackends: string[] }, b: string) => tier.allowedBackends.includes(b),
}));
vi.mock('../ai/aiBackends.js', () => ({
  resolveBackend: (m: string | undefined) => (m && m.includes('claude') ? 'claude' : 'gemini'),
  generateTextWithSearchByUsage: vi.fn(), generateText: vi.fn(),
  isContextTooLongError: () => false, is429Error: () => false, retryAfterMs: () => 0,
  computeAvailableBackends: vi.fn(),
}));
vi.mock('../security/accessControl.js', () => ({ callerTierIdentity: () => ({ principalName: '', idp: '' }), clientSafeMessage: (m: string) => m }));
vi.mock('../security/userContext.js', () => ({ getCurrentUser: () => null, getStorageUserId: () => 'u', isAnonymousUser: () => true, getAnonymousSessionId: () => 'anon' }));
vi.mock('../../../../lib/ai-client/index.js', () => ({ DEFAULT_MODEL: 'gemini-2.5-flash' }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

import { resolveGenerationContext, enforceBackendAllowed } from '../routes/generationContext.js';
import { createRouter } from '../httpKit.js';
import { registerSourcesRoutes } from '../routes/sources.js';
import { registerAiRoutes } from '../routes/ai.js';
import * as aiMock from '../ai/aiBackends.js';

// A non-free tier HONOURS the requested model (no pinning) but restricts backends — the
// path where a disallowed backend produces a 403 rather than a silent free-tier downgrade.
const RESTRICTED = { level: 'platform', allowedBackends: ['gemini'], pinnedModel: undefined, limits: { requestsPerMinute: 100, tokensPerDay: 1_000_000 }, serverProvidedKey: false };

function mockReq(): http.IncomingMessage {
  return { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as http.IncomingMessage;
}
function mockRes() {
  const r = {
    statusCode: 0, body: '', headers: {} as Record<string, string>, writableEnded: false,
    writeHead(code: number, hdrs?: Record<string, string>) { r.statusCode = code; if (hdrs) Object.assign(r.headers, hdrs); return r; },
    setHeader(k: string, v: string) { r.headers[k] = v; },
    end(b?: string) { r.body = b ?? ''; r.writableEnded = true; return r; },
    write() { return true; },
  };
  return r;
}
function handlerFor(register: (r: never, ctx: never) => void, method: string, path: string) {
  const routes: Array<{ method: string; path: string; handler: (req: unknown, res: unknown, body: unknown) => unknown }> = [];
  register(createRouter(routes as never) as never, {} as never);
  return routes.find(r => r.method === method && r.path === path)!.handler;
}

describe('t/2625 — shared backend-entitlement gate', () => {
  beforeEach(() => { h.tier = FREE; });

  it('resolveGenerationContext pins the free tier model over a user-supplied premium model', () => {
    const { effectiveModel, backend, isFree } = resolveGenerationContext(mockReq(), 'claude-opus-4');
    expect(isFree).toBe(true);
    expect(effectiveModel).toBe('gemini-2.5-flash'); // pinned — NOT the requested claude model
    expect(backend).toBe('gemini');
  });

  it('resolveGenerationContext honours the requested model for a non-free tier', () => {
    h.tier = PLATFORM;
    const { effectiveModel, backend } = resolveGenerationContext(mockReq(), 'claude-opus-4');
    expect(effectiveModel).toBe('claude-opus-4');
    expect(backend).toBe('claude');
  });

  it('enforceBackendAllowed 403s a backend the tier cannot use', () => {
    const res = mockRes();
    expect(enforceBackendAllowed(res as never, FREE as never, 'claude')).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).requested_backend).toBe('claude');
  });

  it('enforceBackendAllowed passes an allowed backend without responding', () => {
    const res = mockRes();
    expect(enforceBackendAllowed(res as never, FREE as never, 'gemini')).toBe(false);
    expect(res.statusCode).toBe(0);
  });
});

describe('t/2625 — the two formerly-bypassing routes now route through the gate', () => {
  beforeEach(() => { h.tier = FREE; vi.mocked(aiMock.generateTextWithSearchByUsage).mockClear(); });

  it('POST /api/evidence-qbaf → 403 when a restricted tier requests a disallowed backend', async () => {
    h.tier = RESTRICTED;
    const handler = handlerFor(registerSourcesRoutes as never, 'POST', '/api/evidence-qbaf');
    const res = mockRes();
    await handler(mockReq(), res, { claimText: 'x', claimId: 'c1', model: 'claude-opus-4' });
    expect(res.statusCode).toBe(403); // gated BEFORE any evidence retrieval / generation
  });

  it('POST /api/ai/search → 403 when a restricted tier requests a disallowed backend', async () => {
    h.tier = RESTRICTED;
    const handler = handlerFor(registerAiRoutes as never, 'POST', '/api/ai/search');
    const res = mockRes();
    await handler(mockReq(), res, { prompt: 'hi', model: 'claude-opus-4' });
    expect(res.statusCode).toBe(403); // gated BEFORE the search-generation call
  });

  it('POST /api/ai/search → a free user\'s premium model is DOWNGRADED to the pinned backend, not passed through', async () => {
    h.tier = FREE;
    const handler = handlerFor(registerAiRoutes as never, 'POST', '/api/ai/search');
    const res = mockRes();
    await handler(mockReq(), res, { prompt: 'hi', model: 'claude-opus-4' });
    expect(res.statusCode).toBe(200); // free tier pins → runs on the allowed backend
    // The provider was invoked with the PINNED model, never the requested premium one.
    const call = vi.mocked(aiMock.generateTextWithSearchByUsage).mock.calls[0];
    expect(call?.[2]).toEqual({ model: 'gemini-2.5-flash' });
  });
});
