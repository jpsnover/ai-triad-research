// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import type { ValueBasisRun } from '@lib/schema/povTagProposals';
import { buildSoulProvenance } from '@lib/debate/soulDocSchema';
import { vhTitle, resolveCitation, isContradictory, provenanceState, SHARED_KEY } from './povTagValueBasis';

// t/4052#9 / SO e/278#2 condition 4.
const run: ValueBasisRun = {
  index_base: 1,
  value_hierarchies: { critical: ['Snapshot one — detail one', 'Snapshot two'], [SHARED_KEY]: ['Shared one — d'] },
};

describe('vhTitle', () => {
  it('is the text before the first " — ", or the whole text', () => {
    expect(vhTitle('Power accountability — who controls the compute — more')).toBe('Power accountability');
    expect(vhTitle('No dash here')).toBe('No dash here');
  });
});

describe('resolveCitation (1-based, snapshot only)', () => {
  it('resolves 1-based indices from the snapshot', () => {
    expect(resolveCitation(run, 'critical', 1)).toEqual({ ok: true, index: 1, title: 'Snapshot one', text: 'Snapshot one — detail one' });
    expect(resolveCitation(run, 'critical', 2)).toMatchObject({ ok: true, title: 'Snapshot two' });
    expect(resolveCitation(run, SHARED_KEY, 1)).toMatchObject({ ok: true, title: 'Shared one' });
  });

  it('an index the snapshot cannot resolve is an error, never blank or a neighbour (off-by-one guard)', () => {
    expect(resolveCitation(run, 'critical', 0)).toEqual({ ok: false, index: 0 });
    expect(resolveCitation(run, 'critical', 3)).toEqual({ ok: false, index: 3 });
    expect(resolveCitation(run, 'institutional', 1)).toEqual({ ok: false, index: 1 });
    expect(resolveCitation(undefined, 'critical', 1)).toEqual({ ok: false, index: 1 });
  });
});

describe('isContradictory', () => {
  it('flags unsupported-with-elements and supported-with-none; accepts the consistent cases', () => {
    expect(isContradictory({ vh_index: [1], vh_index_uncertain: [], unsupported: true })).toBe(true);
    expect(isContradictory({ vh_index: null, vh_index_uncertain: [], unsupported: false })).toBe(true);
    expect(isContradictory({ vh_index: null, vh_index_uncertain: [], unsupported: true })).toBe(false);
    expect(isContradictory({ vh_index: null, vh_index_uncertain: [2], unsupported: false })).toBe(false);
  });
});

describe('provenanceState (canonical comparator, SO e/278#5/#7)', () => {
  const a = buildSoulProvenance('skeptic.critical.soul.json', 'A');
  const b = buildSoulProvenance('skeptic.soul.json', 'B');
  it('same when every recorded soul matches the bundled one', () => {
    expect(provenanceState({ critical: a, [SHARED_KEY]: b }, { critical: a, [SHARED_KEY]: b })).toBe('same');
  });
  it('changed when any soul differs, even if another is unknown', () => {
    const edited = buildSoulProvenance('skeptic.critical.soul.json', 'A edited');
    expect(provenanceState({ critical: a, [SHARED_KEY]: b }, { critical: edited, [SHARED_KEY]: undefined })).toBe('changed');
  });
  it('unknown (cannot verify) when a side is missing or not comparable, never "same"', () => {
    expect(provenanceState(undefined, { critical: a })).toBe('unknown');
    expect(provenanceState({ critical: a }, { critical: a, [SHARED_KEY]: b })).toBe('unknown');
    expect(provenanceState({ critical: a }, { critical: undefined })).toBe('unknown');
    // A full 64-hex SHA-256 is not the comparable 16-hex form (e/278#6), so it must not pass as a match.
    expect(provenanceState({ critical: { file: a.file, hash: `sha256:${'0'.repeat(64)}` } }, { critical: a })).toBe('unknown');
  });
});
