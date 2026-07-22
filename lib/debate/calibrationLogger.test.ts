// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeExtractionCoverage,
  extractCalibrationData,
  appendCalibrationLog,
} from './calibrationLogger.js';
import { PROMPT_VERSION } from './prompts.js';
import type { DebateSession, EntryDiagnostics } from './types.js';

function makeMinimalSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'test-debate',
    title: 'Test debate',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    phase: 'closed',
    topic: { original: 'AI policy', refined: null, final: 'AI policy' },
    source_type: 'topic',
    source_ref: '',
    source_content: '',
    active_povers: ['accelerationist', 'safetyist', 'skeptic'],
    user_is_pover: false,
    transcript: [],
    context_summaries: [],
    debate_model: 'gemini-2.5-flash',
    ...overrides,
  } as unknown as DebateSession;
}

// ── Prompt tests ──────────────────────────────────────────────

describe('elementDecompositionPrompt', async () => {
  const { elementDecompositionPrompt } = await import('./prompts.js');

  it('includes the statement text', () => {
    const result = elementDecompositionPrompt('AI will transform education');
    expect(result).toContain('AI will transform education');
  });

  it('includes granularity guide', () => {
    const result = elementDecompositionPrompt('test');
    expect(result).toContain('GRANULARITY GUIDE');
    expect(result).toContain('verifiable');
    expect(result).toContain('normative');
  });

  it('requests JSON output', () => {
    const result = elementDecompositionPrompt('test');
    expect(result).toContain('"elements"');
    expect(result).toContain('"element_type"');
  });
});

describe('coverageCheckPrompt', async () => {
  const { coverageCheckPrompt } = await import('./prompts.js');

  it('includes elements and claims', () => {
    const elements = [
      { text: 'AI improves efficiency', element_type: 'verifiable' },
      { text: 'We should regulate AI', element_type: 'normative' },
    ];
    const claims = ['AI systems increase productivity', 'Regulation is needed'];
    const result = coverageCheckPrompt(elements, claims);
    expect(result).toContain('[verifiable] AI improves efficiency');
    expect(result).toContain('[normative] We should regulate AI');
    expect(result).toContain('AI systems increase productivity');
    expect(result).toContain('Regulation is needed');
  });

  it('numbers elements and claims', () => {
    const elements = [{ text: 'Claim A', element_type: 'verifiable' }];
    const claims = ['Extracted claim 1'];
    const result = coverageCheckPrompt(elements, claims);
    expect(result).toContain('1. [verifiable] Claim A');
    expect(result).toContain('1. Extracted claim 1');
  });

  it('requests JSON coverage output', () => {
    const result = coverageCheckPrompt([], []);
    expect(result).toContain('"coverage"');
    expect(result).toContain('"element_index"');
    expect(result).toContain('"covered"');
  });
});

// ── computeExtractionCoverage tests ───────────────────────────

