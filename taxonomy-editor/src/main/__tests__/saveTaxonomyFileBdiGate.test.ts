// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/3891 — the `save-taxonomy-file` IPC handler's situations BDI boundary guard (t/3888
 * recurrence #5 class). Exercises the real shared rule (findSituationBdiViolations /
 * validateBdiFields, lib/debate/taxonomyTypes.ts, t/3889) unmocked — only the file-read/write
 * side of taxonomyHandlers.ts is faked, mirroring saveEdges.test.ts's scaffold exactly
 * (taxonomyHandlers transitively imports electron + the main data layer, which can't load
 * under vitest).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  writeArg: undefined as unknown,
  // readReturn models the on-disk situations.json; readThrows models a read/parse failure.
  // A 'ENOENT' code on readThrows models a genuinely missing file (first write).
  readReturn: undefined as unknown,
  readThrows: null as (Error & { code?: string }) | null,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../fileIO.js', () => {
  const stub = (): undefined => undefined;
  return {
    readTaxonomyFile: (): unknown => { if (h.readThrows) throw h.readThrows; return h.readReturn; },
    writeTaxonomyFile: (_pov: string, data: unknown): void => { h.writeArg = data; },
    readAllConflictFiles: stub, readConflictClusters: stub, writeConflictFile: stub,
    createConflictFile: stub, deleteConflictFile: stub, readEdgesFile: stub, writeEdgesFile: stub,
    getTaxonomyDirs: stub, getActiveTaxonomyDirName: stub, setActiveTaxonomyDir: stub,
    buildNodeSourceIndex: stub, buildPolicySourceIndex: stub, readPolicyRegistry: stub,
    readAggregatedCruxes: stub, readLineageCategories: stub, readLineageEnrichments: stub,
    loadSyntheticCorpus: stub, loadSyntheticEmbeddings: stub, updateSyntheticEmbeddings: stub,
    getDataRootPath: (): string => '/tmp', loadDataConfig: (): { taxonomy_dir: string } => ({ taxonomy_dir: 'x' }),
  };
});

vi.mock('../../server/storage/editMeta.js', () => ({ stampNodeAuthorship: (_old: unknown, next: unknown) => next }));
vi.mock('../embeddings.js', () => ({ computeEmbeddings: vi.fn(), computeQueryEmbedding: vi.fn() }));

// Imported AFTER the mocks so taxonomyHandlers binds the mocked deps.
import { registerTaxonomyHandlers } from '../ipc/taxonomyHandlers.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import type { BdiInterpretation, SituationNode } from '../../../../lib/debate/taxonomyTypes.js';

function saveTaxonomyFile(pov: string, data: unknown): unknown {
  const fn = h.handlers.get('save-taxonomy-file');
  if (!fn) throw new Error('save-taxonomy-file not registered');
  return fn({ sender: {} }, pov, data);
}

const fullBdi = (tag: string): BdiInterpretation => ({ belief: `${tag} belief`, desire: `${tag} desire`, intention: `${tag} intention`, summary: `${tag} summary` });

function makeNode(id: string, overrides: Partial<SituationNode> = {}): SituationNode {
  return {
    id, label: id, description: '', linked_nodes: [], conflict_ids: [],
    interpretations: { accelerationist: fullBdi('a'), safetyist: fullBdi('s'), skeptic: fullBdi('k') },
    ...overrides,
  };
}

beforeEach(() => {
  h.handlers.clear();
  h.writeArg = undefined;
  h.readReturn = undefined;
  h.readThrows = null;
  registerTaxonomyHandlers();
});

