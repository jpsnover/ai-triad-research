// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared predicate for the complexity-budget rule and baseline generator (t/3821).
// Both must agree on what is "acceptable" — a regression in the rule equals a
// regeneration trigger in the generator, and vice versa.

/**
 * Returns true when the observed file stats are acceptable relative to the baseline.
 *
 * Acceptable means:
 *   1. max decreased (decomposition) AND countOver growth is within the ceiling
 *   2. max is stable AND countOver is stable or improved (Pareto)
 *
 * Decomposition ceiling: max(existing.countOver + 5, ceil(existing.max / threshold))
 * — "how many threshold-sized functions could this complexity legitimately become."
 * Anchored to existing.max rather than existing.countOver: a single 408-complexity
 * function has countOver=1, making a 2×+5 ceiling too tight to permit any real
 * decomposition (deadlock: split fails the rule AND the generator refuses to write
 * new values because it shares this predicate — no escape, t/3821).
 *
 * Residual: a one-point shave buys the full ceil(max/threshold) allowance
 * (e.g., {408,1}→{407,28} passes). Bounded — the allowance scales with existing.max.
 * Tightening it would re-enter the false-positive regime that produced this defect.
 *
 * The threshold parameter is safe to trust: the rule's thresholdMismatch check
 * errors before any ceiling computation if the baseline was generated at a different
 * threshold (t/3838), so callers can pass their configured threshold directly.
 *
 * @param {{ max: number; countOver: number }} observed
 * @param {{ max: number; countOver: number }} existing
 * @param {number} threshold
 * @returns {boolean}
 */
export function isAcceptable(observed, existing, threshold) {
  if (observed.max < existing.max) {
    // Decomposition: max strictly fell. Allow countOver to rise within the ceiling.
    const ceiling = Math.max(existing.countOver + 5, Math.ceil(existing.max / threshold));
    return observed.countOver <= ceiling;
  }
  if (observed.max <= existing.max && observed.countOver <= existing.countOver) return true;
  return false;
}
