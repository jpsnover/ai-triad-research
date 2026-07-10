// @vitest-environment node

/**
 * t/1461 — per-{userId,debateId} in-flight guard on PUT /api/debates. A concurrent
 * save of the same debate (the auto-save cascade) must be rejected with a distinct
 * `save_in_progress` 409 instead of running a second overlapping blob upload; the
 * guard must clear once the in-flight save settles (even on throw) so a hung save
 * never leaves a permanently-409ing debate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// Controllable saveDebateSession — each call parks on a fresh deferred we resolve.
const saveResolvers: Array<(v?: unknown) => void> = [];
const saveRejecters: Array<(e: unknown) => void> = [];
vi.mock('../storage/fileIO.js', () => ({
  saveDebateSession: vi.fn(() => new Promise((resolve, reject) => {
    saveResolvers.push(resolve);
    saveRejecters.push(reject);
  })),
}));
// Avoid the heavy aiBackends import chain — its exports are only referenced inside
// handler closures we don't exercise here.
vi.mock('../ai/aiBackends.js', () => ({}));

import { registerDebatesRoutes } from '../routes/debates.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void;

function makeRouter() {
  const handlers: Record<string, Handler> = {};
  const reg = (m: string) => (p: string, h: Handler) => { handlers[`${m} ${p}`] = h; };
  return { router: { get: reg('GET'), post: reg('POST'), put: reg('PUT'), del: reg('DELETE') }, handlers };
}

function fakeRes(): ServerResponse & { _status?: number; _body?: string } {
  const res = {
    writeHead: vi.fn((s: number) => { res._status = s; }),
    end: vi.fn((b?: string) => { res._body = b; }),
    setHeader: vi.fn(),
  } as unknown as ServerResponse & { _status?: number; _body?: string };
  return res;
}

describe('PUT /api/debates in-flight guard (t/1461)', () => {
  let put: Handler;
  beforeEach(() => {
    saveResolvers.length = 0; saveRejecters.length = 0;
    const { router, handlers } = makeRouter();
    registerDebatesRoutes(router as never, {} as never);
    put = handlers['PUT /api/debates'];
  });

  it('409s save_in_progress for a concurrent save of the same debate', async () => {
    const body = { id: 'debate-x' };
    const res1 = fakeRes();
    const p1 = put({} as IncomingMessage, res1, body); // parks on saveDebateSession

    const res2 = fakeRes();
    await put({} as IncomingMessage, res2, body); // concurrent → rejected synchronously
    expect(res2._status).toBe(409);
    expect(JSON.parse(res2._body!).error).toBe('save_in_progress');

    saveResolvers[0](); // let the first save complete
    await p1;
    expect(res1._status).toBe(200);
  });

  it('clears the guard after the in-flight save settles (throw included)', async () => {
    const body = { id: 'debate-y' };
    const res1 = fakeRes();
    const p1 = put({} as IncomingMessage, res1, body);
    saveRejecters[0](Object.assign(new Error('aborted'), { statusCode: 500 })); // save throws
    await p1; // finally clears the key

    // a subsequent save of the same debate is NOT blocked by a stale guard entry
    const res2 = fakeRes();
    const p2 = put({} as IncomingMessage, res2, body);
    expect(res2._status).not.toBe(409); // proceeded into the save, not rejected
    saveResolvers[1](); // second saveDebateSession call → resolver index 1
    await p2;
    expect(res2._status).toBe(200);
  });
});
