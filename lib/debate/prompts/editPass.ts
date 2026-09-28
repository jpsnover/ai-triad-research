// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateAudience } from '../types.js';
import { AUDIENCE_GRADE_TARGET } from './shared-helpers.js';

export function readabilityEditPassPrompt(
  draft: string,
  audience: DebateAudience,
  violations: string,
): string {
  const { target, ceiling } = AUDIENCE_GRADE_TARGET[audience];
  const audienceLabel = audience.replace(/_/g, ' ');

  return `You are a copy editor preparing an AI-debate turn for a ${audienceLabel} reader. The argument, the debater's position, every concession/rebuttal move, and every fact are FINAL and correct. Your ONLY job is to make it readable at the target level WITHOUT changing what it argues, its debate moves, or its voice.

THE TURN:
${draft}

MEASURED PROBLEMS:
${violations}

RULES:
- Reading level: target Flesch-Kincaid grade ~${target} (ceiling ${ceiling}).
- VOCABULARY IS THE MAIN FIX: replace polysyllabic/abstract/jargon words with plain equivalents; de-nominalize ("regulators decided", not "the regulatory decision"); a technical term only when load-bearing, defined in the same sentence on first use.
- Sentences: no sentence over 30 words; one idea per sentence; split multi-claim sentences.
- Paragraphs: no wall of text; one point per paragraph.

HARD CONSTRAINTS (violating any is worse than leaving the draft):
- Do NOT change the position, the argument, any claim, number, name, or quote.
- Do NOT remove or alter debate MOVES: concessions, steelmans, rebuttals, crux engagement, the disagreement register. These drive the calibration signals, preserve them exactly.
- Do NOT introduce "Furthermore," "Moreover," "In conclusion," "Ultimately," "It is important to note."
- Keep length within ~10% (do not cut content); if the draft is pathologically long (>2x the turn's word budget), flag via edit_notes, do not silently truncate.

Return ONLY JSON (no markdown, no code fences):
{"statement": "<edited turn>", "changed": <bool>, "edit_notes": "<one sentence>"}`;
}
