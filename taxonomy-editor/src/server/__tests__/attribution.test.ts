// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3297 — covers the two new pieces:
//   1) corpusAssemblyCache: the process-lifetime, main-pinned corpus memo (idempotency, in-flight
//      de-dup, failure eviction, ref:'main' pin).
//   2) POST /api/argument-network/attribution: server parity — the endpoint's per-claim
//      ClaimTaxonomyAttribution === a DIRECT computeClaimTaxonomyAttribution() call on the same
//      assembled corpus (parity by construction; the load-bearing gate before the client flip).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Deterministic stub embeds (hash → stable 3-vec), identical for endpoint + direct comparison. ──
function stubVector(text: string): number[] {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return [((h % 1000) / 1000), (((h >> 3) % 1000) / 1000), (((h >> 7) % 1000) / 1000)];
}
const stubComputeEmbeddings = vi.fn(async (texts: string[]) => ({ vectors: texts.map(stubVector), cacheHits: 0, cacheMisses: texts.length }));

const POV_NODES = [
  { id: 'acc-B-001', label: 'Progress', description: 'accelerate capability', pov: 'accelerationist' },
  { id: 'acc-B-002', label: 'Abundance', description: 'growth compounds', pov: 'accelerationist' },
  { id: 'acc-B-003', label: 'Openness', description: 'open models win', pov: 'accelerationist' },
];
const SIT_NODES = [{ id: 'cc-001', label: 'Regulation', description: 'a regulatory situation' }];

// readTaxonomyFile honors being called with (pov, {ref}) but the fixture ignores ref (returns by pov).
const readTaxonomyFile = vi.fn(async (pov: string, _opts?: { ref?: string }) =>
  pov === 'situations' ? { nodes: SIT_NODES } : { nodes: POV_NODES });
const loadSyntheticEmbeddings = vi.fn(async () => null);

vi.mock('../storage/fileIO.js', () => ({
  readTaxonomyFile: (...a: unknown[]) => readTaxonomyFile(a[0] as string, a[1] as { ref?: string }),
  loadSyntheticEmbeddings: () => loadSyntheticEmbeddings(),
}));
vi.mock('../ai/aiBackends.js', () => ({
  computeEmbeddings: (...a: unknown[]) => stubComputeEmbeddings(a[0] as string[]),
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../logger.js', () => ({
  log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
  getRequestId: () => 'test-req',
  getRequestContext: () => undefined,
}));

import { registerAttributionRoutes } from '../routes/attribution.js';
import { getAssembledCorpus, __resetCorpusCacheForTest } from '../routes/corpusAssemblyCache.js';
import { assembleNodeEmbeddings } from '../../../../lib/debate/relevanceSelection.js';
import { computeClaimTaxonomyAttribution } from '../../../../lib/debate/argumentNetwork/attribution.js';
import type { ArgumentNetworkNode } from '../../../../lib/debate/types.js';
import type { ServerCtx } from '../routes/context.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void> | void;
function makeRouter() {
  const handlers: Record<string, Handler> = {};
  const reg = (m: string) => (p: string, h: Handler) => { handlers[`${m} ${p}`] = h; };
  return { router: { get: reg('GET'), put: reg('PUT'), post: reg('POST'), patch: reg('PATCH'), del: reg('DELETE') }, handlers };
}
function fakeRes() {
  const res: Record<string, unknown> = {
    writableEnded: false, headersSent: false, _status: 200, _body: undefined,
    writeHead: vi.fn((c: number) => { res._status = c; res.headersSent = true; }),
    end: vi.fn((b?: string) => { res._body = b !== undefined ? JSON.parse(b) : undefined; res.writableEnded = true; }),
    setHeader: vi.fn(),
  };
  return res as unknown as ServerResponse & { _body: Record<string, unknown>; _status: number };
}
const fakeReq = () => ({ url: '/api/argument-network/attribution', method: 'POST' } as unknown as IncomingMessage);

const CLAIMS = [
  { id: 'an-1', embedding: [0.12, 0.20, 0.31] },
  { id: 'an-2', embedding: [0.90, 0.10, 0.02] },
  { id: 'an-3' }, // no embedding → unattributed 'no_embedding'
];

