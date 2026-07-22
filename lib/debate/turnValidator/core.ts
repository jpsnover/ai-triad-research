// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ADR-007 file-size split of turnValidator.ts (t/1686).
// Full-turn validation: Stage-A structural rules, Stage-B neural judge, and the
// validateTurn orchestrator. Public surface: ValidateTurnParams, validateTurn.

import type {
  DebatePhase,
  DebateAudience,
  SpeakerId,
  TaxonomyRef,
  TranscriptEntry,
  TurnValidation,
  TurnValidationConfig,
  TurnValidationDimensions,
  TaxonomyClarificationHint,
} from '../types.js';
import type { PoverResponseMeta } from '../helpers.js';
import { parseJsonRobust, getMoveName, SUPPORT_MOVES } from '../helpers.js';
import { checkInterventionCompliance } from '../moderator.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import {
  resolveMoveName,
  isFillerRelevance,
  MOVE_CATALOG,
  MOVE_CATALOG_RAW,
  DISAGREEMENT_TYPES,
} from './moves.js';
import { computeHedgeDensity, getHedgeThreshold } from './repair.js';

// ── Validation entry point ───────────────────────────────

export interface ValidateTurnParams {
  statement: string;
  taxonomyRefs: TaxonomyRef[];
  meta: PoverResponseMeta;
  phase: DebatePhase;
  speaker: SpeakerId;
  round: number;
  /** Last up to 2 same-agent prior turns, newest last. */
  priorTurns: TranscriptEntry[];
  /** Up to 2 most-recent turns from any agent (newest last) — judge context. */
  recentTurns: TranscriptEntry[];
  knownNodeIds: ReadonlySet<string>;
  policyIds: ReadonlySet<string>;
  audience?: DebateAudience;
  config: Required<TurnValidationConfig>;
  callJudge: (prompt: string, label: string) => Promise<string>;
  /** Optional fallback judge caller using the debate's own model when the primary judge fails. */
  callJudgeFallback?: (prompt: string, label: string) => Promise<string>;
  /** Active moderator intervention that preceded this turn — triggers compliance checks. */
  pendingIntervention?: import('../types.js').ModeratorIntervention;
  /** When true, all citations in the draft have been verified against the citation bank.
   *  Tells the judge not to re-flag citation quality — the scrub already handled it. */
  citationBankValidated?: boolean;
  /** Summary of evidence that was available to the debater (from the evidence stage).
   *  Passed to the judge so it doesn't penalize missing evidence the debater never had. */
  evidenceContext?: string;
}

interface StageAResult {
  errorIssues: string[];
  warningIssues: string[];
  dimensions: TurnValidationDimensions;
}

