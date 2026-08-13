// @vitest-environment node

/**
 * t/2573 — the /api/oped-sets library routes (list/load/delete). The handlers are
 * thin over storage/opedStore.ts (unit-tested in opedStore.test.ts), so this suite
 * pins the *route-layer* contract:
 *   - list returns the store's row summaries verbatim
 *   - load returns the full OpEdSet, and a PARTIAL set passes through UNTOUCHED
 *     (a member's 'failed'/'cancelled' status is data, not an error) — the AC
 *   - a missing set is a 404 (store returns null), not a 200/500
 *   - an unsafe set_id is rejected at the boundary with 400 BEFORE any store call
 *     (the t/2526 audit class)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// Controllable store — the routes import the public opedStore API directly.
// vi.hoisted so the mock fns exist when the hoisted vi.mock factory runs.
const { listOpedSets, loadOpedSet, deleteOpedSet } = vi.hoisted(() => ({
  listOpedSets: vi.fn(), loadOpedSet: vi.fn(), deleteOpedSet: vi.fn(),
}));
vi.mock('../storage/opedStore.js', () => ({ listOpedSets, loadOpedSet, deleteOpedSet }));

// isSafeId comes from fileIO; mock it to the SAME whitelist as fileIO's SAFE_ID_RE
// (/^[a-zA-Z0-9_-]+$/) so this test never pulls the heavy fileIO backend chain.
vi.mock('../storage/fileIO.js', () => ({
  isSafeId: (v: string) => !!v && /^[a-zA-Z0-9_-]+$/.test(v),
}));

import { registerOpedRoutes } from '../routes/oped.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void;

function makeRouter() {
  const handlers: Record<string, Handler> = {};
  const reg = (m: string) => (p: string, h: Handler) => { handlers[`${m} ${p}`] = h; };
  return { router: { get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), del: reg('DELETE') }, handlers };
}

function fakeReq(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

function fakeRes(): ServerResponse & { _status?: number; _body?: string } {
  const res = {
    writeHead: vi.fn((s: number) => { res._status = s; }),
    end: vi.fn((b?: string) => { res._body = b; }),
    setHeader: vi.fn(),
  } as unknown as ServerResponse & { _status?: number; _body?: string };
  return res;
}

describe('/api/oped-sets routes (t/2573)', () => {
  let handlers: Record<string, Handler>;
  beforeEach(() => {
    listOpedSets.mockReset(); loadOpedSet.mockReset(); deleteOpedSet.mockReset();
    const r = makeRouter();
    registerOpedRoutes(r.router as never, {} as never);
    handlers = r.handlers;
  });

  it('GET /api/oped-sets returns the store summaries', async () => {
    const rows = [{ set_id: 's1', topic: 'AI safety', camps: ['acc', 'saf'], voice_count: 2, created_at: 'c', updated_at: 'u' }];
    listOpedSets.mockResolvedValue(rows);
    const res = fakeRes();
    await handlers['GET /api/oped-sets'](fakeReq('/api/oped-sets'), res, undefined);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body!)).toEqual(rows);
  });

  it('GET /api/oped-sets/:id returns the full set, partial members passing through untouched', async () => {
    const set = {
      schema_version: 1, set_id: 'set-1', topic: 'T', params: { wordCount: 800, model: 'm' }, created_at: 'c',
      opeds: [
        { pov: 'acc', status: 'complete', headline: 'H', subtitle: '', body: 'B', wordCount: 800, grounding: [] },
        { pov: 'saf', status: 'failed', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] },
        { pov: 'skp', status: 'cancelled', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] },
      ],
    };
    loadOpedSet.mockResolvedValue(set);
    const res = fakeRes();
    await handlers['GET /api/oped-sets/:id'](fakeReq('/api/oped-sets/set-1'), res, undefined);
    expect(loadOpedSet).toHaveBeenCalledWith('set-1');
    expect(res._status).toBe(200);
    // The partial-set contract: failed/cancelled member statuses survive the route verbatim.
    expect(JSON.parse(res._body!)).toEqual(set);
  });

  it('GET /api/oped-sets/:id returns 404 when the set is absent', async () => {
    loadOpedSet.mockResolvedValue(null);
    const res = fakeRes();
    await handlers['GET /api/oped-sets/:id'](fakeReq('/api/oped-sets/nope'), res, undefined);
    expect(res._status).toBe(404);
  });

  it('GET /api/oped-sets/:id rejects an unsafe set_id with 400 before any store read', async () => {
    const res = fakeRes();
    await handlers['GET /api/oped-sets/:id'](fakeReq('/api/oped-sets/evil.id'), res, undefined);
    expect(res._status).toBe(400);
    expect(loadOpedSet).not.toHaveBeenCalled();
  });

  it('DELETE /api/oped-sets/:id deletes and returns { ok: true }', async () => {
    deleteOpedSet.mockResolvedValue(undefined);
    const res = fakeRes();
    await handlers['DELETE /api/oped-sets/:id'](fakeReq('/api/oped-sets/set-1'), res, undefined);
    expect(deleteOpedSet).toHaveBeenCalledWith('set-1');
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body!)).toEqual({ ok: true });
  });

  it('DELETE /api/oped-sets/:id rejects an unsafe set_id with 400 before any store call', async () => {
    const res = fakeRes();
    await handlers['DELETE /api/oped-sets/:id'](fakeReq('/api/oped-sets/evil.id'), res, undefined);
    expect(res._status).toBe(400);
    expect(deleteOpedSet).not.toHaveBeenCalled();
  });
});
