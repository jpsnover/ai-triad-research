// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Scheme Stagnation Detection
 *
 * Computes when a debate is recycling the same argumentation scheme patterns.
 * Part of the adaptive debate staging system.
 *
 * Pure computation — no dependencies on other debate modules.
 */

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
