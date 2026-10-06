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

/** Provenance for a loaded soul file. Shared by soulDocLoader (Node) and tagSoulRegistry (browser). */
export interface SoulProvenance {
  /** Path to the soul file. */
  file: string;
  /** 16 hex digits fingerprinting the soul (SHA-256 prefix on Node, FNV-1a in the browser). */
  sha: string;
}
