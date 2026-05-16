// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type {
  TurnStageId,
  TurnStageConfig,
  StageDiagnostics,
  BriefWorkProduct,
  PlanWorkProduct,
  DraftWorkProduct,
  CiteWorkProduct,
  TurnPipelineResult,
  OpeningBriefWorkProduct,
  OpeningPlanWorkProduct,
  OpeningCiteWorkProduct,
  OpeningPipelineResult,
  TaxonomyRef,
  DebatePhase,
} from './types.js';
import type { DocumentAnalysis } from './types.js';
import { ActionableError } from './errors.js';
import { validateDraftStage, validateCiteStage, validatePlanStage, isFillerRelevance, parseDraftQualityResult } from './turnValidator.js';
import type { DraftQualityCheckOutput } from './turnValidator.js';
import type { PoverResponseMeta, MoveAnnotation } from './helpers.js';
import type { GenerateOptions } from './aiAdapter.js';
import { parseJsonRobust, wordOverlap } from './helpers.js';
import {
  briefStagePrompt,
  planStagePrompt,
  draftStagePrompt,
  citeStagePrompt,
  citeRetryPrompt,
  draftQualityCheckPrompt,
  briefOpeningStagePrompt,
  planOpeningStagePrompt,
  draftOpeningStagePrompt,
  citeOpeningStagePrompt,
} from './prompts.js';
import type { StagePromptInput, OpeningStagePromptInput } from './prompts.js';
import type { GenerateRequest, GenerateResponse } from './cacheTypes.js';
import { flattenEnvelope } from './cacheTypes.js';
import {
  briefStageEnvelope,
  planStageEnvelope,
  draftStageEnvelope,
  citeStageEnvelope,
} from './envelopes.js';

// ── Disagreement type normalization ─────────────────────

const VALID_DISAGREEMENT_TYPES = ['EMPIRICAL', 'VALUES', 'DEFINITIONAL'] as const;
type DisagreementType = typeof VALID_DISAGREEMENT_TYPES[number];

const DISAGREEMENT_KEYWORDS: Record<DisagreementType, string[]> = {
  EMPIRICAL: ['empirical', 'evidence', 'factual', 'data', 'measurement', 'testable',
              'observable', 'experiment', 'scientific', 'quantitative', 'statistical'],
  VALUES: ['values', 'moral', 'ethical', 'normative', 'priority', 'ought',
           'should', 'principle', 'rights', 'fairness', 'justice', 'axiological'],
  DEFINITIONAL: ['definitional', 'definition', 'semantic', 'meaning', 'terminology',
                 'conceptual', 'what counts', 'how we define', 'scope of', 'framing'],
};

const MIN_CONFIDENCE = 0.3;

function normalizeDisagreementType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  if ((VALID_DISAGREEMENT_TYPES as readonly string[]).includes(upper)) return upper;

  // Strip common suffixes/prefixes the AI might add
  const cleaned = upper.replace(/[_\-\s]+/g, ' ').replace(/\bDISAGREEMENT\b/g, '').trim();
  for (const valid of VALID_DISAGREEMENT_TYPES) {
    if (cleaned === valid || cleaned.startsWith(valid)) return valid;
  }

  // Keyword scoring — weight type-name match heavily
  const lower = raw.toLowerCase();
  let bestType: DisagreementType | undefined;
  let bestScore = 0;

  for (const dtype of VALID_DISAGREEMENT_TYPES) {
    const keywords = DISAGREEMENT_KEYWORDS[dtype];
    let hits = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) hits++;
    }
    if (lower.includes(dtype.toLowerCase())) hits += 3;
    const score = hits / (keywords.length + 3);
    if (score > bestScore) {
      bestScore = score;
      bestType = dtype;
    }
  }

  if (bestType && bestScore >= MIN_CONFIDENCE) return bestType;
  return 'EMPIRICAL';
}

// ── Public types ────────────────────────────────────────

export interface TurnPipelineInput {
  label: string;
  pov: string;
  personality: string;
  topic: string;
  taxonomyContext: string;
  commitmentContext: string;
  establishedPoints: string;
  edgeContext: string;
  concessionHint: string;
  recentTranscript: string;
  focusPoint: string;
  addressing: string;
  phase: DebatePhase;
  priorMoves: string[];
  turnsSinceLastConcession: number;
  priorRefs: string[];
  availablePovNodeIds: string[];
  availablePolicyIds?: string[];
  crossPovNodeIds?: string[];
  priorFlaggedHints?: string[];
  sourceContent?: string;
  documentAnalysis?: DocumentAnalysis;
  audience?: import('./types').DebateAudience;
  pendingIntervention?: {
    move: string;
    family: string;
    targetDebater: string;
    responseField?: string;
    responseSchema?: string;
    directResponsePattern?: string;
    isTargeted: boolean;
  };
  phaseContext?: {
    rationale: string;
    phase_progress: number;
    approaching_transition: boolean;
  };
  model: string;
  stageTemperatures?: TurnStageConfig;
  repairHints?: string[];
  doctrinalBoundaries?: string[];
  /** Last opponent's statement text — used by the draft quality pre-check "engages" question. */
  lastOpponentStatement?: string;
  /** Model for the draft quality pre-check. Resolved from TurnValidationConfig. */
  preCheckModel?: string;
  /** Skip the draft quality pre-check. */
  skipPreCheck?: boolean;
  /** Pre-loaded source evidence index (from source_evidence_index.json). */
  sourceEvidenceIndex?: import('./evidenceFromSummaries.js').SourceEvidenceIndex;
}

export type StageGenerateFn = (
  prompt: string,
  model: string,
  options: GenerateOptions,
  label: string,
) => Promise<string>;

export type EnvelopeGenerateFn = (
  request: GenerateRequest,
  label: string,
) => Promise<GenerateResponse>;

export type StageProgressFn = (stage: TurnStageId, label: string) => void;

// ── Defaults ────────────────────────────────────────────

