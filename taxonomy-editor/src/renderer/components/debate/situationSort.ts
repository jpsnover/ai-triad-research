// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SituationNode } from '../../types/taxonomy';

export type SitSortMode = 'label' | 'id' | 'divergence';

/**
 * Sort situation nodes by name, id, or interpretation divergence (highest first;
 * nodes without a divergence score sort to the end). Returns a new array. Pure.
 */
export function sortSituationNodes(nodes: SituationNode[], mode: SitSortMode): SituationNode[] {
  if (mode === 'id') return [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  if (mode === 'divergence') {
    return [...nodes].sort((a, b) => {
      const da = a.interpretation_divergence ?? -1;
      const db = b.interpretation_divergence ?? -1;
      return db - da; // highest first; nodes without score sort to end
    });
  }
  return [...nodes].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
}
