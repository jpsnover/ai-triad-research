// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 file-size split of turnValidator.ts (t/1686).
// Per-stage validation (draft / cite / plan), boundary-concession detection,
// hint-key classification, and the associated result types.

import type {
  DebatePhase,
  DebateAudience,
  SpeakerId,
  TaxonomyRef,
  TranscriptEntry,
} from '../types.js';
import type { PoverResponseMeta, MoveAnnotation } from '../helpers.js';
import { getMoveName, SUPPORT_MOVES } from '../helpers.js';
import { checkInterventionCompliance } from '../moderator.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import { POVER_INFO } from '../types.js';
import {
  resolveMoveName,
  isFillerRelevance,
  MOVE_CATALOG,
  MOVE_CATALOG_RAW,
  DISAGREEMENT_TYPES,
} from './moves.js';
import { computeHedgeDensity, getHedgeThreshold } from './repair.js';
import type { DirectiveComplianceResult } from './directiveCompliance.js';
import { checkDirectiveContentCompliance } from './directiveCompliance.js';

// ── Per-stage validation ────────────────────────────────────
// Split validation into draft-specific and cite-specific checks.
// Each returns a lightweight result that can trigger a stage-scoped retry.

export interface StageValidationDetail {
  rule: string;
  pass: boolean;
  value?: string;
  flagged_claims?: string[];
}

export interface StageValidationResult {
  pass: boolean;
  repairHints: string[];
  /** Error-only hints (excludes warnings). Use for retry decisions — only errors warrant a retry. */
  errorHints: string[];
  /** Per-rule check details for diagnostics display. */
  details?: StageValidationDetail[];
  /** Dimension that failed (for diagnostics). */
  failedDimension?: 'schema' | 'grounding' | 'plan' | 'directive';
  /** Directive compliance details — present when a moderator directive exists. */
  directive_compliance?: DirectiveComplianceResult;
}

// ── Hardcoded boundary concession detection ─────────────────
// AC #3/4: detect when a CONCEDE move targets a hardcoded boundary

export interface BoundaryConcessionResult {
  hasConcession: boolean;
  boundaryType: 'hardcoded' | 'softcoded' | 'none';
  matchedBoundary?: string;
  moveDetail?: string;
  hasEvidence?: boolean;
}

const BOUNDARY_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'and', 'but', 'or', 'nor', 'not', 'so', 'that', 'this',
  'these', 'those', 'their', 'there', 'than', 'then', 'both', 'either',
  'any', 'all', 'each', 'every', 'some', 'such', 'very', 'just',
]);

function extractContentWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !BOUNDARY_STOP_WORDS.has(w)),
  );
}

function boundaryOverlap(detail: string, boundary: string): number {
  const detailWords = extractContentWords(detail);
  const boundaryWords = extractContentWords(boundary);
  if (boundaryWords.size === 0) return 0;
  const matched = [...boundaryWords].filter(w => detailWords.has(w)).length;
  return matched / boundaryWords.size;
}

const EVIDENCE_PATTERN = /\bevidence\b|\bdata\b|\bstud(?:y|ies)\b|\bresearch\b|\b\d{4}\b|\bfinding/i;

export function checkBoundaryConcession(
  speaker: SpeakerId,
  moveTypes: (string | MoveAnnotation)[],
  statement: string,
): BoundaryConcessionResult {
  const info = POVER_INFO[speaker as keyof typeof POVER_INFO];
  if (!info?.boundaries) return { hasConcession: false, boundaryType: 'none' };

  const concedeMoves = moveTypes
    .filter(m => resolveMoveName(getMoveName(m)).includes('CONCEDE'))
    .filter((m): m is MoveAnnotation => typeof m === 'object' && 'detail' in m);

  if (concedeMoves.length === 0) return { hasConcession: false, boundaryType: 'none' };

  const OVERLAP_THRESHOLD = 0.3;

  for (const move of concedeMoves) {
    const detail = move.detail ?? '';
    const target = move.target ?? '';
    const textToCheck = `${detail} ${target}`;

    for (const boundary of info.boundaries.hardcoded) {
      if (boundaryOverlap(textToCheck, boundary) >= OVERLAP_THRESHOLD) {
        return {
          hasConcession: true,
          boundaryType: 'hardcoded',
          matchedBoundary: boundary,
          moveDetail: detail,
        };
      }
    }

    for (const boundary of info.boundaries.softcoded) {
      if (boundaryOverlap(textToCheck, boundary) >= OVERLAP_THRESHOLD) {
        const hasEvidence = EVIDENCE_PATTERN.test(detail) || EVIDENCE_PATTERN.test(statement);
        return {
          hasConcession: true,
          boundaryType: 'softcoded',
          matchedBoundary: boundary,
          moveDetail: detail,
          hasEvidence,
        };
      }
    }
  }

  return { hasConcession: false, boundaryType: 'none' };
}

