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
 * FNV-1a 32-bit × 2 hash of raw soul file text → "fnv1a64:" + 16 hex chars.
 * Browser-safe (no node:crypto). Used by both loaders for parity (t/4007 condition #3).
 * The "fnv1a64:" prefix distinguishes these values from any SHA-256 entries stored before t/4007.
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
  return 'fnv1a64:' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Serializable provenance for a resolved soul file. */
export interface SoulProvenance {
  /** Path relative to soul-docs/ (e.g. "skeptic.soul.json" or "skeptic.critical.soul.json"). */
  file: string;
  /** "fnv1a64:" + 16 hex chars from soulDocHash(). Not a cryptographic digest — use for change detection only. Field is `hash` (not `sha`) to signal algorithm-neutrality; op-ed entries pre-t/4007 used `sha` and held no prefix. */
  hash: string;
}

/**
 * Single constructor for soul provenance, used by both debate (soulDocLoader, tagSoulRegistry)
 * and op-ed (generate.ts). Guarantees one hash algorithm, one file format, one field name.
 * @param name  Soul-docs-relative file name, e.g. "skeptic.soul.json"
 * @param raw   Raw file text — hash is computed from this
 */
export function buildSoulProvenance(name: string, raw: string): SoulProvenance {
  return { file: name, hash: soulDocHash(raw) };
}

const REPO_RELATIVE_PREFIX = 'lib/debate/soul-docs/';

/**
 * Compare two soul provenance records in a legacy-aware way.
 *
 * Returns:
 * - `'same'`      — same soul (algorithm + file + content agree)
 * - `'different'` — different soul (same algorithm, content or file differs)
 * - `'unknown'`   — can't compare (one/both absent, or different algorithm prefixes)
 *
 * Legacy normalisation applied before comparison:
 * - Unprefixed hash values (pre-t/4007 SHA-256) treated as `sha256:<value>`.
 * - Repo-relative `file` (`lib/debate/soul-docs/X`) normalised to soul-docs-relative `X`.
 * - `sha` field treated as legacy alias for `hash` (op-ed records pre-t/4007 used `sha`).
 * Across-algorithm comparisons always return `'unknown'`.
 */
export function compareSoulProvenance(
  a: SoulProvenance | { file: string; sha: string } | undefined,
  b: SoulProvenance | { file: string; sha: string } | undefined,
): 'same' | 'different' | 'unknown' {
  if (!a || !b) return 'unknown';

  const resolveHash = (p: SoulProvenance | { file: string; sha: string }) =>
    'hash' in p ? p.hash : (p as { file: string; sha: string }).sha;
  const normaliseHash = (h: string) => (h.includes(':') ? h : `sha256:${h}`);
  const normaliseFile = (f: string) =>
    f.startsWith(REPO_RELATIVE_PREFIX) ? f.slice(REPO_RELATIVE_PREFIX.length) : f;

  const ha = normaliseHash(resolveHash(a));
  const hb = normaliseHash(resolveHash(b));

  const algoA = ha.split(':')[0];
  const algoB = hb.split(':')[0];
  if (algoA !== algoB) return 'unknown';

  const fa = normaliseFile(a.file);
  const fb = normaliseFile(b.file);

  return ha === hb && fa === fb ? 'same' : 'different';
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
) => { soul: PovInfo; soulProvenance: SoulProvenance | undefined };
