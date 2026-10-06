// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/3966 — the Electron `fetch-relevant-nodes` IPC handler must pass real doctrinal boundaries
 * into `selectRelevantTaxonomy`, not the dead `POVER_INFO[pov].doctrinal_boundaries` field (no
 * soul JSON ever sets it, so anchoring was silently skipped on every IPC selection). Uses the
 * REAL `lib/debate/poverInfo.js` (pure soul JSON data, no electron dep) so this proves the
 * actual production souls produce non-empty boundaries through `getPovDoctrinalBoundaries` —
 * only the file-read/write side of taxonomyHandlers.ts is faked, mirroring
 * saveEdges.test.ts/saveTaxonomyFileBdiGate.test.ts's scaffold.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  lastSelectArgs: undefined as { doctrinalBoundaries?: unknown } | undefined,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../fileIO.js', () => {
  const stub = (): undefined => undefined;
  return {
    readTaxonomyFile: (): unknown => ({ nodes: [] }),
    writeTaxonomyFile: stub, readAllConflictFiles: stub, readConflictClusters: stub,
    writeConflictFile: stub, createConflictFile: stub, deleteConflictFile: stub,
    readEdgesFile: stub, writeEdgesFile: stub, getTaxonomyDirs: stub,
    getActiveTaxonomyDirName: stub, setActiveTaxonomyDir: stub, buildNodeSourceIndex: stub,
    buildPolicySourceIndex: stub, readPolicyRegistry: (): unknown => ({ policies: [] }),
    readAggregatedCruxes: stub, readLineageCategories: (): unknown => ({ mapping: {} }),
    readLineageEnrichments: stub, loadSyntheticCorpus: stub, loadSyntheticEmbeddings: (): null => null,
    updateSyntheticEmbeddings: stub,
    getDataRootPath: (): string => '/tmp', loadDataConfig: (): { taxonomy_dir: string } => ({ taxonomy_dir: 'x' }),
  };
});

vi.mock('../../server/storage/editMeta.js', () => ({ stampNodeAuthorship: (_old: unknown, next: unknown) => next }));
vi.mock('../embeddings.js', () => ({ computeEmbeddings: vi.fn(async () => []), computeQueryEmbedding: vi.fn(async () => []) }));

// Mocked so the handler's actual embedding/scoring logic doesn't run — only doctrinalBoundaries
// routing is under test. POVER_INFO/getPovDoctrinalBoundaries are NOT mocked (real soul data).
vi.mock('../../../../lib/debate/relevanceSelection.js', () => ({
  assembleNodeEmbeddings: vi.fn(async () => ({ nodeEmbeddings: {} })),
  selectRelevantTaxonomy: vi.fn((args: { doctrinalBoundaries?: unknown }) => { h.lastSelectArgs = args; return { selectedNodes: [] }; }),
}));

// Imported AFTER the mocks so taxonomyHandlers binds the mocked deps.
import { registerTaxonomyHandlers } from '../ipc/taxonomyHandlers.js';
import { POVER_INFO, getPovDoctrinalBoundaries } from '../../../../lib/debate/poverInfo.js';

function fetchRelevantNodes(payload: unknown): unknown {
  const fn = h.handlers.get('fetch-relevant-nodes');
  if (!fn) throw new Error('fetch-relevant-nodes not registered');
  return fn({}, payload);
}

beforeEach(() => {
  h.handlers.clear();
  h.lastSelectArgs = undefined;
  registerTaxonomyHandlers();
});

describe('fetch-relevant-nodes IPC: doctrinal boundaries routing (t/3966)', () => {
  it('sanity: the real accelerationist soul has non-empty boundaries through the shared accessor (so this test is not vacuous)', () => {
    const result = getPovDoctrinalBoundaries(POVER_INFO.accelerationist);
    expect(result).toBeDefined();
    expect(result!.strings.length).toBeGreaterThan(0);
  });

  it('passes non-undefined, non-empty doctrinalBoundaries to selectRelevantTaxonomy for a POV with real soul boundaries', async () => {
    await fetchRelevantNodes({ pov: 'accelerationist', topic: 't', recentTranscript: 'r' });
    expect(h.lastSelectArgs?.doctrinalBoundaries).toBeDefined();
    const db = h.lastSelectArgs!.doctrinalBoundaries as { strings: string[]; isRejection: boolean[] };
    expect(db.strings.length).toBeGreaterThan(0);
    expect(db.isRejection).toHaveLength(db.strings.length);
  });

  it('REGRESSION: fails against the old dead-field read — doctrinalBoundaries must not be undefined for a POV with real boundaries', async () => {
    // This is the exact failure the old `povInfo?.doctrinal_boundaries` read produced: silently
    // undefined for every POV, because no soul JSON sets that field.
    await fetchRelevantNodes({ pov: 'accelerationist', topic: 't', recentTranscript: 'r' });
    expect(h.lastSelectArgs?.doctrinalBoundaries).not.toBeUndefined();
  });
});
