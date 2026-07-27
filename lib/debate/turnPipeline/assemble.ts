// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DraftWorkProduct, TurnPipelineResult, TaxonomyRef } from '../types.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import { validateDraftStage } from '../turnValidator.js';
import { wordOverlap, sanitizeTurnSymbols } from '../helpers.js';
import type { PoverResponseMeta, MoveAnnotation } from '../helpers.js';
import { sanitizeNodeIds } from '../nodeIdUtils.js';
import { normalizeDisagreementType } from './types.js';

/** Extract PoverResponseMeta-compatible object from DraftWorkProduct for validation. */
export function extractDraftMeta(draft: DraftWorkProduct): PoverResponseMeta {
  // Map claim_sketches → my_claims; fall back to structural extraction if LLM didn't produce them
  const claimsFromSketches = draft.claim_sketches?.map(c => ({
    claim: typeof c === 'string' ? c : (c as Record<string, unknown>).claim as string ?? '',
  }));
  const myClaims = claimsFromSketches?.length
    ? claimsFromSketches
    : extractFallbackClaims(draft.statement ?? '') ?? [];

  return {
    move_types: draft.move_types as MoveAnnotation[] | undefined,
    my_claims: myClaims,
    disagreement_type: draft.disagreement_type as string | undefined,
    key_assumptions: draft.key_assumptions as { assumption: string; if_wrong: string }[] | undefined,
    // Pass through intervention response fields
    ...(draft as Record<string, unknown>).pin_response != null ? { pin_response: (draft as Record<string, unknown>).pin_response } : {},
    ...(draft as Record<string, unknown>).probe_response != null ? { probe_response: (draft as Record<string, unknown>).probe_response } : {},
    ...(draft as Record<string, unknown>).challenge_response != null ? { challenge_response: (draft as Record<string, unknown>).challenge_response } : {},
    ...(draft as Record<string, unknown>).policy_challenge_response != null ? { policy_challenge_response: (draft as Record<string, unknown>).policy_challenge_response } : {},
    ...(draft as Record<string, unknown>).clarification != null ? { clarification: (draft as Record<string, unknown>).clarification } : {},
    ...(draft as Record<string, unknown>).check_response != null ? { check_response: (draft as Record<string, unknown>).check_response } : {},
    ...(draft as Record<string, unknown>).revoice_response != null ? { revoice_response: (draft as Record<string, unknown>).revoice_response } : {},
    ...(draft as Record<string, unknown>).reflection != null ? { reflection: (draft as Record<string, unknown>).reflection } : {},
    ...(draft as Record<string, unknown>).compressed_thesis != null ? { compressed_thesis: (draft as Record<string, unknown>).compressed_thesis } : {},
    ...(draft as Record<string, unknown>).commitment != null ? { commitment: (draft as Record<string, unknown>).commitment } : {},
  } as PoverResponseMeta;
}

// ── Statement deduplication ──────────────────────────────
// LLMs (especially Gemini flash) sometimes produce a statement where the entire
// content is repeated verbatim — 3 paragraphs followed by the same 3 paragraphs.
// Detect and truncate before the statement reaches the transcript.

