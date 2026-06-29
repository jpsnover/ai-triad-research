// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeSchemeStagnation,
  schemeBigramDiversity,
  computeSchemeStagnationCombined,
  computeSchemeCoverageFactor,
  computeCampInsularityRate,
  isInsularityCritical,
  DEFAULT_INSULARITY_THRESHOLD,
  MIN_CITATIONS_FOR_INSULARITY,
} from './schemeStagnation.js';

describe('computeSchemeStagnation (unigram)', () => {
  it('returns 0 when all schemes are used recently', () => {
    expect(computeSchemeStagnation(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
  });

  it('returns 1 when no recent schemes', () => {
    expect(computeSchemeStagnation([], ['a', 'b'])).toBe(1.0);
  });

  it('returns 0 when all schemes are empty', () => {
    expect(computeSchemeStagnation([], [])).toBe(0);
  });

  it('returns 0.5 when half the schemes are recent', () => {
    expect(computeSchemeStagnation(['a', 'b'], ['a', 'b', 'c', 'd'])).toBe(0.5);
  });
});

describe('schemeBigramDiversity', () => {
  it('returns 1.0 for empty input', () => {
    expect(schemeBigramDiversity([])).toBe(1.0);
  });

  it('returns 1.0 for single-scheme turns (no pairs)', () => {
    expect(schemeBigramDiversity([['a'], ['b'], ['c']])).toBe(1.0);
  });

  it('returns 1.0 when all bigrams are unique', () => {
    const result = schemeBigramDiversity([
      ['evidence', 'expert'],
      ['consequences', 'risk'],
    ]);
    // 2 unique bigrams, 2 total → 1.0
    expect(result).toBe(1.0);
  });

  it('detects repetitive bigram patterns', () => {
    const result = schemeBigramDiversity([
      ['evidence', 'expert'],
      ['consequences', 'risk'],
      ['evidence', 'expert'],  // repeat
      ['consequences', 'risk'],  // repeat
    ]);
    // 2 unique bigrams, 4 total → 0.5
    expect(result).toBe(0.5);
  });

  it('handles turns with 3+ schemes (multiple pairs)', () => {
    const result = schemeBigramDiversity([
      ['a', 'b', 'c'],  // pairs: a→b, a→c, b→c
    ]);
    // 3 unique bigrams, 3 total → 1.0
    expect(result).toBe(1.0);
  });

  it('deduplicates schemes within a turn', () => {
    const result = schemeBigramDiversity([
      ['a', 'a', 'b'],  // unique: a, b → 1 pair
    ]);
    // 1 bigram, but less than 2 total → 1.0 (insufficient data)
    expect(result).toBe(1.0);
  });
});

describe('computeSchemeStagnationCombined', () => {
  it('blends unigram and bigram stagnation 40/60', () => {
    // Unigram: all recent, stagnation = 0
    // Bigram: all unique, diversity = 1.0, stagnation = 0
    const result = computeSchemeStagnationCombined(
      ['a', 'b'], ['a', 'b'],
      [['a', 'b']],
    );
    expect(result).toBeCloseTo(0, 2);
  });

  it('detects combinatorial stagnation even with good unigram diversity', () => {
    // Unigram: 4 unique out of 4 = stagnation 0
    // Bigram: same 2 pairs repeated = diversity 0.5, stagnation 0.5
    const result = computeSchemeStagnationCombined(
      ['evidence', 'expert', 'consequences', 'risk'],
      ['evidence', 'expert', 'consequences', 'risk'],
      [
        ['evidence', 'expert'],
        ['consequences', 'risk'],
        ['evidence', 'expert'],
        ['consequences', 'risk'],
      ],
    );
    // 0.4 * 0 + 0.6 * 0.5 = 0.3
    expect(result).toBeCloseTo(0.3, 2);
  });
});

describe('computeSchemeCoverageFactor', () => {
  it('returns 1.0 when 6+ unique schemes used', () => {
    expect(computeSchemeCoverageFactor(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(1.0);
  });

  it('returns fraction for fewer schemes', () => {
    expect(computeSchemeCoverageFactor(['a', 'b', 'c'])).toBeCloseTo(0.5, 2);
  });
});

// ── Camp insularity ────────────────────────────────────

describe('computeCampInsularityRate', () => {
  it('returns 0 for empty node list', () => {
    expect(computeCampInsularityRate([], 'accelerationist')).toBe(0);
  });

  it('returns 1.0 when all citations are own-camp', () => {
    const nodes = ['acc-B-001', 'acc-D-002', 'acc-I-003'];
    expect(computeCampInsularityRate(nodes, 'accelerationist')).toBe(1.0);
  });

  it('returns 0 when all citations are cross-camp', () => {
    const nodes = ['saf-B-001', 'skp-D-002'];
    expect(computeCampInsularityRate(nodes, 'accelerationist')).toBe(0);
  });

  it('returns correct ratio for mixed citations', () => {
    const nodes = ['acc-B-001', 'acc-D-002', 'saf-B-001', 'skp-I-001'];
    expect(computeCampInsularityRate(nodes, 'accelerationist')).toBe(0.5);
  });

  it('excludes cross-cutting and situation nodes from the ratio', () => {
    const nodes = ['acc-B-001', 'acc-D-002', 'sit-001', 'cc-040'];
    // Only 2 camp-specific nodes, both own-camp
    expect(computeCampInsularityRate(nodes, 'accelerationist')).toBe(1.0);
  });

  it('returns 0 when only cross-cutting nodes present', () => {
    const nodes = ['sit-001', 'sit-002', 'cc-040'];
    expect(computeCampInsularityRate(nodes, 'safetyist')).toBe(0);
  });

  it('handles safetyist speaker correctly', () => {
    const nodes = ['saf-B-001', 'saf-D-002', 'acc-B-001'];
    expect(computeCampInsularityRate(nodes, 'safetyist')).toBeCloseTo(2 / 3, 5);
  });

  it('handles skeptic speaker correctly', () => {
    const nodes = ['skp-I-001', 'acc-B-001', 'saf-B-001', 'skp-D-002'];
    expect(computeCampInsularityRate(nodes, 'skeptic')).toBe(0.5);
  });
});

describe('isInsularityCritical', () => {
  it('returns false when below citation minimum', () => {
    expect(isInsularityCritical(1.0, MIN_CITATIONS_FOR_INSULARITY - 1)).toBe(false);
  });

  it('returns false when rate is at threshold', () => {
    expect(isInsularityCritical(DEFAULT_INSULARITY_THRESHOLD, MIN_CITATIONS_FOR_INSULARITY)).toBe(false);
  });

  it('returns true when rate exceeds threshold with enough citations', () => {
    expect(isInsularityCritical(0.80, MIN_CITATIONS_FOR_INSULARITY)).toBe(true);
  });

  it('respects custom threshold', () => {
    expect(isInsularityCritical(0.60, MIN_CITATIONS_FOR_INSULARITY, 0.5)).toBe(true);
    expect(isInsularityCritical(0.40, MIN_CITATIONS_FOR_INSULARITY, 0.5)).toBe(false);
  });
});
