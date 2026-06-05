// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import {
  computeExtractionCoverage,
  extractCalibrationData,
} from './calibrationLogger.js';
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
