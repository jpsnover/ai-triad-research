// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { TurnStageConfig, StageDiagnostics, DraftWorkProduct, OpeningBriefWorkProduct, OpeningPlanWorkProduct, OpeningCiteWorkProduct, OpeningPipelineResult, TaxonomyRef, DocumentAnalysis } from '../types.js';
import { ActionableError } from '../errors.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import { validateDraftStage, validateCiteStage } from '../turnValidator.js';
import { wordOverlap, sanitizeTurnSymbols } from '../helpers.js';
import type { PoverResponseMeta } from '../helpers.js';
import { briefOpeningStagePrompt, planOpeningStagePrompt, draftOpeningStagePrompt, citeOpeningStagePrompt } from '../prompts.js';
import type { OpeningStagePromptInput } from '../prompts.js';
import { sanitizeNodeIds } from '../nodeIdUtils.js';
import { parseStageResponse, tagProvenance, toPromptJson } from './runTurn-stages.js';
import { buildRepairBlock } from './microFix.js';
import { stripLeadingHeadings, deduplicateStatement } from './assemble.js';
import { DEFAULT_STAGE_TEMPERATURES } from './types.js';
import type { StageGenerateFn, StageProgressFn } from './types.js';

// ── Opening pipeline ──────────────────────────────────

const DEFAULT_BRIEF_TIMEOUT_MS = 60_000;
const DEFAULT_BRIEF_MAX_RETRIES = 3;

function isBriefTimeout(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('timed out') || msg.includes('AbortError') || msg.includes('The operation was aborted');
}

export type BriefEventFn = (
  phase: 'brief.timeout' | 'brief.retrying' | 'brief.retries_exhausted',
  data: { agent: string; attempt: number; maxRetries: number; elapsedMs: number },
) => void;

export interface OpeningPipelineInput {
  label: string;
  pov: string;
  personality: string;
  topic: string;
  /** User-supplied supporting context, kept separate from the topic question. */
  background?: string;
  taxonomyContext: string;
  priorStatements: string;
  isFirst: boolean;
  sourceContent?: string;
  documentAnalysis?: DocumentAnalysis;
  audience?: import('../types.js').DebateAudience;
  model: string;
  briefModel?: string;
  planModel?: string;
  draftModel?: string;
  citeModel?: string;
  stageTemperatures?: TurnStageConfig;
  userSeedClaims?: { id: string; text: string; bdi_category?: string }[];
  /** Repair hints from a prior failed attempt — injected into the DRAFT stage prompt. */
  repairHints?: string[];
  /** Available POV node IDs for CITE validation (unknown node detection). */
  availablePovNodeIds?: string[];
  /** Timeout per brief-stage AI call (ms). Default: 60,000. */
  briefTimeoutMs?: number;
  /** Max brief-stage timeout retries. Default: 3. */
  briefMaxRetries?: number;
}

