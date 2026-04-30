// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Pragmatic convergence signals — lexicon-based detection of debate maturation
 * patterns. Computes hedge/assertive ratios, concessive plateaus, meta-discourse
 * crux markers, synthesis language density, and conditional agreement rates.
 * Pure computation module — no LLM calls, no imports from other debate modules.
 */

// ── Lexicons ─────────────────────────────────────────────

export const HEDGE_LEXICON = [
  'perhaps',
  'seems',
  'I suspect',
  'might',
  'could be',
  "it's possible",
  'arguably',
  'one might think',
  'it appears',
  'tentatively',
  'I would suggest',
  'to some extent',
  'not necessarily',
  'in some cases',
  'it remains unclear',
] as const;

export const ASSERTIVE_LEXICON = [
  'clearly',
  'necessarily',
  'entails',
  'obviously',
  'certainly',
  'undeniably',
  'without question',
  'it follows that',
  'the evidence shows',
  'demonstrably',
  'incontrovertibly',
  'unambiguously',
] as const;

export const CONCESSIVE_LEXICON = [
  'however',
  'granted that',
  'although',
  'nonetheless',
  'I concede',
  'that said',
  'admittedly',
  'while I agree',
  'fair point',
  "you're right that",
  "I'll grant",
  'notwithstanding',
  'even so',
  'despite this',
  'acknowledging that',
] as const;

export const META_DISCOURSE_LEXICON = [
  'the central disagreement',
  'the crux is',
  'what this really comes down to',
  'the fundamental question',
  'the core tension',
  'the real issue is',
  'at the heart of',
  'the key disagreement',
  'where we fundamentally differ',
  'the root of our disagreement',
  'the decisive question',
  'the essential trade-off',
  'this hinges on',
  'the critical assumption',
  'what ultimately matters here',
  'the deepest point of contention',
  'the irreducible disagreement',
] as const;

export const SYNTHESIS_INTEGRATION_LEXICON = [
  'building on',
  'combining these perspectives',
  'a possible resolution',
  'synthesizing',
  'integrating',
  'if we bring together',
] as const;

export const CONDITIONAL_AGREEMENT_LEXICON = [
  'if we accept',
  'provided that',
  'under the condition',
  'assuming that',
  'contingent on',
  'if it turns out',
] as const;

// ── Helpers ──────────────────────────────────────────────

/**
 * Count lexicon hits in a text using case-insensitive substring matching.
 * Each phrase in the lexicon is matched independently; overlapping matches
 * are counted separately.
 */
export function countLexiconHits(text: string, lexicon: readonly string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const phrase of lexicon) {
    const needle = phrase.toLowerCase();
    let startIdx = 0;
    while (true) {
      const idx = lower.indexOf(needle, startIdx);
      if (idx === -1) break;
      count++;
      startIdx = idx + 1;
    }
  }
  return count;
}

/**
 * Compute the rate of lexicon hits per text across an array of texts.
 * Returns 0 when texts is empty.
 */
function lexiconRate(texts: string[], lexicon: readonly string[]): number {
  if (texts.length === 0) return 0;
  const totalHits = texts.reduce((sum, t) => sum + countLexiconHits(t, lexicon), 0);
  return totalHits / texts.length;
}

/**
 * Compute the fraction of texts containing at least one hit from the lexicon.
 * Returns 0 when texts is empty.
 */
function lexiconFraction(texts: string[], lexicon: readonly string[]): number {
  if (texts.length === 0) return 0;
  const matchCount = texts.filter(t => countLexiconHits(t, lexicon) > 0).length;
  return matchCount / texts.length;
}

// ── Public API ───────────────────────────────────────────

/**
 * Compute pragmatic convergence signal for the saturation stage detector.
 *
 * @param texts - Debater texts from the last 2-round window
 * @param debateMeanTexts - All debater texts in the debate (for computing mean rates)
 * @param peakConcessiveRate - The highest concessive rate observed so far in the debate
 * @returns A value in [0, 1] where higher means more saturated (positions crystallized)
 */
