// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 extract: session diagnostic helpers, factored out of DebateEngine (t/4007 size budget).

import type { DebateSession } from '../types.js';

/** Recompute situation-citation counters from the full transcript (t/192). Called each turn. */
export function computeSituationCitations(session: DebateSession): void {
  const overview = session.diagnostics?.overview;
  if (!overview) return;

  const uniqueSitIds = new Set<string>();
  let turnsWithSit = 0;
  let totalDebateTurns = 0;

  for (const entry of session.transcript) {
    if (entry.type !== 'statement' && entry.type !== 'opening') continue;
    totalDebateTurns++;
    const hasSit = entry.taxonomy_refs.some(r => r.node_id.startsWith('sit-'));
    if (hasSit) {
      turnsWithSit++;
      for (const r of entry.taxonomy_refs) {
        if (r.node_id.startsWith('sit-')) uniqueSitIds.add(r.node_id);
      }
    }
  }

  overview.situation_citations = {
    turns_with_sit_refs: turnsWithSit,
    total_debate_turns: totalDebateTurns,
    citation_rate: totalDebateTurns > 0 ? turnsWithSit / totalDebateTurns : 0,
    unique_sit_ids_cited: [...uniqueSitIds].sort(),
  };
}
