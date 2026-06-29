// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  weightedSituationScore,
  computeDiversityComponent,
  computeBdiEntropy,
  computeMidDebateFreshness,
  computePreDebateFreshness,
  computeCruxRelevance,
  computeConflictOpenness,
  computeInterpretsBoost,
  PRE_DEBATE_WEIGHTS,
  MID_DEBATE_WEIGHTS,
} from './situationScoring.js';
import type { SituationScoreComponents } from './situationScoring.js';
import type { Category } from './taxonomyTypes.js';

// ── weightedSituationScore ─────────────────────────────────

describe('weightedSituationScore', () => {
  it('computes weighted sum correctly', () => {
    const components: SituationScoreComponents = {
      relevance: 1.0,
      diversity: 1.0,
      freshness: 1.0,
      bdi_entropy: 1.0,
      conflict_openness: 1.0,
    };
    // All weights should sum to 1.0
    expect(weightedSituationScore(components, PRE_DEBATE_WEIGHTS)).toBeCloseTo(1.0);
    expect(weightedSituationScore(components, MID_DEBATE_WEIGHTS)).toBeCloseTo(1.0);
  });

  it('returns 0 for zero components', () => {
    const zero: SituationScoreComponents = {
      relevance: 0, diversity: 0, freshness: 0, bdi_entropy: 0, conflict_openness: 0,
    };
    expect(weightedSituationScore(zero, PRE_DEBATE_WEIGHTS)).toBe(0);
  });

  it('applies weights correctly for selective components', () => {
    const onlyRelevance: SituationScoreComponents = {
      relevance: 0.8, diversity: 0, freshness: 0, bdi_entropy: 0, conflict_openness: 0,
    };
    expect(weightedSituationScore(onlyRelevance, MID_DEBATE_WEIGHTS)).toBeCloseTo(0.8 * 0.50);
  });
});

// ── computeDiversityComponent ──────────────────────────────

describe('computeDiversityComponent', () => {
  it('returns 1.0 when situation adds missing type', () => {
    const present = new Set(['definitional', 'interpretive']);
    expect(computeDiversityComponent({ disagreement_type: 'structural' }, present)).toBe(1);
  });

  it('returns 0 when type is already present', () => {
    const present = new Set(['definitional', 'interpretive']);
    expect(computeDiversityComponent({ disagreement_type: 'definitional' }, present)).toBe(0);
  });

  it('returns 0 when all 3 types present', () => {
    const present = new Set(['definitional', 'interpretive', 'structural']);
    expect(computeDiversityComponent({ disagreement_type: 'structural' }, present)).toBe(0);
  });

  it('returns 0 when situation has no disagreement_type', () => {
    const present = new Set(['definitional']);
    expect(computeDiversityComponent({ disagreement_type: undefined }, present)).toBe(0);
  });
});

// ── computeBdiEntropy ──────────────────────────────────────

describe('computeBdiEntropy', () => {
  it('returns 1.0 for perfectly even distribution', () => {
    const nodeIds = ['a', 'b', 'c'];
    const lookup = new Map<string, Category>([['a', 'Beliefs'], ['b', 'Desires'], ['c', 'Intentions']]);
    expect(computeBdiEntropy(nodeIds, lookup)).toBeCloseTo(1.0);
  });

  it('returns 0 for single-category nodes', () => {
    const nodeIds = ['a', 'b', 'c'];
    const lookup = new Map<string, Category>([['a', 'Beliefs'], ['b', 'Beliefs'], ['c', 'Beliefs']]);
    expect(computeBdiEntropy(nodeIds, lookup)).toBeCloseTo(0);
  });

  it('returns intermediate value for skewed distribution', () => {
    const nodeIds = ['a', 'b', 'c', 'd'];
    const lookup = new Map<string, Category>([
      ['a', 'Beliefs'], ['b', 'Beliefs'], ['c', 'Beliefs'], ['d', 'Desires'],
    ]);
    const entropy = computeBdiEntropy(nodeIds, lookup);
    expect(entropy).toBeGreaterThan(0);
    expect(entropy).toBeLessThan(1);
  });

  it('returns 0 for empty node list', () => {
    expect(computeBdiEntropy([], new Map())).toBe(0);
  });

  it('defaults unknown nodes to Intentions', () => {
    const nodeIds = ['a', 'b'];
    const lookup = new Map<string, Category>([['a', 'Beliefs']]);
    // b defaults to Intentions → 2 categories → entropy > 0
    expect(computeBdiEntropy(nodeIds, lookup)).toBeGreaterThan(0);
  });
});

// ── computeMidDebateFreshness ──────────────────────────────