describe('save-taxonomy-file: situations BDI gate (t/3891)', () => {
  it('a changed flat-string interpretation is refused, and nothing is written', () => {
    h.readReturn = { nodes: [makeNode('sit-001')] }; // baseline: complete BDI
    const edited = makeNode('sit-001', { interpretations: { accelerationist: 'flat prose' as unknown as BdiInterpretation, safetyist: fullBdi('s'), skeptic: fullBdi('k') } });
    expect(() => saveTaxonomyFile('situations', { nodes: [edited] })).toThrow(ActionableError);
    expect(h.writeArg).toBeUndefined();
  });

  it('a changed empty B/D/I is refused', () => {
    h.readReturn = { nodes: [makeNode('sit-001')] };
    const empty: BdiInterpretation = { belief: '', desire: '', intention: '', summary: '' };
    const edited = makeNode('sit-001', { interpretations: { accelerationist: empty, safetyist: fullBdi('s'), skeptic: fullBdi('k') } });
    expect(() => saveTaxonomyFile('situations', { nodes: [edited] })).toThrow(ActionableError);
    expect(h.writeArg).toBeUndefined();
  });

  it('a complete BDI change is written', () => {
    h.readReturn = { nodes: [makeNode('sit-001', { interpretations: { accelerationist: fullBdi('old'), safetyist: fullBdi('s'), skeptic: fullBdi('k') } })] };
    const edited = makeNode('sit-001', { interpretations: { accelerationist: fullBdi('new'), safetyist: fullBdi('s'), skeptic: fullBdi('k') } });
    saveTaxonomyFile('situations', { nodes: [edited] });
    expect(h.writeArg).toEqual({ nodes: [edited] });
  });

  it('an untouched deprecated flat node alongside a valid change is written (changed-only scoping)', () => {
    const deprecatedFlat = makeNode('sit-154', {
      description: '[DEPRECATED] superseded',
      interpretations: { accelerationist: 'legacy prose' as unknown as BdiInterpretation, safetyist: 'legacy prose' as unknown as BdiInterpretation, skeptic: 'legacy prose' as unknown as BdiInterpretation },
    });
    h.readReturn = { nodes: [deprecatedFlat, makeNode('sit-002', { interpretations: { accelerationist: fullBdi('old'), safetyist: fullBdi('s'), skeptic: fullBdi('k') } })] };
    const editedSit002 = makeNode('sit-002', { interpretations: { accelerationist: fullBdi('new'), safetyist: fullBdi('s'), skeptic: fullBdi('k') } });
    // sit-154 passed through unchanged — it was never touched, so it must not block the save
    // even though it's flat (and even though it's exempt anyway via [DEPRECATED]).
    saveTaxonomyFile('situations', { nodes: [deprecatedFlat, editedSit002] });
    expect(h.writeArg).toEqual({ nodes: [deprecatedFlat, editedSit002] });
  });

  it('a non-deprecated untouched flat node also does not block an unrelated change (changed-only, not just the [DEPRECATED] exemption)', () => {
    const untouchedFlat = makeNode('sit-999', {
      interpretations: { accelerationist: 'flat but untouched' as unknown as BdiInterpretation, safetyist: fullBdi('s'), skeptic: fullBdi('k') },
    });
    h.readReturn = { nodes: [untouchedFlat, makeNode('sit-002', { interpretations: { accelerationist: fullBdi('old'), safetyist: fullBdi('s'), skeptic: fullBdi('k') } })] };
    const editedSit002 = makeNode('sit-002', { interpretations: { accelerationist: fullBdi('new'), safetyist: fullBdi('s'), skeptic: fullBdi('k') } });
    saveTaxonomyFile('situations', { nodes: [untouchedFlat, editedSit002] });
    expect(h.writeArg).toEqual({ nodes: [untouchedFlat, editedSit002] });
  });

  it('a missing baseline (ENOENT — first write) validates every node and lets a compliant save through', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    h.readThrows = enoent;
    const node = makeNode('sit-001');
    saveTaxonomyFile('situations', { nodes: [node] });
    expect(h.writeArg).toEqual({ nodes: [node] });
  });

  it('a missing baseline (ENOENT) still refuses a non-compliant node — "no baseline" means "new", not "exempt"', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    h.readThrows = enoent;
    const flat = makeNode('sit-001', { interpretations: { accelerationist: 'flat' as unknown as BdiInterpretation, safetyist: fullBdi('s'), skeptic: fullBdi('k') } });
    expect(() => saveTaxonomyFile('situations', { nodes: [flat] })).toThrow(ActionableError);
    expect(h.writeArg).toBeUndefined();
  });

  it('an unreadable baseline (non-ENOENT read failure) fails closed — refuses the save and writes nothing, even for an otherwise-compliant payload', () => {
    h.readThrows = new Error('EACCES: permission denied');
    const node = makeNode('sit-001'); // fully compliant
    expect(() => saveTaxonomyFile('situations', { nodes: [node] })).toThrow(ActionableError);
    expect(h.writeArg).toBeUndefined();
  });

  it('the refusal error names the node id and the POV', () => {
    h.readReturn = { nodes: [makeNode('sit-001')] };
    const edited = makeNode('sit-001', { label: 'My Situation', interpretations: { accelerationist: 'flat' as unknown as BdiInterpretation, safetyist: fullBdi('s'), skeptic: fullBdi('k') } });
    expect(() => saveTaxonomyFile('situations', { nodes: [edited] })).toThrow(/sit-001/);
    try {
      saveTaxonomyFile('situations', { nodes: [edited] });
    } catch (err) {
      expect(String(err)).toMatch(/accelerationist/);
    }
  });

  it('does not run the BDI gate for non-situations POVs', () => {
    // A flat-looking interpretations shape on another pov's nodes is not a situations concept
    // at all — the gate must not fire (and must not even attempt to read 'situations').
    saveTaxonomyFile('accelerationist', { nodes: [{ id: 'acc-001' }] });
    expect(h.writeArg).toEqual({ nodes: [{ id: 'acc-001' }] });
  });
});
