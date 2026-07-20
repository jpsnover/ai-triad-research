// @vitest-environment node

/**
 * t/1636 (parent t/1470) — PATCH /api/debates/:id delta save. Instead of the PUT
 * full-blob upload, PATCH ships a DebateDelta the storage layer merges under an
 * exact baseVersion match. The client branches on THREE distinct response shapes,
 * so all three are pinned here:
 *   1. happy path            → 200 { newVersion }
 *   2. in-flight guard        → 409 { error: 'save_in_progress' }   (shared with PUT)
 *   3. storage version clash  → 409 { currentVersion, code: 'version_conflict' }
 *      — distinct from the guard 409 so the client can fall back to a full PUT.
 * The guard must also clear on a thrown save (never leave a debate permanently 409ing).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// Controllable applyDebateDeltaToStorage — each call parks on a fresh deferred we
// resolve/reject, so we can hold one save "in flight" while firing a second.
const applyResolvers: Array<(v: { newVersion: number }) => void> = [];
const applyRejecters: Array<(e: unknown) => void> = [];
vi.mock('../storage/fileIO.js', () => ({
  applyDebateDeltaToStorage: vi.fn(() => new Promise((resolve, reject) => {
    applyResolvers.push(resolve as (v: { newVersion: number }) => void);
    applyRejecters.push(reject);
  })),
}));
// Avoid the heavy aiBackends import chain — unused by the delta handler.
vi.mock('../ai/aiBackends.js', () => ({}));

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

// param() extracts :id from req.url, so the request must carry a matching URL.
function fakeReq(id: string): IncomingMessage {
  return { url: `/api/debates/${id}`, method: 'PATCH' } as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { _status?: number; _body?: string } {
  const res = {
    writeHead: vi.fn((s: number) => { res._status = s; }),
    end: vi.fn((b?: string) => { res._body = b; }),
    setHeader: vi.fn(),
  } as unknown as ServerResponse & { _status?: number; _body?: string };
  return res;
}

describe('PATCH /api/debates/:id delta save (t/1636)', () => {
  let patch: Handler;
  beforeEach(() => {
    applyResolvers.length = 0; applyRejecters.length = 0;
    const { router, handlers } = makeRouter();
    registerDebatesRoutes(router as never, {} as never);
    patch = handlers['PATCH /api/debates/:id'];
  });

  it('returns { newVersion } on a successful delta merge', async () => {
    const res = fakeRes();
    const p = patch(fakeReq('debate-x'), res, { id: 'debate-x', baseVersion: 3 });
    applyResolvers[0]({ newVersion: 4 });
    await p;
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body!)).toEqual({ newVersion: 4 });
  });

  it('409s save_in_progress for a concurrent delta save of the same debate', async () => {
    const body = { id: 'debate-y', baseVersion: 1 };
    const res1 = fakeRes();
    const p1 = patch(fakeReq('debate-y'), res1, body); // parks on applyDebateDeltaToStorage

    const res2 = fakeRes();
    await patch(fakeReq('debate-y'), res2, body); // concurrent → rejected synchronously
    expect(res2._status).toBe(409);
    expect(JSON.parse(res2._body!).error).toBe('save_in_progress');

    applyResolvers[0]({ newVersion: 2 }); // let the first save complete
    await p1;
    expect(res1._status).toBe(200);
  });

  it('maps a storage version_conflict to a distinct 409 { currentVersion, code }', async () => {
    const res = fakeRes();
    const p = patch(fakeReq('debate-z'), res, { id: 'debate-z', baseVersion: 1 });
    // Storage throws ActionableError carrying code + currentVersion on a stale base.
    applyRejecters[0](Object.assign(new Error('stale base version'), { statusCode: 409, code: 'version_conflict', currentVersion: 7 }));
    await p;
    expect(res._status).toBe(409);
    expect(JSON.parse(res._body!)).toEqual({ currentVersion: 7, code: 'version_conflict' });
  });

  it('clears the guard after a delta save settles (throw included)', async () => {
    const body = { id: 'debate-w', baseVersion: 1 };
    const res1 = fakeRes();
    const p1 = patch(fakeReq('debate-w'), res1, body);
    applyRejecters[0](Object.assign(new Error('aborted'), { statusCode: 500 })); // save throws
    await p1; // finally clears the key

    // a subsequent delta save of the same debate is NOT blocked by a stale guard entry
    const res2 = fakeRes();
    const p2 = patch(fakeReq('debate-w'), res2, body);
    expect(res2._status).not.toBe(409); // proceeded into the save, not rejected
    applyResolvers[1]({ newVersion: 2 }); // second apply call → resolver index 1
    await p2;
    expect(res2._status).toBe(200);
  });
});
