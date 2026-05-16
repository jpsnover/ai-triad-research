// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Structural ambiguity-collapse detector.
 * Replaces LLM self-reported ambiguity_resolved with deterministic
 * hedging-language comparison between source text and extraction.
 *
 * Rationale: The model that collapsed an ambiguity is the worst possible
 * judge of whether it did so (Gur-Arieh et al., 2026).
 */

// ── Hedging markers ─────────────────────────────────────

/** Words/phrases that signal the source is hedging, uncertain, or presenting alternatives. */
const HEDGING_PATTERNS = [
  /\bmay\b/i,
  /\bmight\b/i,
  /\bcould\b/i,
  /\bperhaps\b/i,
  /\bpotentially\b/i,
  /\bpossibly\b/i,
  /\blikely\b/i,
  /\bunlikely\b/i,
  /\buncertain\b/i,
  /\bunclear\b/i,
  /\bdebated\b/i,
  /\bcontested\b/i,
  /\barguably\b/i,
  /\btentative(?:ly)?\b/i,
  /\bsome argue\b/i,
  /\bsome suggest\b/i,
  /\bsome believe\b/i,
  /\bothers (?:argue|contend|suggest|believe|claim)\b/i,
  /\bon the other hand\b/i,
  /\bit is (?:not )?clear (?:whether|that|if)\b/i,
  /\bremains? (?:to be seen|contested|open|unclear|uncertain|debated)\b/i,
  /\bwhether or not\b/i,
  /\bopen question\b/i,
  /\bin dispute\b/i,
  /\bnot yet (?:established|settled|resolved|determined)\b/i,
];

// ── Core detector ───────────────────────────────────────

export type AmbiguityResolution = 'none' | 'acknowledged' | 'collapsed';

export interface AmbiguityDetectionResult {
  resolution: AmbiguityResolution;
  source_hedge_count: number;
  extraction_hedge_count: number;
  source_hedges_found: string[];
}

/**
 * Detect whether an extraction collapsed an ambiguity the source left open.
 *
 * @param sourceText - the original source passage (debate statement or document excerpt)
 * @param extractedClaim - the extracted claim text
 * @returns detection result with resolution classification and evidence
 */
export function detectAmbiguityCollapse(
  sourceText: string,
  extractedClaim: string,
): AmbiguityDetectionResult {
  if (!sourceText || !extractedClaim) {
    return { resolution: 'none', source_hedge_count: 0, extraction_hedge_count: 0, source_hedges_found: [] };
  }

  // Find hedging markers in source
  const sourceHedges: string[] = [];
  for (const pattern of HEDGING_PATTERNS) {
    const matches = sourceText.match(new RegExp(pattern.source, 'gi'));
    if (matches) {
      for (const m of matches) sourceHedges.push(m.toLowerCase());
    }
  }

  // Find hedging markers in extraction
  let extractionHedgeCount = 0;
  for (const pattern of HEDGING_PATTERNS) {
    const matches = extractedClaim.match(new RegExp(pattern.source, 'gi'));
    if (matches) extractionHedgeCount += matches.length;
  }

  const sourceHedgeCount = sourceHedges.length;

  // Classification logic:
  // - Source has hedging, extraction has none → COLLAPSED
  // - Source has hedging, extraction preserves some → ACKNOWLEDGED
  // - Source has no hedging → NONE (nothing to collapse)
  if (sourceHedgeCount === 0) {
    return { resolution: 'none', source_hedge_count: 0, extraction_hedge_count: extractionHedgeCount, source_hedges_found: [] };
  }

  // Source has hedging. Did the extraction preserve it?
  if (extractionHedgeCount === 0) {
    // Source hedges but extraction doesn't — ambiguity was collapsed
    return {
      resolution: 'collapsed',
      source_hedge_count: sourceHedgeCount,
      extraction_hedge_count: 0,
      source_hedges_found: [...new Set(sourceHedges)],
    };
  }

  // Both have hedging — ambiguity acknowledged
  return {
    resolution: 'acknowledged',
    source_hedge_count: sourceHedgeCount,
    extraction_hedge_count: extractionHedgeCount,
    source_hedges_found: [...new Set(sourceHedges)],
  };
}

/**
 * Find the source passage most relevant to an extracted claim.
 * Uses a sliding window to find the passage with highest word overlap.
 */
export function findSourcePassage(
  sourceText: string,
  extractedClaim: string,
  windowChars: number = 500,
): string {
  if (!sourceText || sourceText.length <= windowChars) return sourceText;

  const claimWords = new Set(
    extractedClaim.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3),
  );
  if (claimWords.size === 0) return sourceText.slice(0, windowChars);

  let bestOverlap = 0;
  let bestStart = 0;
  const step = Math.max(50, Math.floor(windowChars / 4));

  for (let start = 0; start <= sourceText.length - windowChars; start += step) {
    const window = sourceText.slice(start, start + windowChars);
    const windowWords = new Set(
      window.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3),
    );
    let overlap = 0;
    for (const w of claimWords) {
      if (windowWords.has(w)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestStart = start;
    }
  }

  return sourceText.slice(bestStart, bestStart + windowChars);
}
