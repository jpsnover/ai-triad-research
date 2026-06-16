// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Canonicalizing lookup over intellectual lineage data.
//
// Taxonomy POV files contain many near-duplicate lineage values — casing
// variants ("civil rights movement" vs "Civil rights movement"), parenthetical
// qualifiers ("Cognitive psychology (confirmation bias)"), and trailing
// attributions ("epistemology, Kahneman & Tversky"). A canonicalization pass
// collapses 1,078 raw missing values to 579 canonical ones and resolves ~500
// raw variants to existing catalog entries at display time, without mutating
// source data.
//
// Data is loaded asynchronously from the bridge API (t/236). Consumers should
// call initLineageData() at app startup. Until initialized, lookups return null
// but do not throw — this allows components to render gracefully while data loads.

import type { AttributeInfo } from './epistemicTypeInfo';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

/** Module-level data store, populated by initLineageData(). */
let lineageData: Record<string, AttributeInfo> = {};
let initialized = false;

// Build canonical -> original key index lazily (rebuilt when data changes).
let canonicalIndex: Map<string, string> | null = null;

/**
 * Seed the lineage lookup module with data from the bridge API.
 * Safe to call multiple times — subsequent calls replace the data.
 */
export function initLineageData(data: Record<string, AttributeInfo>): void {
  lineageData = data;
  canonicalIndex = null; // rebuild on next lookup
  initialized = true;
}

/** Whether lineage data has been loaded. */
export function isLineageDataInitialized(): boolean {
  return initialized;
}

/** Return the full lineage catalog (for iteration by consumers). */
export function getAllLineages(): Record<string, AttributeInfo> {
  return lineageData;
}

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

function getCanonicalIndex(): Map<string, string> {
  if (canonicalIndex) return canonicalIndex;
  const idx = new Map<string, string>();
  for (const k of Object.keys(lineageData)) {
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
  const direct = lineageData[raw];
  if (direct) return { key: raw, info: direct };

  // 2. case-insensitive
  const lower = raw.toLowerCase();
  for (const k of Object.keys(lineageData)) {
    if (k.toLowerCase() === lower) {
      return { key: k, info: lineageData[k] };
    }
  }

  // 3. canonicalized
  const canon = canonicalizeLineageKey(raw);
  const hit = getCanonicalIndex().get(canon);
  if (hit) return { key: hit, info: lineageData[hit] };

  return { key: null, info: null };
}

/** Convenience: return only the AttributeInfo (or null). */
export function getLineageInfo(raw: string): AttributeInfo | null {
  return lookupLineage(raw).info;
}

/** Load lineage info from the bridge API and seed the lookup module. Call once at app start. */
export async function loadLineageInfoData(): Promise<void> {
  try {
    const raw = await api.loadLineageInfo() as Record<string, AttributeInfo> | null;
    if (!raw) return;
    initLineageData(raw);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'lineage-lookup', level: 'warn',
      message: 'Failed to load lineage info from bridge',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}
