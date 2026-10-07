// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { reviewTier, sortForReview } from './povTagProposalOrder';

// t/4052 req 5, predicates from CL t/4052#2.
const p = (node_id: string, proposed: string[], crux: string | null = 'C1') => ({ node_id, proposed, crux });

describe('reviewTier (t/4052)', () => {
  it('tier 1: nothing proposed, even with no crux', () => {
    expect(reviewTier(p('skp-beliefs-001', [], null)).rank).toBe(1);
    expect(reviewTier(p('skp-desires-001', [])).rank).toBe(1);
  });

  it('tier 2: no crux but tagged', () => {
    expect(reviewTier(p('skp-beliefs-002', ['critical', 'institutional'], null)).rank).toBe(2);
  });

  it('tier 3: a Desires node whose proposal includes critical (critical-only and both)', () => {
    expect(reviewTier(p('skp-desires-003', ['critical'])).rank).toBe(3);
    expect(reviewTier(p('skp-desires-004', ['critical', 'institutional'])).rank).toBe(3);
  });

  it('tier 4: everything else, including institutional-only Desires and critical non-Desires', () => {
    expect(reviewTier(p('skp-desires-005', ['institutional'])).rank).toBe(4);
    expect(reviewTier(p('skp-beliefs-006', ['critical'])).rank).toBe(4);
  });

  it('intentions-167 (a technical-mechanism node with a crux) is NOT singled out: the proxy does not claim it', () => {
    const t = reviewTier(p('skp-intentions-167', ['institutional'], 'C3'));
    expect(t.rank).toBe(4);
    expect(t.label).not.toMatch(/mechanism/i);
  });
});

describe('sortForReview (t/4052)', () => {
  it('orders by tier, then node id numerically, without mutating the input', () => {
    const input = [
      p('skp-beliefs-010', ['critical']),
      p('skp-desires-002', ['critical']),
      p('skp-beliefs-002', ['critical'], null),
      p('skp-beliefs-9', []),
      p('skp-beliefs-10', []),
    ];
    const before = input.map(x => x.node_id);
    expect(sortForReview(input).map(x => x.node_id)).toEqual([
      'skp-beliefs-9', 'skp-beliefs-10', // tier 1, numeric id order
      'skp-beliefs-002', // tier 2
      'skp-desires-002', // tier 3
      'skp-beliefs-010', // tier 4
    ]);
    expect(input.map(x => x.node_id)).toEqual(before);
  });

  it('confidence never affects the order', () => {
    const lo = { ...p('skp-beliefs-001', ['critical']), confidence: 0.75 };
    const hi = { ...p('skp-beliefs-002', ['critical']), confidence: 0.95 };
    expect(sortForReview([hi, lo]).map(x => x.node_id)).toEqual(['skp-beliefs-001', 'skp-beliefs-002']);
  });
});
