// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { disambiguateTerms } from './vocabularyDisambiguation.js';
import type { ColloquialTerm } from '../dictionary/types.js';

// ── Helpers ──────────────────────────────────────────────

function makeColloquial(
  term: string,
  resolves_to: ColloquialTerm['resolves_to'],
): ColloquialTerm {
  return {
    $schema_version: '1.0.0',
    colloquial_term: term,
    status: 'do_not_use_bare',
    translation_required: true,
    resolves_to,
    first_added: '2026-01-01',
    last_reviewed: '2026-01-01',
  };
}

const alignmentTerm = makeColloquial('alignment', [
  { standardized_term: 'safety_alignment', when: 'safety context', default_for_camp: 'safetyist', confidence_typical: 'high' },
  { standardized_term: 'commercial_alignment', when: 'product context', default_for_camp: 'accelerationist', confidence_typical: 'high' },
  { standardized_term: 'alignment_compliance', when: 'value compliance', default_for_camp: 'skeptic', confidence_typical: 'medium' },
]);

const biasTerm = makeColloquial('bias', [
  { standardized_term: 'bias_technical', when: 'ML context', default_for_camp: 'accelerationist', confidence_typical: 'high' },
  { standardized_term: 'bias_systemic', when: 'social context', default_for_camp: 'skeptic', confidence_typical: 'high' },
]);

const singleResolutionTerm = makeColloquial('oversight', [
  { standardized_term: 'oversight_regulatory', when: 'any context', confidence_typical: 'high' },
]);

const safeTerm: ColloquialTerm = {
  $schema_version: '1.0.0',
  colloquial_term: 'technology',
  status: 'safe',
  translation_required: false,
  resolves_to: [],
  first_added: '2026-01-01',
  last_reviewed: '2026-01-01',
};

const allTerms = [alignmentTerm, biasTerm, singleResolutionTerm, safeTerm];

// ── Tests ───────────────────────────────────────────────

describe('disambiguateTerms', () => {
  it('resolves bare term by speaker POV camp default', () => {
    const result = disambiguateTerms(
      'We need better alignment in AI systems',
      'safetyist',
      allTerms,
    );
    expect(result.resolvedCount).toBe(1);
    expect(result.ambiguousCount).toBe(0);
    expect(result.terms).toHaveLength(1);
    expect(result.terms[0].bare).toBe('alignment');
    expect(result.terms[0].canonical).toBe('safety_alignment');
    expect(result.terms[0].confidence).toBe('high');
    expect(result.terms[0].ambiguous).toBe(false);
  });

  it('resolves same term differently for different POVs', () => {
    const text = 'The alignment problem is central to this debate';
    const safetyist = disambiguateTerms(text, 'safetyist', allTerms);
    const acc = disambiguateTerms(text, 'accelerationist', allTerms);
    const skeptic = disambiguateTerms(text, 'skeptic', allTerms);

    expect(safetyist.terms[0].canonical).toBe('safety_alignment');
    expect(acc.terms[0].canonical).toBe('commercial_alignment');
    expect(skeptic.terms[0].canonical).toBe('alignment_compliance');
  });

  it('resolves single-resolution terms regardless of POV', () => {
    const result = disambiguateTerms(
      'Government oversight is essential',
      'accelerationist',
      allTerms,
    );
    expect(result.resolvedCount).toBe(1);
    expect(result.terms[0].bare).toBe('oversight');
    expect(result.terms[0].canonical).toBe('oversight_regulatory');
    expect(result.terms[0].ambiguous).toBe(false);
  });

  it('flags ambiguous terms when no camp default matches', () => {
    // bias has defaults for accelerationist and skeptic, not safetyist
    const result = disambiguateTerms(
      'Addressing bias in AI systems',
      'safetyist',
      allTerms,
    );
    expect(result.ambiguousCount).toBe(1);
    expect(result.terms[0].bare).toBe('bias');
    expect(result.terms[0].canonical).toBe('');
    expect(result.terms[0].ambiguous).toBe(true);
    expect(result.terms[0].confidence).toBe('low');
  });

  it('ignores terms with safe status', () => {
    const result = disambiguateTerms(
      'This technology is transformative',
      'accelerationist',
      allTerms,
    );
    // 'technology' has status 'safe', should not be flagged
    expect(result.terms).toHaveLength(0);
  });

  it('finds multiple occurrences of the same term', () => {
    const result = disambiguateTerms(
      'Alignment is key. We must ensure alignment with human values.',
      'safetyist',
      allTerms,
    );
    expect(result.terms).toHaveLength(2);
    expect(result.terms[0].offset).toBeLessThan(result.terms[1].offset);
    expect(result.terms.every(t => t.canonical === 'safety_alignment')).toBe(true);
  });

  it('finds multiple different terms in the same text', () => {
    const result = disambiguateTerms(
      'The alignment debate intersects with oversight mechanisms',
      'skeptic',
      allTerms,
    );
    expect(result.terms).toHaveLength(2);
    const canonicals = result.terms.map(t => t.canonical);
    expect(canonicals).toContain('alignment_compliance');
    expect(canonicals).toContain('oversight_regulatory');
  });

  it('matches case-insensitively', () => {
    const result = disambiguateTerms(
      'ALIGNMENT must be addressed. Alignment is critical.',
      'accelerationist',
      allTerms,
    );
    expect(result.terms).toHaveLength(2);
    expect(result.terms.every(t => t.canonical === 'commercial_alignment')).toBe(true);
  });

  it('respects word boundaries — no partial matches', () => {
    const result = disambiguateTerms(
      'misalignment and realignment are not the same as alignment',
      'safetyist',
      allTerms,
    );
    // Only the standalone "alignment" should match, not "misalignment" or "realignment"
    expect(result.terms).toHaveLength(1);
    expect(result.terms[0].bare).toBe('alignment');
  });

  it('returns empty result for text with no bare terms', () => {
    const result = disambiguateTerms(
      'This is a completely unrelated sentence about weather.',
      'safetyist',
      allTerms,
    );
    expect(result.terms).toHaveLength(0);
    expect(result.resolvedCount).toBe(0);
    expect(result.ambiguousCount).toBe(0);
  });

  it('handles empty text', () => {
    const result = disambiguateTerms('', 'safetyist', allTerms);
    expect(result.terms).toHaveLength(0);
  });

  it('handles empty colloquial terms list', () => {
    const result = disambiguateTerms('alignment is important', 'safetyist', []);
    expect(result.terms).toHaveLength(0);
  });

  it('sorts results by offset', () => {
    const result = disambiguateTerms(
      'oversight of alignment and bias in AI',
      'accelerationist',
      allTerms,
    );
    expect(result.terms.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.terms.length; i++) {
      expect(result.terms[i].offset).toBeGreaterThan(result.terms[i - 1].offset);
    }
  });
});
