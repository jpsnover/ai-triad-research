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
export const SITUATION_PREFIX = 'cc-';

/** Category slug within POV IDs (e.g., the 'goals' in 'acc-goals-001'). */
export const CATEGORY_SLUGS: Record<string, string> = {
  'goals': 'Desires',
  'data': 'Beliefs',
  'methods': 'Intentions',
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
  return null;
}

/**
 * Get the node type from an ID prefix.
 * Returns 'pov' for POV nodes, 'situation' for situation nodes, or null.
 */
export function nodeTypeFromId(id: string): 'pov' | 'situation' | null {
  for (const prefix of Object.keys(POV_PREFIXES)) {
    if (id.startsWith(prefix)) return 'pov';
  }
  if (id.startsWith(SITUATION_PREFIX)) return 'situation';
  return null;
}

/**
 * Check if an ID belongs to a specific POV.
 */
export function isNodeOfPov(id: string, pov: string): boolean {
  return nodePovFromId(id) === pov;
}

// ── Legacy ID normalization (permanent safety net) ───────

/** Legacy prefix mapping for un-migrated external data. */
const LEGACY_SLUG_MAP: Record<string, string> = {
  // These will be populated in Phase 2A when the canonical slugs change.
  // For now, current slugs ARE canonical — no normalization needed.
};

/**
 * Normalize a node ID from legacy format to current format.
 * Permanent safety net for external data that may not have been migrated.
 * Currently a no-op — will map old→new after Phase 2A.
 */
export function normalizeNodeId(id: string): string {
  // Phase 2A will add mappings here (e.g., 'acc-goals-' → 'acc-desires-')
  for (const [oldSlug, newSlug] of Object.entries(LEGACY_SLUG_MAP)) {
    if (id.includes(oldSlug)) {
      return id.replace(oldSlug, newSlug);
    }
  }
  return id;
}
