// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2800 — Extract stage unit tests. Approved design: t/2800#2.
// All tests use deterministic fixtures — no model calls.

import { describe, it, expect } from 'vitest';
import { extractDeckSpec, validateDeckSpec } from './extract.js';
import type { DeckSpec } from './types.js';

// ── Minimal valid closed session fixture ──────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sess-001',
    run_id: 'run-001',
    title: 'Should AI safety be legally mandated?',
    debate_model: 'claude-sonnet-5',
    protocol_id: 'structured',
    phase: 'closed',
    topic: {
      final: 'AI safety requirements should be legally mandated',
      scope: {
        key_tensions: ['innovation vs. safety'],
        explicit_qualifiers: ['for frontier models only'],
        excluded_scenarios: ['research prototypes'],
        time_horizon: '2026-2030',
      },
      critique: {
        rating: 'fair',
        composite_score: 12,
        reframing_suggestion: 'Should frontier AI training require certified safety audits?',
      },
    },
    transcript: [
      {
        type: 'concluding',
        metadata: {
          synthesis: {
            areas_of_agreement: [
              { point: 'AI risks are real', povers: ['acc', 'saf'] },
            ],
            areas_of_disagreement: [
              { point: 'Mandatory thresholds are harmful', bdi_layer: 'belief', resolvability: 'empirically_testable' },
            ],
            unresolved_questions: ['What metrics define sufficient safety?'],
            cruxes: [
              { question: 'Will mandates stifle innovation?', type: 'EMPIRICAL', if_yes: 'Acc wins', if_no: 'Saf wins', resolution_status: 'active' },
            ],
            preferences: [
              { conflict: 'speed vs. safety', prevails: 'saf', criterion: 'public harm', rationale: 'irreversible harms outweigh delay costs', what_would_change_this: 'proof mandates cut investment >30%' },
            ],
            argument_map: [
              {
                claim_id: 'a1',
                claim: 'Regulation reduces innovation',
                claimant: 'acc',
                supported_by: ['a2'],
                attacked_by: [{ claim_id: 'a3' }],
              },
            ],
          },
        },
      },
    ],
    argument_network: {
      nodes: [
        {
          id: 'a1',
          text: 'Regulation reduces innovation',
          speaker: 'acc',
          scoring_method: 'bdi_criteria',
          computed_strength: 0.72,
        },
        {
          id: 'fc1',
          text: 'Frontier models doubled in 12 months',
          speaker: 'system',
          scoring_method: 'fact_check',
          verification_status: 'supported',
          verification_evidence: 'Source: Epoch AI compute tracker 2025',
        },
        {
          id: 'fc2',
          text: 'Mandates slow deployment by >6 months',
          speaker: 'acc',
          scoring_method: 'fact_check',
          verification_status: 'disputed',
          verification_evidence: 'No peer-reviewed evidence found',
        },
      ],
    },
    commitments: {
      acc: { asserted: ['c1', 'c2'], conceded: ['c3'], challenged: ['c4', 'c5'] },
      saf: { asserted: ['c6'], conceded: [], challenged: ['c7'] },
    },
    convergence_tracker: {
      issues: [
        { taxonomy_ref: 'ai-safety-mandate', convergence: 0.4, qbaf_strength: 0.45 },
        { taxonomy_ref: null, convergence: 0.6 },
      ],
    },
    crux_tracker: [
      { id: 'cx1', description: 'Will mandates stifle innovation?', state: 'engaged', identified_turn: 2, history: [], attacking_claim_ids: [], speakers_involved: ['acc', 'saf'], last_computed_strength: 0.5, support_polarity: 0 },
      { id: 'cx2', description: 'Is AGI near?', state: 'resolved', identified_turn: 1, history: [], attacking_claim_ids: [], speakers_involved: ['acc'], last_computed_strength: 0.3, support_polarity: 0 },
    ],
    ...overrides,
  };
}

// ── Guard: phase must be 'closed' ─────────────────────────────────────────────

