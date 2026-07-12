// @vitest-environment node
//
// t/1541 — pure append/remove semantics for crux external_evidence. The routes in
// server.ts (which boots the HTTP server on import, so can't be imported here) own
// the I/O and delegate the mutation to these helpers.

import { describe, it, expect } from 'vitest';
import { appendCruxEvidence, removeCruxEvidence, type CruxEvidenceEntry } from '../cruxEvidence.js';

const entry = (over: Partial<CruxEvidenceEntry> = {}): CruxEvidenceEntry =>
  ({ url: 'https://example.org/a', added_by: 'reviewer-1', added_at: '2026-07-12', ...over });

function doc() {
  return {
    cruxes: [
      { id: 'crux-001', statement: 'A', external_evidence: [entry({ url: 'https://seed/0' })] },
      { id: 'crux-002', statement: 'B' }, // no external_evidence array yet
    ],
  };
}

describe('appendCruxEvidence (t/1541)', () => {
  it('appends to an existing array without touching prior entries (append-only)', () => {
    const d = doc();
    const crux = appendCruxEvidence(d, 'crux-001', entry({ url: 'https://new/1' }));
    expect(crux?.external_evidence?.map(e => e.url)).toEqual(['https://seed/0', 'https://new/1']);
    // in-place mutation is visible on the document
    expect(d.cruxes[0].external_evidence).toHaveLength(2);
  });

  it('lazily creates the array on a crux that has no external_evidence yet', () => {
    const d = doc();
    const crux = appendCruxEvidence(d, 'crux-002', entry());
    expect(crux?.external_evidence).toHaveLength(1);
    expect(crux?.external_evidence?.[0].added_at).toBe('2026-07-12');
  });

  it('returns null for an unknown crux id (and does not mutate)', () => {
    const d = doc();
    expect(appendCruxEvidence(d, 'crux-999', entry())).toBeNull();
    expect(d.cruxes[0].external_evidence).toHaveLength(1);
  });

  it('returns null when the document has no cruxes array', () => {
    expect(appendCruxEvidence({}, 'crux-001', entry())).toBeNull();
    expect(appendCruxEvidence(null, 'crux-001', entry())).toBeNull();
  });
});

describe('removeCruxEvidence (t/1541)', () => {
  it('removes the entry at the given index', () => {
    const d = doc();
    appendCruxEvidence(d, 'crux-001', entry({ url: 'https://new/1' }));
    const crux = removeCruxEvidence(d, 'crux-001', 0);
    expect(crux).not.toBe('not_found');
    expect(crux).not.toBe('out_of_range');
    expect((crux as { external_evidence?: CruxEvidenceEntry[] }).external_evidence?.map(e => e.url)).toEqual(['https://new/1']);
  });

  it("returns 'not_found' for an unknown crux id", () => {
    expect(removeCruxEvidence(doc(), 'crux-999', 0)).toBe('not_found');
  });

  it("returns 'out_of_range' for a bad or missing index", () => {
    const d = doc();
    expect(removeCruxEvidence(d, 'crux-001', 5)).toBe('out_of_range');   // past the end
    expect(removeCruxEvidence(d, 'crux-001', -1)).toBe('out_of_range');  // negative
    expect(removeCruxEvidence(d, 'crux-001', 1.5)).toBe('out_of_range'); // non-integer
    expect(removeCruxEvidence(d, 'crux-002', 0)).toBe('out_of_range');   // no array at all
    expect(d.cruxes[0].external_evidence).toHaveLength(1);               // unchanged
  });
});
