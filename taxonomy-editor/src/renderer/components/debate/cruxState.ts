// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface CruxResolutionSummary {
  active: number;
  resolved: number;
  irreducible: number;
}

/**
 * The dominant resolution state shown on a crux list item:
 * - `resolved` only when every instance is resolved (none active, none irreducible)
 * - `irreducible` when some are irreducible and none are active
 * - `active` otherwise (the default while work remains)
 * Pure.
 */
export function cruxDominantState(rs: CruxResolutionSummary): 'resolved' | 'irreducible' | 'active' {
  if (rs.resolved > 0 && rs.active === 0 && rs.irreducible === 0) return 'resolved';
  if (rs.irreducible > 0 && rs.active === 0) return 'irreducible';
  return 'active';
}
