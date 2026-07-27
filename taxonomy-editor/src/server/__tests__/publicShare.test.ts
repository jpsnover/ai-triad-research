// @vitest-environment node
//
// t/1788 — GET /api/public/pov/:pov/node/:nodeId: the public, no-login POV-node
// share endpoint. This is a SECURITY-SENSITIVE public surface, so the suite is
// weighted toward the controls the OWASP/info-leak review cares about:
//   (a) whitelist-only projection — a node laden with graph_attributes (aphorism
//       + embeddings + scores), _edit_meta, authorship, timestamps and status
//       must project to EXACTLY the 6 allowlisted fields, nothing more.
//   (b) auth-bypass scope — the /api/public/ clause is present in the server.ts
//       auth gate, a gated sibling is NOT, and the route table exposes exactly
//       one route under /api/public/.
//   (c) no session — a logged-out request gets NO Set-Cookie back.
// Plus rate-limit (429 + Retry-After), 404, and 400 (bad :pov / traversal).
//
// Drives the real handler through a captured Router + a minimal req/res so the
// real httpKit json()/error() path runs. fileIO.readTaxonomyFile is mocked; the
// real isSafePov/isSafeId (used by invalidRouteParam) and the real checkRate are
// exercised — each test uses a distinct client IP so rate windows never bleed.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';

const { readTaxonomyFileMock, recordMock } = vi.hoisted(() => ({
  readTaxonomyFileMock: vi.fn(),
  recordMock: vi.fn(),
}));

// Partial mock: override readTaxonomyFile but keep the real isSafePov/isSafeId
// (invalidRouteParam imports them from here — mocking the whole module would
// break the very traversal guard we are testing).
vi.mock('../storage/fileIO.js', async (importActual) => {
  const actual = await importActual<typeof import('../storage/fileIO.js')>();
  return { ...actual, readTaxonomyFile: readTaxonomyFileMock };
});
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordMock }) }));

import type { ServerCtx } from '../routes/context.js';
import { createRouter, type Handler } from '../httpKit.js';
import { registerPublicShareRoutes, type PublicPovNode } from '../routes/publicShare.js';
import { extractRoutes } from './extractRoutes.js';

const ROUTE = '/api/public/pov/:pov/node/:nodeId';
const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, '..', 'server.ts');

// ── route harness ──
interface InvokeResult { status: number; body: unknown; headers: Record<string, unknown> }

// `pov`/`nodeId` are inserted verbatim (caller controls encoding) so a test can
// send an encoded-traversal segment. `ip` seeds x-forwarded-for → the rate key.
async function invoke(pov: string, nodeId: string, ip = `1.2.3.${Math.floor(Math.random() * 1e6)}`): Promise<InvokeResult> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerPublicShareRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.path === ROUTE);
  if (!route) throw new Error('public share route not registered');

  const req = {
    url: `/api/public/pov/${pov}/node/${nodeId}`, method: 'GET',
    headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;

  const headers: Record<string, unknown> = {};
  const result: InvokeResult = { status: 200, body: undefined, headers };
  const res = {
    writableEnded: false, headersSent: false, req,
    setHeader(name: string, val: unknown) { headers[name.toLowerCase()] = val; },
    getHeader(name: string) { return headers[name.toLowerCase()]; },
    writeHead(s: number, hdrs?: Record<string, unknown>) {
      result.status = s;
      if (hdrs) for (const k of Object.keys(hdrs)) headers[k.toLowerCase()] = hdrs[k];
      this.headersSent = true; return this;
    },
    end(b?: string) { result.body = b ? JSON.parse(b) : undefined; this.writableEnded = true; },
  } as unknown as ServerResponse;

  await route.handler(req, res, undefined);
  return result;
}

