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

// ── Negation handling ────────────────────────────────────

const NEGATION_TOKENS = new Set([
  'not', 'never', 'no', 'neither', 'nor', 'cannot',
  // Contractions — matched as whole tokens
  "n't", "don't", "doesn't", "didn't", "won't", "wouldn't",
  "can't", "couldn't", "shouldn't", "isn't", "aren't",
  "hasn't", "haven't", "hadn't",
]);

const NEGATION_WINDOW = 4; // tokens to scan before match

/**
 * Check if a match at the given character index is preceded by a negation
 * within NEGATION_WINDOW tokens. Tokenizes the preceding text by whitespace.
 */
function isNegated(lowerText: string, matchIndex: number): boolean {
  const prefix = lowerText.slice(Math.max(0, matchIndex - 60), matchIndex);
  const tokens = prefix.split(/\s+/).filter(t => t.length > 0).slice(-NEGATION_WINDOW);
  return tokens.some(t => NEGATION_TOKENS.has(t) || t.endsWith("n't"));
}

/**
 * Check if a lexicon phrase is inherently negation-bearing (e.g. "not necessarily").
 * Such phrases are immune to the negation window filter.
 */
function isNegationBearing(phrase: string): boolean {
  const firstWord = phrase.split(/\s+/)[0].toLowerCase();
  return NEGATION_TOKENS.has(firstWord) || firstWord.endsWith("n't");
}

/**
 * Build a word-boundary regex for a lexicon phrase.
 * Matches the phrase as a complete unit (not as a substring of a longer word).
 */
function buildPhraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'gi');
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Count lexicon hits in a text using word-boundary matching with negation filtering.
 * Each phrase in the lexicon is matched independently via regex word-boundary.
 * Matches preceded by a negation token within 4 tokens are excluded.
 * Phrases that themselves begin with a negation (e.g. "not necessarily") are immune.
 */
export function countLexiconHits(text: string, lexicon: readonly string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const phrase of lexicon) {
    const regex = buildPhraseRegex(phrase);
    const immune = isNegationBearing(phrase);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lower)) !== null) {
      if (immune || !isNegated(lower, match.index)) {
        count++;
      }
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
 * @param argumentationTexts - Debater texts from the exploration phase (for baseline)
 * @returns A value in [0, 1] where higher means synthesis is progressing well
 */
export function computeConcludingPragmaticSignal(
  texts: string[],
  argumentationTexts: string[],
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
  const argumentationHedgeRate = lexiconRate(argumentationTexts, HEDGE_LEXICON);
  const qualificationDrop = argumentationHedgeRate > 0
    ? Math.max(0, Math.min(1, 1 - currentHedgeRate / argumentationHedgeRate))
    : 0;

  // Average the three sub-signals
  return (integrationDensity + conditionalDensity + qualificationDrop) / 3;
}