// ── Hint key classification ─────────────────────────────────
// Maps free-text repair hints to stable slugs for streak tracking.

const HINT_KEY_PATTERNS: [RegExp, string][] = [
  [/my_claims.*(empty|abstract)|claim specificity/i, 'claim_specificity'],
  [/hedge density/i, 'hedge_density'],
  [/move_types repeat/i, 'move_repetition'],
  [/constructive move|CONCEDE-AND-PIVOT.*INTEGRATE.*EXTEND/i, 'constructive_move'],
  [/paragraph/i, 'paragraph_count'],
  [/duplication|duplicat/i, 'duplication'],
  [/Unknown move_types/i, 'unknown_move'],
  [/disagreement_type/i, 'disagreement_type'],
  [/intervention compliance/i, 'intervention_compliance'],
  [/directive content/i, 'directive_compliance'],
  [/hardcoded boundary concession/i, 'hardcoded_boundary_concession'],
  [/softcoded.*evidence/i, 'softcoded_evidence_missing'],
];

/** Classify a repair hint string into a stable slug for streak tracking. */
export function classifyHintKey(hint: string): string {
  for (const [re, key] of HINT_KEY_PATTERNS) {
    if (re.test(hint)) return key;
  }
  return 'other';
}

/**
 * Validate the draft stage output. Checks statement content, moves, claims,
 * intervention compliance, and structural rules (Rules 1,2,6,8,9,10,11,12).
 */
