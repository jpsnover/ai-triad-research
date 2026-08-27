// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3074 — POST /api/embeddings/compute batch cap (413) + typed-timeout 503.
// TL-approved test arms (p/522#59):
//   1. texts.length > MAX_EMBED_BATCH → 413 (non-retryable)
//   2. texts.length === MAX_EMBED_BATCH → proceeds normally (boundary pass)
//   3. evaluateEmbeddingLoadShed → {shed:true, mode:'block'} → 503 retryable
//   4. computeEmbeddings throws error with .timeout=true → 503 retryable (NOT 500)
//   5. computeEmbeddings throws error WITHOUT .timeout → 500 (deterministic, non-retryable)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Hoisted mocks (vi.fn() refs shared between factory and test body) ─────────

const computeEmbeddings = vi.fn();
const evaluateEmbeddingLoadShed = vi.fn();

// ── Module mocks (hoisted before import) ─────────────────────────────────────

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('../security/accessControl.js', () => ({
  callerTierIdentity: () => ({ principalName: 'testuser', idp: 'aad' }),
  missingApiKeyError: vi.fn(() => null),
  expiredAuthCookies: vi.fn(() => []),
  clientSafeMessage: (msg: string) => msg,
}));

vi.mock('../security/userContext.js', () => ({
  getCurrentUser: vi.fn(() => ({ principalName: 'testuser', idp: 'aad' })),
  getCurrentUserId: vi.fn(() => 'testuser'),
}));

vi.mock('../logger.js', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    fr: { info: vi.fn(), warn: vi.fn() },
  },
  getRequestContext: vi.fn(() => ({})),
  getRequestId: vi.fn(() => 'req-test'),
  LOG_MAX_LINE_BYTES: 65536,
}));

vi.mock('../../../../lib/ai-client/index.js', () => ({
  DEFAULT_MODEL: 'test-model',
}));

vi.mock('../config.js', () => ({
  hasApiKey: vi.fn(() => false),
  getPaidGeminiFallbackKey: vi.fn(() => null),
  getDataRoot: () => '/fake/data',
  getStateRoot: () => '/fake/state',
  getProjectRoot: () => '/fake/project',
  STORAGE_MODE: 'local',
}));

vi.mock('../ai/proxyTiers.js', () => ({
  resolveTier: vi.fn(() => ({ level: 'platform', limits: { requestsPerMinute: 100, tokensPerDay: 1_000_000 } })),
  LOCAL_EMBED_RPM_PER_IP: 120,
  getTierKey: vi.fn(() => 'platform'),
}));

vi.mock('../security/rateLimiter.js', () => ({
  checkRate: vi.fn(() => ({ allowed: true })),
  checkRequestRate: vi.fn(() => ({ allowed: true })),
  checkTokenBudget: vi.fn(() => ({ allowed: true })),
  resetRateLimiters: vi.fn(),
}));

vi.mock('../ai/aiBackends.js', () => ({
  computeEmbeddings: (...a: unknown[]) => computeEmbeddings(...a),
  computeQueryEmbedding: vi.fn(),
  generateText: vi.fn(),
  generateTextByUsage: vi.fn(),
  classifyNli: vi.fn(),
  updateNodeEmbeddings: vi.fn(),
  setDebateTemperature: vi.fn(),
  resolveEmbeddingsChunked: vi.fn(),
}));

vi.mock('./generationContext.js', () => ({
  resolveGenerationContext: vi.fn(() => ({ model: 'test-model', backend: 'gemini' })),
  enforceBackendAllowed: vi.fn(() => false),
}));

vi.mock('../embeddingsLoad.js', () => ({
  evaluateEmbeddingLoadShed: (...a: unknown[]) => evaluateEmbeddingLoadShed(...a),
  embeddingLoadSnapshot: vi.fn(() => ({
    in_flight_embedding_computes: 0,
    heap_limit_mb: 512,
    heap_used_mb: 100,
    rss_mb: 200,
    event_loop_delay_max_ms: 0,
  })),
  beginEmbeddingCompute: vi.fn(),
  endEmbeddingCompute: vi.fn(),
  isEmbeddingModelWarm: vi.fn(() => false),
  markEmbeddingModelWarm: vi.fn(),
  decideLoadShed: vi.fn(),
  inFlightEmbeddingComputes: vi.fn(() => 0),
  embeddingLoadShedMode: vi.fn(() => 'warn'),
  readRecentLoopDelayMaxMs: vi.fn(() => 0),
  resetEmbeddingModelWarm: vi.fn(),
}));