describe('extractDeckSpec phase guard', () => {
  it('throws ActionableError when phase is not closed', () => {
    const session = makeSession({ phase: 'open' });
    expect(() => extractDeckSpec(session as never)).toThrow("must be 'closed'");
  });

  it('throws ActionableError when no concluding transcript entry', () => {
    const session = makeSession({ transcript: [] });
    expect(() => extractDeckSpec(session as never)).toThrow('No concluding transcript entry');
  });
});

// ── Happy path: version + meta ────────────────────────────────────────────────

describe('extractDeckSpec meta', () => {
  it('emits deck_spec_version 1.0', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.deck_spec_version).toBe('1.0');
  });

  it('meta fields from session', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.meta.id).toBe('sess-001');
    expect(spec.meta.run_id).toBe('run-001');
    expect(spec.meta.title).toBe('Should AI safety be legally mandated?');
    expect(spec.meta.model).toBe('claude-sonnet-5');
    expect(spec.meta.protocol).toBe('structured');
    expect(spec.meta.phase).toBe('closed');
  });

  it('falls back to id when run_id absent', () => {
    const session = makeSession();
    delete (session as Record<string, unknown>)['run_id'];
    const spec = extractDeckSpec(session as never);
    expect(spec.meta.run_id).toBe('sess-001');
  });
});

// ── question ──────────────────────────────────────────────────────────────────

describe('extractDeckSpec question', () => {
  it('maps topic.final to core_proposition', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.question.core_proposition).toBe('AI safety requirements should be legally mandated');
  });

  it('maps scope sub-fields', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.question.tensions).toEqual(['innovation vs. safety']);
    expect(spec.question.qualifiers).toEqual(['for frontier models only']);
    expect(spec.question.exclusions).toEqual(['research prototypes']);
    expect(spec.question.time_horizon).toBe('2026-2030');
  });

  it('omits empty scope arrays', () => {
    const session = makeSession();
    (session['topic'] as Record<string, unknown>)['scope'] = { key_tensions: [] };
    const spec = extractDeckSpec(session as never);
    expect(spec.question.tensions).toBeUndefined();
  });
});

// ── framing_critique ──────────────────────────────────────────────────────────

describe('extractDeckSpec framing_critique', () => {
  it('maps rating, composite_score → composite, reframing_suggestion → rewritten_motion', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.framing_critique.rating).toBe('fair');
    expect(spec.framing_critique.composite).toBe(12);
    expect(spec.framing_critique.rewritten_motion).toBe('Should frontier AI training require certified safety audits?');
  });

  it('returns unavailable defaults when critique absent', () => {
    const session = makeSession();
    (session['topic'] as Record<string, unknown>)['critique'] = undefined;
    const spec = extractDeckSpec(session as never);
    expect(spec.framing_critique.rating).toBe('unavailable');
    expect(spec.framing_critique.composite).toBe(0);
  });
});

// ── agreements / disagreements ────────────────────────────────────────────────

describe('extractDeckSpec agreements', () => {
  it('maps areas_of_agreement to TextNode[]', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.agreements).toHaveLength(1);
    expect(spec.agreements[0].text).toBe('AI risks are real');
  });
});

describe('extractDeckSpec disagreements', () => {
  it('bdi_layer=belief → EMPIRICAL', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.disagreements[0].kind).toBe('EMPIRICAL');
  });

  it('resolvability maps to resolution_path (underscores → spaces)', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.disagreements[0].resolution_path).toBe('empirically testable');
  });
});

// ── cruxes ────────────────────────────────────────────────────────────────────

describe('extractDeckSpec cruxes', () => {
  it('maps question/type/if_yes/if_no', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.cruxes).toHaveLength(1);
    expect(spec.cruxes[0].text).toBe('Will mandates stifle innovation?');
    expect(spec.cruxes[0].kind).toBe('EMPIRICAL');
    expect(spec.cruxes[0].if_yes).toBe('Acc wins');
    expect(spec.cruxes[0].if_no).toBe('Saf wins');
  });

  it('non-EMPIRICAL type → VALUES', () => {
    const session = makeSession();
    const cruxes = (((session['transcript'] as unknown[])[0] as Record<string, unknown>)['metadata'] as Record<string, unknown>)['synthesis'] as Record<string, unknown>;
    (cruxes['cruxes'] as unknown[])[0] = { ...((cruxes['cruxes'] as unknown[])[0] as Record<string, unknown>), type: 'DEFINITIONAL' };
    const spec = extractDeckSpec(session as never);
    expect(spec.cruxes[0].kind).toBe('VALUES');
  });
});