export async function runOpeningPipeline(
  input: OpeningPipelineInput,
  generate: StageGenerateFn,
  onProgress?: StageProgressFn,
  onBriefEvent?: BriefEventFn,
): Promise<OpeningPipelineResult> {
  const temps = {
    ...DEFAULT_STAGE_TEMPERATURES,
    ...input.stageTemperatures,
  };
  const oBriefModel = input.briefModel ?? input.model;
  const oPlanModel = input.planModel ?? input.model;
  const oDraftModel = input.draftModel ?? input.model;
  const oCiteModel = input.citeModel ?? input.model;
  const stageInput: OpeningStagePromptInput = {
    label: input.label,
    pov: input.pov,
    personality: input.personality,
    topic: input.topic,
    background: input.background,
    taxonomyContext: input.taxonomyContext,
    priorStatements: input.priorStatements,
    isFirst: input.isFirst,
    sourceContent: input.sourceContent,
    documentAnalysis: input.documentAnalysis,
    audience: input.audience,
    userSeedClaims: input.userSeedClaims,
  };
  const stageDiags: StageDiagnostics[] = [];
  const pipelineStart = Date.now();

  // ── Stage 1: BRIEF (with parse-failure retry and configurable timeout retry) ──
  const isOpeningOuterRetry = (input.repairHints?.length ?? 0) > 0;
  const MAX_OPENING_RETRIES = isOpeningOuterRetry ? 0 : 1;
  const briefTimeoutMs = input.briefTimeoutMs ?? DEFAULT_BRIEF_TIMEOUT_MS;
  const briefMaxRetries = input.briefMaxRetries ?? DEFAULT_BRIEF_MAX_RETRIES;
  let brief: OpeningBriefWorkProduct | undefined;
  let briefJson = '';
  let t0: number = Date.now();
  let elapsed: number = 0;
  for (let briefAttempt = 0; briefAttempt <= MAX_OPENING_RETRIES; briefAttempt++) {
    onProgress?.('brief', `${input.label} is briefing${briefAttempt > 0 ? ` (retry ${briefAttempt})` : ''}...`);
    const briefPrompt = briefOpeningStagePrompt(stageInput);
    let briefRaw!: string;
    for (let tout = 0; tout <= briefMaxRetries; tout++) {
      t0 = Date.now();
      try {
        briefRaw = await generate(
          briefPrompt, oBriefModel,
          { temperature: temps.brief_temperature, timeoutMs: briefTimeoutMs },
          `${input.label} opening brief`,
        );
        break;
      } catch (err) {
        if (isBriefTimeout(err)) {
          const elapsedMs = Date.now() - t0;
          const evData = { agent: input.label, attempt: tout, maxRetries: briefMaxRetries, elapsedMs };
          onBriefEvent?.('brief.timeout', evData);
          getGlobalRecorder()?.record({
            type: 'ai.error', component: 'turn-pipeline', level: 'warn', speaker: input.label,
            message: `Opening brief timed out after ${Math.round(elapsedMs / 1000)}s (attempt ${tout + 1}/${briefMaxRetries + 1})`,
            data: evData,
          });
          if (tout < briefMaxRetries) {
            onBriefEvent?.('brief.retrying', { ...evData, attempt: tout + 1 });
            continue;
          }
          onBriefEvent?.('brief.retries_exhausted', evData);
        }
        throw err;
      }
    }
    elapsed = Date.now() - t0;
    const briefParsed = parseStageResponse<OpeningBriefWorkProduct>(briefRaw, 'brief');
    stageDiags.push({
      stage: 'brief', prompt: briefPrompt, raw_response: briefRaw,
      model: oBriefModel, temperature: temps.brief_temperature,
      response_time_ms: elapsed, work_product: briefParsed.product as unknown as Record<string, unknown>,
      parse_error: briefParsed.error,
      retry_trigger: briefAttempt > 0 ? 'stage-retry' : 'initial',
    });
    if (briefParsed.error) {
      if (briefAttempt < MAX_OPENING_RETRIES) {
        getGlobalRecorder()?.record({
          type: 'turn.repair', component: 'turn-pipeline', level: 'warn',
          speaker: input.label,
          message: `Opening BRIEF parse failed (attempt ${briefAttempt}), retrying`,
          data: { stage: 'brief', attempt: briefAttempt, error: briefParsed.error },
        });
        console.log(`[pipeline] Opening brief parse failed (attempt ${briefAttempt}), retrying: ${briefParsed.error}`);
        continue;
      }
      throw new ActionableError({
        goal: 'Run opening statement pipeline',
        problem: `Brief stage failed to parse after ${briefAttempt + 1} attempt(s) — downstream stages would operate on empty context. ${briefParsed.error}`,
        location: 'turnPipeline.runOpeningPipeline',
        nextSteps: ['Check the AI model response quality', 'Try a different model'],
      });
    }
    brief = tagProvenance(briefParsed.product, {
      pipeline_run: 0, stage: 'brief', attempt: briefAttempt,
      model: oBriefModel, timestamp: new Date().toISOString(),
    });
    briefJson = toPromptJson(brief);
    break;
  }

  // ── Stage 2: PLAN ──
  onProgress?.('plan', `${input.label} is planning...`);
  const planPromptText = planOpeningStagePrompt(stageInput, briefJson);
  t0 = Date.now();
  const planRaw = await generate(
    planPromptText, oPlanModel, { temperature: temps.plan_temperature }, `${input.label} opening plan`,
  );
  elapsed = Date.now() - t0;
  const planParsed = parseStageResponse<OpeningPlanWorkProduct>(planRaw, 'plan');
  stageDiags.push({
    stage: 'plan', prompt: planPromptText, raw_response: planRaw,
    model: oPlanModel, temperature: temps.plan_temperature,
    response_time_ms: elapsed, work_product: planParsed.product as unknown as Record<string, unknown>,
    parse_error: planParsed.error,
  });
  if (planParsed.error) {
    throw new ActionableError({
      goal: 'Run opening statement pipeline',
      problem: `Plan stage failed to parse — downstream stages would operate on empty context. ${planParsed.error}`,
      location: 'turnPipeline.runOpeningPipeline',
      nextSteps: ['Check the AI model response quality', 'Try a different model'],
    });
  }
  const plan = tagProvenance(planParsed.product, {
    pipeline_run: 0, stage: 'plan', attempt: 0,
    model: oPlanModel, timestamp: new Date().toISOString(),
  });
  const planJson = toPromptJson(plan);

  // ── Stage 3: DRAFT ──
  onProgress?.('draft', `${input.label} is drafting...`);
  let draftPromptText = draftOpeningStagePrompt(stageInput, briefJson, planJson);
  if (input.repairHints && input.repairHints.length > 0) {
    const openingRepairBlock = buildRepairBlock(input.repairHints);
    if (openingRepairBlock) {
      draftPromptText = draftPromptText.replace(
        /Respond ONLY with a JSON/,
        `${openingRepairBlock}\nRespond ONLY with a JSON`,
      );
      if (!draftPromptText.includes('CORRECTIONS REQUIRED') && !draftPromptText.includes('MANDATORY CORRECTION')) {
        draftPromptText += openingRepairBlock;
      }
    }
  }
  t0 = Date.now();
  const draftRaw = await generate(
    draftPromptText, oDraftModel, { temperature: temps.draft_temperature }, `${input.label} opening draft`,
  );
  elapsed = Date.now() - t0;
  const draftParsed = parseStageResponse<DraftWorkProduct>(draftRaw, 'draft');
  stageDiags.push({
    stage: 'draft', prompt: draftPromptText, raw_response: draftRaw,
    model: oDraftModel, temperature: temps.draft_temperature,
    response_time_ms: elapsed, work_product: draftParsed.product as unknown as Record<string, unknown>,
    parse_error: draftParsed.error,
  });
  const draft = tagProvenance(draftParsed.product, {
    pipeline_run: 0, stage: 'draft', attempt: 0,
    model: input.model, timestamp: new Date().toISOString(),
  });
  const draftJson = toPromptJson(draft);

  // Per-stage draft validation for openings (Rules 6, 10, 12 — no moves/disagreement for openings)
  if (draft) {
    const openingDraftMeta: import('../helpers.js').PoverResponseMeta = {
      my_claims: draft.claim_sketches?.map(c => ({
        claim: typeof c === 'string' ? c : (c as Record<string, unknown>).claim as string ?? '',
        targets: [] as string[],
      })) ?? [],
      key_assumptions: draft.key_assumptions as { assumption: string; if_wrong: string }[] | undefined,
    };
    const draftVal = validateDraftStage({
      statement: draft.statement ?? '',
      meta: openingDraftMeta,
      phase: 'confrontation' as import('../types.js').DebatePhase,
      round: 0,
      priorTurns: [],
      speaker: input.pov as import('../types.js').SpeakerId,
    });
    const lastDiag = stageDiags[stageDiags.length - 1];
    (lastDiag as Record<string, unknown>).stage_validation = {
      pass: draftVal.pass, hints: draftVal.repairHints,
    };
  }

  // ── Stage 4: CITE ──
  onProgress?.('cite', `${input.label} is citing...`);
  const citePromptText = citeOpeningStagePrompt(stageInput, briefJson, planJson, draftJson);
  t0 = Date.now();
  const citeRaw = await generate(
    citePromptText, oCiteModel, { temperature: temps.cite_temperature }, `${input.label} opening cite`,
  );
  elapsed = Date.now() - t0;
  const citeParsed = parseStageResponse<OpeningCiteWorkProduct>(citeRaw, 'cite');
  stageDiags.push({
    stage: 'cite', prompt: citePromptText, raw_response: citeRaw,
    model: oCiteModel, temperature: temps.cite_temperature,
    response_time_ms: elapsed, work_product: citeParsed.product as unknown as Record<string, unknown>,
    parse_error: citeParsed.error,
  });
  const cite = citeParsed.product;

  // Per-stage cite validation for openings (Rules 3, 4, 5)
  if (cite) {
    const knownIds = new Set(input.availablePovNodeIds ?? []);
    const citeVal = validateCiteStage({
      taxonomyRefs: (cite.taxonomy_refs ?? []) as import('../types.js').TaxonomyRef[],
      policyRefs: cite.policy_refs as (string | { policy_id: string; relevance?: string })[] | undefined,
      knownNodeIds: knownIds,
      policyIds: new Set<string>(),
      priorTurns: [],
      speaker: input.label,
    });
    const lastDiag = stageDiags[stageDiags.length - 1];
    (lastDiag as Record<string, unknown>).stage_validation = {
      pass: citeVal.pass, hints: citeVal.repairHints,
    };
  }

  return {
    brief: brief!,
    plan,
    draft,
    cite,
    stage_diagnostics: stageDiags,
    total_time_ms: Date.now() - pipelineStart,
  };
}

