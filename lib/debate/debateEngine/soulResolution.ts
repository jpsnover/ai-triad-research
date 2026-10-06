// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 extract: soul resolution pre-flight, factored out of DebateEngine.run() (t/4007).

import { POVER_INFO, type SpeakerId, type PovInfo } from '../types.js';
import { ActionableError } from '../errors.js';
import type { SoulProvenance } from '../soulDocSchema.js';
import type { PovNode } from '../taxonomyTypes.js';
import type { LoadedTaxonomy } from '../taxonomyLoader.js';
import { checkTagScope } from '../relevanceSelection.js';
import { TAG_SCOPE_MINIMUM_NODES } from '../debateConfig.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import type { DebateConfig } from './internals.js';

/**
 * Resolve per-seat souls from DebateConfig before initSession().
 * Tagged seats: scope-check via checkTagScope, then soulResolver (ActionableError propagates).
 * Untagged seats: soulResolver returns base POVER_INFO soul with provenance; no resolver → POVER_INFO fallback + warn.
 * soulResolver is runtime-injected (t/3975): cli/server pass soulDocLoader.resolvePoverInfo, renderer passes tagSoulRegistry.resolvePoverInfo.
 */
export function resolveSouls(
  config: DebateConfig,
  taxonomy: LoadedTaxonomy,
): {
  resolvedSouls: Partial<Record<string, PovInfo>>;
  soulProv: Partial<Record<string, SoulProvenance>>;
} {
  const resolvedSouls: Partial<Record<string, PovInfo>> = {};
  const soulProv: Partial<Record<string, SoulProvenance>> = {};
  for (const poverId of config.activePovers) {
    const seatTag = config.seat_tags?.[poverId];
    const tagSelection = seatTag ? { tag: seatTag.pov_tag, mode: seatTag.tag_mode } : undefined;
    if (tagSelection) {
      const campNodes: PovNode[] = (taxonomy[poverId as 'accelerationist' | 'safetyist' | 'skeptic'] as { nodes: PovNode[] } | undefined)?.nodes ?? [];
      const scopeCheck = checkTagScope(campNodes, tagSelection);
      if (!scopeCheck.sufficient) {
        throw new ActionableError({
          goal: `Start tagged debate (${poverId}/${tagSelection.tag})`,
          problem: scopeCheck.reason === 'none-tagged'
            ? `No nodes carry tag "${tagSelection.tag}" in the ${poverId} camp`
            : `Scope too thin for tag "${tagSelection.tag}" in ${poverId}: ${scopeCheck.inScope.length} groundable nodes (minimum ${TAG_SCOPE_MINIMUM_NODES})`,
          location: 'DebateEngine.run() › soul resolution pre-flight',
          nextSteps: [
            `Add pov_tags: ["${tagSelection.tag}"] to at least ${TAG_SCOPE_MINIMUM_NODES} nodes under the ${poverId} POV and run Update-TaxEmbeddings.`,
            'Or switch to Prioritize mode to boost tagged nodes without filtering.',
          ],
        });
      }
      if (!config.soulResolver) {
        throw new ActionableError({
          goal: `Start tagged debate (${poverId}/${tagSelection.tag})`,
          problem: 'No soulResolver provided in DebateConfig — tagged debates require a runtime soul resolver.',
          location: 'DebateEngine.run() › soul resolution pre-flight',
          nextSteps: ['Pass soulResolver: resolvePoverInfo from soulDocLoader (Node) or tagSoulRegistry (browser) in DebateConfig.'],
        });
      }
    }
    if (config.soulResolver) {
      const { soul, soulProvenance: provenance } = config.soulResolver(
        poverId as Exclude<SpeakerId, 'user'>,
        tagSelection,
      );
      resolvedSouls[poverId] = soul;
      soulProv[poverId] = { file: provenance.file, hash: provenance.hash };
    } else {
      resolvedSouls[poverId] = POVER_INFO[poverId as keyof typeof POVER_INFO];
      getGlobalRecorder()?.record({
        type: 'system.info',
        component: 'debate-engine',
        level: 'warn',
        message: `No soulResolver in DebateConfig — soul_provenance will not be recorded for ${poverId}. Pass soulResolver to enable cross-run comparison (t/3963).`,
      });
    }
  }
  return { resolvedSouls, soulProv };
}
