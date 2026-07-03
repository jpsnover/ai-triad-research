// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Centralized node ID prefix detection and utilities.
 * Single source of truth for ID prefix → POV mapping.
 * Phase 2A of the Node ID migration changes the constants here only.
 */

// ── Prefix → POV mapping (Phase 2A: update these constants) ──

/** POV node ID prefixes. Key = prefix (including trailing hyphen), value = POV name. */
export const POV_PREFIXES: Record<string, string> = {
  'acc-': 'accelerationist',
  'saf-': 'safetyist',
  'skp-': 'skeptic',
};

/** Situation node ID prefix. */
export const SITUATION_PREFIX = 'sit-';

/** Conflict node ID prefix. */
export const CONFLICT_PREFIX = 'conflict-';

/** Category slug within POV IDs (e.g., the 'desires' in 'acc-desires-001'). */
export const CATEGORY_SLUGS: Record<string, string> = {
  'desires': 'Desires',
  'beliefs': 'Beliefs',
  'intentions': 'Intentions',
};

// ── ID → POV resolution ──────────────────────────────────

/**
 * Get the POV from a node ID prefix.
 * Returns the POV string ('accelerationist', 'safetyist', 'skeptic', 'situations')
 * or null if the ID format is unrecognized.
 */
export function nodePovFromId(id: string): string | null {
  for (const [prefix, pov] of Object.entries(POV_PREFIXES)) {
    if (id.startsWith(prefix)) return pov;
  }
  if (id.startsWith(SITUATION_PREFIX)) return 'situations';
  if (id.startsWith(CONFLICT_PREFIX)) return 'conflicts';
  return null;
}

/**
 * Get the node type from an ID prefix.
 * Returns 'pov' for POV nodes, 'situation' for situation nodes, 'conflict' for conflict nodes, or null.
 */
export function nodeTypeFromId(id: string): 'pov' | 'situation' | 'conflict' | null {
  for (const prefix of Object.keys(POV_PREFIXES)) {
    if (id.startsWith(prefix)) return 'pov';
  }
  if (id.startsWith(SITUATION_PREFIX)) return 'situation';
  if (id.startsWith(CONFLICT_PREFIX)) return 'conflict';
  return null;
}

/**
 * Check if an ID belongs to a specific POV.
 */
export function isNodeOfPov(id: string, pov: string): boolean {
  return nodePovFromId(id) === pov;
}

// Legacy ID normalization lives in index.ts (normalizeNodeId).
// It handles goals→desires/data→beliefs/methods→intentions BDI category renames.
// WARNING: cc- and sit- are SEPARATE node namespaces with colliding numeric
// suffixes (cc-001 ≠ sit-001). Never map cc-NNN → sit-NNN.

// ── Fuzzy ID correction ─────────────────────────────────

/**
 * Attempt to correct a hallucinated node ID against a set of known valid IDs.
 *
 * LLMs sometimes "helpfully" transform node IDs by adding or swapping prefixes:
 *   sit-cc-040 → cc-040   (added sit- prefix to a cross-cutting node)
 *   pov-sit-001 → sit-001  (added pov- prefix)
 *   cc-sit-051 → sit-051   (swapped prefix)
 *
 * Returns the corrected ID if a match is found, or null if no correction is possible.
 */
export function fuzzyCorrectNodeId(badId: string, knownIds: Set<string>): string | null {
  // Direct match — not actually bad
  if (knownIds.has(badId)) return badId;

  // Strip common hallucinated prefix combinations
  const prefixStripped = badId
    .replace(/^sit-(cc|acc|saf|skp)-/, '$1-')   // sit-cc-040 → cc-040
    .replace(/^(cc|pov)-(sit)-/, '$2-')          // cc-sit-051 → sit-051
    .replace(/^pov-(cc|acc|saf|skp)-/, '$1-')    // pov-cc-040 → cc-040
    .replace(/^sit-pol-/, 'pol-')                 // sit-pol-123 → pol-123
    .replace(/^pol-sit-/, 'sit-');                // pol-sit-001 → sit-001
  if (prefixStripped !== badId && knownIds.has(prefixStripped)) return prefixStripped;

  // Try known prefixes against the numeric suffix
  // e.g., "sit-cc-040" → suffix "040" → try "cc-040"
  const suffixMatch = badId.match(/-(\d{2,4})$/);
  if (suffixMatch) {
    const suffix = suffixMatch[1];
    const candidates = [...knownIds].filter(id => id.endsWith('-' + suffix));
    if (candidates.length === 1) return candidates[0];
  }

  return null;
}

/**
 * Validate and correct an array of node IDs against known valid IDs.
 * Returns a sanitized array with invalid IDs either corrected or removed.
 * Also returns arrays of corrections and removals for diagnostics.
 */
export function sanitizeNodeIds(
  ids: string[],
  knownIds: Set<string>,
): { sanitized: string[]; corrections: { from: string; to: string }[]; removed: string[] } {
  const sanitized: string[] = [];
  const corrections: { from: string; to: string }[] = [];
  const removed: string[] = [];

  for (const id of ids) {
    if (knownIds.has(id)) {
      sanitized.push(id);
    } else {
      const corrected = fuzzyCorrectNodeId(id, knownIds);
      if (corrected) {
        sanitized.push(corrected);
        corrections.push({ from: id, to: corrected });
      } else {
        removed.push(id);
      }
    }
  }

  return { sanitized, corrections, removed };
}
