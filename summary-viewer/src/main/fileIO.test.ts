// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';

// fileIO.ts imports `electron` (app) for platform data-dir resolution. Those
// lookups are lazy (never reached at import), but stub electron so the module
// loads deterministically under vitest's node environment.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

import { POV_PREFIX_MAP, CATEGORY_PREFIX_MAP, NODE_ID_PATTERN } from './fileIO.js';

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
