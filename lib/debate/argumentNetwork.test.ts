// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { processExtractedClaims, normalizeExtractedClaim, beliefVerificationToStrength, overlapToExtractionConfidence, sampleNodesForEntailment } from './argumentNetwork.js';
import type { BeliefVerification } from './argumentNetwork.js';
import type { ArgumentNetworkNode } from './types.js';

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

describe('political salience QBAF boost (t/247)', () => {
  const baseInput = {
    statement: 'The EU AI Act Section 6 mandates conformity assessments for high-risk systems deployed in healthcare',
    speaker: 'safetyist',
    entryId: 'entry-1',
    taxonomyRefIds: [],
    turnNumber: 1,
    existingNodes: [],
    existingEdgeCount: 0,
    startNodeId: 1,
  };
  const baseOptions = { groundingOverlapThreshold: 0.1, isClassifyPath: false };

  it('applies +0.10 boost for high political_salience in policymaker debates', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{ text: 'The EU AI Act Section 6 mandates conformity assessments for high-risk systems deployed in healthcare', political_salience: 'high', base_strength: 0.5 }],
      audience: 'policymakers',
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    expect(result.newNodes[0].political_salience).toBe('high');
    expect(result.newNodes[0].base_strength).toBeCloseTo(0.6);
  });

  it('does not boost medium or low salience', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{ text: 'The EU AI Act Section 6 mandates conformity assessments for high-risk systems deployed in healthcare', political_salience: 'medium', base_strength: 0.5 }],
      audience: 'policymakers',
    }, baseOptions);

    expect(result.newNodes[0].political_salience).toBe('medium');
    expect(result.newNodes[0].base_strength).toBeCloseTo(0.5);
  });

  it('does not apply salience in non-policymaker debates', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{ text: 'The EU AI Act Section 6 mandates conformity assessments for high-risk systems deployed in healthcare', political_salience: 'high', base_strength: 0.5 }],
      audience: 'technical_researchers',
    }, baseOptions);

    expect(result.newNodes[0].political_salience).toBeUndefined();
    expect(result.newNodes[0].base_strength).toBeCloseTo(0.5);
  });

  it('caps boosted base_strength at 1.0', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{ text: 'The EU AI Act Section 6 mandates conformity assessments for high-risk systems deployed in healthcare', political_salience: 'high', base_strength: 0.95 }],
      audience: 'policymakers',
    }, baseOptions);

    expect(result.newNodes[0].base_strength).toBe(1.0);
  });
});

describe('situation grounding (t/243)', () => {
  const baseInput = {
    statement: 'AI governance should prioritize safety mechanisms to address autonomous weapons deployment risks',
    speaker: 'safetyist',
    entryId: 'entry-1',
    taxonomyRefIds: ['saf-beliefs-001'],
    turnNumber: 1,
    existingNodes: [],
    existingEdgeCount: 0,
    startNodeId: 1,
  };
  const baseOptions = { groundingOverlapThreshold: 0.1, isClassifyPath: false };

  it('adds sit- refs when claim text overlaps with activated situation', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{ text: 'Autonomous weapons deployment risks require governance safety mechanisms to prevent catastrophic outcomes' }],
      activatedSituations: [
        { id: 'sit-042', text: 'Autonomous weapons deployment international governance frameworks for lethal autonomous systems' },
        { id: 'sit-099', text: 'Quantum computing post-quantum cryptography standards migration' },
      ],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    expect(result.newNodes[0].taxonomy_refs).toContain('saf-beliefs-001');
    expect(result.newNodes[0].taxonomy_refs).toContain('sit-042');
    expect(result.newNodes[0].taxonomy_refs).not.toContain('sit-099');
  });

  it('does not duplicate sit- refs already present from cite stage', () => {
    const result = processExtractedClaims({
      ...baseInput,
      taxonomyRefIds: ['saf-beliefs-001', 'sit-042'],
      claims: [{ text: 'Autonomous weapons deployment risks require governance safety mechanisms' }],
      activatedSituations: [
        { id: 'sit-042', text: 'Autonomous weapons deployment international governance frameworks' },
      ],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    const sitRefs = result.newNodes[0].taxonomy_refs.filter(r => r === 'sit-042');
    expect(sitRefs).toHaveLength(1);
  });

  it('skips grounding when no activated situations provided', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{ text: 'Autonomous weapons deployment risks require governance safety mechanisms' }],
    }, baseOptions);

    expect(result.newNodes).toHaveLength(1);
    expect(result.newNodes[0].taxonomy_refs).toEqual(['saf-beliefs-001']);
  });
});

// ── overlapToExtractionConfidence ──────────────────────────

