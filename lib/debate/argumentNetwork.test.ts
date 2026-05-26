// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { processExtractedClaims, normalizeExtractedClaim, beliefVerificationToStrength } from './argumentNetwork.js';
import type { BeliefVerification } from './argumentNetwork.js';

describe('BDI composite scoring', () => {
  const baseInput = {
    statement: 'AI governance should prioritize safety mechanisms with clear tradeoff acknowledgment',
    speaker: 'safetyist',
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

  it('applies specificity proxy for Belief claims (t/455 Stage 1)', () => {
    const cases = [
      { specificity: 'precise', expected: 0.70 },
      { specificity: 'general', expected: 0.50 },
      { specificity: 'abstract', expected: 0.35 },
    ];
    for (const { specificity, expected } of cases) {
      const result = processExtractedClaims({
        ...baseInput,
        claims: [{
          text: `AI governance claim with ${specificity} specificity for belief scoring test`,
          bdi_category: 'belief',
          base_strength: 'reasoned',
          specificity,
          bdi_sub_scores: { evidence_quality: 'partial', source_reliability: 'partial', falsifiability: 'partial' },
        }],
      }, baseOptions);
      expect(result.newNodes).toHaveLength(1);
      const node = result.newNodes[0];
      expect(node.scoring_method).toBe('belief_specificity');
      expect(node.base_strength).toBe(expected);
    }
  });

  it('uses ThinkPRM verification chain for Belief claims (t/455 Stage 3)', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms backed by clear empirical evidence',
        bdi_category: 'belief',
        base_strength: 'grounded',
        specificity: 'precise',
        belief_verification: {
          evidence_cited: 'MIT 2025 audit on AI safety mechanisms',
          source_located: 'found',
          evidence_supports: 'strongly',
          counter_evidence: 'none',
        },
      }],
    }, baseOptions);
    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    // Verification chain takes priority over specificity proxy
    expect(node.base_strength).toBeGreaterThan(0.7);
  });

  it('ThinkPRM verification penalizes contradicted claims', () => {
    // Provide an existing node and responds_to so the low-strength claim isn't
    // rejected by the anti-filibustering filter (which drops claims < 0.25
    // strength that lack crux connections or novel schemes).
    const existingNode = {
      id: 'AN-0', text: 'Rapid deployment creates accountability gaps', speaker: 'accelerationist',
      source_entry_id: 'entry-0', taxonomy_refs: [], turn_number: 0, base_strength: 0.5,
    };
    const result = processExtractedClaims({
      ...baseInput,
      existingNodes: [existingNode] as any[],
      claims: [{
        text: 'AI governance safety mechanisms have clear tradeoff acknowledgment with no downsides',
        bdi_category: 'belief',
        base_strength: 'grounded',
        specificity: 'general',
        belief_verification: {
          evidence_cited: 'claims broad data support',
          source_located: 'not_found',
          evidence_supports: 'weakly',
          counter_evidence: 'significant',
        },
        responds_to: [{
          prior_claim_id: 'AN-0',
          relationship: 'attacks',
          attack_type: 'rebut',
          scheme: 'EMPIRICAL CHALLENGE',
          weight: 0.7,
        }],
      }],
    }, baseOptions);
    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    // Low location + weak support + significant counter → low strength
    expect(node.base_strength).toBeLessThan(0.3);
  });

  it('falls back to generic scoring for Beliefs without specificity', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'AI governance claim without specificity for belief fallback test',
        bdi_category: 'belief',
        base_strength: 'grounded',
        bdi_sub_scores: { evidence_quality: 'yes', source_reliability: 'yes', falsifiability: 'yes' },
      }],
    }, baseOptions);
    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    // No specificity → no proxy, keeps generic scoring
    expect(node.scoring_method).not.toBe('belief_specificity');
  });

  it('guards against NaN sub-scores in Desire composite', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with NaN guard test for desire claims',
        bdi_category: 'desire',
        base_strength: 'grounded',
        bdi_sub_scores: { values_grounding: NaN, tradeoff_acknowledgment: 0.8, precedent_citation: 0.6 },
      }],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    expect(node.scoring_method).toBe('bdi_composite');
    // NaN → 0.5 fallback, (0.5 + 0.8 + 0.6) / 3 ≈ 0.633
    expect(node.base_strength).toBeCloseTo((0.5 + 0.8 + 0.6) / 3, 4);
    expect(Number.isFinite(node.base_strength)).toBe(true);
  });

  it('guards against NaN sub-scores in Intention composite', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with NaN guard test for intention claims',
        bdi_category: 'intention',
        base_strength: 'grounded',
        bdi_sub_scores: { mechanism_specificity: NaN, scope_bounding: NaN, failure_mode_addressing: NaN },
      }],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    expect(node.scoring_method).toBe('bdi_composite');
    // All NaN → all 0.5 fallback → mean = 0.5
    expect(node.base_strength).toBeCloseTo(0.5, 5);
    expect(Number.isFinite(node.base_strength)).toBe(true);
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
    expect(node.scoring_method).toBe('bdi_criteria');
    // Desire with no sub-scores: base_strength should be neutral 0.5, not 0.8 (grounded)
    expect(node.base_strength).toBeCloseTo(0.5, 5);
  });
});