function runStageA(p: ValidateTurnParams): StageAResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schemaIssues: string[] = [];
  const groundingIssues: string[] = [];
  const advancementSignals: string[] = [];

  const { statement, taxonomyRefs, meta, round, phase, priorTurns, knownNodeIds, policyIds } = p;

  // Rule 1: move_types present and valid — normalize to canonical 10, error on unmappable
  if (meta.move_types && meta.move_types.length > 0) {
    const resolved: typeof meta.move_types = [];
    const unmappable: string[] = [];
    for (const m of meta.move_types) {
      const rawName = getMoveName(m);
      const resolvedName = resolveMoveName(rawName);
      if (MOVE_CATALOG.has(resolvedName)) {
        // Normalize the move to its canonical name
        if (typeof m === 'string') {
          resolved.push(resolvedName);
        } else {
          resolved.push({ ...m, move: resolvedName });
        }
      } else {
        unmappable.push(rawName);
      }
    }
    if (unmappable.length > 0) {
      const msg = `Unknown move_types: ${unmappable.join(', ')}. Use ONLY the 10 canonical moves: ${MOVE_CATALOG_RAW.join(', ')}.`;
      errors.push(msg);
      schemaIssues.push(msg);
    }
    // Replace with normalized moves (drop unmappable)
    meta.move_types = resolved.length > 0 ? resolved : meta.move_types;
  } else {
    const msg = 'move_types is missing or empty — declare at least one dialectical move.';
    errors.push(msg);
    schemaIssues.push(msg);
  }

  // Rule 2: disagreement_type enum (error, only if present)
  if (meta.disagreement_type && !DISAGREEMENT_TYPES.has(meta.disagreement_type)) {
    const msg = `disagreement_type '${meta.disagreement_type}' is not one of EMPIRICAL | VALUES | DEFINITIONAL.`;
    errors.push(msg);
    schemaIssues.push(msg);
  }

  // Rule 3: every taxonomy_refs[i].node_id exists (error) — skip when no known set
  if (knownNodeIds.size > 0) {
    const unknownRefs = taxonomyRefs.filter(r => !knownNodeIds.has(r.node_id));
    if (unknownRefs.length > 0) {
      const msg = `Unknown taxonomy node_id(s): ${unknownRefs.map(r => r.node_id).join(', ')}. Cite only nodes that exist in the loaded taxonomy.`;
      errors.push(msg);
      schemaIssues.push(msg);
      groundingIssues.push(msg);
    }
  }

  // Rule 4: policy_refs exist (warning only)
  // Post-CQ cite stage emits {policy_id, relevance} objects; pre-CQ emits bare strings.
  if (meta.policy_refs && policyIds.size > 0) {
    const policyIdList = (meta.policy_refs as (string | { policy_id: string })[])
      .map(p => typeof p === 'string' ? p : p?.policy_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const unknownPolicies = policyIdList.filter(pid => !policyIds.has(pid));
    if (unknownPolicies.length > 0) {
      const msg = `Unknown policy_refs: ${unknownPolicies.join(', ')}.`;
      warnings.push(msg);
      groundingIssues.push(msg);
    }
  }

  // Rule 5: every relevance must be substantive (warning — cite stage produces this text,
  // so retrying the draft can't fix it; downgraded from error to prevent unresolvable retries)
  const weakRelevance = taxonomyRefs.filter(
    r => (r.relevance ?? '').trim().length < 40 || isFillerRelevance((r.relevance ?? '').trim()),
  );
  if (weakRelevance.length > 0) {
    const msg = `taxonomy_refs with filler or too-short 'relevance' (≥40 chars, no stock openers): ${weakRelevance.map(r => r.node_id).join(', ')}. Explain the mechanism by which the node supports or complicates your claim.`;
    warnings.push(msg);
    groundingIssues.push(msg);
  }

  // Rule 6: paragraph count 3–5
  // Single-paragraph is handled by postDraft deterministic auto-split (t/311) — no retry needed.
  // Only warn on 2 or >5 paragraphs (non-triggering observation).
  const paragraphs = statement.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (paragraphs.length === 2 || paragraphs.length > 5) {
    const msg = `Statement has ${paragraphs.length} paragraphs — target 3–5 double-newline-separated blocks.`;
    warnings.push(msg);
  }

  // Rule 7: novelty (warning everywhere; harder expectation outside confrontation)
  const priorNodeIds = new Set<string>();
  for (const t of priorTurns) {
    for (const r of t.taxonomy_refs ?? []) priorNodeIds.add(r.node_id);
  }
  const newRefs = taxonomyRefs.filter(r => !priorNodeIds.has(r.node_id));
  if (newRefs.length === 0 && priorNodeIds.size > 0) {
    const msg = 'No new taxonomy_refs beyond your last two turns — introduce at least one node you have not cited recently.';
    warnings.push(msg);
    if (phase !== 'confrontation') {
      // Treat as a stronger advancement failure in later phases but still warning-level.
      advancementSignals.push('no_new_refs');
    }
  } else if (newRefs.length > 0) {
    advancementSignals.push(`new_refs:${newRefs.length}`);
  }

  // Rule 8: move repetition vs most recent same-agent turn (warning)
  const lastMoves = priorTurns.length > 0
    ? (((priorTurns[priorTurns.length - 1].metadata as Record<string, unknown> | undefined)?.move_types) as (string | import('../helpers.js').MoveAnnotation)[] | undefined)
        ?.map(m => resolveMoveName(getMoveName(m)))
    : undefined;
  if (
    lastMoves && lastMoves.length > 0 &&
    meta.move_types && meta.move_types.length > 0 &&
    lastMoves.length === meta.move_types.length &&
    lastMoves.every((m, i) => m === resolveMoveName(getMoveName(meta.move_types![i])))
  ) {
    const msg = `move_types repeat your previous turn exactly (${lastMoves.join(', ')}). Vary your dialectical move.`;
    warnings.push(msg);
  }

  // Rule 9: claim specificity — warning after round 3, error after round 4
  if (round >= 3) {
    const claims = meta.my_claims ?? [];
    const specific = claims.some(c =>
      /\d|[A-Z][a-z]+\s[A-Z][a-z]+|[A-Z]{2,}|within|by\s\d{4}|percent|%|per year|Act\b|Treaty\b|Directive\b|Section\s/.test(c.claim),
    );
    const target = round >= 4 ? errors : warnings;
    if (claims.length === 0) {
      const msg = 'my_claims is empty — add at least one claim with a concrete number, percentage, named institution or person, or timeline (e.g. "94% of cases", "European Commission", "by 2028"). Use the source evidence facts if provided.';
      target.push(msg);
    } else if (!specific) {
      const msg = 'my_claims are all abstract — each claim needs at least one of: a number/percentage, a named entity (institution, person, regulation), or a timeline/date. Use the source evidence provided in the prompt — cite the specific statistics and findings rather than paraphrasing vaguely.';
      target.push(msg);
    } else {
      advancementSignals.push('specific_claim');
    }
  }

  // Rule 10: hedge density — audience-aware, phase-aware warning
  const hedgeDensity = computeHedgeDensity(statement);
  const hedgeThreshold = getHedgeThreshold(phase, p.audience);
  if (hedgeDensity > hedgeThreshold) {
    const pct = (hedgeDensity * 100).toFixed(0);
    const thresh = (hedgeThreshold * 100).toFixed(0);
    const msg = `Hedge density ${pct}% exceeds ${thresh}% threshold — replace qualifiers (may, might, could, perhaps, potentially) with definitive assertions. Use specific actors, timelines, and numbers.`;
    warnings.push(msg);
    advancementSignals.push(`high_hedge_density:${pct}%`);
  }

  // Rule 11: constructive move requirement — at least one support move after round 4
  if (phase !== 'confrontation' && round >= 4 && meta.move_types && meta.move_types.length > 0) {
    const resolved = meta.move_types.map(m => resolveMoveName(getMoveName(m)));
    const hasConstructive = resolved.some(m => SUPPORT_MOVES.has(m));
    if (!hasConstructive) {
      const constructiveList = 'CONCEDE-AND-PIVOT, INTEGRATE, EXTEND, SPECIFY';
      const msg = `No constructive move found — include at least one of: ${constructiveList}. Convergence requires engaging with opponents' strongest points, not just attacking.`;
      if (phase === 'concluding' || round >= 6) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
      advancementSignals.push('no_constructive_move');
    }
  }

  // Rule 12: statement duplication — detect verbatim repetition of large text blocks
  if (statement.length >= 400) {
    const half = Math.floor(statement.length / 2);
    const first300 = statement.slice(0, 300).trim();
    // Check if the same 300-char block appears again in the second half
    const secondHalfIdx = statement.indexOf(first300, half - 150);
    if (secondHalfIdx > 0 && secondHalfIdx >= half - 150) {
      const msg = 'Statement contains verbatim repeated text — your response appears to duplicate itself. Write each paragraph once.';
      errors.push(msg);
      schemaIssues.push(msg);
    }
  }

  const schemaPass = schemaIssues.length === 0;
  const groundingPass = groundingIssues.length === 0;
  // advancement pass decided later composite with judge signal
  const advancementPass = !advancementSignals.includes('no_new_refs');

  return {
    errorIssues: errors,
    warningIssues: warnings,
    dimensions: {
      schema:      { pass: schemaPass, issues: schemaIssues },
      grounding:   { pass: groundingPass, issues: groundingIssues },
      advancement: { pass: advancementPass, signals: advancementSignals },
      clarifies:   { pass: false, signals: [] },
    },
  };
}