describe('overlapToExtractionConfidence', () => {
  it('returns 1.0 for high overlap (>= 0.7)', () => {
    expect(overlapToExtractionConfidence(0.7)).toBe(1.0);
    expect(overlapToExtractionConfidence(0.9)).toBe(1.0);
  });

  it('returns 0.8 for moderate overlap (0.5–0.69)', () => {
    expect(overlapToExtractionConfidence(0.5)).toBe(0.8);
    expect(overlapToExtractionConfidence(0.65)).toBe(0.8);
  });

  it('returns 0.6 for low overlap (0.3–0.49)', () => {
    expect(overlapToExtractionConfidence(0.3)).toBe(0.6);
    expect(overlapToExtractionConfidence(0.45)).toBe(0.6);
  });

  it('returns 0.5 for very low overlap (< 0.3)', () => {
    expect(overlapToExtractionConfidence(0.1)).toBe(0.5);
    expect(overlapToExtractionConfidence(0.0)).toBe(0.5);
  });
});

// ── extraction_confidence server-side computation ──────────

describe('extraction_confidence server-side computation', () => {
  const ecBaseInput = {
    statement: 'AI governance should prioritize safety mechanisms with clear tradeoff acknowledgment',
    speaker: 'safetyist',
    entryId: 'entry-ec',
    taxonomyRefIds: [],
    turnNumber: 1,
    existingNodes: [],
    existingEdgeCount: 0,
    startNodeId: 1,
  };
  const ecOptions = { groundingOverlapThreshold: 0.1, isClassifyPath: false };

  it('computes extraction_confidence from wordOverlap, ignoring LLM value', () => {
    const result = processExtractedClaims({
      ...ecBaseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with clear tradeoff acknowledgment',
        extraction_confidence: 0.95,
      }],
    }, ecOptions);

    expect(result.newNodes).toHaveLength(1);
    expect(result.newNodes[0].extraction_confidence).toBeDefined();
    expect(result.newNodes[0].extraction_confidence).toBe(1.0);
  });

  it('computes extraction_confidence even when LLM omits the field', () => {
    const result = processExtractedClaims({
      ...ecBaseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with clear tradeoff acknowledgment',
      }],
    }, ecOptions);

    expect(result.newNodes).toHaveLength(1);
    expect(result.newNodes[0].extraction_confidence).toBeDefined();
    expect(typeof result.newNodes[0].extraction_confidence).toBe('number');
  });

  it('uses server-side value even when LLM provides a very different extraction_confidence', () => {
    const result = processExtractedClaims({
      ...ecBaseInput,
      claims: [{
        text: 'AI governance should prioritize safety mechanisms with clear tradeoff acknowledgment',
        extraction_confidence: 0.3,
      }],
    }, ecOptions);

    expect(result.newNodes).toHaveLength(1);
    expect(result.newNodes[0].extraction_confidence).toBe(1.0);
  });

  it('assigns lower confidence for loosely overlapping claims', () => {
    const result = processExtractedClaims({
      ...ecBaseInput,
      claims: [{
        text: 'Governance safety mechanisms tradeoff acknowledgment policy debate considerations',
      }],
    }, ecOptions);

    expect(result.newNodes).toHaveLength(1);
    const conf = result.newNodes[0].extraction_confidence!;
    expect(conf).toBeLessThanOrEqual(0.8);
    expect(conf).toBeGreaterThanOrEqual(0.5);
  });
});

// ── sampleNodesForEntailment ───────────────────────────

describe('sampleNodesForEntailment', () => {
  function makeNode(bdi_category: string): ArgumentNetworkNode {
    return {
      id: `AN-${Math.random().toString(36).slice(2, 6)}`,
      text: 'test claim',
      speaker: 'safetyist',
      source_entry_id: 'entry-1',
      taxonomy_refs: [],
      turn_number: 1,
      bdi_category: bdi_category as ArgumentNetworkNode['bdi_category'],
    } as ArgumentNetworkNode;
  }

  it('samples Intentions at 50% rate', () => {
    const nodes = Array.from({ length: 100 }, () => makeNode('intention'));
    const rngAlwaysLow = () => 0.49;
    expect(sampleNodesForEntailment(nodes, rngAlwaysLow)).toHaveLength(100);
    const rngAbove = () => 0.51;
    expect(sampleNodesForEntailment(nodes, rngAbove)).toHaveLength(0);
  });

  it('samples Beliefs at 30% rate', () => {
    const nodes = Array.from({ length: 100 }, () => makeNode('belief'));
    const rngBelow = () => 0.29;
    expect(sampleNodesForEntailment(nodes, rngBelow)).toHaveLength(100);
    const rngAbove = () => 0.31;
    expect(sampleNodesForEntailment(nodes, rngAbove)).toHaveLength(0);
  });

  it('samples Desires at 15% rate', () => {
    const nodes = Array.from({ length: 100 }, () => makeNode('desire'));
    const rngBelow = () => 0.14;
    expect(sampleNodesForEntailment(nodes, rngBelow)).toHaveLength(100);
    const rngAbove = () => 0.16;
    expect(sampleNodesForEntailment(nodes, rngAbove)).toHaveLength(0);
  });

  it('uses 30% default rate for unknown BDI category', () => {
    const nodes = Array.from({ length: 100 }, () => makeNode(''));
    const rngBelow = () => 0.29;
    expect(sampleNodesForEntailment(nodes, rngBelow)).toHaveLength(100);
    const rngAbove = () => 0.31;
    expect(sampleNodesForEntailment(nodes, rngAbove)).toHaveLength(0);
  });

  it('produces mixed results with varying rng', () => {
    let callCount = 0;
    const alternating = () => (callCount++ % 2 === 0 ? 0.0 : 1.0);
    const nodes = Array.from({ length: 10 }, () => makeNode('belief'));
    const sampled = sampleNodesForEntailment(nodes, alternating);
    expect(sampled).toHaveLength(5);
  });
});

