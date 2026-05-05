// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { prefixClaimForTaxonomyComparison } from './coverageTracker.js';

describe('prefixClaimForTaxonomyComparison', () => {
  it('prefixes with capitalized BDI category', () => {
    expect(prefixClaimForTaxonomyComparison('AI will be safe', 'belief'))
      .toBe('Belief claim: AI will be safe');
  });

  it('normalizes case of category', () => {
    expect(prefixClaimForTaxonomyComparison('We should regulate', 'DESIRE'))
      .toBe('Desire claim: We should regulate');
    expect(prefixClaimForTaxonomyComparison('Build safety tests', 'Intention'))
      .toBe('Intention claim: Build safety tests');
  });

  it('returns original text when no category', () => {
    expect(prefixClaimForTaxonomyComparison('Some claim', undefined))
      .toBe('Some claim');
  });

  it('returns original text when category is empty string', () => {
    expect(prefixClaimForTaxonomyComparison('Some claim', ''))
      .toBe('Some claim');
  });

  it('handles document type categories', () => {
    expect(prefixClaimForTaxonomyComparison('AI risk is overstated', 'empirical'))
      .toBe('Empirical claim: AI risk is overstated');
    expect(prefixClaimForTaxonomyComparison('We ought to pause', 'normative'))
      .toBe('Normative claim: We ought to pause');
  });
});