export function validateDraftStage(p: {
  statement: string;
  meta: PoverResponseMeta;
  phase: DebatePhase;
  round: number;
  priorTurns: readonly TranscriptEntry[];
  audience?: DebateAudience;
  pendingIntervention?: import('../types.js').ModeratorIntervention;
  /** Hint keys suppressed due to repeated failures — skip from errors/warnings. */
  suppressedHints?: ReadonlySet<string>;
  speaker?: SpeakerId;
}): StageValidationResult {
  const errors: string[] = [];
  const suppressed: string[] = [];
  const warnings: string[] = [];
  const details: StageValidationDetail[] = [];
  const { statement, meta, phase, round, priorTurns, audience } = p;

  // Rule 1: move_types — only validate if present (move_types comes from cite stage,
  // so it may not exist on the draft output; the full validateTurn checks it post-assembly)
  if (meta.move_types && meta.move_types.length > 0) {
    let movePass = true;
    for (const mt of meta.move_types) {
      const name = getMoveName(mt);
      const resolved = resolveMoveName(name);
      if (!resolved) {
        errors.push(`Unknown move_types: "${name}". Use ONLY: ${MOVE_CATALOG_RAW.join(', ')}.`);
        movePass = false;
      }
    }
    details.push({ rule: 'move_types valid', pass: movePass, value: meta.move_types.map(m => getMoveName(m)).join(', ') });
  }

  // Rule 2: disagreement_type — only validate if present
  if (meta.disagreement_type) {
    const dtPass = DISAGREEMENT_TYPES.has(meta.disagreement_type.toUpperCase());
    if (!dtPass) {
      errors.push(`Unknown disagreement_type "${meta.disagreement_type}". Use: EMPIRICAL, VALUES, or DEFINITIONAL.`);
    }
    details.push({ rule: 'disagreement_type valid', pass: dtPass, value: meta.disagreement_type });
  }

  // Rule 6: paragraph count
  // Single-paragraph is handled by postDraft deterministic auto-split (t/311) — no retry needed.
  const paragraphs = statement.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const paraPass = paragraphs.length >= 3 && paragraphs.length <= 5;
  details.push({ rule: 'paragraph count 3–5', pass: paraPass, value: `${paragraphs.length}` });
  if (paragraphs.length === 2 || paragraphs.length > 5) {
    warnings.push(`Statement has ${paragraphs.length} paragraphs — target 3–5.`);
  }

  // Rule 8: move repetition
  if (meta.move_types && meta.move_types.length > 0 && priorTurns.length > 0) {
    const lastEntry = priorTurns[priorTurns.length - 1];
    const lastMeta = lastEntry?.metadata as Record<string, unknown> | undefined;
    const lastMoveTypes = lastMeta?.move_types as (string | MoveAnnotation)[] | undefined;
    if (lastMoveTypes && lastMoveTypes.length > 0) {
      const lastMoves = lastMoveTypes.map(m => resolveMoveName(getMoveName(m))).filter(Boolean);
      const currentMoves = meta.move_types.map(m => resolveMoveName(getMoveName(m))).filter(Boolean);
      const repeated = lastMoves.length === currentMoves.length &&
          lastMoves.every((m, i) => m === currentMoves[i]);
      details.push({ rule: 'move not repeated', pass: !repeated, value: currentMoves.join(', ') });
      if (repeated) {
        warnings.push(`move_types repeat your previous turn exactly (${lastMoves.join(', ')}). Vary your dialectical move.`);
      }
    }
  }

  // Rule 9: claim specificity
  if (round >= 3) {
    const claims = meta.my_claims ?? [];
    const specific = claims.some(c =>
      /\d|[A-Z][a-z]+\s[A-Z][a-z]+|[A-Z]{2,}|within|by\s\d{4}|percent|%|per year|Act\b|Treaty\b|Directive\b|Section\s/.test(c.claim),
    );
    // Pass = has claims AND (specific OR not yet round 4). But mark as warning if abstract.
    const claimPass = claims.length > 0 && specific;
    const claimWarn = claims.length > 0 && !specific && round < 4;
    const abstractClaims = specific ? [] : claims.map(c => c.claim);
    details.push({ rule: 'claim specificity', pass: claimPass || claimWarn, value: `${claims.length} claims${specific ? ', has specifics' : ', abstract only'}${claimWarn ? ' (warn)' : ''}`, flagged_claims: abstractClaims.length > 0 ? abstractClaims : undefined });
    if (claims.length === 0) {
      errors.push('my_claims is empty — add at least one claim with a concrete number, percentage, named institution or person, or timeline. Use the source evidence facts if provided.');
    } else if (!specific && round >= 4) {
      errors.push('my_claims are all abstract — each claim needs at least one of: a number/percentage, a named entity (institution, person, regulation), or a timeline/date. Use the source evidence provided — cite specific statistics and findings.');
    } else if (!specific) {
      warnings.push('my_claims are all abstract — include a number, named entity, or timeline. Use the source evidence if provided.');
    }
  }

  // Rule 10: hedge density
  const hedgeDensity = computeHedgeDensity(statement);
  const hedgeThreshold = getHedgeThreshold(phase, audience);
  const hedgePass = hedgeDensity <= hedgeThreshold;
  details.push({ rule: `hedge density ≤${(hedgeThreshold * 100).toFixed(0)}%`, pass: hedgePass, value: `${(hedgeDensity * 100).toFixed(1)}%` });
  if (!hedgePass) {
    warnings.push(`Hedge density ${(hedgeDensity * 100).toFixed(0)}% exceeds ${(hedgeThreshold * 100).toFixed(0)}% threshold.`);
  }

  // Rule 11: constructive move
  if (phase !== 'confrontation' && round >= 4 && meta.move_types && meta.move_types.length > 0) {
    const resolved = meta.move_types.map(m => resolveMoveName(getMoveName(m)));
    const hasConstructive = resolved.some(m => m && SUPPORT_MOVES.has(m));
    details.push({ rule: 'constructive move present', pass: hasConstructive, value: resolved.filter(Boolean).join(', ') });
    if (!hasConstructive) {
      const msg = 'No constructive move found — include at least one of: CONCEDE-AND-PIVOT, INTEGRATE, EXTEND, SPECIFY.';
      if (phase === 'concluding' || round >= 6) errors.push(msg);
      else warnings.push(msg);
    }
  }

  // Rule 12: statement duplication
  let dupPass = true;
  if (statement.length >= 400) {
    const half = Math.floor(statement.length / 2);
    const first300 = statement.slice(0, 300).trim();
    const secondHalfIdx = statement.indexOf(first300, half - 150);
    if (secondHalfIdx > 0 && secondHalfIdx >= half - 150) {
      errors.push('Statement contains verbatim repeated text — your response appears to duplicate itself.');
      dupPass = false;
    }
  }
  details.push({ rule: 'no duplication', pass: dupPass, value: `${statement.length} chars` });

  // Intervention compliance — structured response field check
  if (p.pendingIntervention) {
    const rawMeta = (meta as Record<string, unknown>) ?? {};
    const compliance = checkInterventionCompliance(p.pendingIntervention.move, rawMeta);
    details.push({ rule: 'intervention compliance', pass: compliance.compliant, value: p.pendingIntervention.move });
    if (!compliance.compliant && compliance.repair_hint) {
      errors.push(compliance.repair_hint);
    }
  }

  // Directive content compliance — first paragraph must engage the directive
  let directiveResult: DirectiveComplianceResult | undefined;
  if (p.pendingIntervention) {
    directiveResult = checkDirectiveContentCompliance(
      statement,
      p.pendingIntervention,
    );
    details.push({ rule: 'directive content compliance', pass: directiveResult.compliant, value: `${directiveResult.matched_terms}/${directiveResult.directive_terms.length} terms` });
    if (!directiveResult.compliant) {
      errors.push(directiveResult.repair_hint);
    }
  }

  // Rule 13: hardcoded/softcoded boundary concession check (AC #3/4/5)
  let boundaryConcession: BoundaryConcessionResult | undefined;
  if (p.speaker && meta.move_types && meta.move_types.length > 0) {
    boundaryConcession = checkBoundaryConcession(p.speaker, meta.move_types, statement);
    if (boundaryConcession.boundaryType === 'hardcoded') {
      const msg = `Hardcoded boundary concession detected — you conceded a position that is identity-defining and non-negotiable: "${boundaryConcession.matchedBoundary}". Retract this concession in your next turn and reaffirm your hardcoded position.`;
      warnings.push(msg);
      details.push({ rule: 'no hardcoded boundary concession', pass: false, value: boundaryConcession.matchedBoundary ?? '' });
    } else if (boundaryConcession.boundaryType === 'softcoded' && !boundaryConcession.hasEvidence) {
      const msg = `Softcoded boundary concession without evidence — you updated a default position but did not cite the evidence that moved you. Name the specific evidence per the "name the evidence that moved you" instruction.`;
      warnings.push(msg);
      details.push({ rule: 'softcoded concession cites evidence', pass: false, value: boundaryConcession.matchedBoundary ?? '' });
    } else if (boundaryConcession.boundaryType === 'softcoded') {
      details.push({ rule: 'softcoded concession cites evidence', pass: true, value: boundaryConcession.matchedBoundary ?? '' });
    }
  }

  // Filter out suppressed hints — they still appear in `details` for transparency
  // but are excluded from repair/error hints so they don't trigger retries.
  const isSuppressed = (hint: string) => p.suppressedHints?.has(classifyHintKey(hint)) ?? false;
  const activeErrors = errors.filter(h => !isSuppressed(h));
  const activeWarnings = warnings.filter(h => !isSuppressed(h));
  const suppressedCount = (errors.length - activeErrors.length) + (warnings.length - activeWarnings.length);
  if (suppressedCount > 0) {
    getGlobalRecorder()?.record({
      type: 'turn.hint-filtered', component: 'turn-validator', level: 'info',
      message: `${suppressedCount} hint(s) suppressed due to repeated failures`,
      data: { suppressed_keys: [...(p.suppressedHints ?? [])], original_errors: errors.length, original_warnings: warnings.length },
    });
  }

  const draftResult = {
    pass: activeErrors.length === 0,
    repairHints: [...activeErrors, ...activeWarnings],
    errorHints: activeErrors,
    details,
    failedDimension: activeErrors.length > 0
      ? (directiveResult && !directiveResult.compliant ? 'directive' : 'schema')
      : undefined as 'schema' | 'grounding' | 'plan' | 'directive' | undefined,
    directive_compliance: directiveResult,
  };
  getGlobalRecorder()?.record({
    type: draftResult.pass ? 'turn.validate' : 'turn.stage.validation.fail',
    component: 'turn-validator', level: draftResult.pass ? 'info' : 'warn',
    message: `draft validation ${draftResult.pass ? 'passed' : 'failed'}: ${errors.length} error(s), ${warnings.length} warning(s)`,
    data: { stage: 'draft', pass: draftResult.pass, error_count: errors.length, warning_count: warnings.length, failed_dimension: draftResult.failedDimension },
  });
  return draftResult;
}

