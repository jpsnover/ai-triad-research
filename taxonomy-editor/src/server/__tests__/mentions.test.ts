// @vitest-environment node
//
// t/1902 — GET /api/container-mentions/:containerId transport route. Drives the real
// handler via a captured Router + minimal req/res so the real httpKit json()/error()
// path runs. fileIO.readContainerMentions is mocked. Asserts the gate-integrity call:
// an absent container is a 200 null (designed miss), NOT a 404.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const { readContainerMentionsMock, recordMock } = vi.hoisted(() => ({
  readContainerMentionsMock: vi.fn(),
  recordMock: vi.fn(),
}));

vi.mock('../storage/fileIO.js', () => ({ readContainerMentions: readContainerMentionsMock }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordMock }) }));

import type { ServerCtx } from '../routes/context.js';
import { createRouter, type Handler } from '../httpKit.js';
import { registerMentionsRoutes } from '../routes/mentions.js';

const ROUTE = '/api/container-mentions/:containerId';

async function invoke(containerId: string): Promise<{ status: number; body: unknown }> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerMentionsRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.path === ROUTE);
  if (!route) throw new Error('container-mentions route not registered');

  const req = { url: `/api/container-mentions/${encodeURIComponent(containerId)}`, method: 'GET', headers: {} } as unknown as IncomingMessage;
  let status = 200;
  let body: unknown;
  const res = {
    writableEnded: false, headersSent: false, req,
    writeHead(s: number) { status = s; this.headersSent = true; },
    end(b?: string) { body = b ? JSON.parse(b) : undefined; this.writableEnded = true; },
  } as unknown as ServerResponse;

  await route.handler(req, res, undefined);
  return { status, body };
}

describe('GET /api/container-mentions/:containerId (t/1902)', () => {
  beforeEach(() => { readContainerMentionsMock.mockReset(); recordMock.mockReset(); });

  it('returns the container mentions at 200, and decodes the colon-bearing id', async () => {
    const mentions = { text_sha256: 'abc123', extracted_at: '2026-07-29T00:00:00Z', mentions: [{ ref: 'ent-001' }] };
    readContainerMentionsMock.mockResolvedValue(mentions);
    const { status, body } = await invoke('sei:doc-1');
    expect(status).toBe(200);
    expect(body).toEqual(mentions);
    // `sei:doc-1` arrives decoded (param() decodeURIComponent's the %3A), not double-decoded.
    expect(readContainerMentionsMock).toHaveBeenCalledWith('sei:doc-1');
  });

  it('returns 200 with a null body for an absent container — a DESIGNED miss, NOT 404', async () => {
    readContainerMentionsMock.mockResolvedValue(null);
    const { status, body } = await invoke('node:never-indexed');
    expect(status).toBe(200);
    expect(body).toBeNull();
    expect(readContainerMentionsMock).toHaveBeenCalledWith('node:never-indexed');
  });

  it('records to the flight recorder and returns 500 when the read throws', async () => {
    readContainerMentionsMock.mockRejectedValue(new Error('mentions store unreachable'));
    const { status } = await invoke('sei:doc-1');
    expect(status).toBe(500);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', type: 'system.error' }));
  });
});