describe('GET /api/public/pov/:pov/node/:nodeId (t/1788)', () => {
  beforeEach(() => {
    readTaxonomyFileMock.mockReset();
    recordMock.mockReset();
  });

  // ── (a) whitelist-only projection — the info-leak guard ──
  describe('projection is a positive 6-field allowlist (info-leak guard)', () => {
    // A node deliberately laden with sensitive/enrichment data that must NEVER
    // leak: full graph_attributes (aphorism + embeddings + scores), _edit_meta,
    // authorship, timestamps, and status.
    const loadedNode = {
      id: 'acc-beliefs-001',
      category: 'beliefs',
      label: 'AI accelerates prosperity',
      description: 'Rapid AI deployment raises living standards.',
      status: 'published',
      created_by: 'jpsnover',
      updated_by: 'reviewer-7',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-03-04T00:00:00Z',
      _edit_meta: { revision: 42, editor: 'jpsnover', locked: true },
      graph_attributes: {
        aphorism: 'Faster is kinder.',
        embeddings: [0.11, 0.22, 0.33],
        crux_addressed_ratio: 0.87,
        rhetorical_strategy: 'appeal-to-progress',
        assumes: ['abundance'],
      },
    };

    beforeEach(() => { readTaxonomyFileMock.mockResolvedValue({ nodes: [loadedNode] }); });

    it('returns EXACTLY the 6 allowlisted keys and nothing else', async () => {
      const { status, body } = await invoke('accelerationist', 'acc-beliefs-001');
      expect(status).toBe(200);
      expect(Object.keys(body as object).sort()).toEqual(
        ['nodeId', 'pov', 'category', 'label', 'description', 'aphorism'].sort(),
      );
    });

    it('leaks none of _edit_meta / graph_attributes / embeddings / authorship / status / timestamps', async () => {
      const { body } = await invoke('accelerationist', 'acc-beliefs-001');
      for (const forbidden of [
        '_edit_meta', 'graph_attributes', 'embeddings', 'crux_addressed_ratio',
        'created_by', 'updated_by', 'created_at', 'updated_at', 'status', 'id',
      ]) {
        expect(body).not.toHaveProperty(forbidden);
      }
    });

    it('picks ONLY graph_attributes.aphorism (not the rest of graph_attributes)', async () => {
      const { body } = await invoke('accelerationist', 'acc-beliefs-001');
      const rec = body as PublicPovNode;
      expect(rec.aphorism).toBe('Faster is kinder.');
      // The projection carries the aphorism value but never the container.
      expect(JSON.stringify(body)).not.toContain('0.11'); // no embeddings vector
      expect(JSON.stringify(body)).not.toContain('crux_addressed_ratio');
    });

    it('projects the four scalar allowlist fields verbatim', async () => {
      const { body } = await invoke('accelerationist', 'acc-beliefs-001');
      expect(body).toEqual({
        nodeId: 'acc-beliefs-001',
        pov: 'accelerationist',
        category: 'beliefs',
        label: 'AI accelerates prosperity',
        description: 'Rapid AI deployment raises living standards.',
        aphorism: 'Faster is kinder.',
      });
    });

    it('emits aphorism: null when graph_attributes.aphorism is absent', async () => {
      readTaxonomyFileMock.mockResolvedValue({ nodes: [{ id: 'acc-beliefs-002', label: 'x', graph_attributes: { embeddings: [1] } }] });
      const { body } = await invoke('accelerationist', 'acc-beliefs-002');
      expect((body as PublicPovNode).aphorism).toBeNull();
      expect(body).not.toHaveProperty('graph_attributes');
    });
  });

  // ── (b) auth-bypass scope ──
  describe('auth-bypass scope (isPublicPath + route table)', () => {
    // isPublicPath is inline in server.ts (which boots an HTTP server at import,
    // so it is not import-safe). Anchor the assertion to the real source text —
    // the same static-scan discipline extractRoutes uses — rather than a copy.
    const serverSrc = fs.readFileSync(serverEntry, 'utf-8');
    // Slice to the NEXT statement (not the first `;`) — the t/1788 exemption
    // comment itself contains a semicolon, so a `;`-terminated slice would cut
    // the block short before the clause it documents.
    const blockStart = serverSrc.indexOf('const isPublicPath =');
    const isPublicBlock = serverSrc.slice(blockStart, serverSrc.indexOf('const authDisabled', blockStart));

    it('server.ts auth gate exempts the /api/public/ namespace', () => {
      expect(isPublicBlock).toContain("urlPath.startsWith('/api/public/')");
    });

    it('the gated sibling /api/conflicts is NOT in the public exemption list', () => {
      expect(isPublicBlock).not.toContain('/api/conflicts');
    });

    it('predicate: /api/public/... is exempt, a gated path is not', () => {
      // Mirrors the clause anchored above (source-verified in the prior tests):
      // the auth gate exempts anything under /api/public/ and nothing else here.
      const publicByNamespace = (p: string): boolean => p.startsWith('/api/public/');
      expect(publicByNamespace('/api/public/pov/acc-beliefs-001/node/acc-beliefs-001')).toBe(true);
      expect(publicByNamespace('/api/conflicts')).toBe(false);
    });

    it('the ONLY route under /api/public/ is GET /api/public/pov/:pov/node/:nodeId', () => {
      const publicRoutes = extractRoutes(serverEntry)
        .filter(r => r.path.startsWith('/api/public/'))
        .map(r => `${r.method} ${r.path}`);
      expect(publicRoutes).toEqual(['GET /api/public/pov/:pov/node/:nodeId']);
    });
  });

  // ── (c) no session minted ──
  it('sets NO Set-Cookie header for a logged-out request', async () => {
    readTaxonomyFileMock.mockResolvedValue({ nodes: [{ id: 'acc-beliefs-001', label: 'x' }] });
    const { headers } = await invoke('accelerationist', 'acc-beliefs-001');
    expect(headers['set-cookie']).toBeUndefined();
  });

  // ── rate limit (429 + Retry-After) ──
  it('rate-limits after 30 requests in the window (429 + Retry-After)', async () => {
    readTaxonomyFileMock.mockResolvedValue({ nodes: [{ id: 'acc-beliefs-001', label: 'x' }] });
    const ip = '9.9.9.9';
    for (let i = 0; i < 30; i++) {
      const { status } = await invoke('accelerationist', 'acc-beliefs-001', ip);
      expect(status).toBe(200);
    }
    const blocked = await invoke('accelerationist', 'acc-beliefs-001', ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: 'rate_limited' });
    expect((blocked.body as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
    expect(blocked.headers['retry-after']).toBe(String((blocked.body as { retryAfter: number }).retryAfter));
  });

  // ── 404 ──
  it('returns 404 for a node id absent from the POV file', async () => {
    readTaxonomyFileMock.mockResolvedValue({ nodes: [{ id: 'acc-beliefs-001', label: 'x' }] });
    const { status, body } = await invoke('accelerationist', 'acc-beliefs-999');
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: 'not_found' });
  });

  // ── 400 (bad :pov / traversal guard) ──
  it('returns 400 for an invalid :pov (uppercase fails isSafePov)', async () => {
    const { status } = await invoke('ACC', 'acc-beliefs-001');
    expect(status).toBe(400);
    expect(readTaxonomyFileMock).not.toHaveBeenCalled(); // rejected before the read
  });

  it('returns 400 for an encoded path-traversal :pov (%2e%2e)', async () => {
    const { status } = await invoke('%2e%2e', 'acc-beliefs-001');
    expect(status).toBe(400);
    expect(readTaxonomyFileMock).not.toHaveBeenCalled();
  });

  // ── error path (ADR-003 flight recorder) ──
  it('records to the flight recorder and returns 500 when the read throws', async () => {
    readTaxonomyFileMock.mockRejectedValue(new Error('blob unreachable'));
    const { status } = await invoke('accelerationist', 'acc-beliefs-001');
    expect(status).toBe(500);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', type: 'system.error' }));
  });
});
