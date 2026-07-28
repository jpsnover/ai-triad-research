// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * t/1822: the `save-edges` IPC handler (in taxonomyHandlers.ts) whole-file-persists
 * an EdgesFile via writeEdgesFile — the desktop transport for the frozen
 * `saveEdges: (data: EdgesFile) => Promise<void>` bridge method (t/1816). Unlike the
 * index-based edge handlers it CREATES edges.json when absent (new-edge path) and
 * guards the BODY SHAPE (reject non-{edges:[...]}), mirroring the server's PUT
 * /api/edges 400 guard (t/1821).
 *
 * taxonomyHandlers transitively imports electron + the main data layer (can't load
 * under vitest), so we mock electron (capture the registered handler) and ../fileIO.js
 * (stub every imported name; make writeEdgesFile observable + fault-injectable). The
 * real ActionableError / flight-recorder load unmocked.
 */

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  writeEdgesArg: undefined as unknown,
  writeThrows: null as Error | null,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../fileIO.js', () => {
  const stub = (): undefined => undefined;
  return {
    readTaxonomyFile: stub, writeTaxonomyFile: stub, readAllConflictFiles: stub,
    readConflictClusters: stub, writeConflictFile: stub, createConflictFile: stub,
    deleteConflictFile: stub, readEdgesFile: stub,
    writeEdgesFile: (data: unknown): void => { if (h.writeThrows) throw h.writeThrows; h.writeEdgesArg = data; },
    getTaxonomyDirs: stub, getActiveTaxonomyDirName: stub, setActiveTaxonomyDir: stub,
    buildNodeSourceIndex: stub, buildPolicySourceIndex: stub, readPolicyRegistry: stub,
    readAggregatedCruxes: stub, readLineageCategories: stub, readLineageEnrichments: stub,
    loadSyntheticCorpus: stub, loadSyntheticEmbeddings: stub, updateSyntheticEmbeddings: stub,
    getDataRootPath: (): string => '/tmp', loadDataConfig: (): { taxonomy_dir: string } => ({ taxonomy_dir: 'x' }),
  };
});

vi.mock('../../server/storage/editMeta.js', () => ({ stampNodeAuthorship: (_old: unknown, next: unknown) => next }));

// Imported AFTER the mocks so taxonomyHandlers binds the mocked deps.
import { registerTaxonomyHandlers } from '../ipc/taxonomyHandlers.js';
import { ActionableError } from '../../../../lib/debate/errors.js';

function saveEdges(data: unknown): unknown {
  const fn = h.handlers.get('save-edges');
  if (!fn) throw new Error('save-edges not registered');
  return fn({}, data);
}

beforeEach(() => {
  h.handlers.clear();
  h.writeEdgesArg = undefined;
  h.writeThrows = null;
  registerTaxonomyHandlers();
});

describe('save-edges IPC handler (t/1822)', () => {
  it('persists a valid EdgesFile whole via writeEdgesFile', () => {
    const file = { edges: [{ source: 'a', target: 'b', status: 'proposed' }], schema_version: 2 };
    saveEdges(file);
    expect(h.writeEdgesArg).toEqual(file);   // whole file passed through verbatim
  });

  it('creates/overwrites even with an empty edges array (new-edge-on-empty path — no precondition on an existing edges.json)', () => {
    saveEdges({ edges: [] });
    expect(h.writeEdgesArg).toEqual({ edges: [] });
  });

  it('rejects a payload with no edges array (400-equivalent body guard) and writes nothing', () => {
    expect(() => saveEdges({ notEdges: 1 })).toThrow(ActionableError);
    expect(h.writeEdgesArg).toBeUndefined();
  });

  it('rejects non-object payloads', () => {
    expect(() => saveEdges(null)).toThrow(ActionableError);
    expect(() => saveEdges('nope')).toThrow(ActionableError);
    expect(() => saveEdges(42)).toThrow(ActionableError);
  });

  it('surfaces a write failure as an ActionableError (not a raw fs error)', () => {
    h.writeThrows = new Error('EACCES: permission denied');
    expect(() => saveEdges({ edges: [] })).toThrow(ActionableError);
  });
});
