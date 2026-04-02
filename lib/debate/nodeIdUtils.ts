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

// Legacy ID normalization lives in index.ts (normalizeNodeId).
// It handles cc-→sit- and goals→desires/data→beliefs/methods→intentions mappings.
