// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Default review order for the POV-tag proposal queue (t/4052 req 5). The tiers come from each proposal's
// value_basis (CL's display spec t/4052#9), replacing the crux-based tiers of t/4052#2.
// Model confidence does not discriminate (0.75–0.95, t/3962#10), so it is a display column only.
//
// Tier labels say what each tier TESTS. An item with no value_basis (added after the justify run) lands in
// "Other" unless it is untagged; it is never treated as supported or unsupported.

import { isPossiblyMisplaced, hasUncertain, hasUnsupportedTag, type ValueBasisFields } from './povTagValueBasis';

/** The proposal fields the ordering reads. Structural, so it accepts the lib's item type unchanged. */
export interface OrderableProposal extends ValueBasisFields {
  node_id: string;
}

export interface ReviewTier {
  rank: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
}

const TIERS: Record<ReviewTier['rank'], string> = {
  1: 'Possibly misplaced in Skeptic',
  2: 'No tag proposed',
  3: 'Single tag, unsupported by its Value Hierarchy',
  4: 'Both tags, a wing unsupported',
  5: 'An element cited in only one of two runs',
  6: 'Other',
};

/** Which review tier a proposal falls in. Pure. */
export function reviewTier(p: OrderableProposal): ReviewTier {
  let rank: ReviewTier['rank'] = 6;
  if (isPossiblyMisplaced(p)) rank = 1;
  else if (p.proposed.length === 0) rank = 2;
  else if (p.proposed.length === 1 && hasUnsupportedTag(p)) rank = 3;
  else if (p.value_basis_shared && hasUnsupportedTag(p)) rank = 4;
  else if (hasUncertain(p)) rank = 5;
  return { rank, label: TIERS[rank] };
}

/** A copy sorted by tier, then node id. Stable for equal keys. Pure. */
export function sortForReview<T extends OrderableProposal>(proposals: readonly T[]): T[] {
  return [...proposals].sort((a, b) =>
    reviewTier(a).rank - reviewTier(b).rank || a.node_id.localeCompare(b.node_id, 'en', { numeric: true }));
}