// ── resolution_analysis ───────────────────────────────────────────────────────

describe('extractDeckSpec resolution_analysis', () => {
  it('maps preferences to stronger_camp_findings and would_change_if', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.resolution_analysis.stronger_camp_findings).toHaveLength(1);
    expect(spec.resolution_analysis.stronger_camp_findings[0].camp).toBe('saf');
    expect(spec.resolution_analysis.would_change_if).toHaveLength(1);
    expect(spec.resolution_analysis.would_change_if![0].falsifier).toBe('proof mandates cut investment >30%');
  });

  it('omits would_change_if when no falsifiers', () => {
    const session = makeSession();
    const synth = (((session['transcript'] as unknown[])[0] as Record<string, unknown>)['metadata'] as Record<string, unknown>)['synthesis'] as Record<string, unknown>;
    synth['preferences'] = [{ conflict: 'x', prevails: 'acc', criterion: 'speed', rationale: 'r' }];
    const spec = extractDeckSpec(session as never);
    expect(spec.resolution_analysis.would_change_if).toBeUndefined();
  });
});

// ── fact_checks ───────────────────────────────────────────────────────────────

describe('extractDeckSpec fact_checks verdict mapping', () => {
  it('supported → Supported', () => {
    const spec = extractDeckSpec(makeSession() as never);
    const fc = spec.fact_checks.find(f => f.claim.includes('Frontier models'));
    expect(fc?.verdict).toBe('Supported');
  });

  it('disputed → Disputed (always surfaced)', () => {
    const spec = extractDeckSpec(makeSession() as never);
    const fc = spec.fact_checks.find(f => f.claim.includes('Mandates slow'));
    expect(fc?.verdict).toBe('Disputed');
  });

  it('partially_accurate → Supported', () => {
    const session = makeSession();
    (session['argument_network'] as Record<string, unknown[]>)['nodes'].push({
      id: 'fc3', text: 'AI accidents doubled', speaker: 'saf',
      scoring_method: 'fact_check', verification_status: 'partially_accurate',
    });
    const spec = extractDeckSpec(session as never);
    const fc = spec.fact_checks.find(f => f.claim.includes('AI accidents'));
    expect(fc?.verdict).toBe('Supported');
  });

  it('false → Disputed', () => {
    const session = makeSession();
    (session['argument_network'] as Record<string, unknown[]>)['nodes'].push({
      id: 'fc4', text: 'No major AI incidents occurred', speaker: 'acc',
      scoring_method: 'fact_check', verification_status: 'false',
    });
    const spec = extractDeckSpec(session as never);
    const fc = spec.fact_checks.find(f => f.claim.includes('No major'));
    expect(fc?.verdict).toBe('Disputed');
  });

  it('unverifiable → Unverifiable', () => {
    const session = makeSession();
    (session['argument_network'] as Record<string, unknown[]>)['nodes'].push({
      id: 'fc5', text: 'Future risk unknown', speaker: 'saf',
      scoring_method: 'fact_check', verification_status: 'unverifiable',
    });
    const spec = extractDeckSpec(session as never);
    const fc = spec.fact_checks.find(f => f.claim.includes('Future risk'));
    expect(fc?.verdict).toBe('Unverifiable');
  });

  it('verification_evidence → sources and explanation', () => {
    const spec = extractDeckSpec(makeSession() as never);
    const fc = spec.fact_checks.find(f => f.claim.includes('Frontier models'));
    expect(fc?.sources).toEqual(['Source: Epoch AI compute tracker 2025']);
    expect(fc?.explanation).toBe('Source: Epoch AI compute tracker 2025');
  });

  it('only includes fact_check-scored nodes', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.fact_checks).toHaveLength(2);
  });
});

// ── concessions ───────────────────────────────────────────────────────────────