/**
 * Temperature gradient implements process-reward-shaped sampling (Lightman
 * et al. 2023). Analytical stages use low variance for precision; the
 * generative stage uses high variance for expressive diversity:
 *
 *  - brief / cite  (0.15): deterministic — situation assessment and grounding
 *    verification should be precise, mirroring greedy decoding in PRM
 *    best-of-N verification steps.
 *  - plan          (0.4):  moderate — strategy selection benefits from some
 *    exploration while remaining coherent.
 *  - draft         (0.7):  high variance — creative argument generation needs
 *    sampling diversity, analogous to the candidate-generation step that a
 *    process reward model subsequently scores.
 */
export const DEFAULT_STAGE_TEMPERATURES: Required<TurnStageConfig> = {
  brief_temperature: 0.15,
  plan_temperature: 0.4,
  draft_temperature: 0.7,
  cite_temperature: 0.15,
};

// ── Pipeline runner ─────────────────────────────────────

function buildStageInput(input: TurnPipelineInput): StagePromptInput {
  return {
    label: input.label,
    pov: input.pov,
    personality: input.personality,
    topic: input.topic,
    taxonomyContext:
      input.taxonomyContext +
      input.commitmentContext +
      input.establishedPoints +
      input.edgeContext +
      input.concessionHint,
    recentTranscript: input.recentTranscript,
    focusPoint: input.focusPoint,
    addressing: input.addressing,
    phase: input.phase,
    priorMoves: input.priorMoves,
    turnsSinceLastConcession: input.turnsSinceLastConcession,
    priorRefs: input.priorRefs,
    availablePovNodeIds: input.availablePovNodeIds,
    crossPovNodeIds: input.crossPovNodeIds,
    priorFlaggedHints: input.priorFlaggedHints,
    sourceContent: input.sourceContent,
    documentAnalysis: input.documentAnalysis,
    audience: input.audience,
    pendingIntervention: input.pendingIntervention,
    phaseContext: input.phaseContext,
    doctrinalBoundaries: input.doctrinalBoundaries,
  };
}

