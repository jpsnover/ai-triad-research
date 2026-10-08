// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4034/t/4038 — the Electron recount-policy-members IPC handler. Uses the REAL
// lib/policy/registryRecount.js (pure, no electron dep) so this exercises the actual recount
// rule — only the lock/file-read/file-write side of taxonomyHandlers.ts is faked, mirroring the
// scaffold used for taxonomyHandlers.povTagProposals.test.ts (t/4054).
//
// PI ruling e/264#29 (option a): the editor's recount never refuses on an uncommitted registry —
// `refused` means only `'locked'` (the 60s policy_actions.lock wait timed out).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  registry: null as unknown,
  povFiles: {} as Record<string, unknown>,
  // e/274#4 (Rosetta): a real POV file is never legitimately empty — ai-triad-data/taxonomy's
  // one taxonomy dir has 227-455 nodes per file. The default fixture is a filler node that
  // references no policy, so "no longer referenced" means *no node references the id*, not
  // *the file is empty* — this stays correct whether or not #3050's empty-nodes refusal has
  // landed in the lib yet.
  povFileErrors: new Set<string>(),
  lockHandle: {} as unknown | null,
  acquireCalls: 0,
  releaseCalls: 0,
  writeArg: undefined as unknown,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('os', () => ({
  default: { userInfo: () => ({ username: 'test-reviewer' }) },
  userInfo: () => ({ username: 'test-reviewer' }),
}));

vi.mock('../fileIO.js', () => {
  const stub = (): undefined => undefined;
  return {
    readTaxonomyFile: (pov: string): unknown => {
      if (h.povFileErrors.has(pov)) {
        // Simulates parseJsonFile's real failure mode (ENOENT / a parse error) — unguarded in
        // the handler, so it must propagate, never be swallowed into an empty-file default.
        throw new Error(`ENOENT: no such file or directory, open '${pov}.json'`);
      }
      return h.povFiles[pov] ?? { nodes: [{ id: 'fixture-filler' }] };
    },
    writeTaxonomyFile: stub, readAllConflictFiles: stub, readConflictClusters: stub,
    writeConflictFile: stub, createConflictFile: stub, deleteConflictFile: stub,
    readEdgesFile: stub, writeEdgesFile: stub, getTaxonomyDirs: stub,
    getActiveTaxonomyDirName: stub, setActiveTaxonomyDir: stub, buildNodeSourceIndex: stub,
    buildPolicySourceIndex: stub,
    readPolicyRegistry: (): unknown => h.registry,
    acquirePolicyRegistryLock: async (): Promise<unknown | null> => { h.acquireCalls++; return h.lockHandle; },
    releasePolicyRegistryLock: (): void => { h.releaseCalls++; },
    writePolicyRegistryRaw: (content: string): void => { h.writeArg = content; },
    readAggregatedCruxes: stub, readLineageCategories: (): unknown => ({ mapping: {} }),
    readLineageEnrichments: stub, loadSyntheticCorpus: stub, loadSyntheticEmbeddings: (): null => null,
    updateSyntheticEmbeddings: stub,
    getDataRootPath: (): string => '/tmp', loadDataConfig: (): { taxonomy_dir: string } => ({ taxonomy_dir: 'x' }),
    readPovTagProposals: (): null => null,
    writePovTagProposals: stub,
  };
});

vi.mock('../../server/storage/editMeta.js', () => ({ stampNodeAuthorship: (_old: unknown, next: unknown) => next }));
vi.mock('../embeddings.js', () => ({ computeEmbeddings: vi.fn(async () => []), computeQueryEmbedding: vi.fn(async () => []) }));

// Imported AFTER the mocks so taxonomyHandlers binds the mocked deps.
import { registerTaxonomyHandlers } from '../ipc/taxonomyHandlers.js';
import { ActionableError } from '../../../../lib/debate/errors.js';

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`${channel} not registered`);
  return fn;
}

function node(id: string, policyIds: Array<string | null | undefined>) {
  return {
    id,
    graph_attributes: {
      policy_actions: policyIds.map((policy_id) => ({ policy_id })),
    },
  };
}

beforeEach(() => {
  h.handlers.clear();
  h.registry = { policies: [] };
  h.povFiles = {};
  h.povFileErrors = new Set();
  h.lockHandle = {};
  h.acquireCalls = 0;
  h.releaseCalls = 0;
  h.writeArg = undefined;
  registerTaxonomyHandlers();
});

