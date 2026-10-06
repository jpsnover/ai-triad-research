// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SpeakerId, PovInfo } from './types.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import accSoulDoc from './soul-docs/accelerationist.soul.json' with { type: 'json' };
import safSoulDoc from './soul-docs/safetyist.soul.json' with { type: 'json' };
import skpSoulDoc from './soul-docs/skeptic.soul.json' with { type: 'json' };

export const POVER_INFO: Record<Exclude<SpeakerId, 'user'>, PovInfo> = {
  accelerationist: accSoulDoc as unknown as PovInfo,
  safetyist: safSoulDoc as unknown as PovInfo,
  skeptic: skpSoulDoc as unknown as PovInfo,
};

/**
 * Map a soul's `boundaries.{hardcoded, softcoded}` to the doctrinal-boundaries shape
 * expected by `selectRelevantTaxonomy`. Returns `undefined` when no boundaries are defined.
 *
 * Callers reading `povInfo.doctrinal_boundaries` get `undefined` because no soul sets that
 * field — use this accessor instead (t/3966).
 */
export function getPovDoctrinalBoundaries(
  povInfo: PovInfo,
): { strings: string[]; isRejection: boolean[] } | undefined {
  const { hardcoded, softcoded } = povInfo.boundaries;
  const strings = [...hardcoded, ...softcoded];
  if (strings.length === 0) {
    getGlobalRecorder()?.record({
      type: 'system.warn',
      component: 'poverInfo',
      level: 'warn',
      message: `POV "${povInfo.pov}" has no doctrinal boundaries — anchoring will be skipped`,
    });
    return undefined;
  }
  // Mirror the REJECT: detection used by embedDoctrinalBoundaries (t/2746 V5).
  const isRejection = strings.map(s => /^REJECT:\s*/i.test(s));
  return { strings, isRejection };
}
