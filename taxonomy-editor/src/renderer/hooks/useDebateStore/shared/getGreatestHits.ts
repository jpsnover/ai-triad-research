// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Cached greatest-hits exclusion-list fetch + app-path exclusion application (t/1998).
// STORE-FREE (mirrors shared/docTitles.ts) so any slice/shared module can import it
// without a store load-order cycle — it imports only the bridge, the flight recorder,
// and a type. The node-ID list comes from calibration/greatest-hits.json via the bridge
// (Electron IPC `load-greatest-hits` + web `GET /api/greatest-hits`; the provider halves
// land in parallel — ElectronMain / ServerAPI). Both bridge impls return null when the
// file is absent, so getGreatestHits() resolves to undefined and callers degrade.
//
// This is the APP-run mirror of the CLI engine's exclusion at
// lib/debate/debateEngine/taxonomyContext.ts:266. The engine HARD-THROWS when the flag
// is On and the file is missing; the app path degrades LOUDLY instead (TL decision, PM
// p/19#120) — a missing calibration file must never fail a GUI debate. applyGreatestHits-
// Exclusion returns the outcome so the caller can surface a user-visible warning and the
// overview can render "On — not applied".

import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { RelevanceOptions } from '../../../utils/taxonomyRelevance';

let _cached: { node_ids: string[] } | null | undefined;

/**
 * Load the greatest-hits exclusion node-ID list (cached for the session). Returns
 * undefined when unavailable — file absent (bridge returns null), the provider endpoint
 * isn't live yet, or a load error. Never throws.
 */
export async function getGreatestHits(): Promise<string[] | undefined> {
  if (_cached !== undefined) return _cached?.node_ids;
  try {
    const result = await api.loadGreatestHits();
    _cached = result;
    return result?.node_ids;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-store',
      level: 'warn',
      message: 'Failed to load greatest-hits exclusion list',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    _cached = null;
    return undefined;
  }
}

/** Reset the module cache. Test isolation only. */
export function resetGreatestHitsCache(): void {
  _cached = undefined;
}

/** Outcome of an app-path greatest-hits exclusion attempt (drives the user warning + overview state). */
export interface GreatestHitsOutcome {
  /** The debate's exclude_greatest_hits flag was On. */
  requested: boolean;
  /** Exclusion was actually applied (list loaded and non-empty). */
  applied: boolean;
  /** Size of the exclusion list applied (0 when not applied). */
  listSize: number;
}

/**
 * Apply greatest-hits exclusion to relevance options for app-run debates (t/1998).
 * When the flag is On and the list loads, sets `relevanceOpts.greatestHitsExclude` and
 * records an info event. When On but the list is unavailable, LEAVES relevanceOpts
 * untouched and records a warn event — the caller is responsible for the user-visible
 * warning (this module stays store-free). Returns the outcome for that surfacing.
 */
export async function applyGreatestHitsExclusion(
  relevanceOpts: RelevanceOptions,
  excludeFlag: boolean | undefined,
): Promise<GreatestHitsOutcome> {
  if (!excludeFlag) return { requested: false, applied: false, listSize: 0 };

  const ids = await getGreatestHits();
  if (ids && ids.length > 0) {
    relevanceOpts.greatestHitsExclude = new Set(ids);
    getGlobalRecorder()?.record({
      type: 'turn.taxonomy_inject',
      component: 'debate-store',
      level: 'info',
      message: `Greatest-hits exclusion applied: ${ids.length}-node exclusion list loaded`,
      data: { exclusion_list_size: ids.length },
    });
    return { requested: true, applied: true, listSize: ids.length };
  }

  // Loud degrade: requested but unavailable — do NOT throw (engine parity would fail the debate).
  getGlobalRecorder()?.record({
    type: 'turn.taxonomy_inject',
    component: 'debate-store',
    level: 'warn',
    message: 'Greatest-hits exclusion is On but the exclusion list is unavailable — retread nodes NOT filtered',
    data: { reason: ids ? 'empty_list' : 'list_unavailable' },
  });
  return { requested: true, applied: false, listSize: 0 };
}
