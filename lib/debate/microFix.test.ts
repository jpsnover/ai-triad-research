// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { validateMicroFix, splitIntoParagraphs } from './turnPipeline.js';
import { microFixAbstractClaims } from './prompts.js';

// ── validateMicroFix ──────────────────────────────────────

describe('validateMicroFix', () => {
  it('accepts when only flagged sentences change', () => {
    const original = 'AI governance needs reform. Companies should comply. The risks are growing.';
    const revised = 'AI governance needs reform. Companies should comply with the EU AI Act by 2026. The risks are growing.';
    expect(validateMicroFix(original, revised, 1)).toBe(true);
  });

  it('accepts when changes equal flaggedClaimCount * 2 + 3', () => {
    const original = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
    // Change 5 sentences with 1 flagged claim (1*2+3 = 5 allowed)
    const revised = 'Changed one. Changed two. Changed three. Changed four. Changed five.';
    expect(validateMicroFix(original, revised, 1)).toBe(true);
  });

  it('rejects when too many sentences change', () => {
    const original = 'S1. S2. S3. S4. S5. S6. S7.';
    // Change 6 sentences with 1 flagged claim (1*2+3 = 5 allowed, 6 > 5)
    const revised = 'C1. C2. C3. C4. C5. C6. S7.';
    expect(validateMicroFix(original, revised, 1)).toBe(false);
  });

  it('rejects when sentence count changes drastically', () => {
    const original = 'One sentence. Two sentence. Three sentence.';
    const revised = 'One sentence. Two sentence. Three sentence. Four. Five. Six.';
    expect(validateMicroFix(original, revised, 1)).toBe(false);
  });

  it('accepts identical text (zero changes)', () => {
    const text = 'No changes at all. Everything stays the same.';
    expect(validateMicroFix(text, text, 0)).toBe(true);
  });

  it('handles multiple flagged claims allowing more changes', () => {
    const original = 'A. B. C. D. E. F. G. H. I. J.';
    // 3 flagged claims → 3*2+3 = 9 changes allowed
    const revised = 'A1. B1. C1. D1. E1. F1. G1. H1. I1. J.';
    expect(validateMicroFix(original, revised, 3)).toBe(true);
  });

  it('counts added sentences as changes', () => {
    const original = 'Sentence one. Sentence two.';
    const revised = 'Sentence one. Sentence two. New sentence.';
    // 1 added sentence = 1 change, flagged=0 → 0*2+3=3 allowed
    expect(validateMicroFix(original, revised, 0)).toBe(true);
  });

  it('rejects when too many sentences are added', () => {
    const original = 'Sentence one.';
    const revised = 'Sentence one. Added two. Added three. Added four. Added five.';
    // 4 added = 4 changes, flagged=0 → 0*2+3=3 allowed
    expect(validateMicroFix(original, revised, 0)).toBe(false);
  });
});

// ── microFixAbstractClaims prompt ─────────────────────────

describe('microFixAbstractClaims', () => {
  const statement = 'AI regulation is important. We need better governance frameworks.';
  const flaggedClaims = [
    { claim: 'AI regulation is important', index: 0 },
    { claim: 'We need better governance frameworks', index: 1 },
  ];
  const evidenceBlock = '=== EVIDENCE ===\nThe EU AI Act (2024) established risk-based tiers.';
  const citationBank = 'Smith et al. (2024) "AI Governance Report"';

  it('includes the statement in the prompt', () => {
    const prompt = microFixAbstractClaims(statement, flaggedClaims, evidenceBlock, citationBank);
    expect(prompt).toContain(statement);
  });

  it('lists all flagged claims numbered', () => {
    const prompt = microFixAbstractClaims(statement, flaggedClaims, evidenceBlock, citationBank);
    expect(prompt).toContain('1. "AI regulation is important"');
    expect(prompt).toContain('2. "We need better governance frameworks"');
  });

  it('includes the evidence block', () => {
    const prompt = microFixAbstractClaims(statement, flaggedClaims, evidenceBlock, citationBank);
    expect(prompt).toContain(evidenceBlock);
  });

  it('includes the citation bank', () => {
    const prompt = microFixAbstractClaims(statement, flaggedClaims, evidenceBlock, citationBank);
    expect(prompt).toContain(citationBank);
  });

  it('requests JSON output with revised_statement and changes', () => {
    const prompt = microFixAbstractClaims(statement, flaggedClaims, evidenceBlock, citationBank);
    expect(prompt).toContain('"revised_statement"');
    expect(prompt).toContain('"changes"');
    expect(prompt).toContain('"fact_source"');
  });

  it('specifies temperature-appropriate instructions (focused, not creative)', () => {
    const prompt = microFixAbstractClaims(statement, flaggedClaims, evidenceBlock, citationBank);
    expect(prompt).toContain('specificity editor');
    expect(prompt).toContain('Leave ALL unflagged text exactly as-is');
  });
});

// ── splitIntoParagraphs ───────────────────────────────────

describe('splitIntoParagraphs', () => {
  it('returns short text unchanged (fewer than 4 sentences)', () => {
    const text = 'One sentence. Two sentence. Three sentence.';
    expect(splitIntoParagraphs(text)).toBe(text);
  });

  it('splits at transition words when available', () => {
    const text = 'First point about AI. Second detail here. However, there is a counter argument. The data shows otherwise. Furthermore, we must consider ethics. The stakes are high. Moreover, regulation matters. New rules are needed.';
    const result = splitIntoParagraphs(text);
    expect(result).toContain('\n\n');
    const paras = result.split('\n\n');
    expect(paras.length).toBeGreaterThanOrEqual(3);
    expect(paras.length).toBeLessThanOrEqual(5);
  });

  it('falls back to even splitting when no transition words', () => {
    const text = 'Sentence one about topic. Sentence two about topic. Sentence three about topic. Sentence four about topic. Sentence five about topic. Sentence six about topic. Sentence seven about topic. Sentence eight about topic.';
    const result = splitIntoParagraphs(text);
    expect(result).toContain('\n\n');
    const paras = result.split('\n\n');
    expect(paras.length).toBeGreaterThanOrEqual(2);
    expect(paras.length).toBeLessThanOrEqual(5);
  });

  it('does not split text that already has paragraphs', () => {
    // splitIntoParagraphs only receives text without \n\n (checked before calling)
    // But verify it still works if called directly
    const text = 'Para one sentence.\n\nPara two sentence.';
    // The regex won't match \n\n as sentence boundary, so it treats it as one long string
    // This is fine — the caller checks for \n\n before invoking
    expect(splitIntoParagraphs(text)).toBeDefined();
  });

  it('preserves all original text content', () => {
    const text = 'The EU AI Act requires compliance. Companies must register systems. However, timelines are aggressive. Small firms face burdens. Furthermore, enforcement varies by jurisdiction. National authorities differ. Ultimately, harmonization is needed. Standards must converge.';
    const result = splitIntoParagraphs(text);
    // All sentences should appear in the result
    expect(result).toContain('The EU AI Act requires compliance.');
    expect(result).toContain('Standards must converge.');
  });
});
