// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ValueBasisRun } from '@lib/schema/povTagProposals';
import { compareSoulProvenance } from '@lib/debate/soulDocSchema';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

const { ValueBasisBlock, ProvenanceNote, bundledSkepticSoulProvenance } = await import('./PovTagValueBasis');

// t/4052#9 / SO e/278#2 condition 4. The snapshot below deliberately DIFFERS from the live soul docs
// (the live critical VH 1 is "Power accountability — …"), so these tests prove text comes from the snapshot.
const run: ValueBasisRun = {
  index_base: 1,
  value_hierarchies: {
    critical: ['Snapshot critical one — cited wording', 'Snapshot critical two'],
    institutional: ['Snapshot inst one'],
    shared: ['Snapshot shared one — x'],
  },
};
const label = (id: string) => ({ critical: 'Critical', institutional: 'Institutional' }[id] ?? id);
const firm = (tag: string, vh_index: number[] | null, vh_index_uncertain: number[] = []) =>
  ({ tag, vh_index, vh_index_uncertain, why: `why ${tag}`, unsupported: vh_index === null && vh_index_uncertain.length === 0 });

describe('ValueBasisBlock (t/4052#9)', () => {
  it('is labelled model-suggested and renders cited text from the snapshot, not the live soul', () => {
    render(<ValueBasisBlock p={{ proposed: ['critical'], value_basis: [firm('critical', [1])] }} run={run} tagLabel={label} />);
    expect(screen.getByText('Model-suggested justification')).toBeTruthy();
    expect(screen.getByText(/Snapshot critical one/)).toBeTruthy();
    expect(screen.queryByText(/Power accountability/)).toBeNull();
    expect(screen.getByTitle('Snapshot critical one — cited wording')).toBeTruthy();
    expect(screen.getByText('why critical')).toBeTruthy();
  });

  it('shows uncertain elements with a one-of-two-runs marker, using the same chip as firm ones', () => {
    const { container } = render(<ValueBasisBlock p={{ proposed: ['critical'], value_basis: [firm('critical', [1], [2])] }} run={run} tagLabel={label} />);
    expect(screen.getByText(/one of two runs/)).toBeTruthy();
    const chips = container.querySelectorAll('.ptvb-cite');
    expect(chips).toHaveLength(2);
    expect([...chips].every(c => c.className === 'ptvb-cite')).toBe(true); // same visual weight: no extra or greyed class
  });

  it('flags an unsupported tag prominently', () => {
    render(<ValueBasisBlock p={{ proposed: ['institutional'], value_basis: [firm('institutional', null)] }} run={run} tagLabel={label} />);
    expect(screen.getByRole('alert').textContent).toBe('No Value Hierarchy element supports this tag');
  });

  it('a both-item: shared ground line, and "Possibly misplaced" when no wing is firm and shared is unsupported', () => {
    render(<ValueBasisBlock
      p={{ proposed: ['critical', 'institutional'], value_basis: [firm('critical', null, [2]), firm('institutional', null)], value_basis_shared: { vh_index: null, vh_index_uncertain: [], why: 'why shared', unsupported: true } }}
      run={run} tagLabel={label} />);
    expect(screen.getByText('Shared ground')).toBeTruthy();
    expect(screen.getByText('Possibly misplaced in Skeptic')).toBeTruthy();
  });

  it('an untagged item shows its nearest tag and element, and when the runs disagree', () => {
    render(<ValueBasisBlock p={{ proposed: [], value_basis: [], value_basis_nearest: { tag: 'critical', vh_index: 2, why: 'near', agree: false } }} run={run} tagLabel={label} />);
    expect(screen.getByText('Nearest')).toBeTruthy();
    expect(screen.getByText(/Snapshot critical two/)).toBeTruthy();
    expect(screen.getByText('(runs disagree)')).toBeTruthy();
  });

  it('no value_basis → "No justification yet", never a fabricated one', () => {
    render(<ValueBasisBlock p={{ proposed: ['critical'] }} run={run} tagLabel={label} />);
    expect(screen.getByText('No justification yet')).toBeTruthy();
  });

  it('an index the snapshot cannot resolve shows an error state, not blank text', () => {
    render(<ValueBasisBlock p={{ proposed: ['critical'], value_basis: [firm('critical', [9])] }} run={run} tagLabel={label} />);
    expect(screen.getByRole('alert').textContent).toMatch(/VH 9: not in the cited snapshot/);
  });

  it('a self-contradictory entry renders as an error, never as both a citation and the unsupported warning', () => {
    const bad = { tag: 'critical', vh_index: [1], vh_index_uncertain: [], why: 'w', unsupported: true };
    render(<ValueBasisBlock p={{ proposed: ['critical'], value_basis: [bad] }} run={run} tagLabel={label} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Inconsistent justification/);
    expect(screen.queryByText(/No Value Hierarchy element supports/)).toBeNull();
    expect(screen.queryByText(/Snapshot critical one/)).toBeNull();
  });
});

describe('ProvenanceNote', () => {
  it('silent when same; "changed" and "cannot verify" are both visible', () => {
    const { container, rerender } = render(<ProvenanceNote state="same" />);
    expect(container.firstChild).toBeNull();
    rerender(<ProvenanceNote state="changed" />);
    expect(screen.getByRole('status').textContent).toMatch(/Soul doc changed since justification/);
    rerender(<ProvenanceNote state="unknown" />);
    expect(screen.getByRole('status').textContent).toMatch(/Cannot verify/);
  });
});

describe('bundledSkepticSoulProvenance', () => {
  it('resolves all three skeptic souls in the canonical fnv1a64 form, soul-docs-relative', () => {
    const p = bundledSkepticSoulProvenance();
    expect(p.critical?.file).toBe('skeptic.critical.soul.json');
    expect(p.institutional?.file).toBe('skeptic.institutional.soul.json');
    expect(p.shared?.file).toBe('skeptic.soul.json');
    for (const v of Object.values(p)) expect(v?.hash).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(compareSoulProvenance(p.critical, p.critical)).toBe('same');
  });
});
