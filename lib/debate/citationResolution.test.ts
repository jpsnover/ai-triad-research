// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  buildCitationBank,
  formatCitationBank,
  executeCitationLookup,
  scrubCitations,
  validateCitationsAgainstBank,
  citationToolDefinition,
} from './citationResolution.js';
import type { CitationBankEntry } from './citationResolution.js';
import type { SourceEvidenceIndex, DocMetaMap } from './evidenceFromSummaries.js';

// ── Test fixtures ─────────────────────────────────────────

const DOC_META: DocMetaMap = {
  'doc-aisi-2025': {
    title: 'Frontier AI Safety: Evaluating Advanced Model Behaviors',
    resolved_url: 'https://example.com/aisi-2025',
    provenance_label: 'arXiv:2025.12345',
  },
  'doc-exec-14110': {
    title: 'Executive Order 14110 on Safe AI Development',
    resolved_url: 'https://whitehouse.gov/eo-14110',
    provenance_label: '2023',
  },
  'doc-alignment-tax': {
    title: 'The Alignment Tax: Measuring Safety Overhead in Language Models',
    resolved_url: null,
    provenance_label: 'Anthropic, 2024',
  },
};

const EVIDENCE_INDEX: SourceEvidenceIndex = {
  'saf-beliefs-001': {
    facts: [
      { claim: 'AISI evaluations found 3/7 frontier models exhibited deceptive alignment patterns', label: 'empirical', doc_id: 'doc-aisi-2025', specificity: 'precise', temporal_bound: '2025-Q1' },
      { claim: 'Alignment tax estimated at 15-30% compute overhead', label: 'estimate', doc_id: 'doc-alignment-tax', specificity: 'qualified' },
    ],
    keyPoints: [
      { stance: 'supportive', pov: 'safetyist', point: 'Government oversight is necessary for frontier models', doc_id: 'doc-exec-14110' },
    ],
  },
  'acc-beliefs-002': {
    facts: [
      { claim: 'Open-source models achieve 95% of frontier performance', label: 'empirical', doc_id: 'doc-aisi-2025', specificity: 'qualified' },
    ],
    keyPoints: [],
  },
};

const POLICY_REGISTRY = [
  { id: 'pol-001', action: 'Mandatory pre-deployment safety evaluations for frontier models' },
  { id: 'pol-002', action: 'Open-source liability exemption for models under 10B parameters' },
];

function makeSampleBank(): CitationBankEntry[] {
  return buildCitationBank(EVIDENCE_INDEX, DOC_META, POLICY_REGISTRY);
}

// ── buildCitationBank ─────────────────────────────────────

describe('buildCitationBank', () => {
  it('produces entries from evidence index and doc metadata', () => {
    const bank = makeSampleBank();
    // Should have 3 doc entries + 2 policy entries = 5
    expect(bank.length).toBe(5);
  });

  it('deduplicates doc_ids appearing in multiple nodes', () => {
    const bank = makeSampleBank();
    const aisiEntries = bank.filter(e => e.doc_id === 'doc-aisi-2025');
    expect(aisiEntries.length).toBe(1);
  });

  it('populates key_findings from facts', () => {
    const bank = makeSampleBank();
    const aisi = bank.find(e => e.doc_id === 'doc-aisi-2025')!;
    expect(aisi.key_findings.length).toBeGreaterThan(0);
    expect(aisi.key_findings[0]).toContain('deceptive alignment');
  });

  it('preserves URL from metadata', () => {
    const bank = makeSampleBank();
    const aisi = bank.find(e => e.doc_id === 'doc-aisi-2025')!;
    expect(aisi.url).toBe('https://example.com/aisi-2025');
  });

  it('includes policy registry entries as legislation', () => {
    const bank = makeSampleBank();
    const policies = bank.filter(e => e.doc_id.startsWith('pol-'));
    expect(policies.length).toBe(2);
    expect(policies[0].source_type).toBe('legislation');
  });

  it('classifies source types correctly', () => {
    const bank = makeSampleBank();
    const eo = bank.find(e => e.doc_id === 'doc-exec-14110')!;
    expect(eo.source_type).toBe('legislation');
  });

  it('handles empty evidence index', () => {
    const bank = buildCitationBank({}, DOC_META);
    expect(bank.length).toBe(0);
  });
});

// ── formatCitationBank ────────────────────────────────────

describe('formatCitationBank', () => {
  it('produces formatted prompt text with numbered entries', () => {
    const bank = makeSampleBank();
    const text = formatCitationBank(bank);
    expect(text).toContain('CITATION RULES:');
    expect(text).toContain('VERIFIED SOURCES:');
    expect(text).toContain('1. "');
    expect(text).toContain('Frontier AI Safety');
  });

  it('includes key findings in the output', () => {
    const bank = makeSampleBank();
    const text = formatCitationBank(bank);
    expect(text).toContain('deceptive alignment');
  });

  it('returns empty string for empty bank', () => {
    expect(formatCitationBank([])).toBe('');
  });
});

// ── executeCitationLookup ─────────────────────────────────

