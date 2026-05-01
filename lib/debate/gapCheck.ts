// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Responsive gap injection — lightweight deterministic check for
 * high-relevance taxonomy nodes that no debater has engaged.
 * Runs periodically after the initial gap injection to catch
 * perspectives missed due to debate direction changes.
 */

export const GAP_CHECK_INTERVAL = 3;
export const GAP_RELEVANCE_THRESHOLD = 0.7;
export const MAX_GAP_INJECTIONS = 3;

export interface UnengagedNode {
  id: string;
  label: string;
  description: string;
  score: number;
}

/**
 * Find taxonomy nodes with high relevance to the debate that no debater
 * has referenced. This is a deterministic check — no LLM call.
 *
 * @param taxonomyNodes - All taxonomy nodes from loaded POVs
 * @param engagedNodeIds - Node IDs already referenced in the argument network
 * @param relevanceScores - Per-node relevance scores (from embedding or lexical scoring)
 * @param threshold - Minimum relevance score to consider a node "missing" (default 0.7)
 * @returns Unengaged nodes above threshold, sorted by relevance descending
 */
export function findUnengagedHighRelevanceNodes(
  taxonomyNodes: ReadonlyArray<{ id: string; label: string; description: string }>,
  engagedNodeIds: ReadonlySet<string>,
  relevanceScores: ReadonlyMap<string, number>,
  threshold: number = GAP_RELEVANCE_THRESHOLD,
): UnengagedNode[] {
  const results: UnengagedNode[] = [];

  for (const node of taxonomyNodes) {
    if (engagedNodeIds.has(node.id)) continue;
    const score = relevanceScores.get(node.id) ?? 0;
    if (score >= threshold) {
      results.push({
        id: node.id,
        label: node.label,
        description: node.description,
        score,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Determine whether a responsive gap check should run this round.
 *
 * @param round - Current debate round
 * @param initialGapRound - The round at which the first (scheduled) gap injection fires
 * @param gapInjectionCount - How many gap injections have already fired
 * @param maxInjections - Budget cap (default 3)
 * @param checkInterval - Check frequency in rounds (default 3)
 * @returns true if the check should run
 */
export function shouldRunGapCheck(
  round: number,
  initialGapRound: number,
  gapInjectionCount: number,
  maxInjections: number = MAX_GAP_INJECTIONS,
  checkInterval: number = GAP_CHECK_INTERVAL,
): boolean {
  if (gapInjectionCount >= maxInjections) return false;
  if (round <= initialGapRound) return false;
  const roundsSinceInitial = round - initialGapRound;
  return roundsSinceInitial > 0 && roundsSinceInitial % checkInterval === 0;
}

/**
 * Collect all taxonomy node IDs that have been referenced by any
 * argument network node or transcript entry.
 */
export function collectEngagedNodeIds(
  anNodes: ReadonlyArray<{ taxonomy_refs: ReadonlyArray<{ node_id: string }> }>,
  transcriptEntries: ReadonlyArray<{ taxonomy_refs: ReadonlyArray<{ node_id: string }> }>,
): Set<string> {
  const ids = new Set<string>();
  for (const node of anNodes) {
    for (const ref of node.taxonomy_refs) ids.add(ref.node_id);
  }
  for (const entry of transcriptEntries) {
    for (const ref of entry.taxonomy_refs) ids.add(ref.node_id);
  }
  return ids;
}
