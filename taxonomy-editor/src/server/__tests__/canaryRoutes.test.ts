// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3206 — POST /internal/canary/loop-sampler/{start,report} route contract:
//   flag ON  → start 200 {started:true}; report 200 {window,gate}; report-without-start → 409.
//   flag OFF → both 404 (measurement surface invisible in normal prod).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const { flagOn, startSpy, reportSpy } = vi.hoisted(() => ({
  flagOn: { value: true }, startSpy: vi.fn(), reportSpy: vi.fn(),
}));

vi.mock('../config.js', () => ({ isCanaryLoopSamplerEnabled: () => flagOn.value }));
vi.mock('../canaryLoopSampler.js', () => ({
  startCanaryLoopSampler: startSpy,
  reportCanaryLoopSampler: reportSpy,
}));

import { registerCanaryRoutes } from '../routes/canary.js';
import type { ServerCtx } from '../routes/context.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void> | void;
function makeRouter() {
  const handlers: Record<string, Handler> = {};
  const reg = (m: string) => (p: string, h: Handler) => { handlers[`${m} ${p}`] = h; };
  return { router: { get: reg('GET'), put: reg('PUT'), post: reg('POST'), patch: reg('PATCH'), del: reg('DELETE') }, handlers };
}
function fakeRes() {
  const res: Record<string, unknown> = {
    writableEnded: false, headersSent: false, _statusCode: 200, _body: undefined,
    writeHead: vi.fn((code: number) => { res._statusCode = code; res.headersSent = true; }),
    end: vi.fn((b?: string) => { res._body = b !== undefined ? JSON.parse(b) : undefined; res.writableEnded = true; }),
    setHeader: vi.fn(),
  };
  return res as unknown as ServerResponse & { _body: Record<string, unknown>; _statusCode: number };
}

describe('POST /internal/canary/loop-sampler routes (t/3206)', () => {
  let start: Handler; let report: Handler;
  beforeEach(() => {
    flagOn.value = true;
    startSpy.mockReset();
    reportSpy.mockReset();
    const { router, handlers } = makeRouter();
    registerCanaryRoutes(router as never, {} as ServerCtx);
    start = handlers['POST /internal/canary/loop-sampler/start'];
    report = handlers['POST /internal/canary/loop-sampler/report'];
  });

  it('flag ON: start → 200 {started:true} and calls the sampler', async () => {
    const res = fakeRes();
    await start({} as IncomingMessage, res, undefined);
    expect(res._statusCode).toBe(200);
    expect(res._body).toMatchObject({ started: true });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('flag ON: report → 200 {window,gate}', async () => {
    reportSpy.mockReturnValue({ window: { maxMs: 12, p99Ms: 9 }, gate: { pass: true, checks: [] } });
    const res = fakeRes();
    await report({} as IncomingMessage, res, undefined);
    expect(res._statusCode).toBe(200);
    expect(res._body).toMatchObject({ window: { maxMs: 12 }, gate: { pass: true } });
  });

  it('flag ON: report without start → 409 (not a bubbled 500)', async () => {
    reportSpy.mockImplementation(() => { throw new Error('canary loop sampler not started'); });
    const res = fakeRes();
    await report({} as IncomingMessage, res, undefined);
    expect(res._statusCode).toBe(409);
    expect(res._body).toMatchObject({ error: 'sampler not started' });
  });

  it('flag OFF: start and report both 404, sampler never called', async () => {
    flagOn.value = false;
    const resS = fakeRes();
    await start({} as IncomingMessage, resS, undefined);
    expect(resS._statusCode).toBe(404);
    const resR = fakeRes();
    await report({} as IncomingMessage, resR, undefined);
    expect(resR._statusCode).toBe(404);
    expect(startSpy).not.toHaveBeenCalled();
    expect(reportSpy).not.toHaveBeenCalled();
  });
});