function parseStageResponse<T>(raw: string, stage: TurnStageId): { product: T; error?: string } {
  try {
    const parsed = parseJsonRobust(raw) as T;
    return { product: parsed };
  } catch (err) {
    return {
      product: {} as T,
      error: `${stage} stage parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function runTurnPipeline(
  input: TurnPipelineInput,
  generate: StageGenerateFn,
  onProgress?: StageProgressFn,
  envelopeGenerate?: EnvelopeGenerateFn,
  preCheckGenerate?: StageGenerateFn,
): Promise<TurnPipelineResult> {
  const temps = {
    ...DEFAULT_STAGE_TEMPERATURES,
    ...input.stageTemperatures,
  };
  const stageInput = buildStageInput(input);
  const stageDiags: StageDiagnostics[] = [];
  const pipelineStart = Date.now();

  // ── Stage 1: BRIEF ──
  onProgress?.('brief', `${input.label} is briefing...`);
  let briefPrompt: string;
  let briefRaw: string;
  let t0 = Date.now();
  if (envelopeGenerate) {
    const env = briefStageEnvelope(stageInput);
    briefPrompt = flattenEnvelope(env);
    const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.brief_temperature } }, `${input.label} brief`);
    briefRaw = resp.text;
  } else {
    briefPrompt = briefStagePrompt(stageInput);
    briefRaw = await generate(briefPrompt, input.model, { temperature: temps.brief_temperature }, `${input.label} brief`);
  }
  let elapsed = Date.now() - t0;
  const briefParsed = parseStageResponse<BriefWorkProduct>(briefRaw, 'brief');
  stageDiags.push({
    stage: 'brief', prompt: briefPrompt, raw_response: briefRaw,
    model: input.model, temperature: temps.brief_temperature,
    response_time_ms: elapsed, work_product: briefParsed.product as unknown as Record<string, unknown>,
    parse_error: briefParsed.error,
  });
  if (briefParsed.error) {
    throw new ActionableError({
      goal: 'Run debate turn pipeline',
      problem: `Brief stage failed to parse — downstream stages would operate on empty context. ${briefParsed.error}`,
      location: 'turnPipeline.runPipeline',
      nextSteps: ['Check the AI model response quality', 'Try a different model'],
    });
  }
  const brief = briefParsed.product;
  const briefJson = JSON.stringify(brief, null, 2);

  // ── Stage 2: PLAN (with per-stage validation + retry) ──
  // If repairHints are provided, this is an outer retry — skip per-stage retries
  // to avoid compounding (outer retry already re-runs the full pipeline).
  const isOuterRetry = (input.repairHints?.length ?? 0) > 0;
  const MAX_STAGE_RETRIES = isOuterRetry ? 0 : 1;
  const isFirstRound = (input.priorMoves ?? []).length === 0;
  let planRepairHints: string[] = [];
  let plan: PlanWorkProduct | undefined;
  let planJson = '';

  for (let planAttempt = 0; planAttempt <= MAX_STAGE_RETRIES; planAttempt++) {
    onProgress?.('plan', `${input.label} is planning${planAttempt > 0 ? ` (retry ${planAttempt})` : ''}...`);
    let planPromptText: string;
    let planRaw: string;
    t0 = Date.now();
    if (envelopeGenerate) {
      const env = planStageEnvelope(stageInput, briefJson);
      if (planRepairHints.length > 0) {
        env.layer4_variable += `\n\n=== REPAIR HINTS (from prior failed attempt) ===\n${planRepairHints.map(h => '- ' + h).join('\n')}\nAddress these issues in your revised plan.`;
      }
      planPromptText = flattenEnvelope(env);
      const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.plan_temperature } }, `${input.label} plan`);
      planRaw = resp.text;
    } else {
      planPromptText = planStagePrompt(stageInput, briefJson);
      if (planRepairHints.length > 0) {
        planPromptText += `\n\n=== REPAIR HINTS (from prior failed attempt) ===\n${planRepairHints.map(h => '- ' + h).join('\n')}\nAddress these issues in your revised plan.`;
      }
      planRaw = await generate(planPromptText, input.model, { temperature: temps.plan_temperature }, `${input.label} plan`);
    }
    elapsed = Date.now() - t0;
    const planParsed = parseStageResponse<PlanWorkProduct>(planRaw, 'plan');
    stageDiags.push({
      stage: 'plan', prompt: planPromptText, raw_response: planRaw,
      model: input.model, temperature: temps.plan_temperature,
      response_time_ms: elapsed, work_product: planParsed.product as unknown as Record<string, unknown>,
      parse_error: planParsed.error,
    });
    if (planParsed.error) {
      throw new ActionableError({
        goal: 'Run debate turn pipeline',
        problem: `Plan stage failed to parse — downstream stages would operate on empty context. ${planParsed.error}`,
        location: 'turnPipeline.runPipeline',
        nextSteps: ['Check the AI model response quality', 'Try a different model'],
      });
    }

    // Validate plan
    const planVal = validatePlanStage({ plan: planParsed.product, isFirstRound });
    const lastPlanDiag = stageDiags[stageDiags.length - 1];
    (lastPlanDiag as Record<string, unknown>).stage_validation = { pass: planVal.pass, hints: planVal.repairHints, details: planVal.details };

    if (planVal.errorHints.length > 0 && planAttempt < MAX_STAGE_RETRIES) {
      planRepairHints = planVal.errorHints;
      console.log(`[pipeline] Plan validation errors (attempt ${planAttempt}), retrying: ${planVal.errorHints.join('; ')}`);
      continue;
    }

    plan = planParsed.product;
    planJson = JSON.stringify(plan, null, 2);
    break;
  }
  if (!plan) {
    plan = {} as PlanWorkProduct;
    planJson = '{}';
  }

  // ── Stage 2.5: EVIDENCE (deterministic — no LLM call) ──
  // Retrieve source document evidence for the plan's target nodes.
  // Produces a compact evidence brief injected into the DRAFT prompt.
  let evidenceBlock = '';
  console.log(`[pipeline] EVIDENCE stage check: hasIndex=${!!input.sourceEvidenceIndex}, indexKeys=${input.sourceEvidenceIndex ? Object.keys(input.sourceEvidenceIndex).length : 0}, target_nodes=${JSON.stringify(plan.target_nodes ?? null)}`);
  if (input.sourceEvidenceIndex && plan.target_nodes && plan.target_nodes.length > 0) {
    try {
      const { retrieveSourceEvidence } = await import('./evidenceFromSummaries.js');
      const evidenceBrief = retrieveSourceEvidence(
        plan.target_nodes as string[],
        input.pov,
        input.sourceEvidenceIndex,
        3, // max facts
        2, // max key points
      );
      console.log(`[pipeline] EVIDENCE retrieved: ${evidenceBrief.facts.length} facts, ${evidenceBrief.keyPoints.length} keyPoints, block=${evidenceBrief.formattedBlock.length} chars`);
      if (evidenceBrief.formattedBlock) {
        evidenceBlock = '\n\n' + evidenceBrief.formattedBlock;
        stageDiags.push({
          stage: 'evidence',
          prompt: `target_nodes: ${(plan.target_nodes as string[]).join(', ')}`,
          raw_response: evidenceBrief.formattedBlock,
          model: 'deterministic',
          temperature: 0,
          response_time_ms: 0,
          work_product: {
            facts: evidenceBrief.facts as unknown as Record<string, unknown>[],
            keyPoints: evidenceBrief.keyPoints as unknown as Record<string, unknown>[],
            nodesCovered: evidenceBrief.nodesCovered,
            totalCandidates: evidenceBrief.totalCandidates,
          } as unknown as Record<string, unknown>,
        });
      }
    } catch (err) {
      // Evidence retrieval failure is non-fatal — proceed without evidence
      console.warn(`[pipeline] Evidence retrieval failed: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
    }
  }

  // ── Stage 3: DRAFT (with per-stage validation + retry) ──
  let draftRepairHints: string[] = input.repairHints?.filter(h =>
    !/taxonomy_refs.*(?:filler|too-short|relevance)|No new taxonomy_refs|Unknown taxonomy node|Unknown policy_refs|grounding_confidence/i.test(h)
  ) ?? [];
  let draft: DraftWorkProduct | undefined;
  let draftJson = '';

  const MAX_DRAFT_RETRIES = isOuterRetry ? 0 : 2; // directive failures get up to 2 retries (3 attempts)
  for (let draftAttempt = 0; draftAttempt <= MAX_DRAFT_RETRIES; draftAttempt++) {
    onProgress?.('draft', `${input.label} is drafting${draftAttempt > 0 ? ` (retry ${draftAttempt})` : ''}...`);
    let draftPromptText: string;
    let draftRaw: string;
    t0 = Date.now();
    // Build targeted repair block from prior failure — translates hints into
    // specific prompt modifications placed in the recency window, not generic appendix.
    const failedDraftStatement = draftRepairHints.length > 0 && draft?.statement ? draft.statement : undefined;
    const repairBlock = buildRepairBlock(draftRepairHints, failedDraftStatement);

    if (envelopeGenerate) {
      const env = draftStageEnvelope(stageInput, briefJson, planJson);
      // Inject source evidence block (deterministic retrieval from summaries)
      if (evidenceBlock) {
        env.layer4_variable = env.layer4_variable.replace(
          /Respond ONLY with a JSON/,
          `${evidenceBlock}\n\nRespond ONLY with a JSON`,
        );
      }
      if (repairBlock) {
        env.layer4_variable = env.layer4_variable.replace(
          /Respond ONLY with a JSON/,
          `${repairBlock}\nRespond ONLY with a JSON`,
        );
        if (!env.layer4_variable.includes('CORRECTIONS REQUIRED') && !env.layer4_variable.includes('MANDATORY CORRECTION')) {
          env.layer4_variable += repairBlock;
        }
      }
      draftPromptText = flattenEnvelope(env);
      const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.draft_temperature } }, `${input.label} draft`);
      draftRaw = resp.text;
    } else {
      draftPromptText = draftStagePrompt(stageInput, briefJson, planJson);
      // Inject source evidence block
      if (evidenceBlock) {
        draftPromptText = draftPromptText.replace(
          /Respond ONLY with a JSON/,
          `${evidenceBlock}\n\nRespond ONLY with a JSON`,
        );
      }
      if (repairBlock) {
        draftPromptText = draftPromptText.replace(
          /Respond ONLY with a JSON/,
          `${repairBlock}\nRespond ONLY with a JSON`,
        );
        if (!draftPromptText.includes('CORRECTIONS REQUIRED') && !draftPromptText.includes('MANDATORY CORRECTION')) {
          draftPromptText += repairBlock;
        }
      }
      draftRaw = await generate(draftPromptText, input.model, { temperature: temps.draft_temperature }, `${input.label} draft`);
    }
    elapsed = Date.now() - t0;
    const draftParsed = parseStageResponse<DraftWorkProduct>(draftRaw, 'draft');
    stageDiags.push({
      stage: 'draft', prompt: draftPromptText, raw_response: draftRaw,
      model: input.model, temperature: temps.draft_temperature,
      response_time_ms: elapsed, work_product: draftParsed.product as unknown as Record<string, unknown>,
      parse_error: draftParsed.error,
    });
    draft = draftParsed.product;

    // Per-stage draft validation
    if (draft) {
      const meta = extractDraftMeta(draft);
      const draftVal = validateDraftStage({
        statement: draft.statement ?? '',
        meta,
        phase: stageInput.phase ?? 'argumentation',
        round: typeof (stageInput as Record<string, unknown>).round === 'number' ? (stageInput as Record<string, unknown>).round as number : 3,
        priorTurns: (input as Record<string, unknown>).priorTurns as import('./types.js').TranscriptEntry[] ?? [],
        audience: stageInput.audience,
        pendingIntervention: stageInput.pendingIntervention as import('./types.js').ModeratorIntervention | undefined,
      });
      // Record validation result on the stage diagnostic
      const lastDiag = stageDiags[stageDiags.length - 1];
      (lastDiag as Record<string, unknown>).stage_validation = {
        pass: draftVal.pass,
        hints: draftVal.repairHints,
        directive_compliance: draftVal.directive_compliance,
      };

      // First draft: any feedback (errors + warnings) triggers retry — address everything.
      // Subsequent drafts: only errors trigger retry — don't chase diminishing returns.
      // Directive failures get an extra attempt (max 2 retries) since they're structural.
      const isDirectiveFailure = draftVal.failedDimension === 'directive';
      const maxDraftRetries = isDirectiveFailure ? 2 : MAX_STAGE_RETRIES;
      const draftShouldRetry = draftAttempt === 0
        ? draftVal.repairHints.length > 0
        : draftVal.errorHints.length > 0;
      if (draftShouldRetry && draftAttempt < maxDraftRetries) {
        draftRepairHints = draftAttempt === 0 ? draftVal.repairHints : draftVal.errorHints;
        console.log(`[pipeline] Draft validation feedback (attempt ${draftAttempt}), retrying: ${draftRepairHints.join('; ')}`);
        continue;
      }
    }
    break;
  }
  draftJson = JSON.stringify(draft, null, 2);

  // ── Evidence citation verification ──
  // Check if the debater actually cited any source documents from the evidence brief.
  if (evidenceBlock && draft?.statement) {
    const evidenceDiag = stageDiags.find(d => d.stage === 'evidence');
    if (evidenceDiag) {
      const wp = evidenceDiag.work_product as Record<string, unknown>;
      const facts = (wp?.facts as Array<{ doc_id?: string }>) ?? [];
      const keyPoints = (wp?.keyPoints as Array<{ doc_id?: string }>) ?? [];
      const allDocIds = [...new Set([...facts.map(f => f.doc_id), ...keyPoints.map(kp => kp.doc_id)].filter(Boolean))] as string[];
      const statementLower = draft.statement.toLowerCase();
      const citedDocs = allDocIds.filter(docId => {
        // Check if the doc_id slug (or a recognizable portion) appears in the statement
        const slug = docId.replace(/-\d{4}(-\d+)?$/, '').replace(/-/g, ' ');
        return statementLower.includes(slug) || statementLower.includes(docId);
      });
      const utilizationRate = allDocIds.length > 0 ? citedDocs.length / allDocIds.length : 0;
      (wp as Record<string, unknown>).evidence_utilization = {
        total_docs: allDocIds.length,
        cited_docs: citedDocs,
        utilization_rate: Math.round(utilizationRate * 100),
      };
      if (citedDocs.length > 0) {
        console.log(`[pipeline] Evidence utilization: ${citedDocs.length}/${allDocIds.length} source docs cited (${Math.round(utilizationRate * 100)}%)`);
      } else {
        console.log(`[pipeline] Evidence utilization: 0/${allDocIds.length} — debater did not cite any source documents from evidence brief`);
      }
    }
  }

  // ── Stage 3.5: DRAFT QUALITY PRE-CHECK ──
  // Lightweight 3-question LLM evaluation: grounded, falsifiable, engages.
  // Only on first draft attempt within the per-stage loop, non-outer-retry, when pre-check is enabled.
  if (
    !isOuterRetry &&
    !input.skipPreCheck &&
    preCheckGenerate &&
    input.preCheckModel &&
    input.lastOpponentStatement &&
    draft?.statement
  ) {
    onProgress?.('draft_quality', `${input.label} is quality-checking draft...`);
    const preCheckPromptText = draftQualityCheckPrompt(
      draft.statement,
      input.lastOpponentStatement,
      input.label,
      input.pov,
      input.phase,
      typeof (stageInput as Record<string, unknown>).round === 'number'
        ? (stageInput as Record<string, unknown>).round as number
        : 3,
    );
    const preCheckT0 = Date.now();
    try {
      const preCheckRaw = await preCheckGenerate(
        preCheckPromptText,
        input.preCheckModel,
        { temperature: 0.1 },
        `${input.label} draft-quality-check`,
      );
      const preCheckElapsed = Date.now() - preCheckT0;
      const preCheckResult = parseDraftQualityResult(preCheckRaw);
      stageDiags.push({
        stage: 'draft_quality',
        prompt: preCheckPromptText,
        raw_response: preCheckRaw,
        model: input.preCheckModel,
        temperature: 0.1,
        response_time_ms: preCheckElapsed,
        work_product: preCheckResult as unknown as Record<string, unknown>,
      });

      const allPass = preCheckResult.grounded && preCheckResult.falsifiable && preCheckResult.engages;
      if (!allPass && preCheckResult.weaknesses.length > 0) {
        console.log(`[pipeline] Draft quality pre-check failed: ${preCheckResult.weaknesses.join('; ')}`);
        // Re-run just the draft with quality weaknesses as repair hints
        draftRepairHints = preCheckResult.weaknesses;
        const repairBlock = buildRepairBlock(draftRepairHints, draft.statement);
        let retryDraftPrompt: string;
        let retryDraftRaw: string;
        const retryT0 = Date.now();
        if (envelopeGenerate) {
          const env = draftStageEnvelope(stageInput, briefJson, planJson);
          if (repairBlock) {
            env.layer4_variable = env.layer4_variable.replace(
              /Respond ONLY with a JSON/,
              `${repairBlock}\nRespond ONLY with a JSON`,
            );
            if (!env.layer4_variable.includes('CORRECTIONS REQUIRED') && !env.layer4_variable.includes('MANDATORY CORRECTION')) {
              env.layer4_variable += repairBlock;
            }
          }
          retryDraftPrompt = flattenEnvelope(env);
          const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.draft_temperature } }, `${input.label} draft (quality retry)`);
          retryDraftRaw = resp.text;
        } else {
          retryDraftPrompt = draftStagePrompt(stageInput, briefJson, planJson);
          if (repairBlock) {
            retryDraftPrompt = retryDraftPrompt.replace(
              /Respond ONLY with a JSON/,
              `${repairBlock}\nRespond ONLY with a JSON`,
            );
            if (!retryDraftPrompt.includes('CORRECTIONS REQUIRED') && !retryDraftPrompt.includes('MANDATORY CORRECTION')) {
              retryDraftPrompt += repairBlock;
            }
          }
          retryDraftRaw = await generate(retryDraftPrompt, input.model, { temperature: temps.draft_temperature }, `${input.label} draft (quality retry)`);
        }
        const retryElapsed = Date.now() - retryT0;
        const retryDraftParsed = parseStageResponse<DraftWorkProduct>(retryDraftRaw, 'draft');
        stageDiags.push({
          stage: 'draft', prompt: retryDraftPrompt, raw_response: retryDraftRaw,
          model: input.model, temperature: temps.draft_temperature,
          response_time_ms: retryElapsed, work_product: retryDraftParsed.product as unknown as Record<string, unknown>,
          parse_error: retryDraftParsed.error,
        });
        if (!retryDraftParsed.error && retryDraftParsed.product?.statement) {
          draft = retryDraftParsed.product;
          draftJson = JSON.stringify(draft, null, 2);
          console.log(`[pipeline] Draft quality retry produced new draft`);
        }
      }
    } catch (err) {
      // Pre-check failure is non-fatal — proceed to cite
      console.warn(`[pipeline] Draft quality pre-check failed: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
    }
  }

  // ── Stage 4: CITE (with per-stage validation + retry) ──
  let citeRepairHints: string[] = input.repairHints?.filter(h =>
    /taxonomy_refs.*(?:filler|too-short|relevance)|No new taxonomy_refs|Unknown taxonomy node|Unknown policy_refs|grounding_confidence/i.test(h)
  ) ?? [];
  let citeParsed: ReturnType<typeof parseStageResponse<CiteWorkProduct>>;

  for (let citeAttempt = 0; citeAttempt <= MAX_STAGE_RETRIES; citeAttempt++) {
    onProgress?.('cite', `${input.label} is citing${citeAttempt > 0 ? ` (retry ${citeAttempt})` : ''}...`);
    let citePromptText: string;
    let citeRaw: string;
    t0 = Date.now();
    if (envelopeGenerate) {
      const env = citeStageEnvelope(stageInput, briefJson, planJson, draftJson);
      if (citeRepairHints.length > 0) {
        env.layer4_variable += `\n\n=== CITATION REPAIR HINTS (from prior failed attempt) ===\n${citeRepairHints.map(h => '- ' + h).join('\n')}\nAddress these issues in your taxonomy references.`;
      }
      citePromptText = flattenEnvelope(env);
      const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.cite_temperature } }, `${input.label} cite`);
      citeRaw = resp.text;
    } else {
      citePromptText = citeStagePrompt(stageInput, briefJson, planJson, draftJson);
      if (citeRepairHints.length > 0) {
        citePromptText += `\n\n=== CITATION REPAIR HINTS (from prior failed attempt) ===\n${citeRepairHints.map(h => '- ' + h).join('\n')}\nAddress these issues in your taxonomy references.`;
      }
      citeRaw = await generate(citePromptText, input.model, { temperature: temps.cite_temperature }, `${input.label} cite`);
    }
    elapsed = Date.now() - t0;
    citeParsed = parseStageResponse<CiteWorkProduct>(citeRaw, 'cite');
    stageDiags.push({
      stage: 'cite', prompt: citePromptText, raw_response: citeRaw,
      model: input.model, temperature: temps.cite_temperature,
      response_time_ms: elapsed, work_product: citeParsed.product as unknown as Record<string, unknown>,
      parse_error: citeParsed.error,
    });

    // Per-stage cite validation
    if (citeParsed.product) {
      const citeVal = validateCiteStage({
        taxonomyRefs: (citeParsed.product.taxonomy_refs ?? []) as import('./types.js').TaxonomyRef[],
        policyRefs: citeParsed.product.policy_refs as string[] | undefined,
        knownNodeIds: new Set(input.availablePovNodeIds ?? []),
        policyIds: new Set(input.availablePolicyIds ?? []),
        priorTurns: (input as Record<string, unknown>).priorTurns as import('./types.js').TranscriptEntry[] ?? [],
        speaker: input.label,
        targetNodes: plan?.target_nodes,
      });
      const lastDiag = stageDiags[stageDiags.length - 1];
      (lastDiag as Record<string, unknown>).stage_validation = { pass: citeVal.pass, hints: citeVal.repairHints };

      if (citeVal.errorHints.length > 0 && citeAttempt < MAX_STAGE_RETRIES) {
        citeRepairHints = citeVal.errorHints;
        console.log(`[pipeline] Cite validation errors (attempt ${citeAttempt}), retrying: ${citeVal.errorHints.join('; ')}`);
        continue;
      }
    }
    break;
  }
  let cite = citeParsed!.product;

  // ── Cite filler retry: strengthen or drop weak refs ──
  const weakRefs = (cite.taxonomy_refs ?? []).filter(
    r => (r.relevance ?? '').trim().length < 40 || isFillerRelevance((r.relevance ?? '').trim()),
  );
  if (weakRefs.length > 0) {
    console.log(`[pipeline] ${weakRefs.length} weak taxonomy_refs detected, running cite retry for: ${weakRefs.map(r => r.node_id).join(', ')}`);
    onProgress?.('cite', `${input.label} is strengthening refs...`);
    const retryPrompt = citeRetryPrompt(
      weakRefs.map(r => ({ node_id: r.node_id, relevance: r.relevance ?? '' })),
      draftJson,
      stageInput.taxonomyContext,
    );
    t0 = Date.now();
    const retryRaw = await generate(retryPrompt, input.model, { temperature: temps.cite_temperature }, `${input.label} cite-retry`);
    elapsed = Date.now() - t0;
    const retryParsed = parseStageResponse<{ taxonomy_refs: import('./types.js').TaxonomyRef[] }>(retryRaw, 'cite');
    stageDiags.push({
      stage: 'cite', prompt: retryPrompt, raw_response: retryRaw,
      model: input.model, temperature: temps.cite_temperature,
      response_time_ms: elapsed, work_product: retryParsed.product as unknown as Record<string, unknown>,
      parse_error: retryParsed.error,
    });

    if (!retryParsed.error && retryParsed.product?.taxonomy_refs) {
      const strengthened = new Map(retryParsed.product.taxonomy_refs.map(r => [r.node_id, r]));
      const weakIds = new Set(weakRefs.map(r => r.node_id));
      // Keep non-weak refs as-is, replace weak refs with strengthened versions (or drop if not returned)
      cite = {
        ...cite,
        taxonomy_refs: [
          ...cite.taxonomy_refs.filter(r => !weakIds.has(r.node_id)),
          ...retryParsed.product.taxonomy_refs,
        ],
      };
    }
  }

  return {
    brief,
    plan,
    draft,
    cite,
    stage_diagnostics: stageDiags,
    total_time_ms: Date.now() - pipelineStart,
  };
}

/** Extract PoverResponseMeta-compatible object from DraftWorkProduct for validation. */
function extractDraftMeta(draft: DraftWorkProduct): PoverResponseMeta {
  return {
    move_types: draft.move_types as MoveAnnotation[] | undefined,
    my_claims: draft.claim_sketches?.map(c => ({
      claim: typeof c === 'string' ? c : (c as Record<string, unknown>).claim as string ?? '',
    })) ?? [],
    disagreement_type: draft.disagreement_type as string | undefined,
    key_assumptions: draft.key_assumptions as { assumption: string; if_wrong: string }[] | undefined,
    // Pass through intervention response fields
    ...(draft as Record<string, unknown>).pin_response != null ? { pin_response: (draft as Record<string, unknown>).pin_response } : {},
    ...(draft as Record<string, unknown>).probe_response != null ? { probe_response: (draft as Record<string, unknown>).probe_response } : {},
    ...(draft as Record<string, unknown>).challenge_response != null ? { challenge_response: (draft as Record<string, unknown>).challenge_response } : {},
    ...(draft as Record<string, unknown>).clarification != null ? { clarification: (draft as Record<string, unknown>).clarification } : {},
    ...(draft as Record<string, unknown>).check_response != null ? { check_response: (draft as Record<string, unknown>).check_response } : {},
    ...(draft as Record<string, unknown>).revoice_response != null ? { revoice_response: (draft as Record<string, unknown>).revoice_response } : {},
    ...(draft as Record<string, unknown>).reflection != null ? { reflection: (draft as Record<string, unknown>).reflection } : {},
    ...(draft as Record<string, unknown>).compressed_thesis != null ? { compressed_thesis: (draft as Record<string, unknown>).compressed_thesis } : {},
    ...(draft as Record<string, unknown>).commitment != null ? { commitment: (draft as Record<string, unknown>).commitment } : {},
  } as PoverResponseMeta;
}

// ── Targeted repair instructions ─────────────────────────
// Instead of appending generic "REPAIR HINTS" at the bottom (which reference output
// the LLM can't see), translate each failure type into a specific prompt modification
// placed in the recency window just before the JSON schema.

function buildRepairBlock(hints: string[], failedStatement?: string): string {
  if (hints.length === 0) return '';
  const sections: string[] = [];

  // Directive non-compliance — include the failed first paragraph so the LLM can see what it wrote
  const directiveHint = hints.find(h => /directive|first paragraph|PIN|PROBE|CHALLENGE/i.test(h));
  if (directiveHint) {
    const failedFirstParagraph = failedStatement
      ? failedStatement.split(/\n\s*\n/)[0]?.trim().slice(0, 300)
      : undefined;
    sections.push(
      `MANDATORY CORRECTION — DIRECTIVE RESPONSE:\n` +
      (failedFirstParagraph
        ? `Your prior attempt began with: "${failedFirstParagraph}..."\nThis was REJECTED because it did not address the moderator's directive.\n`
        : '') +
      `Your FIRST SENTENCE must begin with "I agree that...", "I disagree that...", or "I conditionally agree:..."\n` +
      `This is not optional. Responses that do not start this way will be rejected again.`
    );
  }

  // Single paragraph
  if (hints.some(h => /single paragraph|split into/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — PARAGRAPH STRUCTURE:\n` +
      `Your prior attempt was a single block of text. You MUST use \\n\\n to create 3-5 separate paragraphs. Each paragraph develops ONE idea.`
    );
  }

  // Hedge density
  if (hints.some(h => /hedge density/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — REMOVE HEDGING:\n` +
      `Your prior attempt had too many qualifiers. Replace "may", "might", "could", "perhaps", "potentially" with definitive claims. Use specific actors, timelines, and numbers.`
    );
  }

  // Claim specificity
  if (hints.some(h => /abstract|number.*entity.*timeline|specific/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — ADD SPECIFICS:\n` +
      `Your prior attempt lacked concrete details. Include at least one: a specific number ("≥20%"), a named entity ("the EU AI Act"), or a timeline ("by 2028").`
    );
  }

  // Statement duplication
  if (hints.some(h => /duplicate|repeated text/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — NO REPETITION:\n` +
      `Your prior attempt contained the same text repeated twice. Write each paragraph ONCE. Do not copy content between paragraphs.`
    );
  }

  // Move repetition
  if (hints.some(h => /move_types repeat/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — VARY MOVES:\n` +
      `Your prior attempt used the same dialectical moves as your previous turn. Choose different moves this time.`
    );
  }

  // Constructive move requirement
  if (hints.some(h => /constructive move|CONCEDE.*PIVOT.*INTEGRATE/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — ADD CONSTRUCTIVE MOVE:\n` +
      `Your prior attempt used only adversarial moves. Include at least one constructive move: CONCEDE-AND-PIVOT, INTEGRATE, EXTEND, or SPECIFY.`
    );
  }

  // Commitment schema compliance (COMMIT move)
  if (hints.some(h => /concessions|conditions_for_change|sharpest_disagreements|commitment.*sub-fields/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — COMMITMENT STRUCTURE:\n` +
      `Your prior attempt was missing required commitment fields. Your response MUST include a "commitment" object with ALL THREE sub-fields:\n` +
      `{\n` +
      `  "commitment": {\n` +
      `    "concessions": ["specific point you concede to an opponent"],\n` +
      `    "conditions_for_change": ["If [specific evidence], then I would revise my position on [specific claim]"],\n` +
      `    "sharpest_disagreements": {\n` +
      `      "opponent_name": "One sentence: the core irreducible disagreement"\n` +
      `    }\n` +
      `  }\n` +
      `}\n` +
      `Each field must be non-empty. Be specific — name opponents, cite claims, state conditions.`
    );
  }

  // Catch-all for any unmatched hints
  const unmatched = hints.filter(h =>
    !(/directive|first paragraph|PIN|PROBE|CHALLENGE|single paragraph|split into|hedge density|abstract.*number|duplicate|repeated text|move_types repeat|constructive move|concessions|conditions_for_change|sharpest_disagreements|commitment.*sub-fields/i.test(h))
  );
  if (unmatched.length > 0) {
    sections.push(
      `CORRECTIONS FROM PRIOR ATTEMPT:\n` +
      unmatched.map(h => `- ${h}`).join('\n')
    );
  }

  return sections.length > 0
    ? `\n\n=== CORRECTIONS REQUIRED (prior attempt was rejected) ===\n${sections.join('\n\n')}\n`
    : '';
}

// ── Statement deduplication ──────────────────────────────
// LLMs (especially Gemini flash) sometimes produce a statement where the entire
// content is repeated verbatim — 3 paragraphs followed by the same 3 paragraphs.
// Detect and truncate before the statement reaches the transcript.

function deduplicateStatement(statement: string): string {
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

// ── Assembler ───────────────────────────────────────────

export function assemblePipelineResult(
  result: TurnPipelineResult,
  validNodeIds?: Set<string>,
): { statement: string; taxonomyRefs: TaxonomyRef[]; meta: PoverResponseMeta } {
  const moveAnnotations: (string | MoveAnnotation)[] = (result.cite.move_annotations ?? []).map(m => ({
    move: m.move,
    target: m.target,
    detail: m.detail,
  }));

  const rawRefs = (result.cite.taxonomy_refs ?? []).map(r => ({
    node_id: r.node_id,
    relevance: r.relevance,
  }));
  const taxonomyRefs = validNodeIds
    ? rawRefs.filter(r => validNodeIds.has(r.node_id))
    : rawRefs;

  const statement = deduplicateStatement(result.draft.statement ?? '');
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
      turn_symbols: result.draft.turn_symbols?.length ? result.draft.turn_symbols : undefined,
      pin_response: result.draft.pin_response,
      probe_response: result.draft.probe_response,
      challenge_response: result.draft.challenge_response,
      clarification: result.draft.clarification,
      check_response: result.draft.check_response,
      revoice_response: result.draft.revoice_response,
      reflection: result.draft.reflection,
      compressed_thesis: result.draft.compressed_thesis,
      commitment: result.draft.commitment,
    },
  };
}

// ── Opening pipeline ──────────────────────────────────

export interface OpeningPipelineInput {
  label: string;
  pov: string;
  personality: string;
  topic: string;
  taxonomyContext: string;
  priorStatements: string;
  isFirst: boolean;
  sourceContent?: string;
  documentAnalysis?: DocumentAnalysis;
  audience?: import('./types').DebateAudience;
  model: string;
  stageTemperatures?: TurnStageConfig;
  userSeedClaims?: { id: string; text: string; bdi_category?: string }[];
  doctrinalBoundaries?: string[];
  /** Repair hints from a prior failed attempt — injected into the DRAFT stage prompt. */
  repairHints?: string[];
  /** Available POV node IDs for CITE validation (unknown node detection). */
  availablePovNodeIds?: string[];
}

export async function runOpeningPipeline(
  input: OpeningPipelineInput,
  generate: StageGenerateFn,
  onProgress?: StageProgressFn,
): Promise<OpeningPipelineResult> {
  const temps = {
    ...DEFAULT_STAGE_TEMPERATURES,
    ...input.stageTemperatures,
  };
  const stageInput: OpeningStagePromptInput = {
    label: input.label,
    pov: input.pov,
    personality: input.personality,
    topic: input.topic,
    taxonomyContext: input.taxonomyContext,
    priorStatements: input.priorStatements,
    isFirst: input.isFirst,
    sourceContent: input.sourceContent,
    documentAnalysis: input.documentAnalysis,
    audience: input.audience,
    userSeedClaims: input.userSeedClaims,
    doctrinalBoundaries: input.doctrinalBoundaries,
  };
  const stageDiags: StageDiagnostics[] = [];
  const pipelineStart = Date.now();

  // ── Stage 1: BRIEF ──
  onProgress?.('brief', `${input.label} is briefing...`);
  const briefPrompt = briefOpeningStagePrompt(stageInput);
  let t0 = Date.now();
  const briefRaw = await generate(
    briefPrompt, input.model, { temperature: temps.brief_temperature }, `${input.label} opening brief`,
  );
  let elapsed = Date.now() - t0;
  const briefParsed = parseStageResponse<OpeningBriefWorkProduct>(briefRaw, 'brief');
  stageDiags.push({
    stage: 'brief', prompt: briefPrompt, raw_response: briefRaw,
    model: input.model, temperature: temps.brief_temperature,
    response_time_ms: elapsed, work_product: briefParsed.product as unknown as Record<string, unknown>,
    parse_error: briefParsed.error,
  });
  if (briefParsed.error) {
    throw new ActionableError({
      goal: 'Run opening statement pipeline',
      problem: `Brief stage failed to parse — downstream stages would operate on empty context. ${briefParsed.error}`,
      location: 'turnPipeline.runOpeningPipeline',
      nextSteps: ['Check the AI model response quality', 'Try a different model'],
    });
  }
  const brief = briefParsed.product;
  const briefJson = JSON.stringify(brief, null, 2);

  // ── Stage 2: PLAN ──
  onProgress?.('plan', `${input.label} is planning...`);
  const planPromptText = planOpeningStagePrompt(stageInput, briefJson);
  t0 = Date.now();
  const planRaw = await generate(
    planPromptText, input.model, { temperature: temps.plan_temperature }, `${input.label} opening plan`,
  );
  elapsed = Date.now() - t0;
  const planParsed = parseStageResponse<OpeningPlanWorkProduct>(planRaw, 'plan');
  stageDiags.push({
    stage: 'plan', prompt: planPromptText, raw_response: planRaw,
    model: input.model, temperature: temps.plan_temperature,
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
  const plan = planParsed.product;
  const planJson = JSON.stringify(plan, null, 2);

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
    draftPromptText, input.model, { temperature: temps.draft_temperature }, `${input.label} opening draft`,
  );
  elapsed = Date.now() - t0;
  const draftParsed = parseStageResponse<DraftWorkProduct>(draftRaw, 'draft');
  stageDiags.push({
    stage: 'draft', prompt: draftPromptText, raw_response: draftRaw,
    model: input.model, temperature: temps.draft_temperature,
    response_time_ms: elapsed, work_product: draftParsed.product as unknown as Record<string, unknown>,
    parse_error: draftParsed.error,
  });
  const draft = draftParsed.product;
  const draftJson = JSON.stringify(draft, null, 2);

  // Per-stage draft validation for openings (Rules 6, 10, 12 — no moves/disagreement for openings)
  if (draft) {
    const openingDraftMeta: import('./helpers.js').PoverResponseMeta = {
      my_claims: draft.claim_sketches?.map(c => ({
        claim: typeof c === 'string' ? c : (c as Record<string, unknown>).claim as string ?? '',
      })) ?? [],
      key_assumptions: draft.key_assumptions as { assumption: string; if_wrong: string }[] | undefined,
    };
    const draftVal = validateDraftStage({
      statement: draft.statement ?? '',
      meta: openingDraftMeta,
      phase: 'confrontation' as import('./types.js').DebatePhase,
      round: 0,
      priorTurns: [],
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
    citePromptText, input.model, { temperature: temps.cite_temperature }, `${input.label} opening cite`,
  );
  elapsed = Date.now() - t0;
  const citeParsed = parseStageResponse<OpeningCiteWorkProduct>(citeRaw, 'cite');
  stageDiags.push({
    stage: 'cite', prompt: citePromptText, raw_response: citeRaw,
    model: input.model, temperature: temps.cite_temperature,
    response_time_ms: elapsed, work_product: citeParsed.product as unknown as Record<string, unknown>,
    parse_error: citeParsed.error,
  });
  const cite = citeParsed.product;

  // Per-stage cite validation for openings (Rules 3, 4, 5)
  if (cite) {
    const knownIds = new Set(input.availablePovNodeIds ?? []);
    const citeVal = validateCiteStage({
      taxonomyRefs: (cite.taxonomy_refs ?? []) as import('./types.js').TaxonomyRef[],
      policyRefs: cite.policy_refs as string[] | undefined,
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
    brief,
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
  const taxonomyRefs = validNodeIds
    ? rawRefs.filter(r => validNodeIds.has(r.node_id))
    : rawRefs;

  const statement = deduplicateStatement(result.draft.statement ?? '');
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
      turn_symbols: result.draft.turn_symbols?.length ? result.draft.turn_symbols : undefined,
    },
  };
}
