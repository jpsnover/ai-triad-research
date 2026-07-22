// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 file-size split of turnValidator.ts (t/1686).
// Draft quality pre-check result types and parser.

import { parseJsonRobust } from '../helpers.js';

// ── Draft quality pre-check ─────────────────────────────────
// Lightweight 3-question LLM evaluation between draft and cite stages.
// Catches grounding, falsifiability, and engagement defects early.

export interface DraftQualityResult {
  grounded: boolean;
  falsifiable: boolean;
  engages?: boolean;
  topic_aligned?: boolean;
  weaknesses: string[];
}

export interface DraftQualityCheckOutput {
  result: DraftQualityResult;
  prompt: string;
  raw: string;
  time_ms: number;
}

export function parseDraftQualityResult(raw: string): DraftQualityResult {
  const fallback: DraftQualityResult = { grounded: false, falsifiable: false, weaknesses: ['Draft quality check parse failure — treating as failed'] };
  try {
    const parsed = parseJsonRobust(raw) as Record<string, unknown>;
    const result: DraftQualityResult = {
      grounded: parsed.grounded === true,
      falsifiable: parsed.falsifiable === true,
      weaknesses: Array.isArray(parsed.weaknesses)
        ? (parsed.weaknesses as unknown[]).filter(w => typeof w === 'string').map(w => w as string).slice(0, 3)
        : [],
    };
    if ('engages' in parsed) {
      result.engages = parsed.engages === true;
    }
    if ('topic_aligned' in parsed) {
      result.topic_aligned = parsed.topic_aligned === true;
    }
    return result;
  } catch {
    return fallback;
  }
}
