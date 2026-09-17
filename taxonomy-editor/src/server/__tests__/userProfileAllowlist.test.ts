// @vitest-environment node
//
// t/3498 (t/3495 epic, SO cond 5) — GET /api/user/profile: `geminiAllowlisted`
// must ALWAYS be a boolean — `false` for anonymous callers and on any allowlist
// read error, never absent/undefined.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';

const h = vi.hoisted(() => ({ isAllowlisted: null as (() => boolean) | null }));
vi.mock('../storage/allowlistStore.js', () => ({
  isAllowlisted: (userId: string) => h.isAllowlisted!(userId),
}));
vi.mock('../security/quotas.js', () => ({ getQuotaLimits: () => null }));

import { createRouter } from '../httpKit.js';
import { registerSessionRoutes } from '../routes/session.js';

let prevAuth: string | undefined;
let prevAdmin: string | undefined;

function mockReq(headers: Record<string, string> = {}): http.IncomingMessage {
  return { headers, url: '/api/user/profile' } as unknown as http.IncomingMessage;
}
function mockRes(): http.ServerResponse & { statusCode: number; body: string } {
  const r = {
    statusCode: 0, body: '', writableEnded: false, headersSent: false,
    writeHead(code: number) { r.statusCode = code; return r; },
    setHeader() {}, write() { return true; },
    end(b?: string) { r.body = b ?? ''; r.writableEnded = true; return r; },
    on() { return r; },
  };
  return r as unknown as http.ServerResponse & { statusCode: number; body: string };
}
function handlerFor(method: string, path: string) {
  const routes: Array<{ method: string; path: string; handler: (req: unknown, res: unknown, body: unknown) => unknown }> = [];
  registerSessionRoutes(createRouter(routes as never) as never, { broadcastEvent: () => {} } as never);
  return routes.find(r => r.method === method && r.path === path)!.handler;
}

beforeEach(() => {
  prevAuth = process.env.WEBSITE_AUTH_ENABLED; process.env.WEBSITE_AUTH_ENABLED = 'true';
  prevAdmin = process.env.ADMIN_USERS; process.env.ADMIN_USERS = 'jpsnover';
  h.isAllowlisted = () => false;
});
afterEach(() => {
  if (prevAuth === undefined) delete process.env.WEBSITE_AUTH_ENABLED; else process.env.WEBSITE_AUTH_ENABLED = prevAuth;
  if (prevAdmin === undefined) delete process.env.ADMIN_USERS; else process.env.ADMIN_USERS = prevAdmin;
});

describe('t/3498 — GET /api/user/profile geminiAllowlisted (SO cond 5)', () => {
  it('anonymous caller → geminiAllowlisted is false (never absent, allowlist store never even consulted)', async () => {
    h.isAllowlisted = vi.fn(() => true) as unknown as () => boolean; // even if it WOULD say true, isAnon short-circuits
    const res = mockRes();
    await handlerFor('GET', '/api/user/profile')(mockReq(), res, undefined);
    const body = JSON.parse(res.body);
    expect(body.geminiAllowlisted).toBe(false);
    expect(h.isAllowlisted).not.toHaveBeenCalled();
  });

  it('authenticated member → geminiAllowlisted is true', async () => {
    h.isAllowlisted = () => true;
    const res = mockRes();
    await handlerFor('GET', '/api/user/profile')(mockReq({ 'x-ms-client-principal-name': 'jsnover13@gmail.com', 'x-ms-client-principal-idp': 'aad' }), res, undefined);
    const body = JSON.parse(res.body);
    expect(body.geminiAllowlisted).toBe(true);
  });

  it('authenticated non-member → geminiAllowlisted is false', async () => {
    h.isAllowlisted = () => false;
    const res = mockRes();
    await handlerFor('GET', '/api/user/profile')(mockReq({ 'x-ms-client-principal-name': 'someone@example.com', 'x-ms-client-principal-idp': 'aad' }), res, undefined);
    const body = JSON.parse(res.body);
    expect(body.geminiAllowlisted).toBe(false);
  });

  it('allowlist read throws → geminiAllowlisted is false, never propagates as a 500', async () => {
    h.isAllowlisted = () => { throw new Error('file unreadable'); };
    const res = mockRes();
    await handlerFor('GET', '/api/user/profile')(mockReq({ 'x-ms-client-principal-name': 'someone@example.com', 'x-ms-client-principal-idp': 'aad' }), res, undefined);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.geminiAllowlisted).toBe(false);
  });

  it('geminiAllowlisted key is always present (never undefined/omitted) across all cases above', async () => {
    const res = mockRes();
    await handlerFor('GET', '/api/user/profile')(mockReq(), res, undefined);
    const body = JSON.parse(res.body);
    expect('geminiAllowlisted' in body).toBe(true);
    expect(typeof body.geminiAllowlisted).toBe('boolean');
  });
});
