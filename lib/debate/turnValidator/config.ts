// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 file-size split of turnValidator.ts (t/1686).
// Turn-validation config resolution.

import type { TurnValidationConfig } from '../types.js';

// ── Config resolution ────────────────────────────────────

export function resolveTurnValidationConfig(
  c: TurnValidationConfig | undefined,
): Required<TurnValidationConfig> {
  const src = c ?? {};
  const rawRetries = src.maxRetries ?? 0;
  const clamped = Math.max(0, Math.min(4, rawRetries));
  return {
    enabled: src.enabled ?? true,
    maxRetries: clamped as 0 | 1 | 2 | 3 | 4,
    deterministicOnly: src.deterministicOnly ?? false,
    judgeModel: src.judgeModel ?? 'claude-haiku-4-5-20251001',
    sampleRate: {
      'confrontation': src.sampleRate?.['confrontation'] ?? 1,
      argumentation: src.sampleRate?.argumentation ?? 1,
      concluding: src.sampleRate?.concluding ?? 1,
    },
    scoreThreshold: Math.max(0, Math.min(1, src.scoreThreshold ?? 0.65)),
    preCheckModel: src.preCheckModel ?? 'gemini-3.1-flash-lite',
    skipPreCheck: src.skipPreCheck ?? false,
  };
}
