// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { CommunityDebate } from '../../hooks/useCommunityStore';

/**
 * Filter community debates by a keyword, matching on title (the debate topic) and
 * the submitter's display name (participant). An empty/whitespace query returns the
 * list unchanged. Pure + side-effect-free so it's unit-testable in isolation (t/951).
 */
export function filterCommunityDebates(debates: CommunityDebate[], query: string): CommunityDebate[] {
  const q = query.trim().toLowerCase();
  if (!q) return debates;
  return debates.filter(cd =>
    cd.title.toLowerCase().includes(q) ||
    (cd.community_metadata?.submitted_by_display?.toLowerCase().includes(q) ?? false)
  );
}
