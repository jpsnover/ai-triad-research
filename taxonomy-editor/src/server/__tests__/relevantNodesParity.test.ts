// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3257 (T2) — PARITY fixture for POST /api/taxonomy/relevant-nodes (the load-bearing gate, TL GV
// before the T3 client flip). Proves the SERVER half of parity: given fixed corpus + session + params
// + a deterministic stub embed, the endpoint's response === a DIRECT selectRelevantTaxonomy() call on
// the same assembled input, ORDER-PRESERVING (W3). If the endpoint's server-side assembly drifted
// (wrong pov nodes, mis-mapped synthetic vectors, a dropped session field, wrong params), the two
// diverge and this fails. The lib-fn-vs-today's-client parity is Rosetta's #1883 guard; this asserts
// the endpoint feeds that lib fn faithfully.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Deterministic stub embeds: a stable vector per text (hash-based), so both the endpoint and the
// direct comparison call produce identical corpus/query vectors → selection is deterministic. ──
function stubVector(text: string): number[] {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return [((h % 1000) / 1000), (((h >> 3) % 1000) / 1000), (((h >> 7) % 1000) / 1000)];
}
const stubComputeEmbeddings = vi.fn(async (texts: string[]) => ({ vectors: texts.map(stubVector), cacheHits: 0, cacheMisses: texts.length }));
const stubComputeQueryEmbedding = vi.fn(async (text: string) => stubVector(text));

// ── Fixed corpus / data the loaders return ──
const POV_NODES = [
  { id: 'acc-B-001', label: 'Progress', description: 'accelerate capability', pov: 'accelerationist' },
  { id: 'acc-B-002', label: 'Abundance', description: 'growth compounds', pov: 'accelerationist' },
  { id: 'acc-B-003', label: 'Openness', description: 'open models win', pov: 'accelerationist' },
];
const SIT_NODES = [{ id: 'cc-001', label: 'Regulation', description: 'a regulatory situation' }];

vi.mock('../storage/fileIO.js', () => ({
  readTaxonomyFile: vi.fn(async (pov: string) => pov === 'situations' ? { nodes: SIT_NODES } : { nodes: POV_NODES }),
  readPolicyRegistry: vi.fn(async () => ({ policies: [{ id: 'pol-001', action: 'fund research', source_povs: ['accelerationist'] }] })),
  readLineageCategories: vi.fn(async () => ({ mapping: { 'Techno-optimism': { l2: 'cluster-1' } } })),
  loadSyntheticEmbeddings: vi.fn(async () => null), // no synthetic merge in the fixture (base vectors only)
}));
vi.mock('../ai/aiBackends.js', () => ({
  computeEmbeddings: (...a: unknown[]) => stubComputeEmbeddings(a[0] as string[]),
  computeQueryEmbedding: (...a: unknown[]) => stubComputeQueryEmbedding(a[0] as string),
}));
vi.mock('../../../../lib/debate/poverInfo.js', () => ({
  POVER_INFO: { accelerationist: { pov: 'accelerationist', doctrinal_boundaries: ['REJECT: safetyism'] } },
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../logger.js', () => ({
  log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
  getRequestId: () => 'test-req',       // httpKit.error()/json() read these
  getRequestContext: () => undefined,
}));

import { registerRelevantNodesRoutes } from '../routes/relevantNodes.js';
import { selectRelevantTaxonomy, assembleNodeEmbeddings } from '../../../../lib/debate/relevanceSelection.js';
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
const fakeReq = () => ({ url: '/api/taxonomy/relevant-nodes', method: 'POST' } as unknown as IncomingMessage);

const BODY = {
  pov: 'accelerationist', topic: 'AI progress', recentTranscript: 'we should accelerate',
  threshold: 0.0, // low threshold so nodes are selected in the fixture
  session: { anClaimEmbeddings: [], excludeGreatestHits: false, greatestHitsList: [] },
};

describe('POST /api/taxonomy/relevant-nodes — server parity fixture (t/3257 T2)', () => {
  let post: Handler;
  beforeEach(() => {
    const { router, handlers } = makeRouter();
    registerRelevantNodesRoutes(router as never, {} as ServerCtx);
    post = handlers['POST /api/taxonomy/relevant-nodes'];
  });

  it('endpoint selection === direct selectRelevantTaxonomy on the same assembled input (order-preserving)', async () => {
    const res = fakeRes();
    await post(fakeReq(), res, BODY);
    expect(res._status).toBe(200);

    // Reproduce the endpoint's assembly independently and call the lib fn directly with the SAME stubs.
    const corpusEmbed = (texts: string[]) => stubComputeEmbeddings(texts).then(r => r.vectors);
    const queryEmbed = (texts: string[]) => Promise.all(texts.map(stubComputeQueryEmbedding));
    const { nodeEmbeddings } = await assembleNodeEmbeddings('accelerationist', POV_NODES as never, SIT_NODES as never, corpusEmbed, null);
    const expected = await selectRelevantTaxonomy({
      povNodes: POV_NODES as never, situationNodes: SIT_NODES as never,
      policyRegistry: [{ id: 'pol-001', action: 'fund research', source_povs: ['accelerationist'] }],
      nodeEmbeddings,
      lineageMapping: { 'Techno-optimism': { l2: 'cluster-1' } },
      doctrinalBoundaries: { strings: ['REJECT: safetyism'] },
      session: { anClaimEmbeddings: [], excludeGreatestHits: false, greatestHitsList: [] },
      params: { pov: 'accelerationist', topic: 'AI progress', recentTranscript: 'we should accelerate', threshold: 0.0 },
      embed: queryEmbed,
    });

    // Order-preserving set equality on the selected node refs + provenance passthrough.
    expect(res._body.povNodes).toEqual(expected.povNodes);            // W3: same nodes, SAME ORDER
    expect(res._body.situationNodes).toEqual(expected.situationNodes);
    expect(res._body.nodeSourceMap).toEqual(expected.nodeSourceMap);  // provenance carried, not recomputed
    expect(res._body.anchoring).toEqual(expected.anchoring);
    expect(res._body.policyRegistry).toEqual(expected.policyRegistry);
  });

  it('rejects an invalid pov with 400', async () => {
    const res = fakeRes();
    await post(fakeReq(), res, { ...BODY, pov: 'bogus' });
    expect(res._status).toBe(400);
  });

  it('returns a well-formed RelevantTaxonomyResult (the W1 revised contract)', async () => {
    const res = fakeRes();
    await post(fakeReq(), res, BODY);
    expect(res._body).toHaveProperty('povNodes');
    expect(res._body).toHaveProperty('situationNodes');
    expect(res._body).toHaveProperty('nodeSourceMap');
    expect(res._body).toHaveProperty('injectionManifest');
    expect(res._body).toHaveProperty('anchoring');
    expect(Array.isArray(res._body.povNodes)).toBe(true);
  });
});
