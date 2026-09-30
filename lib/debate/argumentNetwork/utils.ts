// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Returns the effective camp (POV) for position/membership routing.
 *
 * A steelman authored by speaker A of camp B is a B-camp position — the
 * same logic as attribution.ts:68 (effectivePov = node.steelman_of ?? speakerPov).
 * Use for: opponent-set membership, camp grouping, context display labels.
 * Retain node.speaker for: authorship display, commitment tracking, move attribution.
 */
export function effectiveCamp(node: { speaker: string; steelman_of?: string }): string {
  return node.steelman_of ?? node.speaker;
}
