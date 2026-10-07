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
    readTaxonomyFile: (pov: string): unknown => h.povFiles[pov] ?? { nodes: [] },
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
    h.povFiles = { accelerationist: { nodes: [] } }; // no node references it anymore

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
    expect(h.releaseCalls).toBe(1);
  });
});
