// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Scheme Stagnation and Camp Insularity Detection
 *
 * Computes when a debate is recycling the same argumentation scheme patterns
 * or when a debater is citing only their own camp's taxonomy nodes.
 * Part of the adaptive debate staging system.
 *
 * Pure computation — depends only on nodeIdUtils for POV prefix resolution.
 */

import { nodePovFromId } from './nodeIdUtils.js';

/**
 * Compute scheme stagnation: how much the recent argumentation schemes
 * have contracted relative to the full debate's scheme repertoire.
 *
 * @param recentSchemes - argumentation_scheme values from the last 2 rounds
 * @param allSchemes - argumentation_scheme values from the entire debate
 * @returns A value in [0, 1] where 1 = complete stagnation, 0 = no stagnation
 *
 * Formula: 1 - (unique schemes in recent / unique schemes in entire debate)
 *
 * Edge cases:
 * - If allSchemes is empty or has 0 unique values, returns 0 (no stagnation data)
 * - If recentSchemes is empty, returns 1.0 (complete stagnation)
 */
export function computeSchemeStagnation(
  recentSchemes: string[],
  allSchemes: string[],
): number {
  const uniqueAll = new Set(allSchemes).size;

  if (uniqueAll === 0) {
    return 0;
  }

  if (recentSchemes.length === 0) {
    return 1.0;
  }

  const uniqueRecent = new Set(recentSchemes).size;
  return 1 - uniqueRecent / uniqueAll;
}

/**
 * Compute scheme coverage factor: how broadly the debate has drawn from
 * the available argumentation schemes.
 *
 * Used as a multiplier on crux_maturity to penalize debates with
 * repetitive reasoning.
 *
 * @param allSchemes - argumentation_scheme values from the entire debate
 * @param availableSchemes - total number of defined schemes in the system (default 13)
 * @returns A value in [0, 1] where 1 = full coverage, lower = more repetitive
 *
 * Formula: min(1, uniqueSchemesUsed / min(6, availableSchemes))
 */
/**
 * Compute scheme bigram diversity: how many distinct scheme pairs appear
 * across recent turns. Low diversity indicates combinatorial stagnation
 * (debaters reusing the same scheme combinations).
 *
 * @param schemesPerTurn - array of arrays: each inner array is the schemes
 *   used in a single turn
 * @returns A value in [0, 1] where 1 = all pairs unique, lower = repetitive pairs.
 *   Returns 1.0 if there are fewer than 2 total bigrams (insufficient data).
 */
export function schemeBigramDiversity(schemesPerTurn: string[][]): number {
  const bigrams = new Set<string>();
  let totalBigrams = 0;

  for (const schemes of schemesPerTurn) {
    const unique = [...new Set(schemes)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const bigram = [unique[i], unique[j]].sort().join('→');
        bigrams.add(bigram);
        totalBigrams++;
      }
    }
  }

  if (totalBigrams < 2) return 1.0;
  return bigrams.size / totalBigrams;
}

/**
 * Combined scheme stagnation: weighted blend of unigram stagnation
 * and bigram stagnation (1 - bigram diversity).
 *
 * Bigram gets 60% weight because it catches combinatorial patterns
 * that unigram diversity misses.
 */
export function computeSchemeStagnationCombined(
  recentSchemes: string[],
  allSchemes: string[],
  recentSchemesPerTurn: string[][],
): number {
  const unigramStagnation = computeSchemeStagnation(recentSchemes, allSchemes);
  const bigramDiv = schemeBigramDiversity(recentSchemesPerTurn);
  const bigramStagnation = 1 - bigramDiv;

  return 0.4 * unigramStagnation + 0.6 * bigramStagnation;
}

export function computeSchemeCoverageFactor(
  allSchemes: string[],
  availableSchemes: number = 13,
): number {
  const uniqueSchemesUsed = new Set(allSchemes).size;
  const denominator = Math.min(6, availableSchemes);

  if (denominator === 0) {
    return 0;
  }

  return Math.min(1, uniqueSchemesUsed / denominator);
}

// ── Camp Insularity Detection ───────────────────────────

export const DEFAULT_INSULARITY_THRESHOLD = 0.75;
export const MIN_CITATIONS_FOR_INSULARITY = 4;

