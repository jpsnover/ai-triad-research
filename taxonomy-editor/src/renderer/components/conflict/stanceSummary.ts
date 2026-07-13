// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Computed stance summary for a conflict record (t/1558).
 *
 * A ConflictFile is an evidentiary-claim ledger — a single claim "disputed or
 * supported across multiple source documents" — NOT an assertion that its
 * instances disagree. The static "CONFLICT" record-type chip misreads
 * all-`supports` records as contested. This derives the real evidentiary
 * balance from per-instance `stance`, so the UI can surface it.
 *
 * Pure + presentation-only: no persisted field, no schema change. Kept in its
 * own module so it survives ConflictDetail rewrites (e.g. the t/1559 redesign's
 * status chip can reuse it) rather than living inside JSX.
 */

import type { ConflictStance } from '../../types/taxonomy';

export type StanceSummaryKind = 'contested' | 'corroborated' | 'disputed' | 'unresolved';

export interface StanceSummary {
  kind: StanceSummaryKind;
  /** Human label: 'Contested' | 'Corroborated' | 'Disputed' | 'Unresolved'. */
  label: string;
  /** Short evidentiary detail, e.g. '2/2 support' or 'no instances yet'. */
  detail: string;
  supports: number;
  disputes: number;
  neutral: number;
  qualifies: number;
  total: number;
}

const LABELS: Record<StanceSummaryKind, string> = {
  contested: 'Contested',
  corroborated: 'Corroborated',
  disputed: 'Disputed',
  unresolved: 'Unresolved',
};

/**
 * Summarize the evidentiary balance of a conflict's instances.
 *
 * Rule (per t/1558):
 * - supports AND disputes present → Contested
 * - supports only (≥1, 0 disputes) → Corroborated
 * - disputes only (≥1, 0 supports) → Disputed
 * - neutral/qualifies only, or no instances → Unresolved
 */
export function summarizeStances(instances: ReadonlyArray<{ stance: ConflictStance }>): StanceSummary {
  let supports = 0, disputes = 0, neutral = 0, qualifies = 0;
  for (const inst of instances) {
    switch (inst.stance) {
      case 'supports': supports++; break;
      case 'disputes': disputes++; break;
      case 'neutral': neutral++; break;
      case 'qualifies': qualifies++; break;
      // Unknown/future stance values are ignored (counted only in total).
    }
  }
  const total = instances.length;

  let kind: StanceSummaryKind;
  let detail: string;
  if (supports > 0 && disputes > 0) {
    kind = 'contested';
    detail = `${supports} support · ${disputes} dispute`;
  } else if (supports > 0) {
    kind = 'corroborated';
    detail = `${supports}/${total} support`;
  } else if (disputes > 0) {
    kind = 'disputed';
    detail = `${disputes}/${total} dispute`;
  } else {
    kind = 'unresolved';
    detail = total === 0 ? 'no instances yet' : `${total} neutral/qualifying`;
  }

  return { kind, label: LABELS[kind], detail, supports, disputes, neutral, qualifies, total };
}