describe('computeMidDebateFreshness', () => {
  it('returns 0 when injected but not referenced', () => {
    expect(computeMidDebateFreshness('sit-1', new Set(['sit-1']), new Set())).toBe(0);
  });

  it('returns 1 when injected and referenced', () => {
    expect(computeMidDebateFreshness('sit-1', new Set(['sit-1']), new Set(['sit-1']))).toBe(1);
  });

  it('returns 1 when never injected', () => {
    expect(computeMidDebateFreshness('sit-1', new Set(), new Set())).toBe(1);
  });
});

// ── computePreDebateFreshness ──────────────────────────────

describe('computePreDebateFreshness', () => {
  it('returns 1.0 for never-debated situation', () => {
    expect(computePreDebateFreshness({ debate_refs: [] }, 5)).toBe(1);
  });

  it('returns 0 for maximally-debated situation', () => {
    expect(computePreDebateFreshness({ debate_refs: ['a', 'b', 'c', 'd', 'e'] }, 5)).toBe(0);
  });

  it('returns intermediate value', () => {
    expect(computePreDebateFreshness({ debate_refs: ['a', 'b'] }, 4)).toBeCloseTo(0.5);
  });

  it('handles missing debate_refs', () => {
    expect(computePreDebateFreshness({}, 5)).toBe(1);
  });

  it('handles maxDebateCount of 0', () => {
    expect(computePreDebateFreshness({ debate_refs: ['a'] }, 0)).toBe(1);
  });
});

// ── computeCruxRelevance ───────────────────────────────────

describe('computeCruxRelevance', () => {
  it('returns max similarity across claims', () => {
    const sitEmb = [1, 0, 0];
    const claims = [
      { vector: [0, 1, 0] }, // orthogonal
      { vector: [1, 0, 0] }, // identical
    ];
    expect(computeCruxRelevance(sitEmb, claims)).toBeCloseTo(1.0);
  });

  it('returns 0 for empty claims', () => {
    expect(computeCruxRelevance([1, 0, 0], [])).toBe(0);
  });

  it('returns 0 for undefined embedding', () => {
    expect(computeCruxRelevance(undefined, [{ vector: [1, 0] }])).toBe(0);
  });
});

// ── computeConflictOpenness ────────────────────────────────

describe('computeConflictOpenness', () => {
  it('returns 1.0 when no conflicts are resolved', () => {
    expect(computeConflictOpenness(['c1', 'c2', 'c3'], new Set())).toBeCloseTo(1.0);
  });

  it('returns 0 when all conflicts resolved', () => {
    expect(computeConflictOpenness(['c1', 'c2'], new Set(['c1', 'c2']))).toBe(0);
  });

  it('returns fraction for partial resolution', () => {
    expect(computeConflictOpenness(['c1', 'c2', 'c3', 'c4'], new Set(['c1', 'c2']))).toBeCloseTo(0.5);
  });

  it('returns 0 for empty conflict list', () => {
    expect(computeConflictOpenness([], new Set())).toBe(0);
  });
});

// ── computeInterpretsBoost ────────────────────────────────

describe('computeInterpretsBoost', () => {
  it('returns 0 when no INTERPRETS edges target the situation', () => {
    const edges = [
      { source: 'a', target: 'sit-1', type: 'SUPPORTS' },
      { source: 'b', target: 'sit-2', type: 'INTERPRETS' },
    ];
    expect(computeInterpretsBoost('sit-1', edges)).toBe(0);
  });

  it('returns 0.1 per INTERPRETS edge targeting the situation', () => {
    const edges = [
      { source: 'a', target: 'sit-1', type: 'INTERPRETS' },
    ];
    expect(computeInterpretsBoost('sit-1', edges)).toBeCloseTo(0.1);
  });

  it('caps at 0.3 for 3+ INTERPRETS edges', () => {
    const edges = [
      { source: 'a', target: 'sit-1', type: 'INTERPRETS' },
      { source: 'b', target: 'sit-1', type: 'INTERPRETS' },
      { source: 'c', target: 'sit-1', type: 'INTERPRETS' },
      { source: 'd', target: 'sit-1', type: 'INTERPRETS' },
    ];
    expect(computeInterpretsBoost('sit-1', edges)).toBe(0.3);
  });

  it('ignores rejected INTERPRETS edges', () => {
    const edges = [
      { source: 'a', target: 'sit-1', type: 'INTERPRETS', status: 'rejected' },
      { source: 'b', target: 'sit-1', type: 'INTERPRETS', status: 'approved' },
    ];
    expect(computeInterpretsBoost('sit-1', edges)).toBeCloseTo(0.1);
  });

  it('returns 0 for empty edge list', () => {
    expect(computeInterpretsBoost('sit-1', [])).toBe(0);
  });
});

// ── Weight presets ─────────────────────────────────────────

describe('weight presets', () => {
  it('pre-debate weights sum to 1.0', () => {
    const sum = Object.values(PRE_DEBATE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it('mid-debate weights sum to 1.0', () => {
    const sum = Object.values(MID_DEBATE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });
});