export function computePragmaticConvergence(
  texts: string[],
  debateMeanTexts: string[],
  peakConcessiveRate: number,
): number {
  if (texts.length === 0) return 0;

  // Sub-signal (a): Hedge density drop
  // Compute hedge-to-assertive ratio for the window vs the debate mean.
  // When hedging drops relative to assertives, positions have crystallized.
  const windowHedgeRate = lexiconRate(texts, HEDGE_LEXICON);
  const windowAssertiveRate = lexiconRate(texts, ASSERTIVE_LEXICON);
  const meanHedgeRate = lexiconRate(debateMeanTexts, HEDGE_LEXICON);
  const meanAssertiveRate = lexiconRate(debateMeanTexts, ASSERTIVE_LEXICON);

  const windowRatio = windowAssertiveRate > 0
    ? windowHedgeRate / windowAssertiveRate
    : windowHedgeRate;
  const meanRatio = meanAssertiveRate > 0
    ? meanHedgeRate / meanAssertiveRate
    : meanHedgeRate;

  // A drop in hedge/assertive ratio from the mean signals crystallization.
  // Clamp to [0, 1]: if windowRatio >= meanRatio, no drop → 0.
  const hedgeDensityDrop = meanRatio > 0
    ? Math.max(0, Math.min(1, 1 - windowRatio / meanRatio))
    : 0;

  // Sub-signal (b): Concessive marker plateau
  // When concessive rate drops from its peak, debaters have stopped making
  // new concessions → saturation.
  const windowConcessiveRate = lexiconRate(texts, CONCESSIVE_LEXICON);
  const concessivePlateau = peakConcessiveRate > 0
    ? Math.max(0, Math.min(1, 1 - windowConcessiveRate / peakConcessiveRate))
    : 0;

  // Sub-signal (c): Meta-discourse crux markers
  // Fraction of texts containing at least one meta-discourse marker.
  const metaDiscourseFraction = lexiconFraction(texts, META_DISCOURSE_LEXICON);

  // Average the three sub-signals
  return (hedgeDensityDrop + concessivePlateau + metaDiscourseFraction) / 3;
}

/**
 * Compute synthesis pragmatic signal for the synthesis stage detector.
 *
 * @param texts - Debater texts from the current synthesis window
 * @param explorationTexts - Debater texts from the exploration phase (for baseline)
 * @returns A value in [0, 1] where higher means synthesis is progressing well
 */
export function computeSynthesisPragmaticSignal(
  texts: string[],
  explorationTexts: string[],
): number {
  if (texts.length === 0) return 0;

  // Sub-signal (a): Integration language density
  // Frequency of synthesis integration phrases in the current window.
  // Normalize: cap at a reasonable max (e.g. 3 hits per text on average → 1.0).
  const integrationRate = lexiconRate(texts, SYNTHESIS_INTEGRATION_LEXICON);
  const integrationDensity = Math.min(1, integrationRate / 3);

  // Sub-signal (b): Conditional agreement markers
  // Frequency of conditional agreement structures.
  // Normalize similarly.
  const conditionalRate = lexiconRate(texts, CONDITIONAL_AGREEMENT_LEXICON);
  const conditionalDensity = Math.min(1, conditionalRate / 3);

  // Sub-signal (c): Diminishing qualification rate
  // Drop in new hedge qualifications relative to the exploration phase.
  // If hedging has decreased from exploration, synthesis is replacing uncertainty
  // with conditional structure.
  const currentHedgeRate = lexiconRate(texts, HEDGE_LEXICON);
  const explorationHedgeRate = lexiconRate(explorationTexts, HEDGE_LEXICON);
  const qualificationDrop = explorationHedgeRate > 0
    ? Math.max(0, Math.min(1, 1 - currentHedgeRate / explorationHedgeRate))
    : 0;

  // Average the three sub-signals
  return (integrationDensity + conditionalDensity + qualificationDrop) / 3;
}
