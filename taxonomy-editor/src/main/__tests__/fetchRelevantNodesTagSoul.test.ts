// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/3977 — the Electron `fetch-relevant-nodes` IPC handler must route the active soul through
 * `resolvePoverInfo(pov, tagSelection)` (lib/debate/soulDocLoader.js, t/3957), not the static
 * `POVER_INFO[pov]` map. A tag soul REPLACES the general soul (t/3957#5 condition A) — this
 * proves the handler's doctrinal-boundaries computation and the `tagSelection` passed to
 * `selectRelevantTaxonomy` both reflect the resolved soul, not the untagged default. No fixture
 * tag soul exists on disk yet (pov-tags.json registry is empty), so `resolvePoverInfo` itself is
 * mocked with a distinctive fixture soul — mirrors fetchRelevantNodesDoctrinalBoundaries.test.ts's
 * scaffold (t/3966), which this file leaves untouched for the untagged/fallback path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  lastSelectArgs: undefined as { doctrinalBoundaries?: unknown; params?: { tagSelection?: unknown } } | undefined,
  lastResolveArgs: undefined as { pov?: string; tagSelection?: unknown } | undefined,
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

// A fixture tag soul whose boundaries are deliberately disjoint from the general accelerationist
// soul's — if the handler ever fell back to the static soul, these strings would not appear.
const TAG_SOUL = {
  pov: 'accelerationist',
  personality: 'tag-fixture',
  voice: 'tag-fixture',
  anti_patterns: [],
  value_hierarchy: [],
  epistemic_stance: 'tag-fixture',
  boundaries: { hardcoded: ['TAG-FIXTURE-HARD-BOUNDARY'], softcoded: ['REJECT: TAG-FIXTURE-SOFT-BOUNDARY'] },
};

vi.mock('../../../../lib/debate/soulDocLoader.js', () => ({
  resolvePoverInfo: vi.fn((pov: string, tagSelection?: { tag: string; mode: string }) => {
    h.lastResolveArgs = { pov, tagSelection };
    if (tagSelection) return { soul: TAG_SOUL, soulProvenance: { file: 'tag-fixture.json', sha: 'fixture' } };
    // Falls through to the real POVER_INFO entry for the untagged path, same as production.
    return { soul: POVER_INFO[pov as 'accelerationist'], soulProvenance: { file: '(static-import)', sha: '' } };
  }),
}));

// Mocked so the handler's actual embedding/scoring logic doesn't run — only soul/tagSelection
// routing is under test.
vi.mock('../../../../lib/debate/relevanceSelection.js', () => ({
  assembleNodeEmbeddings: vi.fn(async () => ({ nodeEmbeddings: {} })),
  selectRelevantTaxonomy: vi.fn((args: { doctrinalBoundaries?: unknown; params?: { tagSelection?: unknown } }) => { h.lastSelectArgs = args; return { selectedNodes: [] }; }),
}));

// Imported AFTER the mocks so taxonomyHandlers binds the mocked deps.
import { registerTaxonomyHandlers } from '../ipc/taxonomyHandlers.js';
import { POVER_INFO } from '../../../../lib/debate/poverInfo.js';

function fetchRelevantNodes(payload: unknown): unknown {
  const fn = h.handlers.get('fetch-relevant-nodes');
  if (!fn) throw new Error('fetch-relevant-nodes not registered');
  return fn({}, payload);
}

beforeEach(() => {
  h.handlers.clear();
  h.lastSelectArgs = undefined;
  h.lastResolveArgs = undefined;
  registerTaxonomyHandlers();
});

describe('fetch-relevant-nodes IPC: tag-soul routing via resolvePoverInfo (t/3977)', () => {
  it('no tagSelection: resolvePoverInfo is called with undefined, and byte-identical (untagged) boundaries result', async () => {
    await fetchRelevantNodes({ pov: 'accelerationist', topic: 't', recentTranscript: 'r' });
    expect(h.lastResolveArgs).toEqual({ pov: 'accelerationist', tagSelection: undefined });
    const db = h.lastSelectArgs?.doctrinalBoundaries as { strings: string[] } | undefined;
    expect(db?.strings).not.toContain('TAG-FIXTURE-HARD-BOUNDARY');
  });

  it('REGRESSION: with tagSelection, the tag soul REPLACES the general soul — doctrinalBoundaries reflect the tag fixture, not POVER_INFO', async () => {
    const tagSelection = { tag: 'critical', mode: 'scope' as const };
    await fetchRelevantNodes({ pov: 'accelerationist', topic: 't', recentTranscript: 'r', tagSelection });
    expect(h.lastResolveArgs).toEqual({ pov: 'accelerationist', tagSelection });
    const db = h.lastSelectArgs?.doctrinalBoundaries as { strings: string[]; isRejection: boolean[] };
    expect(db.strings).toEqual(['TAG-FIXTURE-HARD-BOUNDARY', 'REJECT: TAG-FIXTURE-SOFT-BOUNDARY']);
    expect(db.isRejection).toEqual([false, true]);
  });

  it('REGRESSION: tagSelection is threaded into selectRelevantTaxonomy params for Scope/Prioritize filtering', async () => {
    const tagSelection = { tag: 'critical', mode: 'prioritize' as const };
    await fetchRelevantNodes({ pov: 'accelerationist', topic: 't', recentTranscript: 'r', tagSelection });
    expect(h.lastSelectArgs?.params?.tagSelection).toEqual(tagSelection);
  });
});
