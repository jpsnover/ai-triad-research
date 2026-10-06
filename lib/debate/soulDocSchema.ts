// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { z } from 'zod';

export const VoiceSpecSchema = z.object({
  disposition: z.string().min(1),
  style: z.string().min(1),
  reasoning: z.string().min(1),
  evidence: z.string().min(1),
  signature: z.string().min(1),
  prose_style: z.string().min(1),
  voice_hygiene: z.string().min(1),
  prose_style_short: z.string().min(1),
  voice_hygiene_short: z.string().min(1),
});

export const BoundariesSchema = z.object({
  hardcoded: z.array(z.string().min(1)).min(1),
  softcoded: z.array(z.string().min(1)).min(1),
});

export const SoulDocumentSchema = z.object({
  pov: z.enum(['accelerationist', 'safetyist', 'skeptic']),
  /** Present in tag soul files — absent in base souls (t/3957). */
  tag: z.string().optional(),
  label: z.string().min(1),
  color: z.string().min(1),
  personality: z.string().min(1),
  voice: VoiceSpecSchema,
  anti_patterns: z.array(z.string().min(1)).min(1),
  value_hierarchy: z.array(z.string().min(1)).min(1),
  epistemic_stance: z.array(z.string().min(1)).min(1),
  boundaries: BoundariesSchema,
});

export type SoulDocument = z.infer<typeof SoulDocumentSchema>;

/**
 * FNV-1a 32-bit × 2 hash of raw soul file text → 16 hex chars.
 * Browser-safe (no node:crypto). Used by both loaders for parity (t/4007 condition #3).
 */
export function soulDocHash(raw: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x04c11db7;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c;
    h2 = Math.imul(h2, 0x04c11db7) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Serializable provenance for a resolved soul file. */
export interface SoulProvenance {
  /** Path relative to soul-docs/ (e.g. "skeptic.soul.json" or "skeptic.critical.soul.json"). */
  file: string;
  /** 16 hex chars from soulDocHash() of the raw file text at load time. */
  sha: string;
}

import type { PovInfo, SpeakerId } from './types.js';
import type { TagSelection } from './types/session.js';

/**
 * Runtime-injected soul resolver. Each entry point passes its own:
 * - cli/server/Electron main → soulDocLoader.resolvePoverInfo
 * - Electron renderer / web → tagSoulRegistry.resolvePoverInfo
 * Shared lib/debate code (debateEngine.ts, etc.) must not import the loaders directly (t/3975).
 */
export type SoulResolverFn = (
  speaker: Exclude<SpeakerId, 'user'>,
  tagSelection?: TagSelection,
) => { soul: PovInfo; soulProvenance: SoulProvenance };