// ── Stage B judge ────────────────────────────────────────

function buildJudgePrompt(p: ValidateTurnParams): string {
  const window = p.recentTurns.slice(-2).map(t => {
    const content = typeof t.content === 'string' ? t.content : JSON.stringify(t.content);
    return `[${t.speaker}] ${content.slice(0, 800)}`;
  }).join('\n\n');

  const turnJson = JSON.stringify({
    statement: p.statement.slice(0, 6000),
    taxonomy_refs: p.taxonomyRefs,
    move_types: p.meta.move_types ?? [],
    disagreement_type: p.meta.disagreement_type ?? null,
    my_claims: p.meta.my_claims ?? [],
  }, null, 2);

  // Include the evidence that was available to the debater (if any)
  const evidenceBlock = p.evidenceContext
    ? `\nEvidence available to this debater (from source corpus):
${p.evidenceContext}
`
    : '';

  return `You are a debate-progress referee. You do NOT take sides. You judge ONE turn against the last two turns of the same debate.

Phase: ${p.phase}
Agent: ${p.speaker}
Round: ${p.round}

Previous turns (last 2, any agent):
${window || '(no prior turns)'}
${evidenceBlock}
Current turn (JSON):
${turnJson}

Decide:
1. ADVANCES — does this turn do something the previous turns did not? (distinguish, concede-and-pivot, falsifiable prediction, narrowed crux, new steelman)
2. CLARIFIES_TAXONOMY — does it imply a taxonomy edit? Choose zero or more of:
   narrow <node_id> | broaden <node_id> | split <node_id> | merge <node_ids> | qualify <node_id> | retire <node_id> | new_node <label>
   Only mark a hint when the turn contains evidence for it — never speculative.
3. WEAKNESSES — list at most 3, each ≤15 words. Each names a concrete fix the debater could apply on retry.
   IMPORTANT: Only flag missing evidence if the evidence WAS available above and the debater failed to use it. Do NOT flag the absence of evidence that was never in the debater's evidence block — that is a corpus limitation, not a debater failure.
4. QUALITY_SCORE — rate overall turn quality 0.0 to 1.0 using this rubric:
   1.0: Exceptional — specific evidence, falsifiable claims, engages opponent's strongest point, no logical gaps
   0.8: Strong — substantive argument with minor gaps (missing evidence for one claim, or one unaddressed counterpoint)
   0.6: Adequate — makes progress but has 2+ identifiable weaknesses (vague claims, ungrounded assertions, ignored objections)
   0.4: Weak — mostly abstract, recycles prior arguments, or talks past opponents
   0.2: Poor — fails to engage the debate substance meaningfully

   CRITICAL CALIBRATION RULES:
   - 0 weaknesses → score ≥ 0.8
   - 1 weakness → score 0.65-0.80
   - 2 weaknesses → score 0.50-0.65
   - 3 weaknesses → score 0.40-0.55
   - Any weakness containing "lacks evidence", "no data", "unsubstantiated", or "missing citation" → subtract 0.10 from what you would otherwise give
   - A score of 1.0 with any weaknesses is contradictory and MUST NOT occur${p.citationBankValidated ? `

   CITATION NOTE: All citations in this statement have been verified against the source evidence bank. Do NOT flag citation quality, fabricated references, or unverifiable sources — these have already been validated. Focus your weaknesses on argument quality, engagement, and logical structure instead.` : ''}

5. RECOMMEND — based on your quality_score:
   "pass": quality_score ≥ 0.7 and no critical weaknesses
   "accept_with_flag": quality_score 0.5-0.7, or has weaknesses worth noting but acceptable
   "retry": quality_score < 0.5, or a single critical flaw that the debater could fix (missing evidence, unaddressed direct challenge, factual error)

Return ONLY JSON in this shape (no prose, no code fences):
{
  "advances": true|false,
  "advancement_reason": "...",
  "clarifies_taxonomy": [ { "action": "narrow|broaden|split|merge|qualify|retire|new_node", "node_id": "...", "node_ids": ["..."], "label": "...", "evidence_claim_id": "...", "rationale": "..." } ],
  "weaknesses": ["..."],
  "quality_score": 0.8,
  "recommend": "pass" | "retry" | "accept_with_flag"
}`;
}

