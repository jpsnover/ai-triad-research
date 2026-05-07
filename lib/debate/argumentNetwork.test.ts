// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { processExtractedClaims, normalizeExtractedClaim } from './argumentNetwork.js';

describe('BDI composite scoring', () => {
  const baseInput = {
    statement: 'AI governance should prioritize safety mechanisms with clear tradeoff acknowledgment',
    speaker: 'sentinel',
    entryId: 'entry-1',
    taxonomyRefIds: [],
    turnNumber: 1,
    existingNodes: [],
    existingEdgeCount: 0,
    startNodeId: 1,
  };
  const baseOptions = {
    groundingOverlapThreshold: 0.1,
    isClassifyPath: false,
  };

  it('composes Desire sub-scores into base_strength', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with clear tradeoff acknowledgment and precedent',
        bdi_category: 'desire',
        base_strength: 'grounded',
        bdi_sub_scores: { values_grounding: 'yes', tradeoff_acknowledgment: 'partial', precedent_citation: 'no' },
      }],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    expect(node.scoring_method).toBe('bdi_composite');
    // yes=1.0, partial=0.5, no=0.0 → mean = 0.5
    expect(node.base_strength).toBeCloseTo(0.5, 5);
  });

  it('composes Intention sub-scores into base_strength', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with specific scope and failure modes',
        bdi_category: 'intention',
        base_strength: 'grounded',
        bdi_sub_scores: { mechanism_specificity: 'yes', scope_bounding: 'yes', failure_mode_addressing: 'partial' },
      }],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    expect(node.scoring_method).toBe('bdi_composite');
    // yes=1.0, yes=1.0, partial=0.5 → mean ≈ 0.833
    expect(node.base_strength).toBeCloseTo(5 / 6, 4);
  });

  it('does not compose Belief sub-scores (unreliable r≈0.20)', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with strong evidence quality',
        bdi_category: 'belief',
        base_strength: 'grounded',
        bdi_sub_scores: { evidence_quality: 'yes', source_reliability: 'yes', falsifiability: 'yes' },
      }],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    // Should NOT be bdi_composite — Beliefs keep generic scoring
    expect(node.scoring_method).not.toBe('bdi_composite');
  });

  it('falls back to generic scoring when sub-scores are absent', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with clear value tradeoffs acknowledged',
        bdi_category: 'desire',
        base_strength: 'grounded',
      }],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    expect(node.scoring_method).toBe('ai_rubric');
  });
});

describe('normalizeExtractedClaim — BDI sub-scores', () => {
  it('converts discrete ternary strings to numeric scores', () => {
    const claim = normalizeExtractedClaim({
      text: 'test claim',
      bdi_sub_scores: { values_grounding: 'yes', tradeoff_acknowledgment: 'partial', precedent_citation: 'no' },
    });
    expect(claim.bdi_sub_scores).toEqual({
      values_grounding: 1.0,
      tradeoff_acknowledgment: 0.5,
      precedent_citation: 0.0,
    });
  });
});
