// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4054 — the Electron load-pov-tag-proposals / review-pov-tag-proposal IPC handlers
// (pov-tag-proposals.json review queue, t/4052). Uses the REAL lib/schema/povTagProposals.js
// (pure, no electron dep) so this exercises the actual parse/apply/serialize logic — only the
// file-read/write side of taxonomyHandlers.ts is faked, mirroring the scaffold used for
// fetchRelevantNodesDoctrinalBoundaries.test.ts and opedHandlers.tagSelection.test.ts.
//
// Contract under test (Rosetta Stone, p/546#62):
//   - load returns the FILE ITSELF or null when absent — never parsePovTagProposals's
//     { ok, file } wrapper. A parse failure throws (never returns null).
//   - review returns { file, item } on success, { refused, problems } as a VALUE on refusal
//     (never thrown) — nothing is written on refusal.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  fileOnDisk: null as unknown,
  writeArg: undefined as unknown,
  // t/4052 AC: "node files are byte-unchanged after a review session" — every node-file writer
  // the module exposes becomes a vi.fn() so tests can assert review-pov-tag-proposal never
  // touches them (it writes ONLY pov-tag-proposals.json, never pov_tags or any node file).
  writeTaxonomyFile: vi.fn(),
  writeConflictFile: vi.fn(),
  createConflictFile: vi.fn(),
  deleteConflictFile: vi.fn(),
  writeEdgesFile: vi.fn(),
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
    readTaxonomyFile: (): unknown => ({ nodes: [] }),
    writeTaxonomyFile: h.writeTaxonomyFile,
    readAllConflictFiles: stub, readConflictClusters: stub,
    writeConflictFile: h.writeConflictFile, createConflictFile: h.createConflictFile, deleteConflictFile: h.deleteConflictFile,
    readEdgesFile: stub, writeEdgesFile: h.writeEdgesFile, getTaxonomyDirs: stub,
    getActiveTaxonomyDirName: stub, setActiveTaxonomyDir: stub, buildNodeSourceIndex: stub,
    buildPolicySourceIndex: stub, readPolicyRegistry: (): unknown => ({ policies: [] }),
    readAggregatedCruxes: stub, readLineageCategories: (): unknown => ({ mapping: {} }),
    readLineageEnrichments: stub, loadSyntheticCorpus: stub, loadSyntheticEmbeddings: (): null => null,
    updateSyntheticEmbeddings: stub,
    getDataRootPath: (): string => '/tmp', loadDataConfig: (): { taxonomy_dir: string } => ({ taxonomy_dir: 'x' }),
    readPovTagProposals: (): unknown => h.fileOnDisk,
    writePovTagProposals: (file: unknown): void => { h.writeArg = file; },
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

const REGISTERED_TAG_NODE = 'skp-beliefs-001'; // real registry has skeptic: critical, institutional

function makeFile(items: Array<Record<string, unknown>>) {
  return {
    version: 1,
    proposals: items.map((over) => ({
      node_id: REGISTERED_TAG_NODE, proposed: ['critical'], status: 'pending',
      final: null, reviewed_by: null, reviewed_at: null,
      ...over,
    })),
  };
}

const nodeFileWriters = [h.writeTaxonomyFile, h.writeConflictFile, h.createConflictFile, h.deleteConflictFile, h.writeEdgesFile];
function expectNoNodeFileWrites(): void {
  for (const fn of nodeFileWriters) expect(fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  h.handlers.clear();
  h.fileOnDisk = null;
  h.writeArg = undefined;
  for (const fn of nodeFileWriters) fn.mockClear();
  registerTaxonomyHandlers();
});

