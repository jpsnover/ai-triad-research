// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../embeddings/similarity.js';

/**
 * Degenerate-embedding tests for cosineSimilarity — guards the claim that
 * computeInterpretationDivergence.ts's null-guard (incomplete cached embeddings)
 * is the correct defence, and that cosineSimilarity itself never produces NaN
 * for valid-typed (non-undefined) degenerate inputs. (t/2277)
 */
describe('cosineSimilarity degenerate inputs', () => {
  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for length-mismatched vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for zero-magnitude vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it('never returns NaN for any valid-typed degenerate input', () => {
    const cases: [number[], number[]][] = [
      [[], []],
      [[0], [0]],
      [[0, 0, 0], [1, 2, 3]],
      [[1, 2], [1, 2, 3]],
    ];
    for (const [a, b] of cases) {
      expect(Number.isNaN(cosineSimilarity(a, b))).toBe(false);
    }
  });

  it('returns 1 for identical unit vectors', () => {
    const v = [0.5, 0.3, 0.8];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });
});