/** Strip hallucinated markdown headings the LLM sometimes prepends despite prompt instructions. */
export function stripLeadingHeadings(statement: string): string {
  return statement.replace(/^(?:#{1,3}\s+.*\n*)+/, '').trimStart();
}

export function deduplicateStatement(statement: string): string {
  if (!statement || statement.length < 200) return statement;
  const len = statement.length;
  // Check if the second half is a near-exact copy of the first half.
  // Try at the midpoint and at nearby paragraph boundaries.
  for (const offset of [0, -50, 50, -100, 100]) {
    const mid = Math.floor(len / 2) + offset;
    if (mid < 100 || mid >= len - 100) continue;
    const firstHalf = statement.slice(0, mid).trim();
    const secondHalf = statement.slice(mid).trim();
    // Check if secondHalf starts with the same opening as the full statement
    const openLen = Math.min(80, firstHalf.length);
    if (secondHalf.slice(0, openLen) === firstHalf.slice(0, openLen)) {
      // Verify substantial overlap (not just a shared opening sentence)
      const overlapChars = Math.min(firstHalf.length, secondHalf.length, 300);
      if (firstHalf.slice(0, overlapChars) === secondHalf.slice(0, overlapChars)) {
        return firstHalf;
      }
    }
  }
  return statement;
}

// ── Fallback claim extractor ─────────────────────────────

/**
 * When the LLM fails to produce claim_sketches (e.g., outputs markdown instead
 * of JSON on retry), extract claims structurally from the statement text.
 * Finds sentences containing numbers, named entities, timelines, or specific
 * assertions — the same specificity signals Rule 9 checks for.
 */
function extractFallbackClaims(
  statement: string,
): Array<{ claim: string; targets: string[] }> | undefined {
  if (!statement || statement.length < 50) return undefined;

  // Split into sentences
  const sentences = statement
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.length > 20 && s.length < 300);

  // Specificity patterns — same as Rule 9 in validateDraftStage
  const specificPattern = /\d|[A-Z][a-z]+\s[A-Z][a-z]+|within|by\s\d{4}|percent|%|per year/;

  const claims: Array<{ claim: string; targets: string[] }> = [];
  for (const sentence of sentences) {
    if (specificPattern.test(sentence) && claims.length < 5) {
      claims.push({ claim: sentence.trim(), targets: [] });
    }
  }

  if (claims.length === 0) return undefined;
  console.log(`[pipeline] Fallback claim extraction: recovered ${claims.length} claims from statement text`);
  return claims;
}

// ── Assembler ───────────────────────────────────────────

export function assemblePipelineResult(
  result: TurnPipelineResult,
  validNodeIds?: Set<string>,
): { statement: string; taxonomyRefs: TaxonomyRef[]; meta: PoverResponseMeta } {
  // Moves come from the plan (source of truth), not from draft/cite LLM output.
  // The plan's planned_moves are already validated against the canonical move list.
  const moveAnnotations: (string | MoveAnnotation)[] = (result.plan.planned_moves ?? []).map(m => ({
    move: m.move,
    target: m.target,
    detail: m.detail,
  }));

  const rawRefs = (result.cite.taxonomy_refs ?? []).map(r => ({
    node_id: r.node_id,
    relevance: r.relevance,
  }));
  // Fuzzy-correct hallucinated node IDs (e.g., sit-cc-040 → cc-040) before filtering
  let taxonomyRefs: TaxonomyRef[];
  if (validNodeIds) {
    const { sanitized, corrections, removed } = sanitizeNodeIds(rawRefs.map(r => r.node_id), validNodeIds);
    if (corrections.length > 0) console.log(`[pipeline] Corrected ${corrections.length} hallucinated node ID(s): ${corrections.map(c => `${c.from}→${c.to}`).join(', ')}`);
    if (removed.length > 0) console.log(`[pipeline] Removed ${removed.length} invalid node ID(s): ${removed.join(', ')}`);
    if (corrections.length > 0 || removed.length > 0) {
      getGlobalRecorder()?.record({
        type: 'turn.hallucinated_refs', component: 'turn-pipeline', level: 'warn',
        message: `Sanitized ${corrections.length} corrected + ${removed.length} removed hallucinated node IDs`,
        data: {
          corrected: corrections.map(c => ({ from: c.from, to: c.to })),
          removed,
          total_raw: rawRefs.length,
          hallucinated_ref_rate: rawRefs.length > 0 ? (corrections.length + removed.length) / rawRefs.length : 0,
        },
      });
    }
    const validSet = new Set(sanitized);
    taxonomyRefs = rawRefs
      .map(r => {
        const correction = corrections.find(c => c.from === r.node_id);
        return correction ? { ...r, node_id: correction.to } : r;
      })
      .filter(r => validSet.has(r.node_id));
  } else {
    taxonomyRefs = rawRefs;
  }

  const statement = stripLeadingHeadings(deduplicateStatement(result.draft.statement ?? ''));
  const rawClaims = result.draft.claim_sketches?.length ? result.draft.claim_sketches : undefined;
  const groundedClaims = rawClaims && statement
    ? rawClaims.filter(c => wordOverlap(c.claim, statement) >= 0.4)
    : rawClaims;

  return {
    statement,
    taxonomyRefs,
    meta: {
      move_types: moveAnnotations.length > 0 ? moveAnnotations : undefined,
      disagreement_type: normalizeDisagreementType(result.draft.disagreement_type),
      key_assumptions: result.draft.key_assumptions?.length ? result.draft.key_assumptions : undefined,
      my_claims: groundedClaims?.length ? groundedClaims : undefined,
      policy_refs: result.cite.policy_refs?.length ? result.cite.policy_refs : undefined,
      position_update: result.draft.position_update || undefined,
      turn_symbols: result.draft.turn_symbols?.length ? sanitizeTurnSymbols(result.draft.turn_symbols) : undefined,
      pin_response: result.draft.pin_response,
      probe_response: result.draft.probe_response,
      challenge_response: result.draft.challenge_response,
      clarification: result.draft.clarification,
      check_response: result.draft.check_response,
      revoice_response: result.draft.revoice_response,
      reflection: result.draft.reflection,
      compressed_thesis: result.draft.compressed_thesis,
      commitment: result.draft.commitment,
      directive_response: result.plan?.directive_response,
    },
  };
}
