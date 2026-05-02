// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  computeExtractionConfidence,
  computeStabilityConfidence,
  computeGlobalConfidence,
  isConfidenceDeferred,
  DEFAULT_CONFIDENCE_FLOOR,
} from './signalConfidence';

// ── DEFAULT_CONFIDENCE_FLOOR ─────────────────────────────────

describe('DEFAULT_CONFIDENCE_FLOOR', () => {
  it('is a positive number less than 1', () => {
    expect(DEFAULT_CONFIDENCE_FLOOR).toBeGreaterThan(0);
    expect(DEFAULT_CONFIDENCE_FLOOR).toBeLessThan(1);
  });

  it('has the expected value', () => {
    expect(DEFAULT_CONFIDENCE_FLOOR).toBe(0.40);
  });
});

// ── computeExtractionConfidence ──────────────────────────────

describe('computeExtractionConfidence', () => {
  it('returns maximum confidence for ok status with high claims and perfect validity', () => {
    const result = computeExtractionConfidence('ok', 10, 1.0);
    expect(result).toBe(1.0);
  });

  it('returns 0 for parse_error status with zero claims and zero validity', () => {
    const result = computeExtractionConfidence('parse_error', 0, 0);
    expect(result).toBe(0);
  });

  it('returns 0 for unknown status string', () => {
    const result = computeExtractionConfidence('unknown_status', 0, 0);
    expect(result).toBe(0);
  });

  it('returns 0.5 status score for truncated', () => {
    // 0.5 * 0.5 + 0.3 * min(1, 2/2) + 0.2 * 1.0 = 0.25 + 0.3 + 0.2 = 0.75
    const result = computeExtractionConfidence('truncated', 2, 1.0);
    expect(result).toBeCloseTo(0.75, 5);
  });

  it('clamps claims component at 1 (claimsAccepted / 2)', () => {
    // 0.5 * 1.0 + 0.3 * min(1, 10/2) + 0.2 * 1.0 = 0.5 + 0.3 + 0.2 = 1.0
    const result = computeExtractionConfidence('ok', 10, 1.0);
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('handles 1 claim accepted', () => {
    // 0.5 * 1.0 + 0.3 * min(1, 1/2) + 0.2 * 1.0 = 0.5 + 0.15 + 0.2 = 0.85
    const result = computeExtractionConfidence('ok', 1, 1.0);
    expect(result).toBeCloseTo(0.85, 5);
  });

  it('handles 0 claims accepted with ok status', () => {
    // 0.5 * 1.0 + 0.3 * 0 + 0.2 * 1.0 = 0.5 + 0 + 0.2 = 0.7
    const result = computeExtractionConfidence('ok', 0, 1.0);
    expect(result).toBeCloseTo(0.7, 5);
  });

  it('handles partial validity ratio', () => {
    // 0.5 * 1.0 + 0.3 * min(1, 2/2) + 0.2 * 0.5 = 0.5 + 0.3 + 0.1 = 0.9
    const result = computeExtractionConfidence('ok', 2, 0.5);
    expect(result).toBeCloseTo(0.9, 5);
  });

  it('returns value in [0, 1] for all status types', () => {
    for (const status of ['ok', 'truncated', 'parse_error', 'garbage', '']) {
      for (const claims of [0, 1, 5]) {
        for (const ratio of [0, 0.5, 1]) {
          const result = computeExtractionConfidence(status, claims, ratio);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// ── computeStabilityConfidence ���──────────────────────────────

describe('computeStabilityConfidence', () => {
  it('returns 1.0 when movingAvg3 is null (no history)', () => {
    expect(computeStabilityConfidence(0.5, null, 5)).toBe(1.0);
  });

  it('returns 1.0 when roundsInPhase < 3 (cold start)', () => {
    expect(computeStabilityConfidence(0.5, 0.3, 2)).toBe(1.0);
    expect(computeStabilityConfidence(0.5, 0.3, 1)).toBe(1.0);
    expect(computeStabilityConfidence(0.5, 0.3, 0)).toBe(1.0);
  });

  it('returns 1.0 when currentValue equals movingAvg3', () => {
    expect(computeStabilityConfidence(0.5, 0.5, 5)).toBe(1.0);
  });

  it('returns lower confidence for large deviations from moving average', () => {
    // deviation = |0.8 - 0.5| / 0.3 = 1.0 → 1.0 - 1.0 = 0.0
    expect(computeStabilityConfidence(0.8, 0.5, 5)).toBeCloseTo(0.0, 5);
  });

  it('returns moderate confidence for moderate deviations', () => {
    // deviation = |0.65 - 0.5| / 0.3 = 0.5 → 1.0 - 0.5 = 0.5
    expect(computeStabilityConfidence(0.65, 0.5, 5)).toBeCloseTo(0.5, 5);
  });

  it('clamps deviation at 1 for very large deviations', () => {
    // deviation = |1.0 - 0.0| / 0.3 = 3.33 → clamped at 1.0 → 1.0 - 1.0 = 0.0
    expect(computeStabilityConfidence(1.0, 0.0, 5)).toBeCloseTo(0.0, 5);
  });

  it('handles negative deviation (currentValue < movingAvg3)', () => {
    // deviation = |0.2 - 0.5| / 0.3 = 1.0 → 1.0 - 1.0 = 0.0
    expect(computeStabilityConfidence(0.2, 0.5, 5)).toBeCloseTo(0.0, 5);
  });

  it('returns value in [0, 1] for various inputs', () => {
    for (const current of [0, 0.3, 0.5, 0.7, 1.0]) {
      for (const avg of [0, 0.3, 0.5, 0.7, 1.0]) {
        for (const rounds of [0, 2, 3, 10]) {
          const result = computeStabilityConfidence(current, avg, rounds);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// ── computeGlobalConfidence ──────────────────────────────────

describe('computeGlobalConfidence', () => {
  it('returns the minimum of extraction and stability confidence', () => {
    expect(computeGlobalConfidence(0.8, 0.6)).toBe(0.6);
    expect(computeGlobalConfidence(0.3, 0.9)).toBe(0.3);
    expect(computeGlobalConfidence(0.5, 0.5)).toBe(0.5);
  });

  it('returns 0 when either input is 0', () => {
    expect(computeGlobalConfidence(0, 0.9)).toBe(0);
    expect(computeGlobalConfidence(0.9, 0)).toBe(0);
  });

  it('returns 1 when both inputs are 1', () => {
    expect(computeGlobalConfidence(1, 1)).toBe(1);
  });
});

// ── isConfidenceDeferred ─────────────────────────────────────

describe('isConfidenceDeferred', () => {
  it('returns true when confidence is below default floor', () => {
    expect(isConfidenceDeferred(0.0)).toBe(true);
    expect(isConfidenceDeferred(0.1)).toBe(true);
    expect(isConfidenceDeferred(0.39)).toBe(true);
  });

  it('returns false when confidence equals the floor', () => {
    expect(isConfidenceDeferred(DEFAULT_CONFIDENCE_FLOOR)).toBe(false);
  });

  it('returns false when confidence is above the floor', () => {
    expect(isConfidenceDeferred(0.5)).toBe(false);
    expect(isConfidenceDeferred(1.0)).toBe(false);
  });

  it('uses custom floor when provided', () => {
    expect(isConfidenceDeferred(0.5, 0.6)).toBe(true);  // below custom floor
    expect(isConfidenceDeferred(0.7, 0.6)).toBe(false); // above custom floor
    expect(isConfidenceDeferred(0.6, 0.6)).toBe(false); // at custom floor
  });

  it('cold start scenario: low round count leads to deferred', () => {
    // Simulate cold start: extraction is weak, stability is fine (cold start returns 1.0)
    const extractionConf = computeExtractionConfidence('parse_error', 0, 0); // = 0
    const stabilityConf = computeStabilityConfidence(0.5, null, 1); // = 1.0 (cold start)
    const globalConf = computeGlobalConfidence(extractionConf, stabilityConf); // = 0
    expect(isConfidenceDeferred(globalConf)).toBe(true);
  });

  it('sufficient data scenario: good extraction and stable signal pass confidence gate', () => {
    const extractionConf = computeExtractionConfidence('ok', 3, 1.0); // = 1.0
    const stabilityConf = computeStabilityConfidence(0.5, 0.5, 5); // = 1.0 (no deviation)
    const globalConf = computeGlobalConfidence(extractionConf, stabilityConf); // = 1.0
    expect(isConfidenceDeferred(globalConf)).toBe(false);
  });

  it('edge case: zero nodes and zero edges lead to deferred extraction', () => {
    const extractionConf = computeExtractionConfidence('ok', 0, 0);
    // 0.5 * 1.0 + 0.3 * 0 + 0.2 * 0 = 0.5
    expect(extractionConf).toBeCloseTo(0.5, 5);
    const globalConf = computeGlobalConfidence(extractionConf, 1.0);
    // 0.5 >= 0.40 → not deferred
    expect(isConfidenceDeferred(globalConf)).toBe(false);
  });

  it('edge case: parse error with zero claims is always deferred', () => {
    const extractionConf = computeExtractionConfidence('parse_error', 0, 0);
    expect(extractionConf).toBe(0);
    const globalConf = computeGlobalConfidence(extractionConf, 1.0);
    expect(isConfidenceDeferred(globalConf)).toBe(true);
  });
});