describe('corpusAssemblyCache — process-lifetime main-pinned memo (t/3297)', () => {
  beforeEach(() => { __resetCorpusCacheForTest(); readTaxonomyFile.mockClear(); });

  it('memoizes per pov: second call reuses the assembly (no re-read)', async () => {
    const a = await getAssembledCorpus('accelerationist');
    const b = await getAssembledCorpus('accelerationist');
    expect(b).toBe(a); // same object identity → memo hit
    expect(readTaxonomyFile).toHaveBeenCalledTimes(2); // pov + situations, once total (not 4)
  });

  it('pins base reads to ref:main', async () => {
    await getAssembledCorpus('accelerationist');
    for (const call of readTaxonomyFile.mock.calls) expect(call[1]).toEqual({ ref: 'main' });
  });

  it('de-dups concurrent in-flight callers (single assembly)', async () => {
    const [a, b] = await Promise.all([getAssembledCorpus('accelerationist'), getAssembledCorpus('accelerationist')]);
    expect(b).toBe(a);
    expect(readTaxonomyFile).toHaveBeenCalledTimes(2);
  });

  it('evicts a failed assembly so the next call retries', async () => {
    readTaxonomyFile.mockRejectedValueOnce(new Error('transient read fail'));
    await expect(getAssembledCorpus('safetyist')).rejects.toThrow('transient read fail');
    const ok = await getAssembledCorpus('safetyist'); // retry succeeds — cache was not poisoned
    expect(ok.povNodes.length).toBe(POV_NODES.length);
  });
});

describe('POST /api/argument-network/attribution — server parity (t/3297)', () => {
  let post: Handler;
  beforeEach(() => {
    __resetCorpusCacheForTest();
    readTaxonomyFile.mockClear();
    const { router, handlers } = makeRouter();
    registerAttributionRoutes(router as never, {} as ServerCtx);
    post = handlers['POST /api/argument-network/attribution'];
  });

  it('endpoint attributions === direct computeClaimTaxonomyAttribution on the same corpus', async () => {
    const res = fakeRes();
    await post(fakeReq(), res, { pov: 'accelerationist', claims: structuredClone(CLAIMS) });
    expect(res._status).toBe(200);

    // Reproduce the corpus + attribution independently with the SAME stubs.
    const corpusEmbed = (texts: string[]) => stubComputeEmbeddings(texts).then(r => r.vectors);
    const { nodeEmbeddings } = await assembleNodeEmbeddings('accelerationist', POV_NODES as never, SIT_NODES as never, corpusEmbed, null);
    const candidateNodeIds = new Set(POV_NODES.map(n => n.id));
    const claimsClone = structuredClone(CLAIMS) as unknown as ArgumentNetworkNode[];
    computeClaimTaxonomyAttribution(claimsClone, 'accelerationist', nodeEmbeddings, candidateNodeIds);
    const expected: Record<string, unknown> = {};
    for (const c of claimsClone) expected[c.id] = c.claim_taxonomy_attribution;

    expect(res._body.attributions).toEqual(expected); // per-claim parity by construction
  });

  it('reports a well-formed summary and covers the no-embedding claim', async () => {
    const res = fakeRes();
    await post(fakeReq(), res, { pov: 'accelerationist', claims: structuredClone(CLAIMS) });
    const summary = res._body.summary as Record<string, number>;
    expect(summary).toHaveProperty('attributed');
    expect(summary).toHaveProperty('unattributed');
    expect(summary.missing_embedding).toBeGreaterThanOrEqual(1); // an-3 has no embedding
    expect((res._body.attributions as Record<string, { unattributed_reason?: string }>)['an-3'].unattributed_reason).toBe('no_embedding');
  });

  it('rejects an invalid pov with 400', async () => {
    const res = fakeRes();
    await post(fakeReq(), res, { pov: 'bogus', claims: [] });
    expect(res._status).toBe(400);
  });

  it('rejects a non-array claims with 400', async () => {
    const res = fakeRes();
    await post(fakeReq(), res, { pov: 'accelerationist', claims: 'nope' });
    expect(res._status).toBe(400);
  });

  it('empty claims → empty attributions, zeroed summary', async () => {
    const res = fakeRes();
    await post(fakeReq(), res, { pov: 'accelerationist', claims: [] });
    expect(res._status).toBe(200);
    expect(res._body.attributions).toEqual({});
    expect((res._body.summary as Record<string, number>).attributed).toBe(0);
  });
});
