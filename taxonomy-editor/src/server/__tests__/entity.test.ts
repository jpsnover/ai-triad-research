// @vitest-environment node
//
// t/1786 — GET /api/entity/:ref resolver + the merged_into tombstone helper.
// Drives the route handler through a captured Router with a minimal req/res so the
// real httpKit json()/error() path is exercised, against mocked fileIO / org reads.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const { readPolicyRegistryMock, readTaxonomyFileMock, loadDictionaryMock, readEntityRegistryMock, getOrganizationByIdMock, recordMock } =
  vi.hoisted(() => ({
    readPolicyRegistryMock: vi.fn(),
    readTaxonomyFileMock: vi.fn(),
    loadDictionaryMock: vi.fn(),
    readEntityRegistryMock: vi.fn(),
    getOrganizationByIdMock: vi.fn(),
    recordMock: vi.fn(),
  }));

vi.mock('../storage/fileIO.js', () => ({
  readPolicyRegistry: readPolicyRegistryMock,
  readTaxonomyFile: readTaxonomyFileMock,
  loadDictionary: loadDictionaryMock,
  readEntityRegistry: readEntityRegistryMock,
}));
vi.mock('../organizations.js', () => ({ getOrganizationById: getOrganizationByIdMock }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordMock }) }));

import type { Entity } from '../../../../lib/entities/types.js';
import type { ServerCtx } from '../routes/context.js';
import { createRouter, type Handler } from '../httpKit.js';
import { registerEntityRoutes, resolveMergedInto } from '../routes/entity.js';

// ── route harness ──
async function invoke(rawRef: string): Promise<{ status: number; body: unknown }> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  registerEntityRoutes(createRouter(routes), {} as ServerCtx);
  const route = routes.find(r => r.path === '/api/entity/:ref');
  if (!route) throw new Error('entity route not registered');

  const req = { url: `/api/entity/${encodeURIComponent(rawRef)}`, method: 'GET', headers: {} } as unknown as IncomingMessage;
  let status = 200;
  let body: unknown;
  const res = {
    writableEnded: false,
    headersSent: false,
    req,
    writeHead(s: number) { status = s; this.headersSent = true; },
    end(b?: string) { body = b ? JSON.parse(b) : undefined; this.writableEnded = true; },
  } as unknown as ServerResponse;

  await route.handler(req, res, undefined);
  return { status, body };
}