/** Extract repair hints from opening pipeline stage diagnostics. */
export function getOpeningRepairHints(result: OpeningPipelineResult): string[] {
  const hints: string[] = [];
  for (const diag of result.stage_diagnostics) {
    const val = (diag as Record<string, unknown>).stage_validation as { pass?: boolean; hints?: string[] } | undefined;
    if (val && !val.pass && val.hints) {
      hints.push(...val.hints);
    }
  }
  return hints;
}

export function assembleOpeningPipelineResult(
  result: OpeningPipelineResult,
  validNodeIds?: Set<string>,
): { statement: string; taxonomyRefs: TaxonomyRef[]; meta: PoverResponseMeta } {
  const rawRefs = (result.cite.taxonomy_refs ?? []).map(r => ({
    node_id: r.node_id,
    relevance: r.relevance,
  }));
  // Fuzzy-correct hallucinated node IDs before filtering (same as assemblePipelineResult)
  let taxonomyRefs: TaxonomyRef[];
  if (validNodeIds) {
    const { sanitized, corrections, removed } = sanitizeNodeIds(rawRefs.map(r => r.node_id), validNodeIds);
    if (corrections.length > 0) console.log(`[pipeline] Opening: corrected ${corrections.length} hallucinated node ID(s): ${corrections.map(c => `${c.from}→${c.to}`).join(', ')}`);
    if (removed.length > 0) console.log(`[pipeline] Opening: removed ${removed.length} invalid node ID(s): ${removed.join(', ')}`);
    if (corrections.length > 0 || removed.length > 0) {
      getGlobalRecorder()?.record({
        type: 'turn.hallucinated_refs', component: 'turn-pipeline', level: 'warn',
        message: `Opening: sanitized ${corrections.length} corrected + ${removed.length} removed hallucinated node IDs`,
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
      key_assumptions: result.draft.key_assumptions?.length ? result.draft.key_assumptions : undefined,
      my_claims: groundedClaims?.length ? groundedClaims : undefined,
      policy_refs: result.cite.policy_refs?.length ? result.cite.policy_refs : undefined,
      turn_symbols: result.draft.turn_symbols?.length ? sanitizeTurnSymbols(result.draft.turn_symbols) : undefined,
    },
  };
}
