// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// "Exclude well-tested" debate mode (the `exclude_greatest_hits` flag). When on, node selection
// hard-excludes well_tested nodes (re-eligibility rules still apply), unions in the curated
// greatest-hits list, and boosts under-tested (untested/cited) nodes near the relevance threshold,
// so a debate stress-tests arguments that have not already been tested. Renderer-reachable via
// taxonomyRelevance — must stay fs-free. Imports from taxonomyRelevance are type-only (no cycle).

import type { PovNode } from './taxonomyTypes.js';
import type {
  RelevanceOptions,
  ScoredPovNode,
  WellTestedExclusionResult,
  GreatestHitsExcludeResult,
} from './taxonomyRelevance.js';
import { UNDER_TESTED_BOOST, DEFICIT_SCORES } from './debateTested.js';

export interface UnderTestedBoostConfig {
  /** Boost for a tier with deficit weight 1.0 (default UNDER_TESTED_BOOST.MAX_BOOST). */
  maxBoost?: number;
  /** Only nodes scoring at least threshold − window are boosted (default UNDER_TESTED_BOOST.NEAR_MISS_WINDOW). */
  nearMissWindow?: number;
}

export interface UnderTestedBoostResult {
  boostedNodeIds: string[];
  /** Node IDs that crossed the threshold thanks to the boost. */
  promotedNodeIds: string[];
  boostedCount: number;
  promotedCount: number;
}

/**
 * Selection options for the exclude-well-tested mode. The curated greatest-hits list is applied
 * separately via `greatestHitsExclude`. Shared by the engine and app selection paths so they stay
 * in parity.
 */
export function excludeWellTestedModeOptions(now?: Date): Pick<RelevanceOptions, 'wellTested' | 'underTestedBoost'> {
  return {
    wellTested: { excludeWellTested: true, ...(now ? { now } : {}) },
    underTestedBoost: {},
  };
}

/**
 * Add MAX_BOOST × DEFICIT_SCORES[tier] to untested (incl. no debate_tested record) and cited nodes
 * scoring within the near-miss window of the threshold, so they outrank equally relevant tested
 * nodes. Mutates `scores` in place.
 */
export function applyUnderTestedBoost(
  povNodes: readonly PovNode[],
  scores: Map<string, number>,
  threshold: number,
  config: UnderTestedBoostConfig,
): UnderTestedBoostResult {
  const maxBoost = config.maxBoost ?? UNDER_TESTED_BOOST.MAX_BOOST;
  const window = config.nearMissWindow ?? UNDER_TESTED_BOOST.NEAR_MISS_WINDOW;
  const boostedTiers: readonly string[] = UNDER_TESTED_BOOST.BOOSTED_TIERS;
  const boostedNodeIds: string[] = [];
  const promotedNodeIds: string[] = [];
  for (const node of povNodes) {
    const tier = node.graph_attributes?.debate_tested?.tier ?? 'untested';
    if (!boostedTiers.includes(tier)) continue;
    const base = scores.get(node.id) ?? 0;
    if (base < threshold - window) continue;
    const boosted = base + maxBoost * (DEFICIT_SCORES[tier] ?? 0);
    scores.set(node.id, boosted);
    boostedNodeIds.push(node.id);
    if (base < threshold && boosted >= threshold) promotedNodeIds.push(node.id);
  }
  return { boostedNodeIds, promotedNodeIds, boostedCount: boostedNodeIds.length, promotedCount: promotedNodeIds.length };
}

/** Persisted in the injection manifest as `testing_selection` so a debate records what the mode did. */
export interface TestingSelectionSummary {
  /** Tier mix of the selected POV nodes (absent debate_tested counts as untested). */
  selected_tiers: Record<string, number>;
  well_tested_excluded: number;
  well_tested_reeligible: number;
  greatest_hits_excluded: number;
  under_tested_boosted: number;
  under_tested_promoted: number;
  well_tested_excluded_ids: string[];
  well_tested_reeligible_ids: string[];
  greatest_hits_excluded_ids: string[];
  under_tested_promoted_ids: string[];
}

const SUMMARY_ID_CAP = 50;

/** Build the `testing_selection` manifest entry from selectRelevantNodes' stashed diagnostics.
 *  `selected` is the final injected set when a post-filter (e.g. topic constraints) rebuilt the
 *  array; the tier mix is counted over it. Returns undefined when neither the exclusion mode nor
 *  the greatest-hits list was active. */
export function summarizeTestingSelection(
  scored: ScoredPovNode[],
  selected: ReadonlyArray<ScoredPovNode> = scored,
): TestingSelectionSummary | undefined {
  const diag = scored as ScoredPovNode[] & {
    _wellTested?: WellTestedExclusionResult;
    _greatestHits?: GreatestHitsExcludeResult;
    _underTestedBoost?: UnderTestedBoostResult;
  };
  if (!diag._wellTested && !diag._greatestHits && !diag._underTestedBoost) return undefined;
  const selected_tiers: Record<string, number> = {};
  for (const s of selected) {
    const tier = s.node.graph_attributes?.debate_tested?.tier ?? 'untested';
    selected_tiers[tier] = (selected_tiers[tier] ?? 0) + 1;
  }
  return {
    selected_tiers,
    well_tested_excluded: diag._wellTested?.excludedCount ?? 0,
    well_tested_reeligible: diag._wellTested?.reeligibleNodeIds.length ?? 0,
    greatest_hits_excluded: diag._greatestHits?.excludedCount ?? 0,
    under_tested_boosted: diag._underTestedBoost?.boostedCount ?? 0,
    under_tested_promoted: diag._underTestedBoost?.promotedCount ?? 0,
    well_tested_excluded_ids: (diag._wellTested?.excludedNodeIds ?? []).slice(0, SUMMARY_ID_CAP),
    well_tested_reeligible_ids: (diag._wellTested?.reeligibleNodeIds ?? []).slice(0, SUMMARY_ID_CAP),
    greatest_hits_excluded_ids: (diag._greatestHits?.excludedNodeIds ?? []).slice(0, SUMMARY_ID_CAP),
    under_tested_promoted_ids: (diag._underTestedBoost?.promotedNodeIds ?? []).slice(0, SUMMARY_ID_CAP),
  };
}
