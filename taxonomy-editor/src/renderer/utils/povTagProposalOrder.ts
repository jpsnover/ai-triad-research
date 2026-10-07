// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Default review order for the POV-tag proposal queue (t/4052 req 5; predicates from CL t/4052#2).
// Model confidence does not discriminate (0.75–0.95, t/3962#10), so it is a display column only.
//
// Tier labels say what each tier TESTS, not what it is meant to approximate: "technical-mechanism"
// was an annotator judgement with no field behind it, and the crux === null proxy misses at least one
// such node (intentions-167), so the queue must not claim to find them (CL t/4052#2).

/** The proposal fields the ordering reads. Structural, so it accepts the lib's item type unchanged. */
export interface OrderableProposal {
  node_id: string;
  proposed: string[];
  crux?: string | null;
}

export interface ReviewTier {
  rank: 1 | 2 | 3 | 4;
  label: string;
}

const TIERS: Record<ReviewTier['rank'], string> = {
  1: 'No tag proposed (possibly misplaced)',
  2: 'No crux, but tagged',
  3: 'Desires proposed critical (critical vs both)',
  4: 'Other',
};

/** Which review tier a proposal falls in. Pure. */
export function reviewTier(p: OrderableProposal): ReviewTier {
  let rank: ReviewTier['rank'] = 4;
  if (p.proposed.length === 0) rank = 1;
  else if (p.crux === null || p.crux === undefined) rank = 2;
  else if (p.node_id.includes('-desires-') && p.proposed.includes('critical')) rank = 3;
  return { rank, label: TIERS[rank] };
}

/** A copy sorted by tier, then node id. Stable for equal keys. Pure. */
export function sortForReview<T extends OrderableProposal>(proposals: readonly T[]): T[] {
  return [...proposals].sort((a, b) =>
    reviewTier(a).rank - reviewTier(b).rank || a.node_id.localeCompare(b.node_id, 'en', { numeric: true }));
}
