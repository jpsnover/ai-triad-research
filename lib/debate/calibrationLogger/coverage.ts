// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Extraction coverage measurement (ADR-007 file-size split, t/1686; logic t/391).
 *
 * Samples debater turns and, via an LLM decomposition + coverage check, records
 * what fraction of verifiable information elements were captured as AN claims.
 * Mutates the session's per-entry diagnostics in place; failures are non-blocking.
 */

import type { DebateSession } from '../types.js';
import { elementDecompositionPrompt, coverageCheckPrompt } from '../prompts.js';
import { parseJsonRobust } from '../helpers.js';

// ── Extraction coverage (t/391) ────────────────────────────

export type GenerateFn = (prompt: string) => Promise<string>;

const COVERAGE_SAMPLING_RATE = 0.20;

interface InformationElement {
  text: string;
  element_type: 'verifiable' | 'normative';
}

interface CoverageResult {
  coverage: { element_index: number; covered: boolean; covering_claim_index: number | null }[];
}

export async function computeExtractionCoverage(
  session: DebateSession,
  generateFn: GenerateFn,
  rng: () => number = Math.random,
): Promise<void> {
  const diagEntries = session.diagnostics?.entries;
  if (!diagEntries) return;

  const an = session.argument_network;
  if (!an || an.nodes.length === 0) return;

  const statementEntries = session.transcript.filter(
    e => e.type === 'statement' || e.type === 'opening',
  );
  if (statementEntries.length === 0) return;

  const sampled = statementEntries.filter(() => rng() < COVERAGE_SAMPLING_RATE);
  if (sampled.length === 0) return;

  for (const entry of sampled) {
    const entryDiag = diagEntries[entry.id];
    if (!entryDiag || entryDiag.extraction_coverage) continue;

    const myClaims = an.nodes
      .filter(n => n.source_entry_id === entry.id)
      .map(n => n.text);

    if (myClaims.length === 0) continue;

    try {
      const decompRaw = await generateFn(elementDecompositionPrompt(entry.content));
      const decompResult = parseJsonRobust(decompRaw) as { elements?: InformationElement[] };
      const elements = decompResult.elements ?? [];
      if (elements.length === 0) continue;

      const coverRaw = await generateFn(coverageCheckPrompt(elements, myClaims));
      const coverResult = parseJsonRobust(coverRaw) as CoverageResult;
      const coverageItems = coverResult.coverage ?? [];

      const verifiable = elements.filter(e => e.element_type === 'verifiable');
      const normative = elements.filter(e => e.element_type === 'normative');

      const coveredVerifiable = verifiable.filter((_, i) => {
        const globalIdx = elements.indexOf(verifiable[i]);
        return coverageItems.some(c => c.element_index === globalIdx + 1 && c.covered);
      }).length;

      const coveredNormative = normative.filter((_, i) => {
        const globalIdx = elements.indexOf(normative[i]);
        return coverageItems.some(c => c.element_index === globalIdx + 1 && c.covered);
      }).length;

      const coverageRate = verifiable.length > 0
        ? coveredVerifiable / verifiable.length
        : 1.0;

      const uncoveredElements = elements
        .filter((e, i) => !coverageItems.some(c => c.element_index === i + 1 && c.covered))
        .map(e => ({ text: e.text, element_type: e.element_type as 'verifiable' | 'normative' }));

      entryDiag.extraction_coverage = {
        total_elements: elements.length,
        verifiable_elements: verifiable.length,
        normative_elements: normative.length,
        covered_verifiable: coveredVerifiable,
        covered_normative: coveredNormative,
        coverage_rate: Math.round(coverageRate * 1000) / 1000,
        uncovered_elements: uncoveredElements.length > 0 ? uncoveredElements : undefined,
      };
    } catch {
      // Coverage computation failure is non-blocking
    }
  }
}
