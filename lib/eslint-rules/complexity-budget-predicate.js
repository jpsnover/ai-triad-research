// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared predicate for the complexity-budget rule and baseline generator (t/3821).
// Both must agree on what is "acceptable" — a regression in the rule equals a
// regeneration trigger in the generator, and vice versa.

// countOver ceiling multipliers for the decomposition clause (SO condition 2, e/240#9).
// When max strictly falls, countOver may rise — but not by more than 2× + 5.
// Honest splits (one 100-complexity function → two 40-complexity functions) raise countOver
// modestly and stay well inside. Pathological growth (max falls by 1, countOver → 500)
// fails. Numbers are deliberately loose; tighten only if the realistic failure mode changes.
const DECOMP_CEIL_MULT = 2;
const DECOMP_CEIL_ADD  = 5;

/**
 * Returns true when the observed file stats are acceptable relative to the baseline.
 *
 * Acceptable means:
 *   1. max decreased (decomposition) AND countOver growth is within the loose ceiling
 *   2. max is stable AND countOver is stable or improved (Pareto)
 *
 * @param {{ max: number; countOver: number }} observed
 * @param {{ max: number; countOver: number }} existing
 * @returns {boolean}
 */
export function isAcceptable(observed, existing) {
  if (observed.max < existing.max) {
    // Decomposition: max strictly fell. Allow countOver to rise, but cap pathological growth.
    const ceiling = Math.max(existing.countOver * DECOMP_CEIL_MULT, existing.countOver + DECOMP_CEIL_ADD);
    return observed.countOver <= ceiling;
  }
  if (observed.max <= existing.max && observed.countOver <= existing.countOver) return true;
  return false;
}