interface JudgeVerdict {
  advances: boolean;
  advancement_reason: string;
  clarifies_taxonomy: TaxonomyClarificationHint[];
  weaknesses: string[];
  quality_score: number;
  recommend: 'pass' | 'retry' | 'accept_with_flag';
}

function parseJudgeVerdict(raw: string): JudgeVerdict {
  const fallback: JudgeVerdict = {
    advances: false,
    advancement_reason: 'judge_parse_failure',
    clarifies_taxonomy: [],
    weaknesses: [],
    quality_score: 0.6, // above retry threshold — judge failure shouldn't penalize the turn
    recommend: 'accept_with_flag',
  };
  try {
    const parsed = parseJsonRobust(raw) as Record<string, unknown>;
    const rec = typeof parsed.recommend === 'string' ? parsed.recommend : 'pass';
    const recommend: JudgeVerdict['recommend'] =
      rec === 'retry' || rec === 'accept_with_flag' ? rec : 'pass';
    const hintsRaw = Array.isArray(parsed.clarifies_taxonomy) ? parsed.clarifies_taxonomy : [];
    const hints: TaxonomyClarificationHint[] = hintsRaw
      .map(h => h as Record<string, unknown>)
      .filter(h => typeof h.action === 'string')
      .map(h => ({
        action: h.action as TaxonomyClarificationHint['action'],
        node_id: typeof h.node_id === 'string' ? h.node_id : undefined,
        node_ids: Array.isArray(h.node_ids) ? (h.node_ids as string[]) : undefined,
        label: typeof h.label === 'string' ? h.label : undefined,
        evidence_claim_id: typeof h.evidence_claim_id === 'string' ? h.evidence_claim_id : undefined,
        rationale: typeof h.rationale === 'string' ? h.rationale : '',
      }));
    const result: JudgeVerdict = {
      advances: parsed.advances !== false,
      advancement_reason: typeof parsed.advancement_reason === 'string' ? parsed.advancement_reason : '',
      clarifies_taxonomy: hints,
      weaknesses: Array.isArray(parsed.weaknesses)
        ? (parsed.weaknesses as unknown[]).filter(w => typeof w === 'string').map(w => w as string)
        : [],
      quality_score: typeof parsed.quality_score === 'number'
        ? Math.max(0, Math.min(1, parsed.quality_score))
        : 0.5,
      recommend,
    };

    // Enforce calibration rules deterministically — LLMs (especially flash-lite)
    // systematically inflate quality_score regardless of the rubric in the prompt.
    // The rubric says: 3 weaknesses → 0.40-0.55, but the model often returns 0.80+.
    const wc = result.weaknesses.length;
    const caps: [number, number][] = [[0, 0.90], [1, 0.80], [2, 0.65], [3, 0.55]];
    const cap = wc >= caps.length ? 0.45 : caps[wc][1];
    if (result.quality_score > cap) result.quality_score = cap;

    // Evidence-gap penalty: if any weakness mentions missing evidence, subtract 0.10
    const hasEvidenceGap = result.weaknesses.some(w =>
      /lacks? evidence|no data|unsubstantiated|missing citation/i.test(w),
    );
    if (hasEvidenceGap) {
      result.quality_score = Math.max(0.1, result.quality_score - 0.10);
    }

    // Advancement floor: when the judge writes that the turn meaningfully
    // advances the debate (advances=true) AND backs it with a substantive
    // qualitative reason (>120 chars suggests real description, not boilerplate),
    // the quality_score should reflect that. A turn that does genuine
    // dialectical work shouldn't be punished into the 0.40-0.55 "weak" band
    // by weakness-count caps alone. Floors at 0.60 — comfortably in the
    // "adequate" rubric tier, still penalizable below the "strong" tier.
    const ADVANCEMENT_FLOOR = 0.60;
    const SUBSTANTIVE_REASON_THRESHOLD = 120;
    if (
      result.advances &&
      result.advancement_reason.length >= SUBSTANTIVE_REASON_THRESHOLD &&
      result.quality_score < ADVANCEMENT_FLOOR
    ) {
      result.quality_score = ADVANCEMENT_FLOOR;
    }

    // Reconcile recommend with enforced quality_score
    if (result.quality_score < 0.5 && result.recommend === 'pass') {
      result.recommend = 'retry';
    } else if (result.quality_score < 0.7 && result.recommend === 'pass') {
      result.recommend = 'accept_with_flag';
    }

    return result;
  } catch {
    return fallback;
  }
}