describe('computeExtractionCoverage', () => {
  it('populates extraction_coverage on sampled entries', async () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'AI will transform society through automation.', timestamp: '', taxonomy_refs: [] },
        { id: 'e2', type: 'statement', speaker: 'safetyist', content: 'We need safeguards for AI systems.', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'AI transforms society', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-2', text: 'AI safeguards needed', speaker: 'safetyist', source_entry_id: 'e2', taxonomy_refs: [], turn_number: 2 },
        ],
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: { e1: {}, e2: {} } as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const mockGenerate = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        elements: [
          { text: 'AI will transform society', element_type: 'verifiable' },
          { text: 'Automation drives change', element_type: 'verifiable' },
        ],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        coverage: [
          { element_index: 1, covered: true, covering_claim_index: 1 },
          { element_index: 2, covered: false, covering_claim_index: null },
        ],
      }));

    // RNG always returns 0 → all entries sampled (0 < 0.20 = true)
    await computeExtractionCoverage(session, mockGenerate, () => 0);

    const diag = session.diagnostics!.entries['e1'] as EntryDiagnostics;
    expect(diag.extraction_coverage).toBeDefined();
    expect(diag.extraction_coverage!.total_elements).toBe(2);
    expect(diag.extraction_coverage!.verifiable_elements).toBe(2);
    expect(diag.extraction_coverage!.normative_elements).toBe(0);
    expect(diag.extraction_coverage!.covered_verifiable).toBe(1);
    expect(diag.extraction_coverage!.coverage_rate).toBe(0.5);
    expect(diag.extraction_coverage!.uncovered_elements).toHaveLength(1);
    expect(diag.extraction_coverage!.uncovered_elements![0].text).toBe('Automation drives change');
  });

  it('skips entries when RNG exceeds sampling rate', async () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'Test', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: {
        nodes: [{ id: 'AN-1', text: 'Test claim', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 }],
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: { e1: {} } as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const mockGenerate = vi.fn();
    // RNG always returns 0.99 → nothing sampled (0.99 >= 0.20)
    await computeExtractionCoverage(session, mockGenerate, () => 0.99);

    expect(mockGenerate).not.toHaveBeenCalled();
    expect((session.diagnostics!.entries['e1'] as EntryDiagnostics).extraction_coverage).toBeUndefined();
  });

  it('handles generateFn failure gracefully', async () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'Test statement', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: {
        nodes: [{ id: 'AN-1', text: 'Test', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 }],
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: { e1: {} } as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const mockGenerate = vi.fn().mockRejectedValue(new Error('LLM error'));
    await computeExtractionCoverage(session, mockGenerate, () => 0);

    expect((session.diagnostics!.entries['e1'] as EntryDiagnostics).extraction_coverage).toBeUndefined();
  });

  it('skips entries with no AN nodes', async () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'Test', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: { nodes: [], edges: [] },
      diagnostics: {
        enabled: true,
        entries: { e1: {} } as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const mockGenerate = vi.fn();
    await computeExtractionCoverage(session, mockGenerate, () => 0);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

// ── extractCalibrationData aggregate tests ────────────────────

describe('extractCalibrationData extraction quality fields', () => {
  it('computes extraction_coverage_rate from per-entry data', () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'Test', timestamp: '', taxonomy_refs: [] },
        { id: 'e2', type: 'statement', speaker: 'safetyist', content: 'Test 2', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: { nodes: [], edges: [] },
      diagnostics: {
        enabled: true,
        entries: {
          e1: { extraction_coverage: { total_elements: 10, verifiable_elements: 8, normative_elements: 2, covered_verifiable: 6, covered_normative: 2, coverage_rate: 0.75 } },
          e2: { extraction_coverage: { total_elements: 5, verifiable_elements: 4, normative_elements: 1, covered_verifiable: 4, covered_normative: 1, coverage_rate: 1.0 } },
        } as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.extraction_coverage_rate).toBe(0.875);
    expect(dp.extraction_coverage_samples).toBe(2);
  });

  it('returns null extraction_coverage_rate when no entries have coverage', () => {
    const session = makeMinimalSession({
      diagnostics: {
        enabled: true,
        entries: { e1: {} } as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.extraction_coverage_rate).toBeNull();
    expect(dp.extraction_coverage_samples).toBe(0);
  });

  it('computes mean_extraction_confidence from AN nodes', () => {
    const session = makeMinimalSession({
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'a', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, extraction_confidence: 0.8 },
          { id: 'AN-2', text: 'b', speaker: 'safetyist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, extraction_confidence: 0.6 },
          { id: 'AN-3', text: 'c', speaker: 'skeptic', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, extraction_confidence: 1.0 },
        ] as any,
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: {} as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.mean_extraction_confidence).toBe(0.8);
  });

  it('computes low_confidence_claims_rate', () => {
    const session = makeMinimalSession({
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'a', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, extraction_confidence: 0.5 },
          { id: 'AN-2', text: 'b', speaker: 'safetyist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, extraction_confidence: 0.8 },
          { id: 'AN-3', text: 'c', speaker: 'skeptic', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, extraction_confidence: 0.4 },
          { id: 'AN-4', text: 'd', speaker: 'skeptic', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, extraction_confidence: 1.0 },
        ] as any,
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: {} as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.low_confidence_claims_rate).toBe(0.5);
  });

  it('computes entailment metrics from diagnostics', () => {
    const session = makeMinimalSession({
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'a', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-2', text: 'b', speaker: 'safetyist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-3', text: 'c', speaker: 'skeptic', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-4', text: 'd', speaker: 'skeptic', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
        ] as any,
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: {
          e1: {
            entailment_repairs: [
              { node_id: 'AN-1', bdi_category: 'belief', verdict: 'entailed', explanation: '', original_text: 'a', repaired_text: null, overlap_pct: 80 },
              { node_id: 'AN-2', bdi_category: 'desire', verdict: 'partial', explanation: '', original_text: 'b', repaired_text: 'b fixed', overlap_pct: 50 },
            ],
          },
        } as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.entailment_pass_rate).toBe(0.5);
    expect(dp.entailment_repair_rate).toBe(0.5);
    expect(dp.entailment_sampling_coverage).toBe(0.5);
  });

  it('returns null entailment metrics when no repairs exist', () => {
    const session = makeMinimalSession({
      argument_network: { nodes: [], edges: [] },
      diagnostics: {
        enabled: true,
        entries: { e1: {} } as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.entailment_pass_rate).toBeNull();
    expect(dp.entailment_repair_rate).toBeNull();
    expect(dp.entailment_sampling_coverage).toBeNull();
  });
});

describe('qbaf_preference_concordance', () => {
  it('matches when prevails claim has highest QBAF strength', () => {
    const session = makeMinimalSession({
      transcript: [
        {
          id: 'c1', type: 'concluding', speaker: 'system', content: 'Synthesis', timestamp: '', taxonomy_refs: [],
          metadata: {
            synthesis: {
              argument_map: [
                { claim_id: 'C1', claim: 'regulation slows innovation significantly' },
                { claim_id: 'C2', claim: 'safety frameworks protect the public interest' },
              ],
              preferences: [
                { claim_ids: ['C1', 'C2'], prevails: 'C2', conflict: 'innovation vs safety' },
              ],
            },
          },
        },
      ] as any,
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'regulation slows innovation significantly in practice', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, computed_strength: 0.4 },
          { id: 'AN-2', text: 'safety frameworks protect the public interest effectively', speaker: 'safetyist', source_entry_id: 'e2', taxonomy_refs: [], turn_number: 2, computed_strength: 0.8 },
        ] as any,
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: {} as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.qbaf_preference_concordance).toBe(1.0);
  });

  it('returns 0 when prevails claim does not have highest strength', () => {
    const session = makeMinimalSession({
      transcript: [
        {
          id: 'c1', type: 'concluding', speaker: 'system', content: 'Synthesis', timestamp: '', taxonomy_refs: [],
          metadata: {
            synthesis: {
              argument_map: [
                { claim_id: 'C1', claim: 'regulation slows innovation significantly' },
                { claim_id: 'C2', claim: 'safety frameworks protect the public interest' },
              ],
              preferences: [
                { claim_ids: ['C1', 'C2'], prevails: 'C2', conflict: 'innovation vs safety' },
              ],
            },
          },
        },
      ] as any,
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'regulation slows innovation significantly in practice', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, computed_strength: 0.9 },
          { id: 'AN-2', text: 'safety frameworks protect the public interest effectively', speaker: 'safetyist', source_entry_id: 'e2', taxonomy_refs: [], turn_number: 2, computed_strength: 0.3 },
        ] as any,
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: {} as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.qbaf_preference_concordance).toBe(0);
  });

  it('returns null when no synthesis preferences exist', () => {
    const session = makeMinimalSession({
      argument_network: { nodes: [], edges: [] },
      diagnostics: {
        enabled: true,
        entries: {} as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.qbaf_preference_concordance).toBeNull();
  });

  it('skips undecidable preferences', () => {
    const session = makeMinimalSession({
      transcript: [
        {
          id: 'c1', type: 'concluding', speaker: 'system', content: 'Synthesis', timestamp: '', taxonomy_refs: [],
          metadata: {
            synthesis: {
              argument_map: [
                { claim_id: 'C1', claim: 'open source accelerates progress' },
                { claim_id: 'C2', claim: 'closed models are more controllable' },
              ],
              preferences: [
                { claim_ids: ['C1', 'C2'], prevails: 'undecidable', conflict: 'open vs closed' },
              ],
            },
          },
        },
      ] as any,
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'open source accelerates progress in AI development', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1, computed_strength: 0.9 },
          { id: 'AN-2', text: 'closed models are more controllable and secure', speaker: 'safetyist', source_entry_id: 'e2', taxonomy_refs: [], turn_number: 2, computed_strength: 0.3 },
        ] as any,
        edges: [],
      },
      diagnostics: {
        enabled: true,
        entries: {} as Record<string, EntryDiagnostics>,
        overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.qbaf_preference_concordance).toBeNull();
  });
});

describe('extractCalibrationData exploration seeding fields', () => {
  const explorationSummary = {
    version: 1 as const,
    source_debate_id: 'explore-abc',
    source_model: 'groq-openai-gpt-oss-120b',
    source_tier: 'basic' as const,
    timestamp: '2026-06-01T00:00:00Z',
    topic: { original: 'AI regulation', refined: 'AI regulation', final: 'AI regulation' },
    cruxes: [
      { description: 'c1', disagreement_type: 'empirical' as const, state: 'engaged' as const, speakers_involved: ['acc'] },
      { description: 'c2', disagreement_type: 'values' as const, state: 'unresolved' as const, speakers_involved: ['saf'] },
    ],
    argument_sketch: {
      nodes: [
        { id: 'n1', text: 'claim 1', speaker: 'acc', bdi_category: 'beliefs', computed_strength: 0.8, taxonomy_refs: [] },
        { id: 'n2', text: 'claim 2', speaker: 'saf', bdi_category: 'desires', computed_strength: 0.6, taxonomy_refs: [] },
        { id: 'n3', text: 'claim 3', speaker: 'skp', bdi_category: 'intentions', computed_strength: 0.5, taxonomy_refs: [] },
      ],
      edges: [],
    },
    effective_situations: [
      { id: 'sit-1', label: 'Labor displacement', referenced_turns: 3, match_type: 'explicit_citation' as const },
    ],
    ineffective_situations: [
      { id: 'sit-2', label: 'Climate AI' },
      { id: 'sit-3', label: 'Military AI' },
    ],
    phase_dynamics: { total_rounds: 6, saturation_round: null, regression_count: 0, phase_durations: [] },
    convergence_profile: { final_convergence_score: null, stall_rounds: [], best_engagement_rounds: [], areas_of_agreement: [], areas_of_disagreement: [], unresolved_questions: [] },
    quality_summary: { mean_process_reward: 0.5, repetition_rate: 0.1, claims_forgotten_rate: 0.05, crux_addressed_rate: 0.8 },
    recommended_config: { max_rounds: 10, argumentation_exit_threshold: 0.65, concluding_exit_threshold: 0.6, temperature: 0.7, situation_cap: 15, skip_clarification: true, pacing: 'moderate' as const },
  };

  it('includes exploration fields when summary is present', () => {
    const session = makeMinimalSession();
    const dp = extractCalibrationData(session, 'local', { explorationSummary });
    expect(dp.exploration_source_id).toBe('explore-abc');
    expect(dp.exploration_source_model).toBe('groq-openai-gpt-oss-120b');
    expect(dp.seeded_crux_count).toBe(2);
    expect(dp.seeded_effective_situation_count).toBe(1);
    expect(dp.seeded_ineffective_situation_count).toBe(2);
    expect(dp.seeded_an_node_count).toBe(3);
  });

  it('omits exploration fields when summary is absent', () => {
    const session = makeMinimalSession();
    const dp = extractCalibrationData(session, 'local');
    expect(dp.exploration_source_id).toBeUndefined();
    expect(dp.exploration_source_model).toBeUndefined();
    expect(dp.seeded_crux_count).toBeUndefined();
    expect(dp.seeded_effective_situation_count).toBeUndefined();
    expect(dp.seeded_ineffective_situation_count).toBeUndefined();
    expect(dp.seeded_an_node_count).toBeUndefined();
  });

  it('field values match summary content', () => {
    const session = makeMinimalSession();
    const dp = extractCalibrationData(session, 'local', { explorationSummary });
    expect(dp.seeded_crux_count).toBe(explorationSummary.cruxes.length);
    expect(dp.seeded_effective_situation_count).toBe(explorationSummary.effective_situations.length);
    expect(dp.seeded_ineffective_situation_count).toBe(explorationSummary.ineffective_situations.length);
    expect(dp.seeded_an_node_count).toBe(explorationSummary.argument_sketch.nodes.length);
  });
});

describe('extractCalibrationData peer_referencing_rate (t/1279)', () => {
  it('computes cross-POV engagement rate from AN edges', () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'opening', speaker: 'accelerationist', content: 'Opening', timestamp: '', taxonomy_refs: [] },
        { id: 'e2', type: 'opening', speaker: 'safetyist', content: 'Opening', timestamp: '', taxonomy_refs: [] },
        { id: 'e3', type: 'statement', speaker: 'accelerationist', content: 'Rebuttal', timestamp: '', taxonomy_refs: [] },
        { id: 'e4', type: 'statement', speaker: 'safetyist', content: 'Independent', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'acc claim 1', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-2', text: 'saf claim 1', speaker: 'safetyist', source_entry_id: 'e2', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-3', text: 'acc rebuttal', speaker: 'accelerationist', source_entry_id: 'e3', taxonomy_refs: [], turn_number: 2 },
          { id: 'AN-4', text: 'saf standalone', speaker: 'safetyist', source_entry_id: 'e4', taxonomy_refs: [], turn_number: 2 },
        ] as any,
        edges: [
          { id: 'E-1', source: 'AN-3', target: 'AN-2', type: 'attacks' },
        ] as any,
      },
    });

    const dp = extractCalibrationData(session, 'local');
    // accelerationist: e1 (no cross-POV edge), e3 (attacks saf claim) → 1/2 = 0.5
    // safetyist: e2 (no cross-POV edge), e4 (no cross-POV edge) → 0/2 = 0.0
    // mean = (0.5 + 0.0) / 2 = 0.25
    expect(dp.peer_referencing_rate).toBe(0.25);
    expect(dp.peer_referencing_per_speaker).toEqual({
      accelerationist: 0.5,
      safetyist: 0,
    });
  });

  it('returns 1.0 when every turn has cross-POV engagement', () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'A', timestamp: '', taxonomy_refs: [] },
        { id: 'e2', type: 'statement', speaker: 'safetyist', content: 'B', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'a', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-2', text: 'b', speaker: 'safetyist', source_entry_id: 'e2', taxonomy_refs: [], turn_number: 1 },
        ] as any,
        edges: [
          { id: 'E-1', source: 'AN-1', target: 'AN-2', type: 'supports' },
          { id: 'E-2', source: 'AN-2', target: 'AN-1', type: 'attacks' },
        ] as any,
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.peer_referencing_rate).toBe(1);
    expect(dp.peer_referencing_per_speaker!.accelerationist).toBe(1);
    expect(dp.peer_referencing_per_speaker!.safetyist).toBe(1);
  });

  it('returns null when no AN data is available', () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'A', timestamp: '', taxonomy_refs: [] },
      ] as any,
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.peer_referencing_rate).toBeNull();
    expect(dp.peer_referencing_per_speaker).toBeNull();
  });

  it('excludes revoice_of edges from engagement count', () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'A', timestamp: '', taxonomy_refs: [] },
        { id: 'e2', type: 'statement', speaker: 'safetyist', content: 'B', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'a', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-2', text: 'b', speaker: 'safetyist', source_entry_id: 'e2', taxonomy_refs: [], turn_number: 1 },
        ] as any,
        edges: [
          { id: 'E-1', source: 'AN-1', target: 'AN-2', type: 'revoice_of' },
        ] as any,
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.peer_referencing_rate).toBe(0);
  });

  it('excludes same-speaker edges from engagement count', () => {
    const session = makeMinimalSession({
      transcript: [
        { id: 'e1', type: 'statement', speaker: 'accelerationist', content: 'A', timestamp: '', taxonomy_refs: [] },
      ] as any,
      argument_network: {
        nodes: [
          { id: 'AN-1', text: 'a', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
          { id: 'AN-2', text: 'b', speaker: 'accelerationist', source_entry_id: 'e1', taxonomy_refs: [], turn_number: 1 },
        ] as any,
        edges: [
          { id: 'E-1', source: 'AN-1', target: 'AN-2', type: 'supports' },
        ] as any,
      },
    });

    const dp = extractCalibrationData(session, 'local');
    expect(dp.peer_referencing_rate).toBe(0);
  });
});

