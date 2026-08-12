// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';

// fileIO.ts imports `electron` (app) for platform data-dir resolution. Those
// lookups are lazy (never reached at import), but stub electron so the module
// loads deterministically under vitest's node environment.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

import {
  POV_PREFIX_MAP, CATEGORY_PREFIX_MAP, NODE_ID_PATTERN,
  loadSummary, readSnapshot, findRawPdfPath, setActiveTaxonomyDir,
  addTaxonomyNode, updateNodeFields,
} from './fileIO.js';

// Invariant (t/1682 — closes the t/1677 drift class): the two sources of truth
// for taxonomy node IDs — POV_PREFIX_MAP (+ CATEGORY_PREFIX_MAP) and the
// NODE_ID_PATTERN validator — must never diverge. For every POV prefix, the ID
// that addTaxonomyNode constructs — `${prefix}-NNN` for situations,
// `${prefix}-${categoryPrefix}-NNN` for POV nodes — must satisfy NODE_ID_PATTERN.
// This test is red if a prefix is added or changed without a matching validator
// branch: exactly the bug that shipped in t/1677, where
// POV_PREFIX_MAP['situations'] was 'cc' against a validator that only accepts sit-.
const SAMPLE_NNN = '001';

describe('taxonomy node ID invariant: POV_PREFIX_MAP ↔ NODE_ID_PATTERN', () => {
  const povEntries = Object.entries(POV_PREFIX_MAP);

  it('has POV prefixes to check (guards against a vacuously-passing empty map)', () => {
    expect(povEntries.length).toBeGreaterThan(0);
    expect(Object.keys(CATEGORY_PREFIX_MAP).length).toBeGreaterThan(0);
  });

  for (const [pov, povPrefix] of povEntries) {
    if (pov === 'situations') {
      // Situation nodes: category is ignored; the generator builds `${prefix}-NNN`.
      it(`situations ("${povPrefix}") -> schema-valid ID`, () => {
        const id = `${povPrefix}-${SAMPLE_NNN}`;
        expect(
          NODE_ID_PATTERN.test(id),
          `situation ID "${id}" must match NODE_ID_PATTERN`,
        ).toBe(true);
      });
    } else {
      // POV nodes: the generator builds `${povPrefix}-${categoryPrefix}-NNN`.
      for (const [category, catPrefix] of Object.entries(CATEGORY_PREFIX_MAP)) {
        it(`pov "${pov}" ("${povPrefix}") + "${category}" ("${catPrefix}") -> schema-valid ID`, () => {
          const id = `${povPrefix}-${catPrefix}-${SAMPLE_NNN}`;
          expect(
            NODE_ID_PATTERN.test(id),
            `POV ID "${id}" must match NODE_ID_PATTERN`,
          ).toBe(true);
        });
      }
    }
  }
});

// Regression tests for t/2533 — path traversal guards (M8/M9/L11/L12b).
// assertSafeId throws before any fs access, so no fs mock is needed.
describe('path traversal rejection (t/2533)', () => {
  it('loadSummary rejects a traversal docId', () => {
    expect(() => loadSummary('../etc/passwd')).toThrow();
  });

  it('loadSummary rejects a docId with a path separator', () => {
    expect(() => loadSummary('a/b')).toThrow();
  });

  it('readSnapshot rejects a traversal sourceId', () => {
    expect(() => readSnapshot('../../outside')).toThrow();
  });

  it('findRawPdfPath rejects a traversal sourceId', () => {
    expect(() => findRawPdfPath('../escape')).toThrow();
  });

  it('setActiveTaxonomyDir rejects a traversal dirName before existsSync', () => {
    expect(() => setActiveTaxonomyDir('../pivot')).toThrow();
  });

  it('addTaxonomyNode rejects a traversal docId', () => {
    expect(() => addTaxonomyNode({
      pov: 'accelerationist',
      category: 'beliefs',
      label: 'Test',
      description: 'Test',
      docId: '../traversal',
    })).toThrow();
  });

  it('updateNodeFields rejects an unknown field name (L12b)', () => {
    const result = updateNodeFields('acc-beliefs-001', { evil: 'bad' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in the allowed update set/);
  });

  it('updateNodeFields accepts all allowed fields without error from allowlist', () => {
    // The function may fail later (no real taxonomy file), but not from the allowlist check.
    const result = updateNodeFields('acc-beliefs-001', { source_refs: ['doc-1'] });
    expect(result.error).not.toMatch(/not in the allowed update set/);
  });
});
