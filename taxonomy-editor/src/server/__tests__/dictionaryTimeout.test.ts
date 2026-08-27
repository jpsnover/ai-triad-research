// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3047 — GET /api/dictionary route-level timeout + graceful fallback.
// Verifies: (1) a hanging loadDictionary call is bounded by the 10 s server-side
// timeout and returns empty data (not a 30 s client hang), (2) any loadDictionary
// error (including non-timeout failures) degrades gracefully to the same empty
// fallback and emits a 'dictionary.github.timeout' FR event whose error.message
// distinguishes the cause.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Mocks (hoisted before imports) ──

let recordedEvents: { message?: string; data?: Record<string, unknown>; error?: { message?: string } }[] = [];
vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => ({ record: (ev: unknown) => { recordedEvents.push(ev as never); } }),
}));

const loadDictionary = vi.fn();
vi.mock('../storage/fileIO.js', () => ({
  loadDictionary: () => loadDictionary(),
  getTaxonomyDir: () => '/tmp/test-dict',
  resolveDataPath: () => '/tmp/test-dict',
  buildNodeSourceIndex: vi.fn(),
  isSafeId: vi.fn(() => true),
}));

import { registerSourcesRoutes } from '../routes/sources.js';

// ── Helpers ──

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
    _body: undefined as unknown,
    writeHead: vi.fn(),
    end: vi.fn((b?: string) => {
      res._body = b !== undefined ? JSON.parse(b) : undefined;
      res.writableEnded = true;
      res.headersSent = true;
    }),
    setHeader: vi.fn(),
  };
  return res as unknown as ServerResponse & { _body: unknown };
}

const stubCtx = {} as never;
const EMPTY_DICT = { standardized: [], colloquial: [], lintViolations: [] };

// ── Tests ──

describe('GET /api/dictionary — timeout + fallback (t/3047)', () => {
  let dictionaryHandler: Handler;

  beforeEach(() => {
    recordedEvents = [];
    const { router, handlers } = makeRouter();
    registerSourcesRoutes(router as never, stubCtx);
    dictionaryHandler = handlers['GET /api/dictionary'];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns empty fallback and emits FR event when loadDictionary hangs (timeout)', async () => {
    loadDictionary.mockReturnValue(new Promise(() => { /* never resolves */ }));
    const res = fakeRes();
    const pending = dictionaryHandler({} as IncomingMessage, res);
    // Advance past the 10 s server-side timeout
    await vi.advanceTimersByTimeAsync(10_001);
    await pending;
    expect(res._body).toEqual(EMPTY_DICT);
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({ message: 'dictionary.github.timeout' });
    expect((recordedEvents[0].data as { duration_ms: number }).duration_ms).toBeGreaterThanOrEqual(10_000);
  });

  it('returns empty fallback and FR event on non-timeout error (error.message reflects actual cause)', async () => {
    loadDictionary.mockRejectedValue(new Error('GitHub rate limit exceeded'));
    const res = fakeRes();
    await dictionaryHandler({} as IncomingMessage, res);
    expect(res._body).toEqual(EMPTY_DICT);
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({ message: 'dictionary.github.timeout' });
    // error.message must contain the actual cause so triage can distinguish timeout vs API error
    expect(recordedEvents[0].error?.message).toMatch(/rate limit/);
  });
});
