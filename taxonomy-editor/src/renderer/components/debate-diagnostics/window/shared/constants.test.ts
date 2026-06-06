// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  SUPPRESSION_REASON_TOOLTIPS,
  AIF_TOOLTIPS,
  POV_NODE_COLOR,
  DEBATER_COLORS,
  SUB_SCORE_TIPS,
  BELIEF_KEYS,
  DIMENSION_WEIGHTS,
} from './constants';

describe('DIMENSION_WEIGHTS', () => {
  it('has exactly four dimensions', () => {
    expect(Object.keys(DIMENSION_WEIGHTS)).toEqual(['schema', 'grounding', 'advancement', 'clarifies']);
  });

  it('weights sum to 1.0', () => {
    const total = Object.values(DIMENSION_WEIGHTS).reduce((sum, d) => sum + d.weight, 0);
    expect(total).toBeCloseTo(1.0);
  });

  it('schema has weight 0.4', () => {
    expect(DIMENSION_WEIGHTS.schema.weight).toBe(0.4);
  });

  it('grounding has weight 0.3', () => {
    expect(DIMENSION_WEIGHTS.grounding.weight).toBe(0.3);
  });

  it('advancement has weight 0.2', () => {
    expect(DIMENSION_WEIGHTS.advancement.weight).toBe(0.2);
  });

  it('clarifies has weight 0.1', () => {
    expect(DIMENSION_WEIGHTS.clarifies.weight).toBe(0.1);
  });

  it('all dimensions have description strings', () => {
    for (const [key, val] of Object.entries(DIMENSION_WEIGHTS)) {
      expect(val.description).toBeTruthy();
      expect(typeof val.description).toBe('string');
    }
  });
});

describe('SUPPRESSION_REASON_TOOLTIPS', () => {
  const expectedKeys = [
    'budget_exhausted',
    'cooldown_active',
    'phase_mismatch',
    'same_debater_consecutive',
    'prerequisite_override',
    'burden_cap',
    'engine_override',
  ];

  it('has all expected suppression reason keys', () => {
    for (const key of expectedKeys) {
      expect(SUPPRESSION_REASON_TOOLTIPS).toHaveProperty(key);
    }
  });

  it('all values are non-empty strings', () => {
    for (const [, val] of Object.entries(SUPPRESSION_REASON_TOOLTIPS)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });
});

describe('AIF_TOOLTIPS', () => {
  it('has all four AIF node types', () => {
    expect(AIF_TOOLTIPS).toHaveProperty('I-node');
    expect(AIF_TOOLTIPS).toHaveProperty('CA-node');
    expect(AIF_TOOLTIPS).toHaveProperty('RA-node');
    expect(AIF_TOOLTIPS).toHaveProperty('PA-node');
  });

  it('I-node tooltip mentions claim/proposition', () => {
    expect(AIF_TOOLTIPS['I-node']).toMatch(/claim|proposition/i);
  });

  it('CA-node tooltip mentions attack/conflict', () => {
    expect(AIF_TOOLTIPS['CA-node']).toMatch(/attack|conflict/i);
  });

  it('RA-node tooltip mentions inference/support', () => {
    expect(AIF_TOOLTIPS['RA-node']).toMatch(/inference|support/i);
  });

  it('PA-node tooltip mentions preference/resolve', () => {
    expect(AIF_TOOLTIPS['PA-node']).toMatch(/preference|resolve/i);
  });
});

describe('POV_NODE_COLOR', () => {
  it('maps acc- prefix to accelerationist color', () => {
    expect(POV_NODE_COLOR['acc-']).toBe('var(--color-acc)');
  });

  it('maps saf- prefix to safetyist color', () => {
    expect(POV_NODE_COLOR['saf-']).toBe('var(--color-saf)');
  });

  it('maps skp- prefix to skeptic color', () => {
    expect(POV_NODE_COLOR['skp-']).toBe('var(--color-skp)');
  });

  it('maps sit- prefix to situation color', () => {
    expect(POV_NODE_COLOR['sit-']).toBe('var(--color-sit)');
  });

  it('maps cc- prefix to situation color (cross-cutting)', () => {
    expect(POV_NODE_COLOR['cc-']).toBe('var(--color-sit)');
  });
});

describe('DEBATER_COLORS', () => {
  it('has colors for all three debaters', () => {
    expect(DEBATER_COLORS.accelerationist).toBeTruthy();
    expect(DEBATER_COLORS.safetyist).toBeTruthy();
    expect(DEBATER_COLORS.skeptic).toBeTruthy();
  });

  it('colors are valid hex values', () => {
    for (const color of Object.values(DEBATER_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('SUB_SCORE_TIPS', () => {
  const beliefKeys = ['evidence_quality', 'source_reliability', 'falsifiability'];
  const desireKeys = ['values_grounding', 'tradeoff_acknowledgment', 'precedent_citation'];
  const intentionKeys = ['mechanism_specificity', 'scope_bounding', 'failure_mode_addressing'];

  it('has tips for all 9 BDI sub-score keys', () => {
    for (const key of [...beliefKeys, ...desireKeys, ...intentionKeys]) {
      expect(SUB_SCORE_TIPS).toHaveProperty(key);
      expect(SUB_SCORE_TIPS[key].length).toBeGreaterThan(0);
    }
  });
});

describe('BELIEF_KEYS', () => {
  it('contains exactly the three belief sub-score keys', () => {
    expect(BELIEF_KEYS.size).toBe(3);
    expect(BELIEF_KEYS.has('evidence_quality')).toBe(true);
    expect(BELIEF_KEYS.has('source_reliability')).toBe(true);
    expect(BELIEF_KEYS.has('falsifiability')).toBe(true);
  });

  it('does not contain desire or intention keys', () => {
    expect(BELIEF_KEYS.has('values_grounding')).toBe(false);
    expect(BELIEF_KEYS.has('mechanism_specificity')).toBe(false);
  });
});