describe('normalizeExtractedClaim — edge strength persistence', () => {
  it('preserves canonical categorical strength alongside numeric weight', () => {
    const claim = normalizeExtractedClaim({
      text: 'test claim',
      responds_to: [{ prior_claim_id: 'AN-1', relationship: 'supports', strength: 'decisive' }],
    });
    expect(claim.responds_to![0].weight).toBe(1.0);
    expect(claim.responds_to![0].strength).toBe('decisive');
  });

  it('preserves strength for all three categories', () => {
    for (const [category, expectedWeight] of [['decisive', 1.0], ['substantial', 0.7], ['tangential', 0.3]] as const) {
      const claim = normalizeExtractedClaim({
        text: 'test',
        responds_to: [{ prior_claim_id: 'AN-1', relationship: 'attacks', strength: category }],
      });
      expect(claim.responds_to![0].weight).toBe(expectedWeight);
      expect(claim.responds_to![0].strength).toBe(category);
    }
  });

  it('normalizes case before persisting strength', () => {
    const claim = normalizeExtractedClaim({
      text: 'test',
      responds_to: [{ prior_claim_id: 'AN-1', relationship: 'supports', strength: 'Decisive' }],
    });
    expect(claim.responds_to![0].strength).toBe('decisive');
  });

  it('does not persist strength for non-canonical values', () => {
    const claim = normalizeExtractedClaim({
      text: 'test',
      responds_to: [{ prior_claim_id: 'AN-1', relationship: 'supports', strength: 'strong', weight: 0.65 }],
    });
    expect(claim.responds_to![0].weight).toBe(0.65);
    expect(claim.responds_to![0].strength).toBe('strong');
  });

  it('passes through numeric weight without adding strength', () => {
    const claim = normalizeExtractedClaim({
      text: 'test',
      responds_to: [{ prior_claim_id: 'AN-1', relationship: 'supports', weight: 0.8 }],
    });
    expect(claim.responds_to![0].weight).toBe(0.8);
    expect(claim.responds_to![0].strength).toBeUndefined();
  });
});

describe('processExtractedClaims — edge strength carry-through', () => {
  const baseInput = {
    statement: 'Multilateral governance structures can enforce compliance standards across jurisdictions for frontier model deployment',
    speaker: 'safetyist' as const,
    entryId: 'entry-2',
    turnNumber: 2,
    existingNodes: [{
      id: 'AN-0', text: 'Rapid deployment creates accountability gaps in frontier model development', speaker: 'accelerationist',
      source_entry_id: 'entry-0', taxonomy_refs: [], turn_number: 1, base_strength: 0.5,
    }] as ArgumentNetworkNode[],
    existingEdgeCount: 0,
    startNodeId: 1,
    taxonomyRefIds: [],
  };
  const baseOptions = { groundingOverlapThreshold: 0.1, isClassifyPath: false };

  it('carries validated strength through to persisted edge', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'Multilateral governance structures enforce compliance standards across jurisdictions through coordinated regulatory oversight mechanisms and treaties',
        responds_to: [{ prior_claim_id: 'AN-0', relationship: 'attacks', attack_type: 'rebut', strength: 'decisive' }],
      }],
    }, baseOptions);

    expect(result.newEdges).toHaveLength(1);
    expect(result.newEdges[0].weight).toBe(1.0);
    expect(result.newEdges[0].strength).toBe('decisive');
  });

  it('leaves strength undefined when only numeric weight is provided', () => {
    const result = processExtractedClaims({
      ...baseInput,
      claims: [{
        text: 'Multilateral governance structures enforce compliance standards across jurisdictions through coordinated regulatory enforcement mechanisms',
        responds_to: [{ prior_claim_id: 'AN-0', relationship: 'supports', weight: 0.65 }],
      }],
    }, baseOptions);

    expect(result.newEdges).toHaveLength(1);
    expect(result.newEdges[0].weight).toBe(0.65);
    expect(result.newEdges[0].strength).toBeUndefined();
  });
});
