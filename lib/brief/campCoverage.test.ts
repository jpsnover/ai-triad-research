// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2883 — unit tests for the shared camp-coverage helpers used by BOTH the
// narrate completeness gate and the verify presence arm (they must not drift).

import { describe, it, expect } from 'vitest';
import type { DeckSpec } from './types.js';
import { expectedCamps, campOfTrace, campsCovered, missingCamps } from './campCoverage.js';

function makeSpec(): DeckSpec {
  return {
    deck_spec_version: '1.0',
    meta: { id: 's', run_id: 'r', title: 'T', model: 'm', protocol: 'structured', phase: 'closed' },
    question: { core_proposition: 'Q?' },
    framing_critique: { rating: 'fair', composite: 1 },
    agreements: [{ text: 'agree' }],
    disagreements: [],
    cruxes: [],
    resolution_analysis: { stronger_camp_findings: [] },
    unresolved_questions: [],
    argument_map: { nodes: [], relations: [] },
    fact_checks: [],
    concessions: [],
    top_claims: [
      { camp: 'skeptic', claim: 'skp claim', strength: 0.6 },
      { camp: 'accelerationist', claim: 'acc claim', strength: 0.8 },
    ],
    convergence: [],
    open_threads: [],
  } as unknown as DeckSpec;
}

describe('expectedCamps', () => {
  it('returns the sorted unique top_claims camps', () => {
    expect(expectedCamps(makeSpec())).toEqual(['accelerationist', 'skeptic']);
  });
});

describe('campOfTrace', () => {
  const spec = makeSpec();
  it('reads the camp of a camp-bearing node', () => {
    expect(campOfTrace(spec, '/top_claims/1')).toBe('accelerationist');
  });
  it('returns null for a camp-less section', () => {
    expect(campOfTrace(spec, '/agreements/0')).toBeNull();
  });
  it('returns null for an unresolvable trace', () => {
    expect(campOfTrace(spec, '/nope/9')).toBeNull();
  });
});

describe('campsCovered / missingCamps', () => {
  const spec = makeSpec();
  it('covers only the camps whose nodes are traced', () => {
    expect([...campsCovered(spec, ['/top_claims/1'])]).toEqual(['accelerationist']);
  });
  it('flags the uncovered expected camp', () => {
    expect(missingCamps(spec, ['/top_claims/1', '/agreements/0'])).toEqual(['skeptic']);
  });
  it('reports no missing camps when all are traced', () => {
    expect(missingCamps(spec, ['/top_claims/0', '/top_claims/1'])).toEqual([]);
  });
});
