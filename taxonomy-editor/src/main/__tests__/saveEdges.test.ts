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
  // The on-disk baseline the rationale re-merge reads (t/2957). null = genuine absence (ABSENT_BASELINE
  // → write as-is); readThrows models a corrupt/unreadable edges.json (parseJsonFile/readFileSync throw).
  readEdgesReturn: null as unknown,
  readThrows: null as Error | null,
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
    deleteConflictFile: stub,
    readEdgesFile: (): unknown => { if (h.readThrows) throw h.readThrows; return h.readEdgesReturn; },
    writeEdgesFile: (data: unknown): void => { if (h.writeThrows) throw h.writeThrows; h.writeEdgesArg = data; },
    getTaxonomyDirs: stub, getActiveTaxonomyDirName: stub, setActiveTaxonomyDir: stub,
    buildNodeSourceIndex: stub, buildPolicySourceIndex: stub, readPolicyRegistry: stub,
    readAggregatedCruxes: stub, readLineageCategories: stub, readLineageEnrichments: stub,
    loadSyntheticCorpus: stub, loadSyntheticEmbeddings: stub, updateSyntheticEmbeddings: stub,
    getDataRootPath: (): string => '/tmp', loadDataConfig: (): { taxonomy_dir: string } => ({ taxonomy_dir: 'x' }),
  };
});

vi.mock('../../server/storage/editMeta.js', () => ({ stampNodeAuthorship: (_old: unknown, next: unknown) => next }));

// taxonomyHandlers now imports ../embeddings.js (for fetch-relevant-nodes); mock it so
// embeddings.ts module-level ONNX/fileIO init doesn't run under vitest.
vi.mock('../embeddings.js', () => ({ computeEmbeddings: vi.fn(), computeQueryEmbedding: vi.fn() }));

// Imported AFTER the mocks so taxonomyHandlers binds the mocked deps.
import { registerTaxonomyHandlers } from '../ipc/taxonomyHandlers.js';
import { ActionableError } from '../../../../lib/debate/errors.js';

function saveEdges(data: unknown): unknown {
  const fn = h.handlers.get('save-edges');
  if (!fn) throw new Error('save-edges not registered');
  return fn({}, data);
}

function loadEdges(): unknown {
  const fn = h.handlers.get('load-edges');
  if (!fn) throw new Error('load-edges not registered');
  return fn({});
}

beforeEach(() => {
  h.handlers.clear();
  h.writeEdgesArg = undefined;
  h.writeThrows = null;
  h.readEdgesReturn = null; // default: genuine absence → write payload as-is
  h.readThrows = null;
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

describe('save-edges IPC — rationale re-merge on save (t/2957)', () => {
  const key = { source: 'a', type: 'SUPPORTS', target: 'b' };

  it('REPRO: a stripped whole-file save restores rationale from the on-disk baseline before writing', () => {
    h.readEdgesReturn = { edges: [{ ...key, confidence: 0.9, rationale: 'ON-DISK rationale', model: 'm', discovered_at: 't1' }] };
    saveEdges({ edges: [{ ...key, confidence: 0.9, model: 'm', discovered_at: 't1' }] }); // stripped payload
    const written = h.writeEdgesArg as { edges: Record<string, unknown>[] };
    expect(written.edges[0].rationale).toBe('ON-DISK rationale'); // NOT wiped
  });

  it('BLOCKER arm 1 — genuine absence (readEdgesFile null): first write persists the payload as-is', () => {
    h.readEdgesReturn = null; // no edges.json yet → ABSENT_BASELINE
    const body = { edges: [{ ...key, rationale: 'fresh', model: 'm', discovered_at: 't1' }] };
    saveEdges(body);
    expect(h.writeEdgesArg).toEqual(body);
  });

  it('BLOCKER arm 2 — a read/parse FAILURE refuses the save (ActionableError) and writes NOTHING', () => {
    h.readThrows = new Error('EACCES: permission denied'); // transient read error, NOT absence
    expect(() => saveEdges({ edges: [{ ...key, model: 'm', discovered_at: 't1' }] })).toThrow(ActionableError);
    expect(h.writeEdgesArg).toBeUndefined(); // no stripped write
  });

  it('refuses indistinguishable twins (same key AND discovered_at AND model) — ActionableError, no write', () => {
    h.readEdgesReturn = { edges: [
      { ...key, rationale: 'twin-A', model: 'm', discovered_at: 't' },
      { ...key, rationale: 'twin-B', model: 'm', discovered_at: 't' },
    ] };
    expect(() => saveEdges({ edges: [{ ...key, model: 'm', discovered_at: 't' }] })).toThrow(/Ambiguous rationale attribution/);
    expect(h.writeEdgesArg).toBeUndefined();
  });
});

describe('load-edges IPC — returns the COMPLETE set + lossless round-trip (t/2949)', () => {
  const key = { source: 'a', type: 'SUPPORTS', target: 'b' };

  it('load-edges returns FULL edges (rationale included) — the former inline strip is gone', () => {
    h.readEdgesReturn = { edges: [{ ...key, rationale: 'ON-DISK rationale', model: 'm', discovered_at: 't1' }] };
    const loaded = loadEdges() as { edges: Record<string, unknown>[] };
    expect(loaded.edges[0].rationale).toBe('ON-DISK rationale'); // NOT stripped on load
  });

  it('AC3 round-trip: a full-rationale load saved straight back preserves rationale on disk', () => {
    const onDisk = { edges: [{ ...key, confidence: 0.9, rationale: 'R', model: 'm', discovered_at: 't1' }] };
    h.readEdgesReturn = onDisk;
    const loaded = loadEdges(); // complete set (rationale present)
    saveEdges(loaded);          // save the loaded payload back unchanged
    expect((h.writeEdgesArg as { edges: Record<string, unknown>[] }).edges[0].rationale).toBe('R');
  });

  it('AC4 (t/2294): appending a new edge to the loaded set preserves existing rationale', () => {
    const onDisk = { edges: [{ ...key, rationale: 'existing R', model: 'm', discovered_at: 't1' }] };
    h.readEdgesReturn = onDisk;
    const loaded = loadEdges() as { edges: Record<string, unknown>[] };
    const withNew = { ...loaded, edges: [...loaded.edges, { source: 'c', type: 'SUPPORTS', target: 'd', rationale: 'brand new', model: 'm', discovered_at: 't2' }] };
    saveEdges(withNew);
    const written = h.writeEdgesArg as { edges: Record<string, unknown>[] };
    expect(written.edges[0].rationale).toBe('existing R'); // survives the add-edge save
    expect(written.edges[1].rationale).toBe('brand new');
  });
});