// ── Preregistration-by-artifact provenance (t/1672) ───────────
// Each calibration entry binds prompt version + model id + config revision +
// clean/dirty git flag so a metric drift is attributable to prompt-vs-parameter-
// vs-model drift (arXiv:2607.14399 §5 R-5). Schema-only: metric VALUES unchanged.

describe('extractCalibrationData provenance fields (t/1672)', () => {
  it('binds prompt_version to the imported constant', () => {
    const dp = extractCalibrationData(makeMinimalSession(), 'local');
    expect(dp.prompt_version).toBe(PROMPT_VERSION);
  });

  it('leaves config_revision / working_tree_state as placeholders (pure extractor does no I/O)', () => {
    // The extractor is pure — the I/O-dependent fields get their real values
    // stamped later by appendCalibrationLog. Here they must be the placeholders.
    const dp = extractCalibrationData(makeMinimalSession(), 'local');
    expect(dp.config_revision).toBe('');
    expect(dp.working_tree_state).toBe('unknown');
  });
});

describe('appendCalibrationLog stamps runtime provenance (t/1672)', () => {
  function readLastEntry(dataRoot: string, origin: string): any {
    const file = path.join(dataRoot, 'calibration', 'core', 'calibration-log.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  }

  it('stamps config_revision and working_tree_state onto the persisted entry', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-prov-'));
    try {
      const dp = extractCalibrationData(makeMinimalSession(), 'local');
      appendCalibrationLog(dp, dataRoot);

      const entry = readLastEntry(dataRoot, 'local');
      expect(entry.prompt_version).toBe(PROMPT_VERSION);
      // config_revision: 12-hex content hash of calibration-config.json, or '' if unreadable.
      expect(typeof entry.config_revision).toBe('string');
      expect(entry.config_revision).toMatch(/^([0-9a-f]{12})?$/);
      // working_tree_state: real git state where a repo exists, 'unknown' where git is absent.
      expect(['clean', 'dirty', 'unknown']).toContain(entry.working_tree_state);
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it('does not mutate the caller-supplied dataPoint (stamps a copy)', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-prov-'));
    try {
      const dp = extractCalibrationData(makeMinimalSession(), 'local');
      appendCalibrationLog(dp, dataRoot);
      // The pure extractor's placeholders on the original object are untouched.
      expect(dp.config_revision).toBe('');
      expect(dp.working_tree_state).toBe('unknown');
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it('changes only the two provenance fields — all metric values are unchanged (AC #2)', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-prov-'));
    try {
      const dp = extractCalibrationData(makeMinimalSession(), 'local');
      appendCalibrationLog(dp, dataRoot);

      const entry = readLastEntry(dataRoot, 'local');
      // Strip the two runtime-stamped fields from both sides; everything else — every
      // metric value — must be byte-identical to the pure extractor output.
      const { config_revision: _ec, working_tree_state: _ew, ...entryRest } = entry;
      const { config_revision: _dc, working_tree_state: _dw, ...dpRest } = dp as any;
      expect(entryRest).toEqual(dpRest);
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
