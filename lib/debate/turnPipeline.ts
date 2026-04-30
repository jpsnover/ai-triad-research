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
} from './types';
import type { DocumentAnalysis } from './types';
import type { PoverResponseMeta, MoveAnnotation } from './helpers';
import type { GenerateOptions } from './aiAdapter';
import { parseJsonRobust, wordOverlap } from './helpers';
import {
  briefStagePrompt,
  planStagePrompt,
  draftStagePrompt,
  citeStagePrompt,
  briefOpeningStagePrompt,
  planOpeningStagePrompt,
  draftOpeningStagePrompt,
  citeOpeningStagePrompt,
} from './prompts';
import type { StagePromptInput, OpeningStagePromptInput } from './prompts';
import type { GenerateRequest, GenerateResponse } from './cacheTypes';
import { flattenEnvelope } from './cacheTypes';
import {
  briefStageEnvelope,
  planStageEnvelope,
  draftStageEnvelope,
  citeStageEnvelope,
} from './envelopes';

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
  priorRefs: string[];
  availablePovNodeIds: string[];
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
    priorRefs: input.priorRefs,
    availablePovNodeIds: input.availablePovNodeIds,
    crossPovNodeIds: input.crossPovNodeIds,
    priorFlaggedHints: input.priorFlaggedHints,
    sourceContent: input.sourceContent,
    documentAnalysis: input.documentAnalysis,
    audience: input.audience,
    pendingIntervention: input.pendingIntervention,
    phaseContext: input.phaseContext,
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
    throw new Error(`Pipeline aborted: brief stage failed to parse — downstream stages would operate on empty context. ${briefParsed.error}`);
  }
  const brief = briefParsed.product;
  const briefJson = JSON.stringify(brief, null, 2);

  // ── Stage 2: PLAN ──
  onProgress?.('plan', `${input.label} is planning...`);
  let planPromptText: string;
  let planRaw: string;
  t0 = Date.now();
  if (envelopeGenerate) {
    const env = planStageEnvelope(stageInput, briefJson);
    planPromptText = flattenEnvelope(env);
    const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.plan_temperature } }, `${input.label} plan`);
    planRaw = resp.text;
  } else {
    planPromptText = planStagePrompt(stageInput, briefJson);
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
    throw new Error(`Pipeline aborted: plan stage failed to parse — downstream stages would operate on empty context. ${planParsed.error}`);
  }
  const plan = planParsed.product;
  const planJson = JSON.stringify(plan, null, 2);

  // ── Stage 3: DRAFT ──
  onProgress?.('draft', `${input.label} is drafting...`);
  let draftPromptText: string;
  let draftRaw: string;
  t0 = Date.now();
  if (envelopeGenerate) {
    const env = draftStageEnvelope(stageInput, briefJson, planJson);
    if (input.repairHints && input.repairHints.length > 0) {
      env.layer4_variable += `\n\n=== REPAIR HINTS (from prior failed attempt) ===\n${input.repairHints.map(h => '- ' + h).join('\n')}\nAddress these issues in your revised statement.`;
    }
    draftPromptText = flattenEnvelope(env);
    const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.draft_temperature } }, `${input.label} draft`);
    draftRaw = resp.text;
  } else {
    draftPromptText = draftStagePrompt(stageInput, briefJson, planJson);
    if (input.repairHints && input.repairHints.length > 0) {
      draftPromptText += `\n\n=== REPAIR HINTS (from prior failed attempt) ===\n${input.repairHints.map(h => '- ' + h).join('\n')}\nAddress these issues in your revised statement.`;
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
  const draft = draftParsed.product;
  const draftJson = JSON.stringify(draft, null, 2);

  // ── Stage 4: CITE ──
  onProgress?.('cite', `${input.label} is citing...`);
  let citePromptText: string;
  let citeRaw: string;
  t0 = Date.now();
  if (envelopeGenerate) {
    const env = citeStageEnvelope(stageInput, briefJson, planJson, draftJson);
    citePromptText = flattenEnvelope(env);
    const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.cite_temperature } }, `${input.label} cite`);
    citeRaw = resp.text;
  } else {
    citePromptText = citeStagePrompt(stageInput, briefJson, planJson, draftJson);
    citeRaw = await generate(citePromptText, input.model, { temperature: temps.cite_temperature }, `${input.label} cite`);
  }
  elapsed = Date.now() - t0;
  const citeParsed = parseStageResponse<CiteWorkProduct>(citeRaw, 'cite');
  stageDiags.push({
    stage: 'cite', prompt: citePromptText, raw_response: citeRaw,
    model: input.model, temperature: temps.cite_temperature,
    response_time_ms: elapsed, work_product: citeParsed.product as unknown as Record<string, unknown>,
    parse_error: citeParsed.error,
  });
  const cite = citeParsed.product;

  return {
    brief,
    plan,
    draft,
    cite,
    stage_diagnostics: stageDiags,
    total_time_ms: Date.now() - pipelineStart,
  };
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

  const statement = result.draft.statement ?? '';
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
    throw new Error(`Opening pipeline aborted: brief stage failed to parse — downstream stages would operate on empty context. ${briefParsed.error}`);
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
    throw new Error(`Opening pipeline aborted: plan stage failed to parse — downstream stages would operate on empty context. ${planParsed.error}`);
  }
  const plan = planParsed.product;
  const planJson = JSON.stringify(plan, null, 2);

  // ── Stage 3: DRAFT ──
  onProgress?.('draft', `${input.label} is drafting...`);
  const draftPromptText = draftOpeningStagePrompt(stageInput, briefJson, planJson);
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

  return {
    brief,
    plan,
    draft,
    cite,
    stage_diagnostics: stageDiags,
    total_time_ms: Date.now() - pipelineStart,
  };
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

  const statement = result.draft.statement ?? '';
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
