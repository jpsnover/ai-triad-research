// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { POVER_INFO } from '../types.js';
import type { DraftWorkProduct } from '../types.js';

// ── Targeted repair instructions ─────────────────────────
// Instead of appending generic "REPAIR HINTS" at the bottom (which reference output
// the LLM can't see), translate each failure type into a specific prompt modification
// placed in the recency window just before the JSON schema.

/** Cached codename→label regex pairs, built once from POVER_INFO. The
 *  pre-check / validator LLMs sometimes refer to speakers by internal codename
 *  (accelerationist / safetyist / skeptic) instead of the public label
 *  (Accelerationist / Safetyist / Skeptic) the debater sees everywhere else.
 *  Normalize so corrections are always in the speaker's own vocabulary. */
const SPEAKER_RENAME_PATTERNS: { pattern: RegExp; label: string }[] = Object.entries(POVER_INFO)
  .map(([codename, info]) => ({
    pattern: new RegExp(`\\b${codename}\\b`, 'gi'),
    label: info.label,
  }));

export function normalizeSpeakerNames(text: string): string {
  let out = text;
  for (const { pattern, label } of SPEAKER_RENAME_PATTERNS) {
    out = out.replace(pattern, label);
  }
  return out;
}

// ── Deterministic paragraph splitting ────────────────────

/** Split a single-paragraph statement into 3-5 paragraphs.
 *  Uses transition word boundaries when available, falls back to even splitting. */
export function splitIntoParagraphs(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  if (sentences.length < 4) return text; // too short to split meaningfully

  // Priority split points (natural topic transitions)
  const transitionPatterns = /^\s*(However|Moreover|In contrast|Furthermore|Critically|The key|This means|That said|Building on|To be precise|Nevertheless|Ultimately|In practice|The real|Meanwhile|Conversely|Additionally|Importantly|Specifically|Indeed)/i;

  const breakpoints: number[] = [];
  for (let i = 1; i < sentences.length; i++) {
    if (transitionPatterns.test(sentences[i])) {
      breakpoints.push(i);
    }
  }

  // If we found good breakpoints, use them (target 3-5 paragraphs)
  if (breakpoints.length >= 2 && breakpoints.length <= 5) {
    const paragraphs: string[] = [];
    let start = 0;
    for (const bp of breakpoints) {
      paragraphs.push(sentences.slice(start, bp).join('').trim());
      start = bp;
    }
    paragraphs.push(sentences.slice(start).join('').trim());
    return paragraphs.filter(p => p.length > 0).join('\n\n');
  }

  // Fallback: split evenly every ~3-5 sentences
  const targetParagraphs = Math.min(5, Math.max(3, Math.ceil(sentences.length / 4)));
  const chunkSize = Math.ceil(sentences.length / targetParagraphs);
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += chunkSize) {
    paragraphs.push(sentences.slice(i, i + chunkSize).join('').trim());
  }
  return paragraphs.filter(p => p.length > 0).join('\n\n');
}

// ── Draft field-level freeze for per-stage retries ───────

/** DraftWorkProduct fields that can be individually frozen on retry.
 *  key_assumptions extracted post-Draft (t/298); disagreement_type moved to claim extraction (t/298). */
export type DraftField = 'statement' | 'claim_sketches' | 'turn_symbols'
  | 'commitment' | 'position_update';

export const ALL_DRAFT_FIELDS: DraftField[] = [
  'statement', 'claim_sketches', 'turn_symbols',
  'commitment', 'position_update',
];

/** Map repair hint patterns to the DraftWorkProduct fields they target.
 *  Returns the set of fields that need regeneration — everything else can be frozen. */
export function classifyDraftHintFields(hints: string[]): Set<DraftField> {
  const targeted = new Set<DraftField>();
  for (const h of hints) {
    if (/abstract|number.*entity.*timeline|specific|claim_sketches|my_claims/i.test(h)) {
      targeted.add('claim_sketches');
    }
    if (/hedge density|qualifiers|hedging/i.test(h)) {
      targeted.add('statement');
    }
    if (/single paragraph|split into|paragraph/i.test(h)) {
      targeted.add('statement');
    }
    if (/directive|first paragraph|PIN|PROBE|CHALLENGE/i.test(h)) {
      targeted.add('statement');
    }
    if (/duplicate|repeated text/i.test(h)) {
      targeted.add('statement');
    }
    if (/move_types repeat|vary moves/i.test(h)) {
      targeted.add('turn_symbols');
    }
    if (/constructive move|CONCEDE.*PIVOT.*INTEGRATE/i.test(h)) {
      targeted.add('turn_symbols');
    }
    if (/concessions|conditions_for_change|sharpest_disagreements|commitment.*sub-fields/i.test(h)) {
      targeted.add('commitment');
    }
    if (/position_update/i.test(h)) {
      targeted.add('position_update');
    }
  }
  // If no specific fields matched, assume all fields need regeneration
  if (targeted.size === 0) {
    for (const f of ALL_DRAFT_FIELDS) targeted.add(f);
  }
  return targeted;
}

/** Build a prompt injection that tells the LLM to preserve specific fields
 *  from the prior draft while regenerating only the targeted fields. */
export function buildFieldFreezeBlock(
  priorDraft: DraftWorkProduct,
  targetedFields: Set<DraftField>,
): string {
  const frozenFields = ALL_DRAFT_FIELDS.filter(f => !targetedFields.has(f));
  if (frozenFields.length === 0) return '';

  // Only include frozen field values that exist on the prior draft
  const frozenEntries: Record<string, unknown> = {};
  for (const f of frozenFields) {
    const val = (priorDraft as Record<string, unknown>)[f];
    if (val !== undefined) frozenEntries[f] = val;
  }
  if (Object.keys(frozenEntries).length === 0) return '';

  return `\n=== FIELD-LEVEL FREEZE (from prior accepted draft) ===
The following fields passed validation. Copy them EXACTLY into your response — do not modify them:
${JSON.stringify(frozenEntries, null, 2)}

Only regenerate these fields: ${[...targetedFields].join(', ')}
All other fields above must appear verbatim in your output.\n`;
}

/** After parsing a retry draft, merge frozen fields from the prior draft
 *  to guarantee stability — LLMs don't always follow freeze instructions perfectly. */
export function mergeFrozenDraftFields(
  retryDraft: DraftWorkProduct,
  priorDraft: DraftWorkProduct,
  targetedFields: Set<DraftField>,
): DraftWorkProduct {
  const merged = { ...retryDraft };
  for (const f of ALL_DRAFT_FIELDS) {
    if (!targetedFields.has(f)) {
      const priorVal = (priorDraft as Record<string, unknown>)[f];
      if (priorVal !== undefined) {
        (merged as Record<string, unknown>)[f] = priorVal;
      }
    }
  }
  return merged;
}