/**
 * Validate the cite stage output. Checks taxonomy_refs quality, node_id validity,
 * policy_refs, and relevance text (Rules 3,4,5,7).
 */
export function validateCiteStage(p: {
  taxonomyRefs: TaxonomyRef[];
  policyRefs?: (string | { policy_id: string; relevance?: string })[];
  knownNodeIds: Set<string>;
  policyIds: Set<string>;
  priorTurns: readonly TranscriptEntry[];
  speaker: SpeakerId | string;
  targetNodes?: string[];
}): StageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { taxonomyRefs, knownNodeIds, policyIds, priorTurns, speaker } = p;

  // Rule 3: taxonomy_refs node_id exists (skip when no known set provided)
  if (knownNodeIds.size > 0) {
    const unknownRefs = taxonomyRefs.filter(r => !knownNodeIds.has(r.node_id));
    if (unknownRefs.length > 0) {
      errors.push(`Unknown taxonomy node_id: ${unknownRefs.map(r => r.node_id).join(', ')}. Use only nodes from your taxonomy context.`);
    }
  }

  // Rule 4: policy_refs exist (skip if no registry loaded)
  // Cite stage emits {policy_id, relevance} objects (post-CQ) or bare strings (pre-CQ).
  const policyRefs = p.policyRefs ?? [];
  if (policyIds.size > 0) {
    const policyIdList = policyRefs
      .map(p => typeof p === 'string' ? p : p?.policy_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const unknownPolicies = policyIdList.filter(pid => !policyIds.has(pid));
    if (unknownPolicies.length > 0) {
      warnings.push(`Unknown policy_refs: ${unknownPolicies.join(', ')}.`);
    }
  }

  // Rule 5: relevance text quality (warning only)
  const weakRelevance = taxonomyRefs.filter(
    r => (r.relevance ?? '').trim().length < 40 || isFillerRelevance((r.relevance ?? '').trim()),
  );
  if (weakRelevance.length > 0) {
    warnings.push(`taxonomy_refs with filler or too-short 'relevance' (≥40 chars): ${weakRelevance.map(r => r.node_id).join(', ')}. Explain the mechanism by which the node supports or complicates your claim.`);
  }

  // Rule 7: novelty — at least one new taxonomy_ref not used in prior same-speaker turns
  const priorSpeakerRefs = new Set(
    priorTurns
      .filter(t => t.speaker === speaker)
      .slice(-2)
      .flatMap(t => (t.taxonomy_refs ?? []).map(r => r.node_id)),
  );
  if (priorSpeakerRefs.size > 0 && taxonomyRefs.length > 0) {
    const hasNew = taxonomyRefs.some(r => !priorSpeakerRefs.has(r.node_id));
    if (!hasNew) {
      warnings.push('No new taxonomy_refs — cite at least one node not used in your last 2 turns.');
    }
  }

  // Rule 8: target_nodes coverage — planned nodes should appear in final taxonomy_refs
  if (p.targetNodes && p.targetNodes.length > 0) {
    const citedIds = new Set(taxonomyRefs.map(r => r.node_id));
    const missing = p.targetNodes.filter(id => !citedIds.has(id));
    if (missing.length > 0) {
      warnings.push(`Planned target_nodes missing from taxonomy_refs: ${missing.join(', ')}. The plan committed to engaging these nodes.`);
    }
  }

  const citeResult = {
    pass: errors.length === 0,
    repairHints: [...errors, ...warnings],
    errorHints: errors,
    failedDimension: errors.length > 0 ? 'grounding' as const : undefined,
  };
  getGlobalRecorder()?.record({
    type: citeResult.pass ? 'turn.validate' : 'turn.stage.validation.fail',
    component: 'turn-validator', level: citeResult.pass ? 'info' : 'warn',
    message: `cite validation ${citeResult.pass ? 'passed' : 'failed'}: ${errors.length} error(s), ${warnings.length} warning(s)`,
    data: { stage: 'cite', pass: citeResult.pass, error_count: errors.length, warning_count: warnings.length, taxonomy_refs_count: taxonomyRefs.length },
  });
  return citeResult;
}