vi.mock('../storage/fileIO.js', () => ({
  loadDictionary: vi.fn(),
  getTaxonomyDir: () => '/fake/taxonomy',
  resolveDataPath: () => '/fake/taxonomy',
  buildNodeSourceIndex: vi.fn(),
  isSafeId: vi.fn(() => true),
}));

import { registerAiRoutes } from '../routes/ai.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type Handler = (req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void> | void;

function makeRouter() {
  const handlers: Record<string, Handler> = {};
  const reg = (m: string) => (p: string, h: Handler) => { handlers[`${m} ${p}`] = h; };
  return {
    router: { get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), del: reg('DELETE') },
    handlers,
  };
}

function fakeRes() {
  const res: Record<string, unknown> = {
    writableEnded: false,
    headersSent: false,
    _statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: undefined as unknown,
    writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
      res._statusCode = code;
      if (headers) Object.assign(res._headers as object, headers);
      res.headersSent = true;
    }),
    end: vi.fn((b?: string) => {
      res._body = b !== undefined ? JSON.parse(b) : undefined;
      res.writableEnded = true;
    }),
    setHeader: vi.fn(),
  };
  return res as unknown as ServerResponse & { _body: Record<string, unknown>; _statusCode: number; _headers: Record<string, string> };
}

const MAX_EMBED_BATCH = 512;

function makeCtx() {
  return {} as Parameters<typeof registerAiRoutes>[1];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/embeddings/compute — batch cap + typed-timeout 503 (t/3074)', () => {
  let computeHandler: Handler;

  beforeEach(() => {
    evaluateEmbeddingLoadShed.mockReturnValue({ shed: false });
    computeEmbeddings.mockResolvedValue([[0.1, 0.2]]);

    const { router, handlers } = makeRouter();
    registerAiRoutes(router as never, makeCtx());
    computeHandler = handlers['POST /api/embeddings/compute'];
  });

  it('arm 1 — 413 when texts.length exceeds MAX_EMBED_BATCH (Gap 1 server-side cap)', async () => {
    const res = fakeRes();
    const texts = Array.from({ length: MAX_EMBED_BATCH + 1 }, (_, i) => `text-${i}`);
    await computeHandler({} as IncomingMessage, res, { texts });
    expect(res._statusCode).toBe(413);
    expect(res._body).toMatchObject({ error: expect.stringContaining(`${MAX_EMBED_BATCH + 1}`) });
  });

  it('arm 2 — 200 when texts.length === MAX_EMBED_BATCH (boundary pass)', async () => {
    const texts = Array.from({ length: MAX_EMBED_BATCH }, (_, i) => `text-${i}`);
    const vectors = texts.map(() => [0.1]);
    computeEmbeddings.mockResolvedValueOnce(vectors);
    const res = fakeRes();
    await computeHandler({} as IncomingMessage, res, { texts });
    expect(res._statusCode).not.toBe(413);
    expect(res._body).toMatchObject({ vectors });
  });

  it('arm 3 — 503 retryable when load-shed mode is block', async () => {
    evaluateEmbeddingLoadShed.mockReturnValue({ shed: true, mode: 'block', reason: 'concurrency', retryAfterMs: 3000 });
    const res = fakeRes();
    await computeHandler({} as IncomingMessage, res, { texts: ['hello'] });
    expect(res._statusCode).toBe(503);
    expect(res._body).toMatchObject({ retryable: true });
  });

  it('arm 4 — 503 retryable when computeEmbeddings throws with .timeout=true (NOT 500)', async () => {
    const timeoutErr = Object.assign(new Error('embeddings-chunk timed out after 45s'), { timeout: true });
    computeEmbeddings.mockRejectedValueOnce(timeoutErr);
    const res = fakeRes();
    await computeHandler({} as IncomingMessage, res, { texts: ['hello'] });
    expect(res._statusCode).toBe(503);
    expect(res._body).toMatchObject({ retryable: true, retryAfterMs: 5000 });
  });

  it('arm 5 — 500 when computeEmbeddings throws without .timeout (deterministic errors stay non-retryable)', async () => {
    computeEmbeddings.mockRejectedValueOnce(new Error('model initialization failed'));
    const res = fakeRes();
    await computeHandler({} as IncomingMessage, res, { texts: ['hello'] });
    expect(res._statusCode).toBe(500);
    expect(res._body).not.toMatchObject({ retryable: true });
  });
});