describe('extractDeckSpec concessions', () => {
  it('maps commitment lengths per camp', () => {
    const spec = extractDeckSpec(makeSession() as never);
    const acc = spec.concessions.find(c => c.camp === 'acc');
    expect(acc?.asserted).toBe(2);
    expect(acc?.conceded).toBe(1);
    expect(acc?.challenged).toBe(2);
    const saf = spec.concessions.find(c => c.camp === 'saf');
    expect(saf?.asserted).toBe(1);
    expect(saf?.conceded).toBe(0);
  });
});

// ── top_claims ────────────────────────────────────────────────────────────────

describe('extractDeckSpec top_claims', () => {
  it('includes nodes with computed_strength, sorted descending', () => {
    const session = makeSession();
    (session['argument_network'] as Record<string, unknown[]>)['nodes'].push({
      id: 'a2', text: 'Strong claim', speaker: 'saf',
      scoring_method: 'bdi_criteria', computed_strength: 0.9,
    });
    const spec = extractDeckSpec(session as never);
    expect(spec.top_claims[0].strength).toBeGreaterThanOrEqual(spec.top_claims[1]?.strength ?? 0);
    expect(spec.top_claims.find(c => c.claim.includes('Strong claim'))?.camp).toBe('saf');
  });
});

// ── convergence ───────────────────────────────────────────────────────────────

describe('extractDeckSpec convergence', () => {
  it('prefers qbaf_strength over convergence', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.convergence[0].score).toBe(0.45);
  });

  it('falls back to convergence when qbaf_strength absent', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.convergence[1].score).toBe(0.6);
  });

  it('uses empty string for null taxonomy_ref', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.convergence[1].issue).toBe('');
  });
});

// ── open_threads ──────────────────────────────────────────────────────────────

describe('extractDeckSpec open_threads', () => {
  it('includes only non-resolved crux entries', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.open_threads).toHaveLength(1);
    expect(spec.open_threads[0].text).toBe('Will mandates stifle innovation?');
  });

  it('returns [] and does not throw when crux_tracker absent', () => {
    const session = makeSession();
    delete (session as Record<string, unknown>)['crux_tracker'];
    const spec = extractDeckSpec(session as never);
    expect(spec.open_threads).toEqual([]);
  });
});

// ── top_claims excludes system speaker ───────────────────────────────────────

describe('extractDeckSpec top_claims system-node exclusion', () => {
  it('excludes nodes where speaker is system', () => {
    const session = makeSession();
    (session['argument_network'] as Record<string, unknown[]>)['nodes'].push({
      id: 'sys1', text: 'System-injected evidence', speaker: 'system',
      scoring_method: 'bdi_criteria', computed_strength: 0.99,
    });
    const spec = extractDeckSpec(session as never);
    expect(spec.top_claims.find(c => c.claim.includes('System-injected'))).toBeUndefined();
  });

  it('includes camp nodes alongside the filter', () => {
    const spec = extractDeckSpec(makeSession() as never);
    expect(spec.top_claims.every(c => c.camp !== 'system')).toBe(true);
  });
});

// ── AJV validation rejects schema violations ──────────────────────────────────

function makeValidSpec(): DeckSpec {
  return extractDeckSpec(makeSession() as never);
}

describe('validateDeckSpec AJV gate', () => {
  it('rejects convergence score > 1 (schema maximum)', () => {
    const spec = makeValidSpec();
    spec.convergence = [{ issue: 'x', score: 1.5 }];
    expect(() => validateDeckSpec(spec)).toThrow(/AJV schema validation failed/);
  });

  it('rejects unknown property on meta (additionalProperties:false)', () => {
    const spec = makeValidSpec();
    (spec.meta as unknown as Record<string, unknown>)['unknown_field'] = 'injected';
    expect(() => validateDeckSpec(spec)).toThrow(/AJV schema validation failed/);
  });

  it('rejects invalid verdict enum value', () => {
    const spec = makeValidSpec();
    spec.fact_checks = [{ claim: 'x', verdict: 'Unknown' as never }];
    expect(() => validateDeckSpec(spec)).toThrow(/AJV schema validation failed/);
  });

  it('accepts a valid spec without throwing', () => {
    const spec = makeValidSpec();
    expect(() => validateDeckSpec(spec)).not.toThrow();
  });
});
