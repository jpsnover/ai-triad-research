// @vitest-environment node
//
// t/2119 — GET /api/preferences + PUT /api/preferences transport routes.
// fs, flight-recorder, userContext, and config are mocked. Drives real handlers
// via a captured Router + minimal req/res (same pattern as mentions.test.ts).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const { readFileSyncMock, writeFileSyncMock, mkdirSyncMock, recordMock, getStorageUserIdMock, resolveDataPathMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  recordMock: vi.fn(),
  getStorageUserIdMock: vi.fn(() => '_local'),
  resolveDataPathMock: vi.fn((p: string) => `/data/${p}`),
}));

vi.mock('fs', () => ({ default: { readFileSync: readFileSyncMock, writeFileSync: writeFileSyncMock, mkdirSync: mkdirSyncMock } }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordMock }) }));
vi.mock('../security/userContext.js', () => ({ getStorageUserId: getStorageUserIdMock }));
vi.mock('../config.js', () => ({ resolveDataPath: resolveDataPathMock }));

import type { ServerCtx } from '../routes/context.js';
import { createRouter, type Handler } from '../httpKit.js';
import { registerPreferencesRoutes } from '../routes/preferences.js';

function makeRes(): ServerResponse & { _status: number; _body: unknown } {
  let _status = 200;
  let _body: unknown;
  return {
    writableEnded: false, headersSent: false,
    writeHead(s: number) { _status = s; (this as { headersSent: boolean }).headersSent = true; },
    end(b?: string) { _body = b ? JSON.parse(b) : undefined; (this as { writableEnded: boolean }).writableEnded = true; },
    get _status() { return _status; },
    get _body() { return _body; },
  } as unknown as ServerResponse & { _status: number; _body: unknown };
}

function makeReq(method: string): IncomingMessage {
  return { url: '/api/preferences', method, headers: {} } as unknown as IncomingMessage;
}

async function invokeGet(): Promise<{ status: number; body: unknown }> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerPreferencesRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.method === 'GET' && r.path === '/api/preferences');
  if (!route) throw new Error('GET /api/preferences not registered');
  const res = makeRes();
  await route.handler(makeReq('GET'), res, undefined);
  return { status: res._status, body: res._body };
}

async function invokePut(body: unknown): Promise<{ status: number }> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerPreferencesRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.method === 'PUT' && r.path === '/api/preferences');
  if (!route) throw new Error('PUT /api/preferences not registered');
  const res = makeRes();
  await route.handler(makeReq('PUT'), res, body);
  return { status: res._status };
}

describe('GET /api/preferences (t/2119)', () => {
  beforeEach(() => { readFileSyncMock.mockReset(); recordMock.mockReset(); });

  it('returns null when no prefs file exists (ENOENT)', async () => {
    readFileSyncMock.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    const { status, body } = await invokeGet();
    expect(status).toBe(200);
    expect(body).toBeNull();
  });

  it('returns stored prefs when file exists', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ viewMode: 'advanced' }));
    const { status, body } = await invokeGet();
    expect(status).toBe(200);
    expect(body).toEqual({ viewMode: 'advanced' });
  });
});

describe('PUT /api/preferences (t/2119)', () => {
  beforeEach(() => { writeFileSyncMock.mockReset(); mkdirSyncMock.mockReset(); recordMock.mockReset(); });

  it('writes prefs and returns 204 for a valid body', async () => {
    const { status } = await invokePut({ viewMode: 'simple' });
    expect(status).toBe(204);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('_local.json'),
      JSON.stringify({ viewMode: 'simple' }),
      'utf8',
    );
  });

  it('returns 400 and does not write for an invalid schema', async () => {
    const { status } = await invokePut({ viewMode: 'superuser' });
    expect(status).toBe(400);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });
});