/**
 * Validate the plan stage output. Checks strategic_goal, planned_moves (canonical moves,
 * substantive detail, count), argument_sketch, anticipated_responses, and target_claims.
 */
export function validatePlanStage(p: {
  plan: import('../types.js').PlanWorkProduct;
  isFirstRound: boolean;
}): StageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const details: StageValidationDetail[] = [];
  const { plan, isFirstRound } = p;

  // Rule 1: strategic_goal is substantive (≥30 chars)
  const goalLen = (plan.strategic_goal ?? '').trim().length;
  const goalPass = goalLen >= 30;
  details.push({ rule: 'strategic_goal ≥30 chars', pass: goalPass, value: `${goalLen} chars` });
  if (!goalPass) {
    errors.push('strategic_goal is missing or too short (≥30 chars). Provide a clear one-liner that guides the entire turn.');
  }

  // Rule 2: planned_moves use canonical moves
  const moves = plan.planned_moves ?? [];
  const nonCanonical = moves.filter(pm => !MOVE_CATALOG.has(resolveMoveName(pm.move)));
  const movesCanonicalPass = nonCanonical.length === 0;
  details.push({ rule: 'planned_moves canonical', pass: movesCanonicalPass, value: `${moves.length} move(s)${nonCanonical.length > 0 ? `, ${nonCanonical.length} non-canonical` : ''}` });
  for (const pm of nonCanonical) {
    warnings.push(`Unknown planned move "${pm.move}". Use ONLY: ${MOVE_CATALOG_RAW.join(', ')}.`);
  }

  // Rule 3: planned_moves have substantive detail (≥20 chars each)
  const shortMoves = moves.filter(pm => !pm.detail || pm.detail.trim().length < 20);
  const detailPass = shortMoves.length === 0;
  details.push({ rule: 'move details ≥20 chars', pass: detailPass, value: detailPass ? 'all substantive' : `${shortMoves.length} too short` });
  for (const pm of shortMoves) {
    errors.push(`Planned move "${pm.move}" has missing or too-short detail (≥20 chars). Explain what you will argue.`);
  }

  // Rule 4: planned_moves count (at least 1, warn if >5)
  const countPass = moves.length >= 1 && moves.length <= 5;
  details.push({ rule: 'move count 1-5', pass: countPass, value: `${moves.length}` });
  if (moves.length === 0) {
    errors.push('planned_moves is empty — plan at least one dialectical move.');
  } else if (moves.length > 5) {
    warnings.push(`${moves.length} planned moves is over-ambitious — target 1–5 moves per turn.`);
  }

  // Rule 5: argument_sketch is substantive (≥50 chars)
  const sketchLen = (plan.argument_sketch ?? '').trim().length;
  const sketchPass = sketchLen >= 50;
  details.push({ rule: 'argument_sketch ≥50 chars', pass: sketchPass, value: `${sketchLen} chars` });
  if (!sketchPass) {
    errors.push('argument_sketch is missing or too short (≥50 chars). Outline your core argumentative strategy.');
  }

  // Rule 6: anticipated_responses present
  const responses = plan.anticipated_responses ?? [];
  const responsesPass = responses.length > 0;
  details.push({ rule: 'anticipated_responses', pass: responsesPass, value: `${responses.length} response(s)` });
  if (!responsesPass) {
    warnings.push('anticipated_responses is empty — anticipate at least one counterargument.');
  }

  // Rule 7: target_claims present (warning only, skip round 1)
  if (!isFirstRound) {
    const targets = plan.target_claims ?? [];
    const targetsPass = targets.length > 0;
    details.push({ rule: 'target_claims', pass: targetsPass, value: targets.length > 0 ? targets.join(', ') : '(none)' });
    if (!targetsPass) {
      warnings.push('target_claims is empty — identify at least one prior claim to address.');
    }
  } else {
    details.push({ rule: 'target_claims', pass: true, value: 'skipped (first round)' });
  }

  const planResult = {
    pass: errors.length === 0,
    repairHints: [...errors, ...warnings],
    errorHints: errors,
    details,
    failedDimension: errors.length > 0 ? 'plan' as const : undefined,
  };
  getGlobalRecorder()?.record({
    type: planResult.pass ? 'turn.validate' : 'turn.stage.validation.fail',
    component: 'turn-validator', level: planResult.pass ? 'info' : 'warn',
    message: `plan validation ${planResult.pass ? 'passed' : 'failed'}: ${errors.length} error(s), ${warnings.length} warning(s)`,
    data: { stage: 'plan', pass: planResult.pass, error_count: errors.length, warning_count: warnings.length, move_count: (plan.planned_moves ?? []).length },
  });
  return planResult;
}
