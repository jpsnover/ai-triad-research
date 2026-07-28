// @vitest-environment node
//
// t/1821 — PUT /api/edges: the whole-file atomic edge save (saveEdges bridge path,
// t/1816). Drives the real handler through a captured Router + a minimal req/res so
// the real httpKit json()/error() path runs. fileIO.writeEdgesFile is mocked (spy)
// so the test asserts the atomic write is invoked with the body on a valid save and
// that malformed input is rejected 400 with NO write (AC#3: safe on malformed input).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const { writeEdgesFileMock, readEdgesFileMock } = vi.hoisted(() => ({
  writeEdgesFileMock: vi.fn(async () => {}),
  readEdgesFileMock: vi.fn(async () => ({ edges: [] })),
}));

// Partial mock: override the two edge fileIO calls, keep everything else real.
vi.mock('../storage/fileIO.js', async (importActual) => {
  const actual = await importActual<typeof import('../storage/fileIO.js')>();
  return { ...actual, writeEdgesFile: writeEdgesFileMock, readEdgesFile: readEdgesFileMock };
});

import type { ServerCtx } from '../routes/context.js';
import { createRouter, type Handler } from '../httpKit.js';
import { registerEdgesRoutes } from '../routes/edges.js';

interface InvokeResult { status: number; body: unknown }

async function putEdges(body: unknown): Promise<InvokeResult> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerEdgesRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.path === '/api/edges' && r.method === 'PUT');
  if (!route) throw new Error('PUT /api/edges route not registered');

  const req = { url: '/api/edges', method: 'PUT', headers: {}, socket: {} } as unknown as IncomingMessage;
  const result: InvokeResult = { status: 200, body: undefined };
  const res = {
    writableEnded: false, headersSent: false,
    setHeader() {}, getHeader() { return undefined; },
    writeHead(s: number) { result.status = s; this.headersSent = true; return this; },
    end(b?: string) { result.body = b ? JSON.parse(b) : undefined; this.writableEnded = true; },
  } as unknown as ServerResponse;

  await route.handler(req, res, body);
  return result;
}

describe('PUT /api/edges — whole-file edge save (t/1821)', () => {
  beforeEach(() => { writeEdgesFileMock.mockClear(); readEdgesFileMock.mockClear(); });

  it('persists a valid EdgesFile body via the atomic writeEdgesFile', async () => {
    const file = { edges: [{ source: 'a', target: 'b', type: 'supports', status: 'proposed' }] };
    const res = await putEdges(file);
    expect(res.status).toBe(200);
    expect(writeEdgesFileMock).toHaveBeenCalledTimes(1);
    expect(writeEdgesFileMock).toHaveBeenCalledWith(file);
  });

  it('accepts an empty edges array (valid whole-file save)', async () => {
    const res = await putEdges({ edges: [] });
    expect(res.status).toBe(200);
    expect(writeEdgesFileMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a null body with 400 and does NOT write', async () => {
    const res = await putEdges(null);
    expect(res.status).toBe(400);
    expect(writeEdgesFileMock).not.toHaveBeenCalled();
  });

  it('rejects a body with no edges array with 400 and does NOT write', async () => {
    const res = await putEdges({ notEdges: true });
    expect(res.status).toBe(400);
    expect(writeEdgesFileMock).not.toHaveBeenCalled();
  });

  it('rejects a body whose edges is not an array with 400 and does NOT write', async () => {
    const res = await putEdges({ edges: 'nope' });
    expect(res.status).toBe(400);
    expect(writeEdgesFileMock).not.toHaveBeenCalled();
  });
});
