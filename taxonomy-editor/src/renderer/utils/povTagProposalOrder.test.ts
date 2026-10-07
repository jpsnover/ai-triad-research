// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import type { ValueBasis, ValueBasisShared } from '@lib/schema/povTagProposals';
import { reviewTier, sortForReview } from './povTagProposalOrder';

// t/4052 req 5, tiers from CL's value_basis spec t/4052#9 (misplaced rule confirmed p/4#121).
const firm = (tag: string, i = 1): ValueBasis => ({ tag, vh_index: [i], vh_index_uncertain: [], why: 'w', unsupported: false });
const uncertainOnly = (tag: string): ValueBasis => ({ tag, vh_index: null, vh_index_uncertain: [3], why: 'w', unsupported: false });
const unsupported = (tag: string): ValueBasis => ({ tag, vh_index: null, vh_index_uncertain: [], why: 'w', unsupported: true });
const shared = (s: 'firm' | 'unsupported' | 'uncertain'): ValueBasisShared => s === 'firm'
  ? { vh_index: [1], vh_index_uncertain: [], why: 'w', unsupported: false }
  : s === 'uncertain'
    ? { vh_index: null, vh_index_uncertain: [2], why: 'w', unsupported: false }
    : { vh_index: null, vh_index_uncertain: [], why: 'w', unsupported: true };
const item = (node_id: string, proposed: string[], value_basis?: ValueBasis[], value_basis_shared?: ValueBasisShared) =>
  ({ node_id, proposed, value_basis, value_basis_shared });

describe('reviewTier (t/4052#9)', () => {
  it('tier 1: a both-item with no firm element in either wing and an unsupported shared entry', () => {
    expect(reviewTier(item('a', ['critical', 'institutional'], [unsupported('critical'), unsupported('institutional')], shared('unsupported'))).rank).toBe(1);
    // skp-beliefs-161's shape: one wing uncertain-only still has no firm element (CL p/4#121).
    expect(reviewTier(item('b', ['critical', 'institutional'], [uncertainOnly('critical'), unsupported('institutional')], shared('unsupported'))).rank).toBe(1);
  });

  it('not tier 1 when any wing is firm, or the shared entry has an element', () => {
    expect(reviewTier(item('a', ['critical', 'institutional'], [firm('critical'), unsupported('institutional')], shared('unsupported'))).rank).toBe(4);
    expect(reviewTier(item('b', ['critical', 'institutional'], [unsupported('critical'), unsupported('institutional')], shared('firm'))).rank).toBe(4);
  });

  it('tier 2: nothing proposed', () => {
    expect(reviewTier(item('a', [], [])).rank).toBe(2);
    expect(reviewTier(item('b', [])).rank).toBe(2);
  });

  it('tier 3: a single tag that no element supports', () => {
    expect(reviewTier(item('a', ['critical'], [unsupported('critical')])).rank).toBe(3);
  });

  it('tier 4: a both-item with an unsupported wing (not misplaced)', () => {
    expect(reviewTier(item('a', ['critical', 'institutional'], [firm('critical'), unsupported('institutional')], shared('firm'))).rank).toBe(4);
  });

  it('tier 5: any element cited in only one run, wing or shared', () => {
    expect(reviewTier(item('a', ['critical'], [uncertainOnly('critical')])).rank).toBe(5);
    expect(reviewTier(item('b', ['critical', 'institutional'], [firm('critical'), firm('institutional')], shared('uncertain'))).rank).toBe(5);
  });

  it('tier 6: fully firm, and items with no value_basis (never treated as unsupported)', () => {
    expect(reviewTier(item('a', ['critical'], [firm('critical')])).rank).toBe(6);
    expect(reviewTier(item('b', ['critical'])).rank).toBe(6);
  });
});

describe('sortForReview (t/4052)', () => {
  it('orders by tier, then node id numerically, without mutating the input', () => {
    const input = [
      item('skp-beliefs-010', ['critical'], [firm('critical')]),
      item('skp-beliefs-9', [], []),
      item('skp-beliefs-200', ['critical', 'institutional'], [unsupported('critical'), unsupported('institutional')], shared('unsupported')),
      item('skp-beliefs-10', [], []),
      item('skp-beliefs-003', ['critical'], [unsupported('critical')]),
    ];
    const before = input.map(x => x.node_id);
    expect(sortForReview(input).map(x => x.node_id)).toEqual([
      'skp-beliefs-200', // tier 1
      'skp-beliefs-9', 'skp-beliefs-10', // tier 2, numeric id order
      'skp-beliefs-003', // tier 3
      'skp-beliefs-010', // tier 6
    ]);
    expect(input.map(x => x.node_id)).toEqual(before);
  });

  it('confidence never affects the order', () => {
    const lo = { ...item('skp-beliefs-001', ['critical'], [firm('critical')]), confidence: 0.75 };
    const hi = { ...item('skp-beliefs-002', ['critical'], [firm('critical')]), confidence: 0.95 };
    expect(sortForReview([hi, lo]).map(x => x.node_id)).toEqual(['skp-beliefs-001', 'skp-beliefs-002']);
  });
});
