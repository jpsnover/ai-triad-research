// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Browser-safe companion to soulDocLoader.ts (t/3979).
// Uses import.meta.glob — Vite/vitest only. Do NOT import from Node paths (CLI, main, server).
// Node paths use soulDocLoader.ts instead.

import { ActionableError } from './errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { POVER_INFO } from './poverInfo.js';
import { SoulDocumentSchema } from './soulDocSchema.js';
import type { SoulProvenance } from './soulDocLoader.js';
import { tagSoulFileName } from '../schema/povTags.js';

/** Readability brand: marks provenance from the Vite/browser path (import.meta.glob). Not a transitive guard — see t/3980. */
export type SoulProvenanceBrowser = SoulProvenance & { readonly __runtime: 'browser' };
import type { TagSelection } from './types/session.js';
import type { PovInfo, SpeakerId } from './types.js';

// import.meta.glob is resolved at Vite/vitest build time. Pattern covers all tag soul files.
// Key format: "./soul-docs/<pov>.<tag>.soul.json" (spec §3; t/3989). *.*.soul.json matches only
// two-segment names, so it never captures base souls like accelerationist.soul.json.
const TAG_SOUL_MODULES = import.meta.glob<{ default: unknown }>(
  './soul-docs/*.*.soul.json',
  { eager: true },
);

/** FNV-1a 32-bit × 2 = 16 hex chars (browser-safe, deterministic). */
function fnv1aHex16(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x04c11db7;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c;
    h2 = Math.imul(h2, 0x04c11db7) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function getTagSoulFromRegistry(pov: string, tag: string): PovInfo {
  const key = `./soul-docs/${tagSoulFileName(pov, tag)}`;
  const mod = TAG_SOUL_MODULES[key];
  if (!mod) {
    throw new ActionableError({
      goal: `Load tag soul for ${pov}:${tag}`,
      problem: `Tag soul not found in registry: ${key}`,
      location: 'tagSoulRegistry.ts › getTagSoulFromRegistry',
      nextSteps: [`Add the soul file at lib/debate/soul-docs/${tagSoulFileName(pov, tag)} and rebuild.`],
    });
  }
  try {
    return SoulDocumentSchema.parse(mod.default) as unknown as PovInfo;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'tagSoulRegistry',
      level: 'error',
      message: `Tag soul schema validation failed for ${pov}:${tag}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    throw new ActionableError({
      goal: `Parse tag soul for ${pov}:${tag}`,
      problem: `Schema validation failed: ${String(err)}`,
      location: 'tagSoulRegistry.ts › getTagSoulFromRegistry',
      nextSteps: [`Check the soul file at lib/debate/soul-docs/${tagSoulFileName(pov, tag)} against SoulDocumentSchema.`],
      innerError: err,
    });
  }
}

/**
 * Browser-safe soul resolver. Returns the active soul and its content provenance.
 * Renderer (Electron + web build) imports from here; CLI imports from soulDocLoader.ts.
 */
export function resolvePoverInfo(
  speaker: Exclude<SpeakerId, 'user'>,
  tagSelection?: TagSelection,
): { soul: PovInfo; soulProvenance: SoulProvenanceBrowser } {
  if (!tagSelection) {
    const soul = POVER_INFO[speaker];
    return {
      soul,
      soulProvenance: {
        file: `soul-docs/${speaker}.soul.json`,
        sha: fnv1aHex16(JSON.stringify(soul)),
      } as SoulProvenanceBrowser,
    };
  }
  const tagSoul = getTagSoulFromRegistry(speaker, tagSelection.tag);
  const baseSoul = POVER_INFO[speaker];
  // Enforce base identity fields — tag souls override personality/voice but not label or pov (t/3988).
  const soul: PovInfo = { ...tagSoul, label: baseSoul.label, pov: baseSoul.pov };
  return {
    soul,
    soulProvenance: {
      file: `soul-docs/${tagSoulFileName(speaker, tagSelection.tag)}`,
      sha: fnv1aHex16(JSON.stringify(tagSoul)),
    } as SoulProvenanceBrowser,
  };
}
