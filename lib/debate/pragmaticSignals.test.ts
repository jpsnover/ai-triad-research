// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  countLexiconHits,
  computePragmaticConvergence,
  computeSynthesisPragmaticSignal,
  HEDGE_LEXICON,
  ASSERTIVE_LEXICON,
  CONCESSIVE_LEXICON,
  META_DISCOURSE_LEXICON,
  SYNTHESIS_INTEGRATION_LEXICON,
  CONDITIONAL_AGREEMENT_LEXICON,
} from './pragmaticSignals.js';

// ── countLexiconHits ─────────────────────────────────────────

describe('countLexiconHits', () => {
  it('returns 0 for empty text', () => {
    expect(countLexiconHits('', HEDGE_LEXICON)).toBe(0);
  });

  it('returns 0 when no lexicon matches', () => {
    expect(countLexiconHits('The sky is blue.', HEDGE_LEXICON)).toBe(0);
  });

  it('counts a single match', () => {
    expect(countLexiconHits('Perhaps the data suggests otherwise.', HEDGE_LEXICON)).toBe(1);
  });

  it('counts multiple distinct phrase matches', () => {
    const text = 'Perhaps this seems like it might work.';
    expect(countLexiconHits(text, HEDGE_LEXICON)).toBe(3); // perhaps, seems, might
  });

  it('is case-insensitive', () => {
    expect(countLexiconHits('PERHAPS CLEARLY HOWEVER', HEDGE_LEXICON)).toBe(1);
    expect(countLexiconHits('PERHAPS CLEARLY HOWEVER', ASSERTIVE_LEXICON)).toBe(1);
    expect(countLexiconHits('PERHAPS CLEARLY HOWEVER', CONCESSIVE_LEXICON)).toBe(1);
  });

  it('counts repeated occurrences of the same phrase', () => {
    expect(countLexiconHits('perhaps perhaps perhaps', HEDGE_LEXICON)).toBe(3);
  });

  it('handles multi-word phrases', () => {
    expect(countLexiconHits('I suspect that the evidence shows the opposite.', HEDGE_LEXICON)).toBe(1);
    expect(countLexiconHits('I suspect that the evidence shows the opposite.', ASSERTIVE_LEXICON)).toBe(1);
  });

  it('counts hits from each lexicon independently', () => {
    expect(countLexiconHits('the central disagreement is clear', META_DISCOURSE_LEXICON)).toBe(1);
    expect(countLexiconHits('building on previous work', SYNTHESIS_INTEGRATION_LEXICON)).toBe(1);
    expect(countLexiconHits('if we accept the premise', CONDITIONAL_AGREEMENT_LEXICON)).toBe(1);
  });

  it('handles empty lexicon', () => {
    expect(countLexiconHits('any text here', [])).toBe(0);
  });
});

// ── Lexicon exports ─────────────────────────────────────────

describe('lexicon exports', () => {
  it('exports non-empty lexicon arrays', () => {
    expect(HEDGE_LEXICON.length).toBeGreaterThan(0);
    expect(ASSERTIVE_LEXICON.length).toBeGreaterThan(0);
    expect(CONCESSIVE_LEXICON.length).toBeGreaterThan(0);
    expect(META_DISCOURSE_LEXICON.length).toBeGreaterThan(0);
    expect(SYNTHESIS_INTEGRATION_LEXICON.length).toBeGreaterThan(0);
    expect(CONDITIONAL_AGREEMENT_LEXICON.length).toBeGreaterThan(0);
  });

  it('lexicon entries are non-empty strings', () => {
    for (const lex of [HEDGE_LEXICON, ASSERTIVE_LEXICON, CONCESSIVE_LEXICON, META_DISCOURSE_LEXICON, SYNTHESIS_INTEGRATION_LEXICON, CONDITIONAL_AGREEMENT_LEXICON]) {
      for (const phrase of lex) {
        expect(typeof phrase).toBe('string');
        expect(phrase.length).toBeGreaterThan(0);
      }
    }
  });

  it('countLexiconHits matches case-insensitively regardless of lexicon casing', () => {
    // Some lexicon entries have capitals (e.g. "I suspect") — matching should still work
    expect(countLexiconHits('i suspect this is true', HEDGE_LEXICON)).toBeGreaterThanOrEqual(1);
    expect(countLexiconHits('I SUSPECT THIS IS TRUE', HEDGE_LEXICON)).toBeGreaterThanOrEqual(1);
  });
});

// ── computePragmaticConvergence ──────────────────────────────

