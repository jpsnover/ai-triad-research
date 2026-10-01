// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export const COHERENCE_JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    check1: { type: 'object', properties: { flagged: { type: 'boolean' }, span_a: { type: 'string' }, span_b: { type: 'string' }, why: { type: 'string' } }, required: ['flagged', 'span_a', 'span_b', 'why'] },
    check2: { type: 'object', properties: { flagged: { type: 'boolean' }, span_a: { type: 'string' }, span_b: { type: 'string' }, why: { type: 'string' } }, required: ['flagged', 'span_a', 'span_b', 'why'] },
    check3: { type: 'object', properties: { flagged: { type: 'boolean' }, span_a: { type: 'string' }, span_b: { type: 'string' }, why: { type: 'string' } }, required: ['flagged', 'span_a', 'span_b', 'why'] },
  },
  required: ['check1', 'check2', 'check3'],
} as const;

export interface CoherenceCheckEntry {
  flagged: boolean;
  span_a: string;
  span_b: string;
  why: string;
}

export interface CoherenceJudgeResult {
  check1: CoherenceCheckEntry;
  check2: CoherenceCheckEntry;
  check3: CoherenceCheckEntry;
}

export interface CoherenceJudgeCheck {
  check_id: string;
  flagged: boolean;
  span_a: string;
  span_b: string;
  why: string;
}

/** Normalise the flat CL output to an array with named check_ids. */
export function normalizeJudgeResult(raw: CoherenceJudgeResult): CoherenceJudgeCheck[] {
  return [
    { check_id: 'thesis_solution',     ...raw.check1 },
    { check_id: 'mechanism_scope',     ...raw.check2 },
    { check_id: 'co_asserted_tension', ...raw.check3 },
  ];
}

/** A flag is valid only when flagged AND both spans are non-empty (structural requirement from CL spec). */
export function validFlags(checks: CoherenceJudgeCheck[]): CoherenceJudgeCheck[] {
  return checks.filter(c => c.flagged && c.span_a.trim() !== '' && c.span_b.trim() !== '');
}

export function needsCoherenceRewrite(checks: CoherenceJudgeCheck[]): boolean {
  return validFlags(checks).length > 0;
}

export function buildCoherenceViolationsText(checks: CoherenceJudgeCheck[]): string {
  return validFlags(checks)
    .map(c => `[${c.check_id}] ${c.why}\nSpan A: "${c.span_a}"\nSpan B: "${c.span_b}"`)
    .join('\n\n');
}
