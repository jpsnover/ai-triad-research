// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Canonicalizing lookup over INTELLECTUAL_LINEAGES.
//
// Taxonomy POV files contain many near-duplicate lineage values — casing
// variants ("civil rights movement" vs "Civil rights movement"), parenthetical
// qualifiers ("Cognitive psychology (confirmation bias)"), and trailing
// attributions ("epistemology, Kahneman & Tversky"). A canonicalization pass
// collapses 1,078 raw missing values to 579 canonical ones and resolves ~500
// raw variants to existing catalog entries at display time, without mutating
// source data.

import { INTELLECTUAL_LINEAGES } from './intellectualLineageInfo';
import type { AttributeInfo } from './epistemicTypeInfo';

/**
 * Produce a canonical key for lineage matching:
 *   1. Strip parenthetical qualifiers:  "Foo (bar)" -> "Foo"
 *   2. Drop trailing comma tails:       "Foo, e.g. x" -> "Foo"
 *   3. Collapse whitespace and lowercase.
 */
export function canonicalizeLineageKey(raw: string): string {
  return String(raw)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*,.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Build canonical -> original key index once at module load.
let canonicalIndex: Map<string, string> | null = null;
function getCanonicalIndex(): Map<string, string> {
  if (canonicalIndex) return canonicalIndex;
  const idx = new Map<string, string>();
  for (const k of Object.keys(INTELLECTUAL_LINEAGES)) {
    const c = canonicalizeLineageKey(k);
    // First catalog entry wins for a given canonical form.
    if (!idx.has(c)) idx.set(c, k);
  }
  canonicalIndex = idx;
  return idx;
}

export interface LineageLookupResult {
  /** The catalog key that matched (original casing), or null if none. */
  key: string | null;
  info: AttributeInfo | null;
}

/**
 * Resolve a raw lineage value against the catalog using (in order):
 *   1. exact match
 *   2. case-insensitive match
 *   3. canonicalized match (strip parens + trailing comma tail)
 */
export function lookupLineage(raw: string): LineageLookupResult {
  if (!raw) return { key: null, info: null };

  // 1. exact
  const direct = INTELLECTUAL_LINEAGES[raw];
  if (direct) return { key: raw, info: direct };

  // 2. case-insensitive
  const lower = raw.toLowerCase();
  for (const k of Object.keys(INTELLECTUAL_LINEAGES)) {
    if (k.toLowerCase() === lower) {
      return { key: k, info: INTELLECTUAL_LINEAGES[k] };
    }
  }

  // 3. canonicalized
  const canon = canonicalizeLineageKey(raw);
  const hit = getCanonicalIndex().get(canon);
  if (hit) return { key: hit, info: INTELLECTUAL_LINEAGES[hit] };

  return { key: null, info: null };
}

/** Convenience: return only the AttributeInfo (or null). */
export function getLineageInfo(raw: string): AttributeInfo | null {
  return lookupLineage(raw).info;
}
