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
  TaxonomyRef,
  DebatePhase,
} from './types';
import type { DocumentAnalysis } from './types';
import type { PoverResponseMeta, MoveAnnotation } from './helpers';
import type { GenerateOptions } from './aiAdapter';
import { parseJsonRobust } from './helpers';
import {
  briefStagePrompt,
  planStagePrompt,
  draftStagePrompt,
  citeStagePrompt,
} from './prompts';
import type { StagePromptInput } from './prompts';

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
  const briefPrompt = briefStagePrompt(stageInput);
  let t0 = Date.now();
  const briefRaw = await generate(
    briefPrompt, input.model, { temperature: temps.brief_temperature }, `${input.label} brief`,
  );
  let elapsed = Date.now() - t0;
  const briefParsed = parseStageResponse<BriefWorkProduct>(briefRaw, 'brief');
  stageDiags.push({
    stage: 'brief', prompt: briefPrompt, raw_response: briefRaw,
    model: input.model, temperature: temps.brief_temperature,
    response_time_ms: elapsed, work_product: briefParsed.product as unknown as Record<string, unknown>,
    parse_error: briefParsed.error,
  });
  const brief = briefParsed.product;
  const briefJson = JSON.stringify(brief, null, 2);

  // ── Stage 2: PLAN ──
  onProgress?.('plan', `${input.label} is planning...`);
  const planPromptText = planStagePrompt(stageInput, briefJson);
  t0 = Date.now();
  const planRaw = await generate(
    planPromptText, input.model, { temperature: temps.plan_temperature }, `${input.label} plan`,
  );
  elapsed = Date.now() - t0;
  const planParsed = parseStageResponse<PlanWorkProduct>(planRaw, 'plan');
  stageDiags.push({
    stage: 'plan', prompt: planPromptText, raw_response: planRaw,
    model: input.model, temperature: temps.plan_temperature,
    response_time_ms: elapsed, work_product: planParsed.product as unknown as Record<string, unknown>,
    parse_error: planParsed.error,
  });
  const plan = planParsed.product;
  const planJson = JSON.stringify(plan, null, 2);

  // ── Stage 3: DRAFT ──
  onProgress?.('draft', `${input.label} is drafting...`);
  let draftPromptText = draftStagePrompt(stageInput, briefJson, planJson);
  if (input.repairHints && input.repairHints.length > 0) {
    draftPromptText += `\n\n=== REPAIR HINTS (from prior failed attempt) ===\n${input.repairHints.map(h => '- ' + h).join('\n')}\nAddress these issues in your revised statement.`;
  }
  t0 = Date.now();
  const draftRaw = await generate(
    draftPromptText, input.model, { temperature: temps.draft_temperature }, `${input.label} draft`,
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
  const citePromptText = citeStagePrompt(stageInput, briefJson, planJson, draftJson);
  t0 = Date.now();
  const citeRaw = await generate(
    citePromptText, input.model, { temperature: temps.cite_temperature }, `${input.label} cite`,
  );
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
): { statement: string; taxonomyRefs: TaxonomyRef[]; meta: PoverResponseMeta } {
  const moveAnnotations: (string | MoveAnnotation)[] = (result.cite.move_annotations ?? []).map(m => ({
    move: m.move,
    target: m.target,
    detail: m.detail,
  }));

  return {
    statement: result.draft.statement ?? '',
    taxonomyRefs: (result.cite.taxonomy_refs ?? []).map(r => ({
      node_id: r.node_id,
      relevance: r.relevance,
    })),
    meta: {
      move_types: moveAnnotations.length > 0 ? moveAnnotations : undefined,
      disagreement_type: result.draft.disagreement_type || undefined,
      key_assumptions: result.draft.key_assumptions?.length ? result.draft.key_assumptions : undefined,
      my_claims: result.draft.claim_sketches?.length ? result.draft.claim_sketches : undefined,
      policy_refs: result.cite.policy_refs?.length ? result.cite.policy_refs : undefined,
      position_update: result.draft.position_update || undefined,
      turn_symbols: result.draft.turn_symbols?.length ? result.draft.turn_symbols : undefined,
    },
  };
}
