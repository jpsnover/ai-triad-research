// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared predicate for the complexity-budget rule and baseline generator (t/3821).
// Both must agree on what is "acceptable" — a regression in the rule equals a
// regeneration trigger in the generator, and vice versa.

/**
 * Returns true when the observed file stats are acceptable relative to the baseline.
 *
 * Acceptable means:
 *   1. max decreased (decomposition: one large function was split; countOver may rise)
 *   2. max is stable AND countOver is stable or improved
 *
 * @param {{ max: number; countOver: number }} observed
 * @param {{ max: number; countOver: number }} existing
 * @returns {boolean}
 */
export function isAcceptable(observed, existing) {
  if (observed.max < existing.max) return true; // decomposition — countOver may rise
  if (observed.max <= existing.max && observed.countOver <= existing.countOver) return true;
  return false;
}