// ── Orchestrator ─────────────────────────────────────────

export async function validateTurn(p: ValidateTurnParams): Promise<TurnValidation> {
  if (!p.config.enabled) {
    return zeroValidation('skipped', 1);
  }

  const stageA = runStageA(p);

  // Intervention compliance check — if a moderator intervention preceded this turn,
  // verify the debater included the required response field.
  // Hard-compliance failures are schema errors (fail the schema dimension → process_reward ≤ 0.60).
  if (p.pendingIntervention) {
    const rawMeta = (p.meta as Record<string, unknown>) ?? {};
    const compliance = checkInterventionCompliance(p.pendingIntervention.move, rawMeta);
    if (!compliance.compliant && compliance.repair_hint) {
      stageA.errorIssues.push(compliance.repair_hint);
      // Route to schema dimension so the turn fails hard
      stageA.dimensions.schema.issues.push(compliance.repair_hint);
      stageA.dimensions.schema.pass = false;
    }
  }

  const hasStageAError = stageA.errorIssues.length > 0;

  // Sample rate check — treat out-of-sample as deterministic-only.
  const phaseRate = (p.config.sampleRate as Record<string, number | undefined>)[p.phase] ?? 1;
  const sampled = phaseRate >= 1 ? true : Math.random() < phaseRate;

  const shouldRunJudge =
    !p.config.deterministicOnly &&
    !hasStageAError &&
    sampled;

  let judge: JudgeVerdict | null = null;
  let judgeUsed = false;
  let judgeAttempted = false;
  let judgeModel: string | undefined;
  if (shouldRunJudge) {
    judgeAttempted = true;
    const judgePrompt = buildJudgePrompt(p);
    const judgeLabel = `turn-validator judge (${p.speaker} r${p.round})`;
    try {
      const raw = await p.callJudge(judgePrompt, judgeLabel);
      judge = parseJudgeVerdict(raw);
      judgeUsed = true;
      judgeModel = p.config.judgeModel;
    } catch {
      // Primary judge failed (e.g. missing Anthropic key) — try fallback model.
      if (p.callJudgeFallback) {
        try {
          const raw = await p.callJudgeFallback(judgePrompt, `${judgeLabel} [fallback]`);
          judge = parseJudgeVerdict(raw);
          judgeUsed = true;
          judgeModel = 'fallback';
        } catch {
          judge = null;
        }
      }
    }
  }

  // Compose dimensions — if judge was attempted but fully failed, don't default to advances=true
  const dims: TurnValidationDimensions = {
    schema: stageA.dimensions.schema,
    grounding: stageA.dimensions.grounding,
    advancement: {
      pass: stageA.dimensions.advancement.pass && (judge ? judge.advances : !judgeAttempted),
      signals: [
        ...stageA.dimensions.advancement.signals,
        ...(judge && judge.advances ? ['judge_advances'] : []),
        ...(judge?.advancement_reason ? [judge.advancement_reason] : []),
      ],
    },
    clarifies: {
      pass: true,  // Informational — signals show when taxonomy suggestions were made
      signals: (judge?.clarifies_taxonomy ?? []).map(h =>
        `${h.action}${h.node_id ? `:${h.node_id}` : ''}`,
      ),
    },
  };

  // Repair hints — errors first, then warnings, then judge weaknesses.
  const repairHints = [
    ...stageA.errorIssues,
    ...stageA.warningIssues,
    ...(judge?.weaknesses ?? []),
  ];

  // Process reward: 40% Stage A structural dimensions + 60% judge quality score.
  // When no judge ran (deterministic-only or out-of-sample), quality defaults to 0.7
  // so deterministic-pass turns get 0.78, not a perfect 1.0.
  // The 40/60 split lets the calibration-enforced judge score actually differentiate
  // turns rather than being dominated by binary Stage A pass/fail.
  const stageAScore =
    0.4 * (dims.schema.pass ? 1 : 0) +
    0.3 * (dims.grounding.pass ? 1 : 0) +
    0.2 * (dims.advancement.pass ? 1 : 0) +
    0.1 * (dims.clarifies.pass ? 1 : 0);
  const judgeQuality = judge?.quality_score ?? 0.7;
  const process_reward = 0.4 * stageAScore + 0.6 * judgeQuality;

  // Outcome — retry triggers (in priority order):
  // 1. Stage A structural error
  // 2. Judge explicitly recommends retry
  // 3. Judge quality_score below threshold (substantive weaknesses warrant retry)
  // 4. Orchestration score below scoreThreshold (composite quality gate)
  const retryBudget = p.config.maxRetries;
  const JUDGE_RETRY_THRESHOLD = 0.55; // quality_score below this triggers retry
  const judgeQualityLow = judge != null && judge.quality_score < JUDGE_RETRY_THRESHOLD;
  const scoreBelowThreshold = process_reward < p.config.scoreThreshold;
  let outcome: TurnValidation['outcome'];
  if (hasStageAError && retryBudget > 0) {
    outcome = 'retry';
  } else if (judge && judge.recommend === 'retry' && retryBudget > 0) {
    outcome = 'retry';
  } else if (judgeQualityLow && retryBudget > 0) {
    outcome = 'retry';
  } else if (scoreBelowThreshold && retryBudget > 0) {
    outcome = 'retry';
  } else if (judge && judge.recommend === 'retry' && retryBudget === 0) {
    outcome = 'accept_with_flag';
  } else if (judgeQualityLow && retryBudget === 0) {
    outcome = 'accept_with_flag';
  } else if (scoreBelowThreshold && retryBudget === 0) {
    outcome = 'accept_with_flag';
  } else if (judge && judge.recommend === 'accept_with_flag') {
    outcome = 'accept_with_flag';
  } else if (hasStageAError && retryBudget === 0) {
    outcome = 'accept_with_flag';
  } else {
    outcome = 'pass';
  }

  const retry_trigger: TurnValidation['retry_trigger'] =
    hasStageAError ? 'stageA_error'
    : (judge && judge.recommend === 'retry') ? 'judge_retry'
    : judgeQualityLow ? 'judge_quality_low'
    : scoreBelowThreshold ? 'score_below_threshold'
    : 'none';

  getGlobalRecorder()?.record({
    type: 'turn.validate.outcome', component: 'turn-pipeline', level: 'info',
    message: `Validation outcome: ${outcome} (trigger=${retry_trigger}, score=${process_reward.toFixed(3)}, threshold=${p.config.scoreThreshold})`,
    data: {
      outcome, retry_trigger, process_reward,
      stageA_score: stageAScore,
      judge_quality_score: judge?.quality_score,
      judge_recommend: judge?.recommend,
      score_threshold: p.config.scoreThreshold,
      max_retries: p.config.maxRetries,
      hint_count: repairHints.length,
    },
  });

  return {
    outcome,
    process_reward,
    dimensions: dims,
    repairHints,
    clarifies_taxonomy: judge?.clarifies_taxonomy ?? [],
    judge_used: judgeUsed,
    judge_model: judgeUsed ? judgeModel : undefined,
    retry_trigger,
    stageA_score: stageAScore,
    judge_quality_score: judge?.quality_score,
    judge_recommend: judge?.recommend,
    score_threshold: p.config.scoreThreshold,
  };
}

function zeroValidation(outcome: TurnValidation['outcome'], process_reward: number): TurnValidation {
  return {
    outcome,
    process_reward,
    dimensions: {
      schema:      { pass: true, issues: [] },
      grounding:   { pass: true, issues: [] },
      advancement: { pass: true, signals: [] },
      clarifies:   { pass: false, signals: [] },
    },
    repairHints: [],
    clarifies_taxonomy: [],
    judge_used: false,
  };
}
