// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from './errors.js';

let ccToSitMap: Record<string, string> | null = null;

/**
 * Initialize the cc→sit mapping from the parsed cc-to-sit-mapping.json.
 * Must be called before any cc- ID resolution (debate CLI startup, server init).
 */
export function setCcToSitMapping(mapping: Record<string, string>): void {
  ccToSitMap = mapping;
}

/** Returns whether the mapping has been loaded. */
export function hasCcToSitMapping(): boolean {
  return ccToSitMap !== null;
}

/**
 * Resolve a legacy cc- ID to its sit- equivalent via the migration mapping.
 * Throws ActionableError if the mapping hasn't been loaded or the ID is unmapped.
 */
export function resolveCcId(ccId: string): string {
  if (!ccToSitMap) {
    throw new ActionableError({
      goal: 'Resolve legacy cc- node ID to sit- equivalent',
      problem: 'cc-to-sit mapping not loaded — cannot resolve cc- IDs without it',
      location: 'lib/debate/ccSitMapping.ts — resolveCcId',
      nextSteps: [
        'Call setCcToSitMapping() with the parsed cc-to-sit-mapping.json at startup',
        'The mapping file is at taxonomy/Origin/cc-to-sit-mapping.json in the data repo',
      ],
    });
  }
  const sitId = ccToSitMap[ccId];
  if (!sitId) {
    throw new ActionableError({
      goal: 'Resolve legacy cc- node ID to sit- equivalent',
      problem: `No mapping found for '${ccId}' in cc-to-sit-mapping.json (${Object.keys(ccToSitMap).length} entries loaded)`,
      location: 'lib/debate/ccSitMapping.ts — resolveCcId',
      nextSteps: [
        `Verify '${ccId}' is a valid legacy cc- ID (valid range: cc-001..cc-246)`,
        'Check cc-to-sit-mapping.json for the expected mapping',
      ],
    });
  }
  return sitId;
}
