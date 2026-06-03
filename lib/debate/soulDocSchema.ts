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
