// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Post-hoc vocabulary disambiguation — resolves bare colloquial terms
 * in debate claim text to canonical forms based on speaker POV.
 *
 * This is a deterministic lookup, not an LLM call. The colloquial→canonical
 * mapping per POV already exists in the vocabulary data.
 */

import type { ColloquialTerm, CampOrigin, ConfidenceLevel } from '../dictionary/types.js';

// ── Types ─────────────────────────────────────────────────

export interface DisambiguatedTerm {
  /** The bare colloquial term found in text. */
  bare: string;
  /** Resolved canonical form (empty string if ambiguous). */
  canonical: string;
  /** Resolution confidence. */
  confidence: ConfidenceLevel;
  /** True if the term couldn't be resolved to a single canonical form. */
  ambiguous: boolean;
  /** Character offset of the match in the original text. */
  offset: number;
}

export interface DisambiguationResult {
  /** All resolved terms (including ambiguous ones). */
  terms: DisambiguatedTerm[];
  /** Count of successfully resolved terms. */
  resolvedCount: number;
  /** Count of ambiguous terms needing review. */
  ambiguousCount: number;
}

// ── Core Function ──────────────────────────────────────────

/**
 * Scan text for bare colloquial terms and resolve them to canonical forms
 * using speaker POV as the primary disambiguation signal.
 *
 * Resolution priority:
 * 1. Camp-specific default: `default_for_camp === speakerPov` → use that resolution
 * 2. Single resolution: only one `resolves_to` entry → use it
 * 3. Ambiguous: multiple resolutions, no camp match → flag for review
 */
export function disambiguateTerms(
  text: string,
  speakerPov: CampOrigin,
  colloquialTerms: ColloquialTerm[],
): DisambiguationResult {
  const bareTerms = colloquialTerms.filter(t => t.status === 'do_not_use_bare');
  const results: DisambiguatedTerm[] = [];

  for (const term of bareTerms) {
    const pattern = buildWordBoundaryPattern(term.colloquial_term);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      results.push(resolveMatch(term, speakerPov, match.index));
    }
  }

  // Sort by offset for stable ordering
  results.sort((a, b) => a.offset - b.offset);

  return {
    terms: results,
    resolvedCount: results.filter(t => !t.ambiguous).length,
    ambiguousCount: results.filter(t => t.ambiguous).length,
  };
}

// ── Helpers ────────────────────────────────────────────────

function buildWordBoundaryPattern(term: string): RegExp {
  // Escape regex special chars in the term
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word boundary match, case-insensitive, global
  return new RegExp(`\\b${escaped}\\b`, 'gi');
}

function resolveMatch(
  term: ColloquialTerm,
  speakerPov: CampOrigin,
  offset: number,
): DisambiguatedTerm {
  const resolutions = term.resolves_to;

  // Priority 1: Camp-specific default
  const campDefault = resolutions.find(r => r.default_for_camp === speakerPov);
  if (campDefault) {
    return {
      bare: term.colloquial_term,
      canonical: campDefault.standardized_term,
      confidence: campDefault.confidence_typical ?? 'high',
      ambiguous: false,
      offset,
    };
  }

  // Priority 2: Single resolution (no camp preference needed)
  if (resolutions.length === 1) {
    return {
      bare: term.colloquial_term,
      canonical: resolutions[0].standardized_term,
      confidence: resolutions[0].confidence_typical ?? 'medium',
      ambiguous: false,
      offset,
    };
  }

  // Priority 3: Ambiguous — multiple resolutions, no camp match
  return {
    bare: term.colloquial_term,
    canonical: '',
    confidence: 'low',
    ambiguous: true,
    offset,
  };
}
