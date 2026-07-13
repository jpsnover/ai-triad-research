// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Small derived-display helpers for the ConflictDetail redesign (t/1559).
 * Pure + presentation-only — no stored fields, no data-flow change.
 */

import type { ConflictInstance } from '../../types/taxonomy';

/**
 * Earliest `date_flagged` across instances, formatted `Mon D, YYYY` for the
 * header meta line ("First flagged {date}"). Returns null when there are no
 * instances or none carry a parseable date.
 */
export function earliestInstanceDate(instances: ReadonlyArray<Pick<ConflictInstance, 'date_flagged'>>): string | null {
  let earliest: number | null = null;
  for (const inst of instances) {
    if (!inst.date_flagged) continue;
    const t = Date.parse(inst.date_flagged);
    if (Number.isNaN(t)) continue;
    if (earliest === null || t < earliest) earliest = t;
  }
  if (earliest === null) return null;
  return new Date(earliest).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * CSS camp-color variable for a node id's left tick (§3.4). Node ids look like
 * `acc-intentions-052` / `saf-…` / `skp-…`; situations use `sit-*`/`cc-*`.
 * Falls back to the situation/teal token for anything unrecognized.
 */
export function campColorVarForNodeId(id: string): string {
  const prefix = id.split('-', 1)[0];
  switch (prefix) {
    case 'acc': return 'var(--color-acc)';
    case 'saf': return 'var(--color-saf)';
    case 'skp': return 'var(--color-skp)';
    default: return 'var(--color-sit)'; // sit-*, cc-*, and anything else
  }
}
