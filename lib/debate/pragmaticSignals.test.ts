// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  countLexiconHits,
  computePragmaticConvergence,
  computeConcludingPragmaticSignal,
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

// ── Negation handling ───────────────────────────────────────

describe('negation handling', () => {
  it('filters negated concessive markers', () => {
    expect(countLexiconHits("I don't concede anything", CONCESSIVE_LEXICON)).toBe(0);
    expect(countLexiconHits("I will never grant that", CONCESSIVE_LEXICON)).toBe(0);
  });

  it('preserves non-negated concessive markers', () => {
    expect(countLexiconHits("I concede the point", CONCESSIVE_LEXICON)).toBe(1);
    expect(countLexiconHits("However, I'll grant that", CONCESSIVE_LEXICON)).toBe(2); // however + I'll grant
  });

  it('preserves negation-bearing phrases (not necessarily)', () => {
    expect(countLexiconHits("This is not necessarily true", HEDGE_LEXICON)).toBe(1);
    expect(countLexiconHits("I don't think it's not necessarily the case", HEDGE_LEXICON)).toBe(1);
  });

  it('filters negated hedge markers', () => {
    expect(countLexiconHits("It doesn't seem like that", HEDGE_LEXICON)).toBe(0);
    expect(countLexiconHits("This cannot arguably be claimed", HEDGE_LEXICON)).toBe(0);
  });

  it('preserves non-negated hedges', () => {
    expect(countLexiconHits("Perhaps we should reconsider", HEDGE_LEXICON)).toBe(1);
    expect(countLexiconHits("It seems likely and might work", HEDGE_LEXICON)).toBe(2);
  });

  it('respects 4-token window (distant negation is ignored)', () => {
    // "not" is 5+ tokens before "perhaps" — outside window
    expect(countLexiconHits("That is not what I meant, but perhaps we can agree", HEDGE_LEXICON)).toBe(1);
  });

  it('uses word boundaries to prevent partial matches', () => {
    expect(countLexiconHits("He was mighty impressed", HEDGE_LEXICON)).toBe(0);
    expect(countLexiconHits("The seemsly thing", HEDGE_LEXICON)).toBe(0);
  });

  it('handles negation after the match (should still count)', () => {
    // "might" matched, "not" comes after → not negated
    expect(countLexiconHits("This might not be true", HEDGE_LEXICON)).toBe(1);
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

// ── computeConcludingPragmaticSignal ──────────────────────────

describe('computeConcludingPragmaticSignal', () => {
  it('returns 0 for empty texts', () => {
    expect(computeConcludingPragmaticSignal([], [])).toBe(0);
  });

  it('returns 0 when window texts are empty but exploration texts are not', () => {
    expect(computeConcludingPragmaticSignal([], ['exploration text'])).toBe(0);
  });

  it('returns a value in [0, 1]', () => {
    const texts = ['Building on the previous point, if we accept the data...'];
    const argumentationTexts = ['Perhaps this seems possible.'];
    const result = computeConcludingPragmaticSignal(texts, argumentationTexts);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns higher value when synthesis integration language is present', () => {
    const integrationTexts = [
      'Building on these perspectives, combining these perspectives leads to a possible resolution.',
      'Synthesizing the arguments, integrating the evidence suggests a way forward.',
    ];
    const plainTexts = ['I think AI is good. Markets will decide.'];
    const withIntegration = computeConcludingPragmaticSignal(integrationTexts, []);
    const withoutIntegration = computeConcludingPragmaticSignal(plainTexts, []);
    expect(withIntegration).toBeGreaterThan(withoutIntegration);
  });

  it('returns higher value when conditional agreement markers are present', () => {
    const conditionalTexts = [
      'If we accept the premise, provided that safeguards exist, assuming that oversight is maintained.',
    ];
    const plainTexts = ['I disagree completely.'];
    const withConditional = computeConcludingPragmaticSignal(conditionalTexts, []);
    const withoutConditional = computeConcludingPragmaticSignal(plainTexts, []);
    expect(withConditional).toBeGreaterThan(withoutConditional);
  });

  it('returns higher value when hedging has decreased from exploration', () => {
    // Exploration was hedgy, synthesis is not → qualification drop
    const hedgyExploration = [
      'Perhaps this might seem like it could be argued.',
      'I suspect this seems tentatively correct.',
    ];
    const confidentSynthesis = ['The evidence clearly shows a path forward.'];
    const result = computeConcludingPragmaticSignal(confidentSynthesis, hedgyExploration);
    // Sub-signal (c) should contribute positively
    expect(result).toBeGreaterThan(0);
  });

  it('handles empty exploration texts', () => {
    const texts = ['Building on the previous point.'];
    const result = computeConcludingPragmaticSignal(texts, []);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