describe('beliefVerificationToStrength (t/455 Stage 3)', () => {
  it('strong evidence → high strength', () => {
    const s = beliefVerificationToStrength({
      evidence_cited: 'MIT 2025 audit',
      source_located: 'found',
      evidence_supports: 'strongly',
      counter_evidence: 'none',
    });
    expect(s).toBeGreaterThanOrEqual(0.85);
    expect(s).toBeLessThanOrEqual(0.95);
  });

  it('no source cited → low strength', () => {
    const s = beliefVerificationToStrength({
      evidence_cited: 'none',
      source_located: 'no_source',
      evidence_supports: 'weakly',
      counter_evidence: 'none',
    });
    expect(s).toBeLessThan(0.35);
  });

  it('significant counter-evidence reduces strength', () => {
    const strong = beliefVerificationToStrength({
      evidence_cited: 'source A',
      source_located: 'found',
      evidence_supports: 'strongly',
      counter_evidence: 'none',
    });
    const countered = beliefVerificationToStrength({
      evidence_cited: 'source A',
      source_located: 'found',
      evidence_supports: 'strongly',
      counter_evidence: 'significant',
    });
    expect(countered).toBeLessThan(strong);
    expect(strong - countered).toBeCloseTo(0.30, 1);
  });

  it('clamps output to [0.1, 0.95]', () => {
    const worst: BeliefVerification = {
      evidence_cited: 'none',
      source_located: 'no_source',
      evidence_supports: 'contradicts',
      counter_evidence: 'significant',
    };
    const best: BeliefVerification = {
      evidence_cited: 'strong source',
      source_located: 'found',
      evidence_supports: 'strongly',
      counter_evidence: 'none',
    };
    expect(beliefVerificationToStrength(worst)).toBeGreaterThanOrEqual(0.1);
    expect(beliefVerificationToStrength(best)).toBeLessThanOrEqual(0.95);
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

describe('normalizeExtractedClaim — base_strength BDI scoping', () => {
  it('maps "asserted" to 0.2 for Belief claims', () => {
    const claim = normalizeExtractedClaim({
      text: 'empirical claim about AI capabilities',
      bdi_category: 'belief',
      base_strength: 'asserted',
    });
    expect(claim.base_strength).toBe(0.2);
  });

  it('maps "asserted" to neutral 0.5 for Desire claims', () => {
    const claim = normalizeExtractedClaim({
      text: 'We should prioritize safety over capability racing',
      bdi_category: 'desire',
      base_strength: 'asserted',
    });
    expect(claim.base_strength).toBe(0.5);
  });

  it('maps "asserted" to neutral 0.5 for Intention claims', () => {
    const claim = normalizeExtractedClaim({
      text: 'Implement staged deployment with safety gates',
      bdi_category: 'intention',
      base_strength: 'asserted',
    });
    expect(claim.base_strength).toBe(0.5);
  });

  it('maps "grounded" to 0.8 for Belief claims', () => {
    const claim = normalizeExtractedClaim({
      text: 'GPT-4 scores 86% on MMLU benchmark',
      bdi_category: 'belief',
      base_strength: 'grounded',
    });
    expect(claim.base_strength).toBe(0.8);
  });

  it('maps "grounded" to neutral 0.5 for Desire claims', () => {
    const claim = normalizeExtractedClaim({
      text: 'We should mandate transparency in AI systems',
      bdi_category: 'desire',
      base_strength: 'grounded',
    });
    expect(claim.base_strength).toBe(0.5);
  });

  it('passes through numeric base_strength unchanged regardless of BDI category', () => {
    const claim = normalizeExtractedClaim({
      text: 'test claim with numeric strength',
      bdi_category: 'desire',
      base_strength: 0.7,
    });
    expect(claim.base_strength).toBe(0.7);
  });
});

describe('processExtractedClaims — concession speaker guard', () => {
  // Use distinct claim texts to avoid duplicate rejection (>30% overlap with existing AN nodes)
  const concessionInput = {
    statement: 'Regulatory frameworks must balance innovation incentives against precautionary oversight obligations',
    speaker: 'safetyist',
    entryId: 'entry-2',
    taxonomyRefIds: [],
    turnNumber: 2,
    existingNodes: [
      { id: 'AN-1', text: 'Mandatory discovery rights ensure transparent auditing of deployed systems', speaker: 'safetyist', source_entry_id: 'entry-1', taxonomy_refs: [], turn_number: 1, base_strength: 0.5 },
      { id: 'AN-2', text: 'Voluntary compliance achieves better outcomes than prescriptive mandates', speaker: 'accelerationist', source_entry_id: 'entry-1', taxonomy_refs: [], turn_number: 1, base_strength: 0.5 },
    ] as any[],
    existingEdgeCount: 0,
    startNodeId: 3,
  };
  const baseOptions = { groundingOverlapThreshold: 0.1, isClassifyPath: false };

  it('does NOT add own claim to conceded when self-supporting (EXTEND)', () => {
    const result = processExtractedClaims({
      ...concessionInput,
      claims: [{
        text: 'Regulatory frameworks must balance innovation incentives against precautionary oversight obligations effectively',
        bdi_category: 'intention',
        base_strength: 0.5,
        responds_to: [{
          prior_claim_id: 'AN-1',
          relationship: 'supports',
          scheme: 'EXTEND',
          weight: 0.8,
        }],
      }],
    }, baseOptions);

    // AN-1 belongs to safetyist (same speaker) — should NOT be conceded
    expect(result.commitments.conceded).not.toContain('Mandatory discovery rights ensure transparent auditing of deployed systems');
  });

  it('DOES add opponent claim to conceded when cross-speaker support', () => {
    const result = processExtractedClaims({
      ...concessionInput,
      claims: [{
        text: 'Regulatory frameworks must balance innovation incentives while granting that voluntary compliance has merits',
        bdi_category: 'desire',
        base_strength: 0.5,
        responds_to: [{
          prior_claim_id: 'AN-2',
          relationship: 'supports',
          scheme: 'CONCEDE-AND-PIVOT',
          weight: 0.7,
        }],
      }],
    }, baseOptions);

    // AN-2 belongs to accelerationist (opponent) — SHOULD be conceded
    expect(result.commitments.conceded).toContain('Voluntary compliance achieves better outcomes than prescriptive mandates');
  });

  it('splits CONCEDE-AND-PIVOT dual edges correctly', () => {
    const result = processExtractedClaims({
      ...concessionInput,
      claims: [{
        text: 'Regulatory frameworks must balance innovation incentives while granting that voluntary compliance has merits',
        bdi_category: 'desire',
        base_strength: 0.5,
        responds_to: [
          // Support edge targeting opponent's claim (concession)
          { prior_claim_id: 'AN-2', relationship: 'supports', scheme: 'CONCEDE-AND-PIVOT', weight: 0.7 },
          // Attack edge targeting opponent's claim (challenge)
          { prior_claim_id: 'AN-2', relationship: 'attacks', attack_type: 'rebut', scheme: 'REFRAME', weight: 0.6 },
        ],
      }],
    }, baseOptions);

    // Opponent's claim conceded via support edge
    expect(result.commitments.conceded).toContain('Voluntary compliance achieves better outcomes than prescriptive mandates');
    // Also challenged via attack edge
    expect(result.commitments.challenged).toContain('Voluntary compliance achieves better outcomes than prescriptive mandates');
  });

  it('self-INTEGRATE does not add own claim to conceded', () => {
    const result = processExtractedClaims({
      ...concessionInput,
      claims: [{
        text: 'Regulatory frameworks must balance innovation incentives by integrating discovery rights with compliance flexibility',
        bdi_category: 'intention',
        base_strength: 0.5,
        responds_to: [
          // INTEGRATE own claim
          { prior_claim_id: 'AN-1', relationship: 'supports', scheme: 'INTEGRATE', weight: 0.8 },
          // INTEGRATE opponent claim
          { prior_claim_id: 'AN-2', relationship: 'supports', scheme: 'INTEGRATE', weight: 0.6 },
        ],
      }],
    }, baseOptions);

    // Own claim NOT conceded, opponent claim IS conceded
    expect(result.commitments.conceded).not.toContain('Mandatory discovery rights ensure transparent auditing of deployed systems');
    expect(result.commitments.conceded).toContain('Voluntary compliance achieves better outcomes than prescriptive mandates');
  });
});

describe('vocabulary_tags on AN nodes', () => {
  const baseInput = {
    statement: 'The alignment problem requires accountability mechanisms to address bias in safety-critical systems',
    speaker: 'safetyist',
    entryId: 'entry-1',
    taxonomyRefIds: [],
    turnNumber: 1,
    existingNodes: [],
    existingEdgeCount: 0,
    startNodeId: 1,
  };

  const colloquialTerms = [
    {
      $schema_version: '1.0.0',
      colloquial_term: 'alignment',
      status: 'do_not_use_bare' as const,
      translation_required: true,
      resolves_to: [
        { standardized_term: 'safety_alignment', when: 'safety context', default_for_camp: 'safetyist' as const, confidence_typical: 'high' as const },
        { standardized_term: 'commercial_alignment', when: 'product context', default_for_camp: 'accelerationist' as const, confidence_typical: 'high' as const },
      ],
      first_added: '2026-01-01',
      last_reviewed: '2026-01-01',
    },
    {
      $schema_version: '1.0.0',
      colloquial_term: 'accountability',
      status: 'do_not_use_bare' as const,
      translation_required: true,
      resolves_to: [
        { standardized_term: 'accountability_algorithmic', when: 'AI context', default_for_camp: 'skeptic' as const, confidence_typical: 'high' as const },
      ],
      first_added: '2026-01-01',
      last_reviewed: '2026-01-01',
    },
  ];

  it('adds vocabulary_tags when colloquialTerms provided', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'The alignment problem requires accountability mechanisms to address bias in safety-critical systems',
      }],
    }, {
      groundingOverlapThreshold: 0.1,
      isClassifyPath: false,
      colloquialTerms,
    });

    expect(result.newNodes).toHaveLength(1);
    const node = result.newNodes[0];
    expect(node.vocabulary_tags).toBeDefined();
    // 'alignment' resolves for safetyist, 'accountability' has no safetyist default (only skeptic) → single resolution fallback
    expect(node.vocabulary_tags!.some(t => t.canonical === 'safety_alignment')).toBe(true);
    expect(node.vocabulary_tags!.some(t => t.canonical === 'accountability_algorithmic')).toBe(true);
  });

  it('omits vocabulary_tags when colloquialTerms not provided', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'The alignment problem requires accountability mechanisms to address bias in safety-critical systems',
      }],
    }, {
      groundingOverlapThreshold: 0.1,
      isClassifyPath: false,
    });

    expect(result.newNodes).toHaveLength(1);
    expect(result.newNodes[0].vocabulary_tags).toBeUndefined();
  });
});