describe('recount-policy-members (t/4034/t/4038)', () => {
  it('written: a newly-referenced id gets member_count/source_povs and the registry is written', async () => {
    h.registry = { policies: [{ id: 'pol-001', member_count: 0, source_povs: [] }] };
    h.povFiles = { accelerationist: { nodes: [node('acc-x-001', ['pol-001'])] } };

    const result = await getHandler('recount-policy-members')({}, ['pol-001']) as
      { status: string; updated: Array<{ id: string; member_count: number; source_povs: string[] }> };

    expect(result.status).toBe('written');
    expect(result.updated).toEqual([{ id: 'pol-001', member_count: 1, source_povs: ['accelerationist'] }]);
    expect(h.writeArg).toContain('"member_count": 1');
    expect(h.acquireCalls).toBe(1);
    expect(h.releaseCalls).toBe(1);
  });

  it('no-longer-referenced: member_count drops to 0 and source_povs is left alone', async () => {
    h.registry = { policies: [{ id: 'pol-001', member_count: 1, source_povs: ['accelerationist'] }] };
    // A filler node that references no policy — "no longer referenced" means no NODE references
    // the id, not that the file is empty (e/274#4: no real POV file is ever legitimately empty).
    h.povFiles = { accelerationist: { nodes: [{ id: 'fixture-filler' }] } };

    const result = await getHandler('recount-policy-members')({}, ['pol-001']) as
      { status: string; updated: Array<{ id: string; member_count: number; source_povs: string[] }> };

    expect(result.status).toBe('written');
    expect(result.updated).toEqual([{ id: 'pol-001', member_count: 0, source_povs: ['accelerationist'] }]);
  });

  it('unknown ids are ignored: no match in the registry, nothing written', async () => {
    h.registry = { policies: [{ id: 'pol-001', member_count: 0, source_povs: [] }] };

    const result = await getHandler('recount-policy-members')({}, ['pol-999']) as { status: string; updated: unknown[] };

    expect(result.status).toBe('unchanged');
    expect(result.updated).toEqual([]);
    expect(h.writeArg).toBeUndefined();
  });

  it('unrelated ids are untouched: recounting one id leaves another policy\'s fields unchanged', async () => {
    h.registry = {
      policies: [
        { id: 'pol-001', member_count: 0, source_povs: [] },
        { id: 'pol-002', member_count: 5, source_povs: ['skeptic'] },
      ],
    };
    h.povFiles = { accelerationist: { nodes: [node('acc-x-001', ['pol-001'])] } };

    await getHandler('recount-policy-members')({}, ['pol-001']);

    expect(h.writeArg).toContain('"id": "pol-002"');
    expect(h.writeArg).toContain('"member_count": 5');
  });

  it('unchanged: skips the write when the recomputed registry equals what is on disk', async () => {
    // status: 'active' already present — otherwise the rule ADDS it (a change) even when the
    // counts don't move, which is exactly the previous test's "written" case.
    h.registry = { policies: [{ id: 'pol-001', member_count: 1, source_povs: ['accelerationist'], status: 'active' }] };
    h.povFiles = { accelerationist: { nodes: [node('acc-x-001', ['pol-001'])] } };

    const result = await getHandler('recount-policy-members')({}, ['pol-001']) as { status: string; updated: unknown[] };

    expect(result.status).toBe('unchanged');
    expect(result.updated).toEqual([]);
    expect(h.writeArg).toBeUndefined();
    expect(h.releaseCalls).toBe(1); // lock still released on a no-op
  });

  it('refused/locked: a lock-acquire timeout never reads or writes, and reports reason "locked"', async () => {
    h.lockHandle = null; // acquirePolicyRegistryLock timed out

    const result = await getHandler('recount-policy-members')({}, ['pol-001']) as
      { status: string; reason?: string; updated: unknown[] };

    expect(result).toEqual({ status: 'refused', reason: 'locked', updated: [] });
    expect(h.writeArg).toBeUndefined();
    expect(h.releaseCalls).toBe(0); // nothing to release — the lock was never acquired
  });

  it('throws (and still releases the lock) when policy_actions.json does not exist', async () => {
    h.registry = null;
    await expect(getHandler('recount-policy-members')({}, ['pol-001'])).rejects.toThrow(ActionableError);
    expect(h.writeArg).toBeUndefined(); // e/274#6/#7: a rejection must never be paired with a write
    expect(h.releaseCalls).toBe(1);
  });

  // e/274#5-#7 (Second Opinion / Rosetta Stone): the handler's own half of the fail-closed
  // contract — a thrown read error becomes a rejected call, and NOTHING gets written. The
  // read-succeeds-but-incomplete arm (the lib's "nodes: []" refusal, #3050) follows below.
  it('fails closed on a POV read error: rejects, writes nothing, and releases the lock', async () => {
    h.registry = { policies: [{ id: 'pol-001', member_count: 0, source_povs: [] }] };
    h.povFileErrors.add('safetyist'); // simulates parseJsonFile's real ENOENT/parse-error throw

    await expect(getHandler('recount-policy-members')({}, ['pol-001'])).rejects.toThrow('ENOENT');

    expect(h.writeArg).toBeUndefined();
    expect(h.releaseCalls).toBe(1);
  });

  // #3050 (SO e/274#2, #7): a POV that READS successfully but is empty ({ nodes: [] }, e.g. a
  // fallback substituted for a failed read) must be refused by the lib's completeness guard and
  // become a rejected call. Without the guard it would write member_count: 0 for every policy
  // that POV references, which is exactly the #3048 defect.
  it('fails closed on an empty POV file: rejects naming the POV, writes nothing, and releases the lock', async () => {
    h.registry = { policies: [{ id: 'pol-001', member_count: 1, source_povs: ['safetyist'] }] };
    h.povFiles = { safetyist: { nodes: [] } };

    await expect(getHandler('recount-policy-members')({}, ['pol-001'])).rejects.toThrow(/safetyist/);

    expect(h.writeArg).toBeUndefined();
    expect(h.releaseCalls).toBe(1);
  });
});