/**
 * Compute the fraction of taxonomy node citations that belong to the
 * speaker's own POV camp.
 *
 * @param nodeIds - taxonomy node IDs cited by the speaker in recent turns
 * @param speakerPov - the debater's POV ('accelerationist', 'safetyist', 'skeptic')
 * @returns A value in [0, 1]. 1 = all citations are own-camp. 0 = no own-camp citations.
 *   Returns null if nodeIds is empty or no camp-specific nodes are present.
 *
 * Cross-cutting nodes (cc-*, sit-*, pol-*) are excluded from the ratio — only
 * POV-attributed nodes (acc-*, saf-*, skp-*) count.
 */
export function computeCampInsularityRate(
  nodeIds: string[],
  speakerPov: string,
): number | null {
  let sameCamp = 0;
  let totalCampSpecific = 0;

  for (const id of nodeIds) {
    const pov = nodePovFromId(id);
    if (!pov || pov === 'situations' || pov === 'conflicts') continue;
    totalCampSpecific++;
    if (pov === speakerPov) sameCamp++;
  }

  if (totalCampSpecific === 0) return null;
  return sameCamp / totalCampSpecific;
}

/**
 * Check whether the camp insularity rate exceeds the threshold with enough
 * citations to be meaningful.
 */
export function isInsularityCritical(
  rate: number,
  totalCampCitations: number,
  threshold: number = DEFAULT_INSULARITY_THRESHOLD,
): boolean {
  return totalCampCitations >= MIN_CITATIONS_FOR_INSULARITY && rate > threshold;
}

// ── Cross-Camp Insularity Intervention ────────────────

const ALL_CAMPS = ['accelerationist', 'safetyist', 'skeptic'] as const;

export interface InsularityInjection {
  node_id: string;
  node_label: string;
  target_camp: string;
  camp_engagement: Record<string, number>;
  insularity_rate: number;
}

/**
 * Select a cross-camp taxonomy node to inject when camp insularity is critical.
 *
 * Strategy (BEA RUE, pp. 288–302):
 * 1. Count per-camp citations (excluding cross-cutting cc-/sit-/pol- nodes)
 * 2. Pick the camp the speaker engages LEAST (maximum opposing-camp distance)
 * 3. From that camp's available nodes, filter out already-cited ones
 * 4. Rank by nodeScores (hybrid AN+topic relevance) if available; else alphabetical by ID
 *
 * @returns InsularityInjection metadata, or null if no eligible candidates
 */
export function selectCrossCampNode(
  speakerPov: string,
  citedNodeIds: string[],
  candidateNodes: ReadonlyArray<{ id: string; label: string; description?: string }>,
  nodeScores?: Map<string, number>,
): InsularityInjection | null {
  const campCounts: Record<string, number> = {};
  let totalCampSpecific = 0;
  let sameCamp = 0;

  for (const camp of ALL_CAMPS) {
    campCounts[camp] = 0;
  }

  for (const id of citedNodeIds) {
    const pov = nodePovFromId(id);
    if (!pov || pov === 'situations' || pov === 'conflicts') continue;
    totalCampSpecific++;
    if (pov === speakerPov) sameCamp++;
    if (campCounts[pov] !== undefined) {
      campCounts[pov]++;
    }
  }

  if (totalCampSpecific === 0) return null;

  const otherCamps = ALL_CAMPS.filter(c => c !== speakerPov);
  if (otherCamps.length === 0) return null;

  otherCamps.sort((a, b) => {
    const diff = campCounts[a] - campCounts[b];
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
  const targetCamp = otherCamps[0];

  const citedSet = new Set(citedNodeIds);
  const eligible = candidateNodes.filter(n => {
    const pov = nodePovFromId(n.id);
    return pov === targetCamp && !citedSet.has(n.id);
  });

  if (eligible.length === 0) return null;

  let selected: { id: string; label: string; description?: string };
  if (nodeScores) {
    eligible.sort((a, b) => {
      const diff = (nodeScores.get(b.id) ?? 0) - (nodeScores.get(a.id) ?? 0);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });
    selected = eligible[0];
  } else {
    eligible.sort((a, b) => a.id.localeCompare(b.id));
    selected = eligible[0];
  }

  return {
    node_id: selected.id,
    node_label: selected.label,
    target_camp: targetCamp,
    camp_engagement: { ...campCounts },
    insularity_rate: totalCampSpecific > 0 ? sameCamp / totalCampSpecific : 0,
  };
}
