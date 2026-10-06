// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { POVER_INFO, getPovDoctrinalBoundaries } from './poverInfo.js';

describe('getPovDoctrinalBoundaries (t/3966)', () => {
  it('returns non-empty result for each real soul', () => {
    for (const [key, povInfo] of Object.entries(POVER_INFO)) {
      const result = getPovDoctrinalBoundaries(povInfo);
      expect(result, `${key} should have boundaries`).not.toBeUndefined();
      expect(result!.strings.length, `${key} strings should be non-empty`).toBeGreaterThan(0);
      expect(result!.isRejection.length, `${key} isRejection length should match strings`).toBe(result!.strings.length);
    }
  });

  it('maps hardcoded + softcoded strings in order', () => {
    const acc = POVER_INFO.accelerationist;
    const result = getPovDoctrinalBoundaries(acc)!;
    const expected = [...acc.boundaries.hardcoded, ...acc.boundaries.softcoded];
    expect(result.strings).toEqual(expected);
  });

  it('isRejection is false for strings without REJECT: prefix', () => {
    const acc = POVER_INFO.accelerationist;
    const result = getPovDoctrinalBoundaries(acc)!;
    // Real soul strings have no REJECT: prefix — all should be false.
    expect(result.isRejection.every(r => r === false)).toBe(true);
  });

  it('isRejection is true for REJECT:-prefixed strings', () => {
    const fakePov = {
      ...POVER_INFO.accelerationist,
      boundaries: {
        hardcoded: ['REJECT: no human oversight', 'Normal boundary'],
        softcoded: ['reject: lowercase', 'plain'],
      },
    };
    const result = getPovDoctrinalBoundaries(fakePov as typeof POVER_INFO.accelerationist)!;
    expect(result.isRejection).toEqual([true, false, true, false]);
  });

  it('returns undefined for a soul with empty boundaries', () => {
    const emptyPov = {
      ...POVER_INFO.accelerationist,
      boundaries: { hardcoded: [], softcoded: [] },
    };
    const result = getPovDoctrinalBoundaries(emptyPov as typeof POVER_INFO.accelerationist);
    expect(result).toBeUndefined();
  });

  it('proves the bug: reading doctrinal_boundaries directly always returns undefined', () => {
    // This test documents why the accessor is needed. No soul sets this field.
    for (const [key, povInfo] of Object.entries(POVER_INFO)) {
      expect(
        (povInfo as { doctrinal_boundaries?: string[] }).doctrinal_boundaries,
        `${key}.doctrinal_boundaries should be undefined — use getPovDoctrinalBoundaries instead`,
      ).toBeUndefined();
    }
  });
});
