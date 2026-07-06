// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { computeQualityScore } from '../qualityScore.js';
import type { CalibrationDataPoint } from '../calibrationLogger.js';

function makeDP(overrides: Partial<CalibrationDataPoint>): CalibrationDataPoint {
  return {
    schema_version: 1,
    debate_id: 'test',
    timestamp: '2026-07-01T00:00:00Z',
    origin: 'local',
    model: 'test',
    rounds: 3,
    crux_addressed_ratio: null,
    taxonomy_mapped_ratio: null,
    situation_crux_alignment: null,
    avg_branch_cohesion: null,
    topic_alignment_rate: null,
    repetition_rate: 0,
    claims_forgotten_rate: null,
    draft_repair_rate: null,
    ...overrides,
  } as CalibrationDataPoint;
}

describe('computeQualityScore', () => {
  it('returns perfect score for ideal metrics', () => {
    const dp = makeDP({
      crux_addressed_ratio: 1.0,
      taxonomy_mapped_ratio: 1.0,
      situation_crux_alignment: 1.0,
      avg_branch_cohesion: 1.0,
      topic_alignment_rate: 1.0,
      repetition_rate: 0,
      claims_forgotten_rate: 0,
      draft_repair_rate: 0,
    });
    const result = computeQualityScore(dp);
    expect(result.score).toBe(100);
    expect(result.tier).toBe('Excellent');
  });

  it('returns zero score for worst metrics', () => {
    const dp = makeDP({
      crux_addressed_ratio: 0,
      taxonomy_mapped_ratio: 0,
      situation_crux_alignment: 0,
      avg_branch_cohesion: 0,
      topic_alignment_rate: 0,
      repetition_rate: 1,
      claims_forgotten_rate: 1,
      draft_repair_rate: 1,
    });
    const result = computeQualityScore(dp);
    expect(result.score).toBe(0);
    expect(result.tier).toBe('Poor');
  });

  it('handles null metrics gracefully (defaults to 0)', () => {
    const dp = makeDP({});
    const result = computeQualityScore(dp);
    // Only inverted metrics contribute when all are null/0:
    // (1-0)*10 + (1-0)*10 + (1-0)*5 = 25
    expect(result.score).toBe(25);
    expect(result.tier).toBe('Poor');
  });

  it('assigns correct tiers at boundaries', () => {
    // Fair: 40
    const fair = makeDP({
      crux_addressed_ratio: 0.5,
      taxonomy_mapped_ratio: 0.5,
      topic_alignment_rate: 0.5,
    });
    const fairResult = computeQualityScore(fair);
    expect(fairResult.tier).toBe('Fair');

    // Good: 60-74
    const good = makeDP({
      crux_addressed_ratio: 0.5,
      taxonomy_mapped_ratio: 0.6,
      situation_crux_alignment: 0.3,
      avg_branch_cohesion: 0.5,
      topic_alignment_rate: 0.6,
    });
    const goodResult = computeQualityScore(good);
    expect(goodResult.score).toBeGreaterThanOrEqual(60);
    expect(goodResult.score).toBeLessThan(75);
    expect(goodResult.tier).toBe('Good');
  });

  it('populates all dimension fields', () => {
    const dp = makeDP({
      crux_addressed_ratio: 0.5,
      taxonomy_mapped_ratio: 0.9,
      situation_crux_alignment: 0.3,
      avg_branch_cohesion: 0.7,
      topic_alignment_rate: 0.95,
      repetition_rate: 0.02,
      claims_forgotten_rate: 0.15,
      draft_repair_rate: 0.1,
    });
    const result = computeQualityScore(dp);

    expect(result.dimensions.ArgumentDepth).toBe(0.5);
    expect(result.dimensions.ClaimCoverage).toBe(0.9);
    expect(result.dimensions.RebuttalEffectiveness).toBe(0.3);
    expect(result.dimensions.POVBalance).toBe(0.7);
    expect(result.dimensions.TopicAlignment).toBe(0.95);
    expect(result.dimensions.RepetitionResistance).toBe(0.98);
    expect(result.dimensions.ClaimRetention).toBe(0.85);
    expect(result.dimensions.RhetoricalQuality).toBe(0.9);
  });

  it('matches PS formula: weights sum to 100', () => {
    // Each dimension at 1.0 → weight contributes weight points
    // 20 + 15 + 15 + 10 + 15 + 10 + 10 + 5 = 100
    const dp = makeDP({
      crux_addressed_ratio: 1.0,
      taxonomy_mapped_ratio: 1.0,
      situation_crux_alignment: 1.0,
      avg_branch_cohesion: 1.0,
      topic_alignment_rate: 1.0,
      repetition_rate: 0,
      claims_forgotten_rate: 0,
      draft_repair_rate: 0,
    });
    expect(computeQualityScore(dp).score).toBe(100);
  });
});