describe('computePragmaticConvergence', () => {
  it('returns 0 for empty texts', () => {
    expect(computePragmaticConvergence([], [], 0)).toBe(0);
  });

  it('returns 0 when window texts are empty but debate texts are not', () => {
    expect(computePragmaticConvergence([], ['Some debate text'], 0)).toBe(0);
  });

  it('returns a value in [0, 1]', () => {
    const texts = ['Perhaps this seems right.'];
    const meanTexts = ['Perhaps this seems right. Clearly true.'];
    const result = computePragmaticConvergence(texts, meanTexts, 0.5);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns higher convergence when hedging drops relative to assertives', () => {
    // Mean has lots of hedging, window is all assertive → hedge density drop → higher convergence
    const hedgyTexts = [
      'Perhaps this might seem like it could be possible.',
      'Perhaps this might seem like it could be possible.',
    ];
    const assertiveTexts = [
      'Clearly and necessarily, this is undeniably true.',
      'Obviously and certainly, this demonstrably follows.',
    ];
    const convergenceWithHedgeDrop = computePragmaticConvergence(
      assertiveTexts, hedgyTexts, 0,
    );
    const convergenceWithoutDrop = computePragmaticConvergence(
      hedgyTexts, hedgyTexts, 0,
    );
    expect(convergenceWithHedgeDrop).toBeGreaterThan(convergenceWithoutDrop);
  });

  it('returns higher convergence when concessive rate drops from peak', () => {
    // peakConcessiveRate is high, current texts have no concessive markers → concessive plateau
    const noConcessiveTexts = ['AI is great. Technology advances.'];
    const result = computePragmaticConvergence(
      noConcessiveTexts, noConcessiveTexts, 5.0,
    );
    // Sub-signal (b) should contribute because concessive rate dropped from peak
    expect(result).toBeGreaterThan(0);
  });

  it('returns higher convergence when meta-discourse markers are present', () => {
    const metaTexts = ['The central disagreement is about timelines. The crux is safety.'];
    const noMetaTexts = ['I think AI is good.'];
    const withMeta = computePragmaticConvergence(metaTexts, metaTexts, 0);
    const withoutMeta = computePragmaticConvergence(noMetaTexts, noMetaTexts, 0);
    expect(withMeta).toBeGreaterThan(withoutMeta);
  });

  it('handles peakConcessiveRate of 0', () => {
    const texts = ['Some text here.'];
    const result = computePragmaticConvergence(texts, texts, 0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('handles single-text inputs', () => {
    const texts = ['Perhaps.'];
    const result = computePragmaticConvergence(texts, texts, 0.1);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ── computeSynthesisPragmaticSignal ──────────────────────────

describe('computeSynthesisPragmaticSignal', () => {
  it('returns 0 for empty texts', () => {
    expect(computeSynthesisPragmaticSignal([], [])).toBe(0);
  });

  it('returns 0 when window texts are empty but exploration texts are not', () => {
    expect(computeSynthesisPragmaticSignal([], ['exploration text'])).toBe(0);
  });

  it('returns a value in [0, 1]', () => {
    const texts = ['Building on the previous point, if we accept the data...'];
    const explorationTexts = ['Perhaps this seems possible.'];
    const result = computeSynthesisPragmaticSignal(texts, explorationTexts);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns higher value when synthesis integration language is present', () => {
    const integrationTexts = [
      'Building on these perspectives, combining these perspectives leads to a possible resolution.',
      'Synthesizing the arguments, integrating the evidence suggests a way forward.',
    ];
    const plainTexts = ['I think AI is good. Markets will decide.'];
    const withIntegration = computeSynthesisPragmaticSignal(integrationTexts, []);
    const withoutIntegration = computeSynthesisPragmaticSignal(plainTexts, []);
    expect(withIntegration).toBeGreaterThan(withoutIntegration);
  });

  it('returns higher value when conditional agreement markers are present', () => {
    const conditionalTexts = [
      'If we accept the premise, provided that safeguards exist, assuming that oversight is maintained.',
    ];
    const plainTexts = ['I disagree completely.'];
    const withConditional = computeSynthesisPragmaticSignal(conditionalTexts, []);
    const withoutConditional = computeSynthesisPragmaticSignal(plainTexts, []);
    expect(withConditional).toBeGreaterThan(withoutConditional);
  });

  it('returns higher value when hedging has decreased from exploration', () => {
    // Exploration was hedgy, synthesis is not → qualification drop
    const hedgyExploration = [
      'Perhaps this might seem like it could be argued.',
      'I suspect this seems tentatively correct.',
    ];
    const confidentSynthesis = ['The evidence clearly shows a path forward.'];
    const result = computeSynthesisPragmaticSignal(confidentSynthesis, hedgyExploration);
    // Sub-signal (c) should contribute positively
    expect(result).toBeGreaterThan(0);
  });

  it('handles empty exploration texts', () => {
    const texts = ['Building on the previous point.'];
    const result = computeSynthesisPragmaticSignal(texts, []);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