describe('load-pov-tag-proposals (t/4054)', () => {
  it('returns null when the file is absent — not an error', async () => {
    h.fileOnDisk = null;
    const result = await getHandler('load-pov-tag-proposals')();
    expect(result).toBeNull();
  });

  it('returns the FILE ITSELF, not the { ok, file } wrapper, when present and valid', async () => {
    const file = makeFile([{}]);
    h.fileOnDisk = file;
    const result = await getHandler('load-pov-tag-proposals')() as { version: number; proposals: unknown[] };
    expect(result).not.toHaveProperty('ok');
    expect(result.version).toBe(1);
    expect(result.proposals).toHaveLength(1);
  });

  it('REGRESSION: throws (never returns null) when the file is malformed', () => {
    h.fileOnDisk = { version: 1, proposals: 'not-an-array' };
    expect(() => getHandler('load-pov-tag-proposals')()).toThrow(ActionableError);
  });
});

describe('review-pov-tag-proposal (t/4054)', () => {
  it('accepted: writes the file via writePovTagProposals and returns { file, item }', async () => {
    h.fileOnDisk = makeFile([{}]);
    const decision = { status: 'accepted' as const };
    const result = await getHandler('review-pov-tag-proposal')(
      {}, REGISTERED_TAG_NODE, decision, 'pending',
    ) as { file: unknown; item: { status: string; final: string[]; reviewed_by: string } };

    expect(result.item.status).toBe('accepted');
    expect(result.item.final).toEqual(['critical']);
    expect(result.item.reviewed_by).toBe('test-reviewer'); // os.userInfo(), not a server-auth identity
    expect(h.writeArg).toBe(result.file); // the handler wrote the returned file
    expectNoNodeFileWrites(); // t/4052 AC: review never touches pov_tags or any node file
  });

  it('modified: writes the file and returns { file, item } — node files still untouched', async () => {
    h.fileOnDisk = makeFile([{}]);
    const decision = { status: 'modified' as const, final: ['institutional'] };
    const result = await getHandler('review-pov-tag-proposal')(
      {}, REGISTERED_TAG_NODE, decision, 'pending',
    ) as { file: unknown; item: { status: string; final: string[] } };

    expect(result.item.status).toBe('modified');
    expect(result.item.final).toEqual(['institutional']);
    expect(h.writeArg).toBe(result.file);
    expectNoNodeFileWrites();
  });

  it('REGRESSION: a conflict (stale expectedStatus) is returned as a VALUE, never thrown, and writes nothing', async () => {
    h.fileOnDisk = makeFile([{ status: 'accepted', final: ['critical'], reviewed_by: 'someone-else', reviewed_at: '2026-01-01T00:00:00.000Z' }]);
    const decision = { status: 'accepted' as const };
    const result = await getHandler('review-pov-tag-proposal')(
      {}, REGISTERED_TAG_NODE, decision, 'pending', // expectedStatus is stale — item is already 'accepted'
    ) as { refused?: string; problems?: string[] };

    expect(result.refused).toBe('conflict');
    expect(result.problems?.length).toBeGreaterThan(0);
    expect(h.writeArg).toBeUndefined();
    expectNoNodeFileWrites();
  });

  it('REGRESSION: an invalid decision (unknown node) is returned as a VALUE, never thrown', async () => {
    h.fileOnDisk = makeFile([{}]);
    const decision = { status: 'accepted' as const };
    const result = await getHandler('review-pov-tag-proposal')(
      {}, 'no-such-node', decision, 'pending',
    ) as { refused?: string };
    expect(result.refused).toBe('invalid');
    expect(h.writeArg).toBeUndefined();
    expectNoNodeFileWrites();
  });

  it('rejected: final becomes [] and is written', async () => {
    h.fileOnDisk = makeFile([{}]);
    const result = await getHandler('review-pov-tag-proposal')(
      {}, REGISTERED_TAG_NODE, { status: 'rejected' as const }, 'pending',
    ) as { item: { status: string; final: string[] } };
    expect(result.item.status).toBe('rejected');
    expect(result.item.final).toEqual([]);
    expect(h.writeArg).toBeDefined();
    expectNoNodeFileWrites();
  });

  it('throws when the proposals file does not exist (nothing to review)', () => {
    h.fileOnDisk = null;
    expect(() => getHandler('review-pov-tag-proposal')(
      {}, REGISTERED_TAG_NODE, { status: 'accepted' as const }, 'pending',
    )).toThrow(ActionableError);
  });
});
