// @vitest-environment node

/**
 * t/2554 — POST /api/debates/:id/news-report must distinguish a *missing* debate
 * (a well-defined client condition) from a genuine server fault:
 *   1. loadDebateSession throws ActionableError (not-found) → 404 + ActionableError body
 *   2. loadDebateSession throws any other error            → 500 (unchanged)
 *
 * Prevention arm of Incident 3 (news-report 500, t/2552#2): the missing-debate
 * case previously surfaced as an opaque 500. Complements t/2553 (FR entry events),
 * which made the failure diagnosable; this makes the response correct.
 *
 * The not-found path returns before the dynamic import()/AI call, so mocking only
 * loadDebateSession (and stubbing the heavy aiBackends chain) is sufficient.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { ActionableError } from '../../../../lib/debate/errors.js';

// Controllable loadDebateSession — each test sets its rejection.
const loadDebateSession = vi.fn();
vi.mock('../storage/fileIO.js', () => ({ loadDebateSession: (...a: unknown[]) => loadDebateSession(...a) }));
// Avoid the heavy aiBackends import chain — the not-found/500 paths never reach it.
vi.mock('../ai/aiBackends.js', () => ({ generateTextByUsage: vi.fn() }));

import { registerDebatesRoutes } from '../routes/debates.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void;

function makeRouter() {
  const handlers: Record<string, Handler> = {};
  const reg = (m: string) => (p: string, h: Handler) => { handlers[`${m} ${p}`] = h; };
  return {
    router: { get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), del: reg('DELETE') },
    handlers,
  };
}

// param() extracts :id from req.url against '/api/debates/:id/news-report'.
function fakeReq(id: string): IncomingMessage {
  return { url: `/api/debates/${id}/news-report`, method: 'POST' } as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { _status?: number; _body?: string } {
  const res = {
    writeHead: vi.fn((s: number) => { res._status = s; }),
    end: vi.fn((b?: string) => { res._body = b; }),
    setHeader: vi.fn(),
  } as unknown as ServerResponse & { _status?: number; _body?: string };
  return res;
}

describe('POST /api/debates/:id/news-report — missing debate → 404 (t/2554)', () => {
  let newsReport: Handler;
  beforeEach(() => {
    loadDebateSession.mockReset();
    const { router, handlers } = makeRouter();
    registerDebatesRoutes(router as never, {} as never);
    newsReport = handlers['POST /api/debates/:id/news-report'];
  });

  it('returns 404 with an ActionableError body when the debate is not in storage', async () => {
    // Exactly what loadDebateSession throws for an absent blob.
    loadDebateSession.mockRejectedValue(new ActionableError({
      goal: 'Load debate session',
      problem: 'Debate session not found: ghost-1',
      location: 'server/fileIO.ts → loadDebateSession',
      nextSteps: ['Verify the debate ID exists via listDebateSessions()'],
    }));

    const res = fakeRes();
    await newsReport(fakeReq('ghost-1'), res, undefined);

    expect(res._status).toBe(404);
    const body = JSON.parse(res._body!);
    // ActionableError shape (Goal/Error/Location/Resolve) surfaces in the message
    // (dev/test env returns the full message; production strips internals).
    expect(body.error).toContain('Goal:');
    expect(body.error).toContain('Location:');
    expect(body.error).toContain('ghost-1');
    expect(body.error).toContain('not in storage');
  });

  it('still returns 500 when loadDebateSession fails for a non-not-found reason', async () => {
    // A genuine backend/parse fault is NOT an ActionableError → must stay a 500.
    loadDebateSession.mockRejectedValue(new Error('S3 connection reset'));

    const res = fakeRes();
    await newsReport(fakeReq('debate-real'), res, undefined);

    expect(res._status).toBe(500);
  });
});