describe('executeCitationLookup', () => {
  it('returns matching citations for relevant query', () => {
    const bank = makeSampleBank();
    const result = JSON.parse(executeCitationLookup('alignment safety evaluations', undefined, bank));
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title).toBeDefined();
  });

  it('filters by source type', () => {
    const bank = makeSampleBank();
    const result = JSON.parse(executeCitationLookup('safety', 'legislation', bank));
    for (const r of result.results) {
      // legislation entries: either policy or the EO doc
      expect(bank.find(e => e.doc_id === r.doc_id)?.source_type).toBe('legislation');
    }
  });

  it('returns empty with message when no matches', () => {
    const bank = makeSampleBank();
    const result = JSON.parse(executeCitationLookup('quantum entanglement photosynthesis', undefined, bank));
    expect(result.results.length).toBe(0);
    expect(result.message).toContain('No verified sources');
  });

  it('respects maxResults', () => {
    const bank = makeSampleBank();
    const result = JSON.parse(executeCitationLookup('safety alignment models', undefined, bank, 2));
    expect(result.results.length).toBeLessThanOrEqual(2);
  });
});

// ── scrubCitations ────────────────────────────────────────

describe('scrubCitations', () => {
  it('removes fabricated arXiv IDs', () => {
    const bank = makeSampleBank();
    const draft = 'As shown by Smith et al. (arXiv:2099.99999), alignment is hard.';
    const { cleanedDraft, removed } = scrubCitations(draft, bank);
    expect(removed).toContain('arXiv:2099.99999');
    expect(cleanedDraft).not.toContain('arXiv:2099.99999');
  });

  it('removes fabricated URLs', () => {
    const bank = makeSampleBank();
    const draft = 'See https://fake-journal.org/paper123 for details.';
    const { cleanedDraft, removed } = scrubCitations(draft, bank);
    expect(removed.length).toBe(1);
    expect(cleanedDraft).not.toContain('fake-journal.org');
  });

  it('preserves URLs from the bank', () => {
    const bank = makeSampleBank();
    const draft = 'See https://example.com/aisi-2025 for details.';
    const { cleanedDraft, removed } = scrubCitations(draft, bank);
    expect(removed.length).toBe(0);
    expect(cleanedDraft).toContain('https://example.com/aisi-2025');
  });

  it('replaces fabricated Executive Orders with hedged text', () => {
    const bank = makeSampleBank();
    const draft = 'Under Executive Order 99999, all AI must be licensed.';
    const { cleanedDraft, removed } = scrubCitations(draft, bank);
    expect(removed).toContain('Executive Order 99999');
    expect(cleanedDraft).toContain('relevant policy directives');
  });

  it('returns clean result for drafts without citations', () => {
    const bank = makeSampleBank();
    const draft = 'AI safety is important for responsible development.';
    const { cleanedDraft, removed } = scrubCitations(draft, bank);
    expect(removed.length).toBe(0);
    expect(cleanedDraft).toBe(draft);
  });
});

// ── validateCitationsAgainstBank ──────────────────────────

describe('validateCitationsAgainstBank', () => {
  it('warns about arXiv IDs', () => {
    const bank = makeSampleBank();
    const warnings = validateCitationsAgainstBank('See arXiv:2099.12345 for proof.', bank);
    expect(warnings.length).toBe(1);
    expect(warnings[0].reason).toContain('ArXiv ID');
  });

  it('warns about fabricated URLs', () => {
    const bank = makeSampleBank();
    const warnings = validateCitationsAgainstBank('Per https://fake.org/paper, this is true.', bank);
    expect(warnings.length).toBe(1);
    expect(warnings[0].reason).toContain('URL not in citation bank');
  });

  it('does not warn about bank URLs', () => {
    const bank = makeSampleBank();
    const warnings = validateCitationsAgainstBank('Per https://example.com/aisi-2025, models show risk.', bank);
    expect(warnings.length).toBe(0);
  });

  it('warns about fabricated quoted titles', () => {
    const bank = makeSampleBank();
    const warnings = validateCitationsAgainstBank('As shown in "A Completely Made Up Paper Title About Nothing"', bank);
    expect(warnings.length).toBe(1);
    expect(warnings[0].reason).toContain('Quoted title');
  });

  it('does not warn about real titles from the bank', () => {
    const bank = makeSampleBank();
    const warnings = validateCitationsAgainstBank('As shown in "Frontier AI Safety: Evaluating Advanced Model Behaviors"', bank);
    expect(warnings.length).toBe(0);
  });

  it('returns empty for clean text', () => {
    const bank = makeSampleBank();
    const warnings = validateCitationsAgainstBank('AI safety is a critical concern for society.', bank);
    expect(warnings.length).toBe(0);
  });
});

// ── citationToolDefinition ────────────────────────────────

describe('citationToolDefinition', () => {
  it('has required fields', () => {
    expect(citationToolDefinition.name).toBe('lookup_citation');
    expect(citationToolDefinition.description).toBeTruthy();
    expect(citationToolDefinition.parameters).toBeDefined();
  });

  it('has query as required parameter', () => {
    const params = citationToolDefinition.parameters as { required: string[] };
    expect(params.required).toContain('query');
  });
});