describe('GET /api/entity/:ref (t/1786)', () => {
  beforeEach(() => {
    readPolicyRegistryMock.mockReset();
    readTaxonomyFileMock.mockReset();
    loadDictionaryMock.mockReset();
    readEntityRegistryMock.mockReset();
    getOrganizationByIdMock.mockReset();
    recordMock.mockReset();

    getOrganizationByIdMock.mockImplementation(async (id: string) =>
      id === 'org-001' ? { id: 'org-001', name: 'Electronic Frontier Foundation' } : null);
    readPolicyRegistryMock.mockResolvedValue({ policies: [{ id: 'pol-001', action: 'Fund reskilling.' }] });
    readTaxonomyFileMock.mockImplementation(async (pov: string) => {
      if (pov === 'accelerationist') return { nodes: [{ id: 'acc-desires-001', label: 'Accelerate' }] };
      if (pov === 'situations') return { nodes: [{ id: 'sit-001', label: 'Job displacement' }] };
      return { nodes: [] };
    });
    loadDictionaryMock.mockResolvedValue({
      standardized: [],
      lintViolations: [],
      colloquial: [{ colloquial_term: 'labor displacement', status: 'do_not_use_bare' }],
    });
    // Default: entities.json absent (null) → ent-* resolves to not_found. Tests that
    // exercise a populated registry override this with a Map (t/1829 / t/1807).
    readEntityRegistryMock.mockResolvedValue(null);
  });

  it('resolves an organization ref (200, kind=organization)', async () => {
    const { status, body } = await invoke('org-001');
    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'organization', ref: { kind: 'organization', id: 'org-001' }, record: { id: 'org-001' } });
  });

  it('resolves a policy ref by id (200, kind=policy)', async () => {
    const { status, body } = await invoke('pol-001');
    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'policy', record: { id: 'pol-001' } });
  });

  it('resolves a POV node via its prefix (acc → accelerationist file)', async () => {
    const { status, body } = await invoke('acc-desires-001');
    expect(status).toBe(200);
    expect(readTaxonomyFileMock).toHaveBeenCalledWith('accelerationist');
    expect(body).toMatchObject({ kind: 'node', record: { id: 'acc-desires-001' } });
  });

  it('resolves a situation ref from the situations file', async () => {
    const { status, body } = await invoke('sit-001');
    expect(status).toBe(200);
    expect(readTaxonomyFileMock).toHaveBeenCalledWith('situations');
    expect(body).toMatchObject({ kind: 'situation', record: { id: 'sit-001' } });
  });

  it('resolves a term ref by slugifying colloquial_term (labor-displacement)', async () => {
    const { status, body } = await invoke('term:labor-displacement');
    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'term', record: { colloquial_term: 'labor displacement' } });
  });

  it('returns not_found (no record) for an ambiguous term slug', async () => {
    // Two colloquial terms slugify onto the same slug → refusal, not a guess.
    loadDictionaryMock.mockResolvedValue({
      standardized: [], lintViolations: [],
      colloquial: [{ colloquial_term: 'foo bar' }, { colloquial_term: 'foo-bar' }],
    });
    const { status, body } = await invoke('term:foo-bar');
    expect(status).toBe(200);
    expect(body).toEqual({ kind: 'not_found', ref: { kind: 'term', id: 'term:foo-bar' } });
    expect(body).not.toHaveProperty('record');
  });

  it('returns not_found for ent-* when the registry is absent (null store)', async () => {
    // Server Storage returns null when entities.json is unpopulated (t/1807) — the
    // not_found semantic is held stable until the store lands.
    readEntityRegistryMock.mockResolvedValue(null);
    const { status, body } = await invoke('ent-001');
    expect(status).toBe(200);
    expect(body).toEqual({ kind: 'not_found', ref: { kind: 'entity', id: 'ent-001' } });
    expect(body).not.toHaveProperty('record');
  });

  it('resolves an ent-* ref to its Entity record (200, kind=entity)', async () => {
    readEntityRegistryMock.mockResolvedValue(new Map([
      ['ent-001', { id: 'ent-001', name: 'OpenAI' } as unknown as Entity],
    ]));
    const { status, body } = await invoke('ent-001');
    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'entity', ref: { kind: 'entity', id: 'ent-001' }, record: { id: 'ent-001', name: 'OpenAI' } });
    expect(body).not.toHaveProperty('redirected_from');
  });

  it('follows a merged_into tombstone to the canonical Entity + stamps redirected_from', async () => {
    readEntityRegistryMock.mockResolvedValue(new Map([
      ['ent-001', { id: 'ent-001', merged_into: 'ent-002' } as unknown as Entity],
      ['ent-002', { id: 'ent-002', name: 'Canonical' } as unknown as Entity],
    ]));
    const { status, body } = await invoke('ent-001');
    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'entity', record: { id: 'ent-002', name: 'Canonical' }, redirected_from: 'ent-001' });
  });

  it('returns 400 for a malformed / unrecognized ref', async () => {
    const { status, body } = await invoke('not-a-real-ref');
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: expect.stringContaining('not-a-real-ref') });
  });

  it('returns 200 not_found (no record) for a well-formed but unresolved ref', async () => {
    const { status, body } = await invoke('org-999');
    expect(status).toBe(200);
    expect(body).toEqual({ kind: 'not_found', ref: { kind: 'organization', id: 'org-999' } });
    expect(body).not.toHaveProperty('record');
  });

  it('records to the flight recorder and returns 500 when a read throws', async () => {
    readPolicyRegistryMock.mockRejectedValue(new Error('blob unreachable'));
    const { status } = await invoke('pol-001');
    expect(status).toBe(500);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', type: 'system.error' }));
  });
});

describe('resolveMergedInto (merged_into tombstone chase, t/1786)', () => {
  const ent = (id: string, mergedInto?: string): Entity =>
    ({ id, merged_into: mergedInto } as unknown as Entity);

  it('follows a 2-hop chain to the terminal record, stamping redirectedFrom', () => {
    const map = new Map<string, Entity>([
      ['ent-001', ent('ent-001', 'ent-002')],
      ['ent-002', ent('ent-002', 'ent-003')],
      ['ent-003', ent('ent-003')],
    ]);
    const res = resolveMergedInto('ent-001', id => map.get(id) ?? null, { maxDepth: 16 });
    expect(res).toEqual({ record: map.get('ent-003'), redirectedFrom: 'ent-001' });
  });

  it('returns the record with no redirectedFrom when it is already canonical', () => {
    const map = new Map<string, Entity>([['ent-003', ent('ent-003')]]);
    const res = resolveMergedInto('ent-003', id => map.get(id) ?? null, { maxDepth: 16 });
    expect(res).toEqual({ record: map.get('ent-003'), redirectedFrom: undefined });
  });

  it('returns null when a hop points at a missing id', () => {
    const map = new Map<string, Entity>([['ent-001', ent('ent-001', 'ent-gone')]]);
    expect(resolveMergedInto('ent-001', id => map.get(id) ?? null, { maxDepth: 16 })).toBeNull();
  });

  it('throws ActionableError on a merged_into cycle', () => {
    const map = new Map<string, Entity>([
      ['ent-A', ent('ent-A', 'ent-B')],
      ['ent-B', ent('ent-B', 'ent-A')],
    ]);
    expect(() => resolveMergedInto('ent-A', id => map.get(id) ?? null, { maxDepth: 16 })).toThrow(/cycle/i);
  });

  it('throws ActionableError when the chain exceeds maxDepth', () => {
    const map = new Map<string, Entity>([
      ['ent-001', ent('ent-001', 'ent-002')],
      ['ent-002', ent('ent-002', 'ent-003')],
      ['ent-003', ent('ent-003')],
    ]);
    expect(() => resolveMergedInto('ent-001', id => map.get(id) ?? null, { maxDepth: 1 })).toThrow(/depth cap/i);
  });
});
