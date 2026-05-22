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
  StageProvenance,
} from './types.js';
import type { DocumentAnalysis } from './types.js';
import { POVER_INFO } from './types.js';
import { ActionableError } from './errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import { validateDraftStage, validateCiteStage, validatePlanStage, isFillerRelevance, parseDraftQualityResult, resolveMoveName } from './turnValidator.js';
import type { DraftQualityCheckOutput } from './turnValidator.js';
import type { PoverResponseMeta, MoveAnnotation } from './helpers.js';
import type { GenerateOptions } from './aiAdapter.js';
import { parseJsonRobust, wordOverlap, getMoveName } from './helpers.js';
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
import { resolveBackend } from '../ai-client/registry.js';
import {
  buildCitationBank,
  formatCitationBank,
  scrubCitations,
  validateCitationsAgainstBank,
  extractCitationMatches,
} from './citationResolution.js';
import type { CitationBankEntry, CitationResolutionDiagnostics } from './citationResolution.js';
import type { DocMetaMap } from './evidenceFromSummaries.js';
import { sanitizeNodeIds } from './nodeIdUtils.js';

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
  /** Map of doc_id → human-readable document title for evidence citations. */
  docTitles?: import('./evidenceFromSummaries.js').DocTitleMap;
  /** Policy registry for citation bank building. */
  policyRegistry?: Array<{ id: string; action: string }>;
  /** Frozen Brief from a prior pipeline run — skips Brief stage when provided. */
  frozenBrief?: BriefWorkProduct;
  /** Frozen Plan from a prior pipeline run — skips Plan stage when provided. */
  frozenPlan?: PlanWorkProduct;
  /** Frozen Draft from a prior pipeline run — skips Draft stage when provided (cite-only retry). */
  frozenDraft?: DraftWorkProduct;
  /** Frozen evidence block from a prior pipeline run — skips evidence retrieval when provided. */
  frozenEvidenceBlock?: string;
  /** Opponent-aware strategic hints computed from AN/commitments. */
  strategicHints?: string[];
  /** Strong claims to base the argument on — injected into Plan stage as foundations. */
  strongFoundations?: { text: string; marginal_delta: number; base_strength: number; reason: string }[];
  /** Weak claims to avoid using — injected into Plan stage with reasons. */
  avoidClaims?: { text: string; marginal_delta: number; base_strength: number; reason: string }[];
  /** Concession claims to preserve — injected into Plan stage as claims to keep. */
  preserveConcessions?: { text: string; reason: string }[];
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
    strategicHints: input.strategicHints,
    strongFoundations: input.strongFoundations,
    avoidClaims: input.avoidClaims,
    preserveConcessions: input.preserveConcessions,
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

// ── Provenance tagging ──────────────────────────────────

/** Stamp provenance metadata onto a parsed work product. */
function tagProvenance<T>(
  product: T,
  prov: StageProvenance,
): T {
  (product as Record<string, unknown>)._provenance = prov;
  return product;
}

/** Serialize a work product to JSON for downstream prompt injection, stripping _provenance. */
function toPromptJson(product: unknown): string {
  return JSON.stringify(product, (key, value) => key === '_provenance' ? undefined : value, 2);
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
  const isOuterRetry = (input.repairHints?.length ?? 0) > 0;

  // ── Stage 1: BRIEF ──
  let brief: BriefWorkProduct;
  let briefJson: string;
  let t0: number;
  let elapsed: number;

  if (input.frozenBrief) {
    // Frozen from prior pipeline run — skip generation, reuse output
    brief = input.frozenBrief;
    briefJson = toPromptJson(brief);
    console.log(`[pipeline] Brief stage FROZEN — reusing prior output`);
  } else {
    onProgress?.('brief', `${input.label} is briefing...`);
    getGlobalRecorder()?.record({
      type: 'turn.stage', component: 'turnPipeline', level: 'info',
      speaker: input.label, debate_id: (input as any).debate_id, turn_id: (input as any).turn_id,
      message: `${input.label} entering BRIEF stage`,
      data: { stage: 'brief', action: 'enter' },
    });
    let briefPrompt: string;
    let briefRaw: string;
    t0 = Date.now();
    if (envelopeGenerate) {
      const env = briefStageEnvelope(stageInput);
      briefPrompt = flattenEnvelope(env);
      const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.brief_temperature } }, `${input.label} brief`);
      briefRaw = resp.text;
    } else {
      briefPrompt = briefStagePrompt(stageInput);
      briefRaw = await generate(briefPrompt, input.model, { temperature: temps.brief_temperature }, `${input.label} brief`);
    }
    elapsed = Date.now() - t0;
    const briefParsed = parseStageResponse<BriefWorkProduct>(briefRaw, 'brief');
    stageDiags.push({
      stage: 'brief', prompt: briefPrompt, raw_response: briefRaw,
      model: input.model, temperature: temps.brief_temperature,
      response_time_ms: elapsed, work_product: briefParsed.product as unknown as Record<string, unknown>,
      parse_error: briefParsed.error,
      retry_trigger: isOuterRetry ? 'orchestration-rerun' : 'initial',
    });
    if (briefParsed.error) {
      throw new ActionableError({
        goal: 'Run debate turn pipeline',
        problem: `Brief stage failed to parse — downstream stages would operate on empty context. ${briefParsed.error}`,
        location: 'turnPipeline.runPipeline',
        nextSteps: ['Check the AI model response quality', 'Try a different model'],
      });
    }
    brief = tagProvenance(briefParsed.product, {
      pipeline_run: isOuterRetry ? 1 : 0,
      stage: 'brief', attempt: 0,
      model: input.model, timestamp: new Date().toISOString(),
    });
    briefJson = toPromptJson(brief);
    getGlobalRecorder()?.record({
      type: 'turn.stage', component: 'turnPipeline', level: 'info',
      speaker: input.label, duration_ms: elapsed,
      message: `${input.label} completed BRIEF stage`,
      data: { stage: 'brief', action: 'exit', duration_ms: elapsed },
    });
  }

  // ── Stage 1.5: BRIEF node ID sanitization ──
  // LLMs sometimes hallucinate node ID prefixes (e.g., sit-cc-040 instead of cc-040).
  // Validate and correct all node IDs in the BRIEF output BEFORE they cascade into PLAN/DRAFT/CITE.
  const knownNodeIds = new Set(input.availablePovNodeIds ?? []);
  if (knownNodeIds.size > 0 && brief.key_claims_to_address) {
    let briefCorrected = false;
    for (const claim of brief.key_claims_to_address) {
      if (!claim.grounding?.length) continue;
      const groundingIds = claim.grounding.map(g => g.node_id);
      const result = sanitizeNodeIds(groundingIds, knownNodeIds);
      if (result.corrections.length > 0 || result.removed.length > 0) {
        briefCorrected = true;
        for (const c of result.corrections) {
          console.log(`[pipeline] Brief ID correction: ${c.from} → ${c.to}`);
        }
        for (const r of result.removed) {
          console.log(`[pipeline] Brief ID removed (unknown): ${r}`);
        }
        // Rebuild grounding with corrected IDs only
        claim.grounding = claim.grounding
          .map(g => {
            const correction = result.corrections.find(c => c.from === g.node_id);
            if (correction) return { ...g, node_id: correction.to };
            if (result.removed.includes(g.node_id)) return null;
            return g;
          })
          .filter((g): g is NonNullable<typeof g> => g !== null);
      }
    }
    if (briefCorrected) {
      // Re-serialize so downstream stages (PLAN/DRAFT) see the corrected IDs
      briefJson = toPromptJson(brief);
    }
  }

  // ── Stage 2: PLAN (with per-stage validation + retry) ──
  // If repairHints are provided, this is an outer retry — skip per-stage retries
  // to avoid compounding (outer retry already re-runs the full pipeline).
  const MAX_STAGE_RETRIES = isOuterRetry ? 0 : 1;
  const isFirstRound = (input.priorMoves ?? []).length === 0;
  let plan: PlanWorkProduct | undefined;
  let planJson = '';

  if (input.frozenPlan) {
    // Frozen from prior pipeline run — skip generation, reuse output
    plan = input.frozenPlan;
    planJson = toPromptJson(plan);
    console.log(`[pipeline] Plan stage FROZEN — reusing prior output`);
  } else {
    let planRepairHints: string[] = [];
    for (let planAttempt = 0; planAttempt <= MAX_STAGE_RETRIES; planAttempt++) {
      onProgress?.('plan', `${input.label} is planning${planAttempt > 0 ? ` (retry ${planAttempt})` : ''}...`);
      getGlobalRecorder()?.record({
        type: 'turn.stage', component: 'turnPipeline', level: 'info',
        speaker: input.label,
        message: `${input.label} entering PLAN stage (attempt ${planAttempt})`,
        data: { stage: 'plan', action: 'enter', attempt: planAttempt },
      });
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
        retry_trigger: isOuterRetry ? 'orchestration-rerun' : planAttempt > 0 ? 'stage-retry' : 'initial',
        repair_hints_in: planRepairHints.length > 0 ? planRepairHints : undefined,
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
        (lastPlanDiag as Record<string, unknown>).validation_failed = true;
        (lastPlanDiag as Record<string, unknown>).validation_errors = [...planVal.errorHints];
        getGlobalRecorder()?.record({
          type: 'turn.repair', component: 'turnPipeline', level: 'warn',
          speaker: input.label,
          message: `PLAN repair attempt ${planAttempt}: ${planVal.errorHints.length} error(s)`,
          data: { stage: 'plan', attempt: planAttempt, hints: planVal.errorHints },
        });
        console.log(`[pipeline] Plan validation errors (attempt ${planAttempt}), retrying: ${planVal.errorHints.join('; ')}`);
        continue;
      }

      plan = tagProvenance(planParsed.product, {
        pipeline_run: isOuterRetry ? 1 : 0,
        stage: 'plan', attempt: planAttempt,
        model: input.model, timestamp: new Date().toISOString(),
      });
      planJson = toPromptJson(plan);
      getGlobalRecorder()?.record({
        type: 'turn.stage', component: 'turnPipeline', level: 'info',
        speaker: input.label, duration_ms: elapsed,
        message: `${input.label} completed PLAN stage (attempt ${planAttempt})`,
        data: { stage: 'plan', action: 'exit', attempt: planAttempt, duration_ms: elapsed },
      });
      break;
    }
  }
  if (!plan) {
    plan = {} as PlanWorkProduct;
    planJson = '{}';
  }

  // ── Stage 2.1: PLAN target_nodes sanitization ──
  // Same as BRIEF — validate target_nodes against knownNodeIds before DRAFT/CITE.
  if (knownNodeIds.size > 0 && plan.target_nodes?.length) {
    const planIdResult = sanitizeNodeIds(plan.target_nodes, knownNodeIds);
    if (planIdResult.corrections.length > 0 || planIdResult.removed.length > 0) {
      for (const c of planIdResult.corrections) {
        console.log(`[pipeline] Plan target_nodes correction: ${c.from} → ${c.to}`);
      }
      for (const r of planIdResult.removed) {
        console.log(`[pipeline] Plan target_nodes removed (unknown): ${r}`);
      }
      plan.target_nodes = planIdResult.sanitized;
      planJson = toPromptJson(plan);
    }
  }

  // ── Stages 2.5–3.5: EVIDENCE → DRAFT → PRE-CHECK ──
  // When frozenDraft is provided, skip evidence retrieval, draft generation,
  // linkification, citation verification, and quality pre-check entirely.
  let draft: DraftWorkProduct | undefined;
  let draftJson = '';
  let evidenceBlock = '';

  if (input.frozenDraft) {
    draft = input.frozenDraft;
    draftJson = toPromptJson(draft);
    evidenceBlock = input.frozenEvidenceBlock ?? '';
    console.log(`[pipeline] Draft stage FROZEN — reusing prior output (skipping evidence, linkification, pre-check)`);
  } else {

  // ── Stage 2.5: EVIDENCE (deterministic — no LLM call) ──
  // Retrieve source document evidence for the plan's target nodes.
  // Produces a compact evidence brief injected into the DRAFT prompt.
  if (input.frozenEvidenceBlock != null) {
    evidenceBlock = input.frozenEvidenceBlock;
    console.log(`[pipeline] Evidence stage FROZEN — reusing prior output (${evidenceBlock.length} chars)`);
  } else if (input.sourceEvidenceIndex && plan.target_nodes && plan.target_nodes.length > 0) {
    try {
      const { retrieveSourceEvidence } = await import('./evidenceFromSummaries.js');
      const evidenceBrief = retrieveSourceEvidence(
        plan.target_nodes as string[],
        input.pov,
        input.sourceEvidenceIndex,
        3, // max facts
        2, // max key points
        input.docTitles,
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

  // ── Stage 2.6: CITATION BANK (deterministic — no LLM call) ──
  // Build citation bank from evidence index for citation validation.
  // Path A (all backends for now): inject bank into prompt + post-draft scrub.
  // Path B (gemini/claude tool-calling) requires multi-turn provider support — future enhancement.
  let citationBank: CitationBankEntry[] = [];
  let citationBankBlock = '';
  const citationBackend = resolveBackend(input.model);
  const citationPathIntended = (citationBackend === 'gemini' || citationBackend === 'claude') ? 'B' : 'A';
  const citationPathUsed: 'tool-calling' | 'bank-scrub' = 'bank-scrub'; // Path B requires multi-turn provider support (future)
  let citationBankBuildTime = 0;

  if (input.sourceEvidenceIndex) {
    try {
      const bankT0 = Date.now();
      const docMeta: DocMetaMap = {};
      if (input.docTitles) {
        for (const [id, entry] of Object.entries(input.docTitles)) {
          docMeta[id] = typeof entry === 'string' ? { title: entry } : entry;
        }
      }
      citationBank = buildCitationBank(input.sourceEvidenceIndex, docMeta, input.policyRegistry);
      citationBankBuildTime = Date.now() - bankT0;
      if (citationBank.length > 0) {
        citationBankBlock = '\n\n' + formatCitationBank(citationBank);
        console.log(`[pipeline] Citation bank built: ${citationBank.length} entries, path=${citationPathUsed} (intended=${citationPathIntended}), ${citationBankBuildTime}ms`);
      }
    } catch (err) {
      console.warn(`[pipeline] Citation bank build failed: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
    }
  }

  // ── Stage 3: DRAFT (with per-stage validation + retry) ──
  let draftRepairHints: string[] = input.repairHints?.filter(h =>
    !/taxonomy_refs.*(?:filler|too-short|relevance)|No new taxonomy_refs|Unknown taxonomy node|Unknown policy_refs|grounding_confidence/i.test(h)
  ) ?? [];

  const MAX_DRAFT_RETRIES = isOuterRetry ? 0 : 2; // directive failures get up to 2 retries (3 attempts)
  for (let draftAttempt = 0; draftAttempt <= MAX_DRAFT_RETRIES; draftAttempt++) {
    onProgress?.('draft', `${input.label} is drafting${draftAttempt > 0 ? ` (retry ${draftAttempt})` : ''}...`);
    getGlobalRecorder()?.record({
      type: 'turn.stage', component: 'turnPipeline', level: 'info',
      speaker: input.label,
      message: `${input.label} entering DRAFT stage (attempt ${draftAttempt})`,
      data: { stage: 'draft', action: 'enter', attempt: draftAttempt },
    });
    let draftPromptText: string;
    let draftRaw: string;
    t0 = Date.now();
    // Build targeted repair block from prior failure — translates hints into
    // specific prompt modifications placed in the recency window, not generic appendix.
    const failedDraftStatement = draftRepairHints.length > 0 && draft?.statement ? draft.statement : undefined;
    // Field-level freeze: when hints target only specific fields, instruct the LLM
    // to preserve unflagged fields from the prior draft (prevents unnecessary regression).
    const targetedFields = draftRepairHints.length > 0 ? classifyDraftHintFields(draftRepairHints) : new Set<DraftField>();
    const repairBlock = buildRepairBlock(draftRepairHints, failedDraftStatement, draft, targetedFields);
    const fieldFreezeBlock = draft && targetedFields.size > 0 && targetedFields.size < ALL_DRAFT_FIELDS.length
      ? buildFieldFreezeBlock(draft, targetedFields)
      : '';

    if (envelopeGenerate) {
      const env = draftStageEnvelope(stageInput, briefJson, planJson);
      // Inject repair block first (corrections from prior attempt)
      if (repairBlock) {
        env.layer4_variable = env.layer4_variable.replace(
          /Respond ONLY with a JSON/,
          `${repairBlock}\nRespond ONLY with a JSON`,
        );
        if (!env.layer4_variable.includes('CORRECTIONS REQUIRED') && !env.layer4_variable.includes('MANDATORY CORRECTION')) {
          env.layer4_variable += repairBlock;
        }
      }
      // Inject field-freeze block (preserve unflagged fields from prior draft)
      if (fieldFreezeBlock) {
        env.layer4_variable = env.layer4_variable.replace(
          /Respond ONLY with a JSON/,
          `${fieldFreezeBlock}\nRespond ONLY with a JSON`,
        );
      }
      // Inject source evidence — right before the output schema (Lost-in-the-Middle mitigation)
      if (evidenceBlock) {
        env.layer4_variable = env.layer4_variable.replace(
          /Respond ONLY with a JSON/,
          `${evidenceBlock}\n\nYou MUST cite at least one source from the evidence above by title in your statement.\n\nRespond ONLY with a JSON`,
        );
      }
      // Inject citation bank after evidence (constrains LLM to verified sources)
      if (citationBankBlock) {
        env.layer4_variable = env.layer4_variable.replace(
          /Respond ONLY with a JSON/,
          `${citationBankBlock}\n\nRespond ONLY with a JSON`,
        );
      }
      draftPromptText = flattenEnvelope(env);
      const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.draft_temperature } }, `${input.label} draft`);
      draftRaw = resp.text;
    } else {
      draftPromptText = draftStagePrompt(stageInput, briefJson, planJson);
      // Inject repair block first
      if (repairBlock) {
        draftPromptText = draftPromptText.replace(
          /Respond ONLY with a JSON/,
          `${repairBlock}\nRespond ONLY with a JSON`,
        );
        if (!draftPromptText.includes('CORRECTIONS REQUIRED') && !draftPromptText.includes('MANDATORY CORRECTION')) {
          draftPromptText += repairBlock;
        }
      }
      // Inject field-freeze block (preserve unflagged fields from prior draft)
      if (fieldFreezeBlock) {
        draftPromptText = draftPromptText.replace(
          /Respond ONLY with a JSON/,
          `${fieldFreezeBlock}\nRespond ONLY with a JSON`,
        );
      }
      // Inject source evidence — right before the output schema
      if (evidenceBlock) {
        draftPromptText = draftPromptText.replace(
          /Respond ONLY with a JSON/,
          `${evidenceBlock}\n\nYou MUST cite at least one source from the evidence above by title in your statement.\n\nRespond ONLY with a JSON`,
        );
      }
      // Inject citation bank after evidence (constrains LLM to verified sources)
      if (citationBankBlock) {
        draftPromptText = draftPromptText.replace(
          /Respond ONLY with a JSON/,
          `${citationBankBlock}\n\nRespond ONLY with a JSON`,
        );
      }
      draftRaw = await generate(draftPromptText, input.model, { temperature: temps.draft_temperature }, `${input.label} draft`);
    }
    elapsed = Date.now() - t0;
    const priorDraft = draft; // save before reassign for field-level merge
    const draftParsed = parseStageResponse<DraftWorkProduct>(draftRaw, 'draft');

    // Fallback: if JSON parse failed but raw has substantial text, use it as the statement.
    // The LLM sometimes produces prose instead of JSON — salvage the content.
    if (draftParsed.error && !draftParsed.product.statement && draftRaw.length > 100) {
      // Strip markdown fences if present
      let salvaged = draftRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      // If it starts with a quote or letter (not { ), it's prose — use it directly
      if (salvaged.length > 50 && !salvaged.startsWith('{')) {
        draftParsed.product.statement = salvaged;
        console.log(`[pipeline] Draft JSON parse failed — salvaged ${salvaged.length} chars of prose as statement`);
      }
    }
    stageDiags.push({
      stage: 'draft', prompt: draftPromptText, raw_response: draftRaw,
      model: input.model, temperature: temps.draft_temperature,
      response_time_ms: elapsed, work_product: draftParsed.product as unknown as Record<string, unknown>,
      parse_error: draftParsed.error,
      retry_trigger: draftAttempt === 0 && !isOuterRetry ? 'initial' : draftAttempt > 0 ? 'stage-retry' : 'orchestration-rerun',
      repair_hints_in: draftRepairHints.length > 0 ? [...draftRepairHints] : undefined,
    });
    draft = tagProvenance(draftParsed.product, {
      pipeline_run: isOuterRetry ? 1 : 0,
      stage: 'draft', attempt: draftAttempt,
      model: input.model, timestamp: new Date().toISOString(),
    });

    // Merge frozen fields from prior draft to guarantee stability —
    // LLMs don't always follow field-freeze instructions perfectly.
    if (draft && priorDraft && fieldFreezeBlock) {
      draft = mergeFrozenDraftFields(draft, priorDraft, targetedFields);
      console.log(`[pipeline] Draft field-level merge: froze ${ALL_DRAFT_FIELDS.filter(f => !targetedFields.has(f)).join(', ')}, regenerated ${[...targetedFields].join(', ')}`);
    }

    // Backfill empty claim_sketches targets from prior draft — LLMs drop AN-ID
    // targets when regenerating claims because they focus on text, not ID mappings.
    if (draft?.claim_sketches && priorDraft?.claim_sketches) {
      let backfilled = 0;
      for (const claim of draft.claim_sketches) {
        if (!claim.targets || claim.targets.length === 0) {
          // Find best-matching prior claim by text overlap
          const best = priorDraft.claim_sketches
            .filter(pc => pc.targets && pc.targets.length > 0)
            .map(pc => ({ pc, overlap: wordOverlap(claim.claim, pc.claim) }))
            .sort((a, b) => b.overlap - a.overlap)[0];
          if (best && best.overlap >= 0.3) {
            claim.targets = best.pc.targets;
            backfilled++;
          }
        }
      }
      if (backfilled > 0) console.log(`[pipeline] Backfilled ${backfilled} claim target(s) from prior draft`);
    }

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
        details: draftVal.details,
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
        const lastDraftDiag = stageDiags[stageDiags.length - 1];
        (lastDraftDiag as Record<string, unknown>).validation_failed = true;
        (lastDraftDiag as Record<string, unknown>).validation_errors = [...draftRepairHints];
        getGlobalRecorder()?.record({
          type: 'turn.repair', component: 'turnPipeline', level: 'warn',
          speaker: input.label,
          message: `DRAFT repair attempt ${draftAttempt}: ${draftRepairHints.length} hint(s)`,
          data: { stage: 'draft', attempt: draftAttempt, hints: draftRepairHints },
        });
        console.log(`[pipeline] Draft validation feedback (attempt ${draftAttempt}), retrying: ${draftRepairHints.join('; ')}`);
        continue;
      }
    }
    // ── PLAN→DRAFT move consistency check (warning only) ──
    // Compare draft's actual moves against plan's intended moves.
    // This is a quality signal — the LLM sometimes ignores the plan.
    if (draft?.move_types && plan?.planned_moves?.length) {
      const plannedMoves = plan.planned_moves.map(pm => resolveMoveName(pm.move));
      const draftMoves = (draft.move_types as Array<string | { move: string }>).map(mt => resolveMoveName(getMoveName(mt)));
      const plannedSet = new Set(plannedMoves);
      const draftSet = new Set(draftMoves);
      const missingFromDraft = plannedMoves.filter(m => !draftSet.has(m));
      const addedInDraft = draftMoves.filter(m => !plannedSet.has(m));
      if (missingFromDraft.length > 0 || addedInDraft.length > 0) {
        const lastDraftDiag = stageDiags[stageDiags.length - 1];
        const moveConsistency = {
          planned: plannedMoves,
          actual: draftMoves,
          missing: missingFromDraft,
          added: addedInDraft,
        };
        (lastDraftDiag as Record<string, unknown>).move_consistency = moveConsistency;
        console.log(`[pipeline] PLAN→DRAFT move divergence: planned=[${plannedMoves.join(',')}] actual=[${draftMoves.join(',')}] missing=[${missingFromDraft.join(',')}] added=[${addedInDraft.join(',')}]`);
      }
    }

    // Draft passed validation — clear repair hints so they don't persist
    // as stale noise into subsequent orchestration retry cycles.
    draftRepairHints = [];
    break;
  }
  // ── Post-draft citation scrub ──
  // Deterministically remove fabricated citations not in the citation bank.
  let citationScrubResult: import('./citationResolution.js').ScrubResult | undefined;
  let citationScrubOriginal: string | undefined;
  if (citationBank.length > 0 && draft?.statement) {
    citationScrubOriginal = draft.statement; // preserve pre-scrub text for Diff Viewer
    const scrub = scrubCitations(draft.statement, citationBank);
    if (scrub.removed.length > 0) {
      draft.statement = scrub.cleanedDraft;
      citationScrubResult = scrub;
      console.log(`[pipeline] Citation scrub: removed ${scrub.removed.length} fabricated citation(s): ${scrub.removed.join(', ')}`);
    }
  }

  draftJson = toPromptJson(draft);

  // ── Post-draft linkification: replace title mentions with clickable links ──
  let linkificationApplied = false;
  let preLinkStatement = '';
  if (draft?.statement && input.docTitles) {
    preLinkStatement = draft.statement;
    const { linkifyEvidenceCitations } = await import('./evidenceFromSummaries.js');
    draft.statement = linkifyEvidenceCitations(draft.statement, input.docTitles);
    linkificationApplied = draft.statement !== preLinkStatement;
  }

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
      const docMeta = input.docTitles;
      const citedDocs: Array<{ doc_id: string; title?: string; match_type: string }> = [];
      for (const docId of allDocIds) {
        const slug = docId.replace(/-\d{4}(-\d+)?$/, '').replace(/-/g, ' ');
        const entry = docMeta?.[docId];
        const title = typeof entry === 'string' ? entry : entry?.title;
        const titleLower = title?.toLowerCase();
        const resolvedUrl = typeof entry === 'object' ? entry?.resolved_url : undefined;
        // Check for markdown link pattern: [Title](url)
        if (resolvedUrl && draft.statement.includes(`](${resolvedUrl})`)) {
          citedDocs.push({ doc_id: docId, title, match_type: 'markdown_link' });
        } else if (statementLower.includes(docId)) {
          citedDocs.push({ doc_id: docId, title, match_type: 'exact_id' });
        } else if (statementLower.includes(slug)) {
          citedDocs.push({ doc_id: docId, title, match_type: 'slug' });
        } else if (titleLower && statementLower.includes(titleLower)) {
          citedDocs.push({ doc_id: docId, title, match_type: 'title_exact' });
        } else if (titleLower) {
          const titleWords = titleLower.split(/\s+/).filter(w => w.length > 3);
          if (titleWords.length >= 3) {
            const trigram = titleWords.slice(0, 4).join(' ');
            if (statementLower.includes(trigram)) {
              citedDocs.push({ doc_id: docId, title, match_type: 'title_partial' });
            }
          }
        }
      }
      const utilizationRate = allDocIds.length > 0 ? citedDocs.length / allDocIds.length : 0;
      (wp as Record<string, unknown>).evidence_utilization = {
        total_docs: allDocIds.length,
        cited_docs: citedDocs,
        utilization_rate: Math.round(utilizationRate * 100),
      };
      // Build per-doc citation pipeline trace
      const docMetaForPipeline = input.docTitles;
      const pipelineTrace = allDocIds.map(docId => {
        const metaEntry = docMetaForPipeline?.[docId];
        const meta = typeof metaEntry === 'string' ? { title: metaEntry } : metaEntry;
        const cited = citedDocs.find(cd => cd.doc_id === docId);
        return {
          doc_id: docId,
          resolved_title: meta?.title ?? docId,
          resolved_url: (meta as { resolved_url?: string })?.resolved_url ?? null,
          url_type: (() => {
            const url = (meta as { resolved_url?: string })?.resolved_url ?? '';
            if (url.includes('doi.org')) return 'doi';
            if (url.includes('arxiv.org')) return 'arxiv';
            if (url.includes('ssrn.com')) return 'ssrn';
            if (url.includes('scholar.google')) return 'scholar_fallback';
            if (url.includes('google.com/search')) return 'google_fallback';
            if (url) return 'direct';
            return 'none';
          })(),
          provenance_label: (meta as { provenance_label?: string })?.provenance_label ?? null,
          cited: !!cited,
          match_type: cited?.match_type ?? null,
          linkified: linkificationApplied && cited?.match_type !== null,
        };
      });
      (wp as Record<string, unknown>).citation_pipeline = pipelineTrace;

      if (citedDocs.length > 0) {
        console.log(`[pipeline] Evidence utilization: ${citedDocs.length}/${allDocIds.length} source docs cited (${Math.round(utilizationRate * 100)}%)`);
      } else {
        console.log(`[pipeline] Evidence utilization: 0/${allDocIds.length} — debater did not cite any source documents from evidence brief`);
      }
    }
  }

  // ── Ungrounded claims detection ──
  // Find specific factual claims in the statement that don't match any source in the
  // evidence block or evidence index. These are from the LLM's parametric knowledge.
  if (draft?.statement) {
    const evidenceDiagForGrounding = stageDiags.find(d => d.stage === 'evidence');
    const evidenceWpForGrounding = evidenceDiagForGrounding?.work_product as Record<string, unknown> | undefined;

    // Build a set of "grounded" text fragments from the evidence
    const groundedFragments = new Set<string>();
    const evidenceFacts = (evidenceWpForGrounding?.facts as Array<{ claim?: string }>) ?? [];
    const evidenceKPs = (evidenceWpForGrounding?.keyPoints as Array<{ point?: string; verbatim?: string }>) ?? [];
    for (const f of evidenceFacts) {
      if (f.claim) {
        // Extract key phrases (3+ word sequences with a named entity or number)
        const words = f.claim.toLowerCase().split(/\s+/);
        for (let w = 0; w <= words.length - 4; w++) {
          groundedFragments.add(words.slice(w, w + 4).join(' '));
        }
      }
    }
    for (const kp of evidenceKPs) {
      for (const text of [kp.point, kp.verbatim]) {
        if (!text) continue;
        const words = text.toLowerCase().split(/\s+/);
        for (let w = 0; w <= words.length - 4; w++) {
          groundedFragments.add(words.slice(w, w + 4).join(' '));
        }
      }
    }

    // Extract specific factual assertions from the statement
    // (sentences with named entities, numbers, dates, or specific references)
    const sentences = draft.statement
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.length > 30);

    const specificPattern = /(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+.*(?:study|report|found|showed|documented|revealed))|(?:(?:a|the)\s+\d{4}\s+(?:study|report|survey|analysis))|(?:[A-Z][a-z]+'s?\s+(?:scrapped|hiring|recruiting|algorithm))/;

    const ungroundedClaims: Array<{ claim: string; reason: string }> = [];
    for (const sentence of sentences) {
      if (!specificPattern.test(sentence)) continue;

      // Check if any 4-word sequence from this sentence matches the evidence
      const sentWords = sentence.toLowerCase().split(/\s+/);
      let isGrounded = false;
      for (let w = 0; w <= sentWords.length - 4; w++) {
        if (groundedFragments.has(sentWords.slice(w, w + 4).join(' '))) {
          isGrounded = true;
          break;
        }
      }

      if (!isGrounded) {
        ungroundedClaims.push({
          claim: sentence.length > 150 ? sentence.slice(0, 147) + '...' : sentence,
          reason: 'Not found in evidence block or source corpus — from model general knowledge',
        });
      }
    }

    if (ungroundedClaims.length > 0) {
      // Store on the evidence work product for diagnostics
      const evidenceWpToUpdate = evidenceDiagForGrounding?.work_product as Record<string, unknown> | undefined;
      if (evidenceWpToUpdate) {
        evidenceWpToUpdate.ungrounded_claims = ungroundedClaims;
      }
      console.log(`[pipeline] Ungrounded claims: ${ungroundedClaims.length} factual assertions not traceable to source corpus`);
    }
  }

  // ── Post-draft citation validation (both paths) ──
  // Validate all citation-like strings against the bank.
  // Warnings are recorded in diagnostics for the UI/judge.
  let citationWarnings: string[] = [];
  if (citationBank.length > 0 && draft?.statement) {
    const warnings = validateCitationsAgainstBank(draft.statement, citationBank);
    if (warnings.length > 0) {
      citationWarnings = warnings.map(w => `${w.citation}: ${w.reason}`);
      console.log(`[pipeline] Citation validation: ${warnings.length} warning(s): ${citationWarnings.join('; ')}`);
    }
  }

  // Record rich citation resolution diagnostics on the draft stage diagnostic
  if (citationBank.length > 0) {
    const draftDiag = [...stageDiags].reverse().find(d => d.stage === 'draft');
    if (draftDiag) {
      const citationResolutionT0 = Date.now();
      const citationMatches = draft?.statement
        ? extractCitationMatches(draft.statement, citationBank)
        : [];
      const citationFabrications = citationScrubResult?.fabrications ?? [];
      const citationResolutionTime = citationBankBuildTime + (Date.now() - citationResolutionT0);

      const diagnostics: CitationResolutionDiagnostics = {
        path: citationPathUsed,
        bank_size: citationBank.length,
        bank_sources: citationBank.map(e => e.doc_id),
        citations_extracted: citationMatches.length + citationFabrications.length,
        citations_matched: citationMatches.length,
        citations_fabricated: citationFabrications.length,
        resolution_time_ms: citationResolutionTime,
        matches: citationMatches,
        fabrications: citationFabrications,
        warnings: citationWarnings,
      };

      // Path A scrub diff
      if (citationScrubOriginal && citationScrubResult) {
        const origLines = citationScrubOriginal.split('\n');
        const cleanedLines = citationScrubResult.cleanedDraft.split('\n');
        let linesRemoved = 0;
        let linesModified = 0;
        const maxLen = Math.max(origLines.length, cleanedLines.length);
        for (let li = 0; li < maxLen; li++) {
          if (li >= cleanedLines.length) { linesRemoved++; continue; }
          if (li >= origLines.length) continue;
          if (origLines[li] !== cleanedLines[li]) linesModified++;
        }
        diagnostics.scrub_diff = {
          lines_removed: linesRemoved,
          lines_modified: linesModified,
          original_length: citationScrubOriginal.length,
          cleaned_length: citationScrubResult.cleanedDraft.length,
        };
        diagnostics.scrub_original = citationScrubOriginal;
      }

      (draftDiag as Record<string, unknown>).citation_resolution = diagnostics;
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
      plan?.planned_moves,
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
          // Inject citation bank in quality retry
          if (citationBankBlock) {
            env.layer4_variable = env.layer4_variable.replace(
              /Respond ONLY with a JSON/,
              `${citationBankBlock}\n\nRespond ONLY with a JSON`,
            );
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
          // Inject citation bank in quality retry
          if (citationBankBlock) {
            retryDraftPrompt = retryDraftPrompt.replace(
              /Respond ONLY with a JSON/,
              `${citationBankBlock}\n\nRespond ONLY with a JSON`,
            );
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
          draft = tagProvenance(retryDraftParsed.product, {
            pipeline_run: isOuterRetry ? 1 : 0,
            stage: 'draft', attempt: 1, // quality retry is always attempt 1
            model: input.model, timestamp: new Date().toISOString(),
          });
          draftJson = toPromptJson(draft);
          console.log(`[pipeline] Draft quality retry produced new draft`);
        }
      }
    } catch (err) {
      // Pre-check failure is non-fatal — proceed to cite
      console.warn(`[pipeline] Draft quality pre-check failed: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
    }
  }

  } // end frozenDraft else

  // ── Stage 4: CITE (with per-stage validation + retry) ──
  let citeRepairHints: string[] = input.repairHints?.filter(h =>
    /taxonomy_refs.*(?:filler|too-short|relevance)|No new taxonomy_refs|Unknown taxonomy node|Unknown policy_refs|grounding_confidence/i.test(h)
  ) ?? [];
  let citeParsed: ReturnType<typeof parseStageResponse<CiteWorkProduct>>;

  for (let citeAttempt = 0; citeAttempt <= MAX_STAGE_RETRIES; citeAttempt++) {
    onProgress?.('cite', `${input.label} is citing${citeAttempt > 0 ? ` (retry ${citeAttempt})` : ''}...`);
    getGlobalRecorder()?.record({
      type: 'turn.stage', component: 'turnPipeline', level: 'info',
      speaker: input.label,
      message: `${input.label} entering CITE stage (attempt ${citeAttempt})`,
      data: { stage: 'cite', action: 'enter', attempt: citeAttempt },
    });
    let citePromptText: string;
    let citeRaw: string;
    t0 = Date.now();
    if (envelopeGenerate) {
      const env = citeStageEnvelope(stageInput, planJson, draftJson);
      if (citeRepairHints.length > 0) {
        env.layer4_variable += `\n\n=== CITATION REPAIR HINTS (from prior failed attempt) ===\n${citeRepairHints.map(h => '- ' + h).join('\n')}\nAddress these issues in your taxonomy references.`;
      }
      citePromptText = flattenEnvelope(env);
      const resp = await envelopeGenerate({ envelope: env, model: input.model, options: { temperature: temps.cite_temperature } }, `${input.label} cite`);
      citeRaw = resp.text;
    } else {
      citePromptText = citeStagePrompt(stageInput, planJson, draftJson);
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
      retry_trigger: isOuterRetry ? 'orchestration-rerun' : citeAttempt > 0 ? 'stage-retry' : 'initial',
      repair_hints_in: citeRepairHints.length > 0 ? [...citeRepairHints] : undefined,
    });

    // Per-stage cite validation
    if (citeParsed.product) {
      const citeVal = validateCiteStage({
        taxonomyRefs: (citeParsed.product.taxonomy_refs ?? []) as import('./types.js').TaxonomyRef[],
        policyRefs: citeParsed.product.policy_refs as (string | { policy_id: string; relevance?: string })[] | undefined,
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
        const lastCiteDiag = stageDiags[stageDiags.length - 1];
        (lastCiteDiag as Record<string, unknown>).validation_failed = true;
        (lastCiteDiag as Record<string, unknown>).validation_errors = [...citeVal.errorHints];
        getGlobalRecorder()?.record({
          type: 'turn.repair', component: 'turnPipeline', level: 'warn',
          speaker: input.label,
          message: `CITE repair attempt ${citeAttempt}: ${citeVal.errorHints.length} error(s)`,
          data: { stage: 'cite', attempt: citeAttempt, hints: citeVal.errorHints },
        });
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
    evidenceBlock,
    stage_diagnostics: stageDiags,
    total_time_ms: Date.now() - pipelineStart,
  };
}

/** Extract PoverResponseMeta-compatible object from DraftWorkProduct for validation. */
function extractDraftMeta(draft: DraftWorkProduct): PoverResponseMeta {
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

/** Cached codename→label regex pairs, built once from POVER_INFO. The
 *  pre-check / validator LLMs sometimes refer to speakers by internal codename
 *  (prometheus / sentinel / cassandra) instead of the public label
 *  (Accelerationist / Safetyist / Skeptic) the debater sees everywhere else.
 *  Normalize so corrections are always in the speaker's own vocabulary. */
const SPEAKER_RENAME_PATTERNS: { pattern: RegExp; label: string }[] = Object.entries(POVER_INFO)
  .map(([codename, info]) => ({
    pattern: new RegExp(`\\b${codename}\\b`, 'gi'),
    label: info.label,
  }));

function normalizeSpeakerNames(text: string): string {
  let out = text;
  for (const { pattern, label } of SPEAKER_RENAME_PATTERNS) {
    out = out.replace(pattern, label);
  }
  return out;
}

// ── Draft field-level freeze for per-stage retries ───────

/** DraftWorkProduct fields that can be individually frozen on retry. */
type DraftField = 'statement' | 'claim_sketches' | 'key_assumptions' | 'turn_symbols'
  | 'disagreement_type' | 'commitment' | 'position_update';

const ALL_DRAFT_FIELDS: DraftField[] = [
  'statement', 'claim_sketches', 'key_assumptions', 'turn_symbols',
  'disagreement_type', 'commitment', 'position_update',
];

/** Map repair hint patterns to the DraftWorkProduct fields they target.
 *  Returns the set of fields that need regeneration — everything else can be frozen. */
function classifyDraftHintFields(hints: string[]): Set<DraftField> {
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
    if (/disagreement_type/i.test(h)) {
      targeted.add('disagreement_type');
    }
    if (/key_assumptions/i.test(h)) {
      targeted.add('key_assumptions');
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
function buildFieldFreezeBlock(
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
function mergeFrozenDraftFields(
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

/** Harvest concrete data from a prior draft for injection into the retry prompt.
 *  All framing is self-contained — no references to "your prior attempt". */
function buildDraftHarvestBlock(
  priorDraft: DraftWorkProduct,
  targetedFields: Set<DraftField>,
): string {
  const parts: string[] = [];

  // Claim sketches
  if (priorDraft.claim_sketches?.length > 0) {
    const claimsTargeted = targetedFields.has('claim_sketches');
    const header = claimsTargeted
      ? 'PRIOR CLAIMS (revise per corrections above):'
      : 'STRONG CLAIMS (build your revised statement around these):';
    parts.push(header);
    for (const cs of priorDraft.claim_sketches) {
      const targets = cs.targets?.length > 0 ? ` → targets: [${cs.targets.join(', ')}]` : '';
      parts.push(`- "${cs.claim}"${targets}`);
    }
  }

  // Statement text (only when statement is targeted — LLM needs to see what to improve)
  if (targetedFields.has('statement') && priorDraft.statement) {
    const truncated = priorDraft.statement.length > 800
      ? priorDraft.statement.slice(0, 800) + '…'
      : priorDraft.statement;
    parts.push(
      `\nPRIOR DRAFT STATEMENT (rejected for reasons listed above):\n` +
      `"${truncated}"`
    );
  }

  // Key assumptions (reinforce freeze with semantic framing when not targeted)
  if (!targetedFields.has('key_assumptions') && priorDraft.key_assumptions?.length > 0) {
    parts.push('\nKEEP THESE ASSUMPTIONS:');
    for (const ka of priorDraft.key_assumptions) {
      parts.push(`- ${ka.assumption} (if wrong: ${ka.if_wrong})`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

function buildRepairBlock(hints: string[], failedStatement?: string, priorDraft?: DraftWorkProduct, targetedFields?: Set<DraftField>): string {
  if (hints.length === 0) return '';
  hints = hints.map(normalizeSpeakerNames);
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
        ? `The rejected draft began with: "${failedFirstParagraph}..."\nThis was REJECTED because it did not address the moderator's directive.\n`
        : '') +
      `Your FIRST SENTENCE must begin with "I agree that...", "I disagree that...", or "I conditionally agree:..."\n` +
      `This is not optional. Responses that do not start this way will be rejected again.`
    );
  }

  // Single paragraph
  if (hints.some(h => /single paragraph|split into/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — PARAGRAPH STRUCTURE:\n` +
      `The rejected draft was a single block of text. You MUST use \\n\\n to create 3-5 separate paragraphs. Each paragraph develops ONE idea.`
    );
  }

  // Hedge density
  if (hints.some(h => /hedge density/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — REMOVE HEDGING:\n` +
      `The rejected draft had too many qualifiers. Replace "may", "might", "could", "perhaps", "potentially" with definitive claims. Use specific actors, timelines, and numbers.`
    );
  }

  // Claim specificity
  if (hints.some(h => /abstract|number.*entity.*timeline|specific/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — ADD SPECIFICS:\n` +
      `The rejected draft lacked concrete details. Include at least one: a specific number ("≥20%"), a named entity ("the EU AI Act"), or a timeline ("by 2028").`
    );
  }

  // Statement duplication
  if (hints.some(h => /duplicate|repeated text/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — NO REPETITION:\n` +
      `The rejected draft contained the same text repeated twice. Write each paragraph ONCE. Do not copy content between paragraphs.`
    );
  }

  // Move repetition
  if (hints.some(h => /move_types repeat/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — VARY MOVES:\n` +
      `The rejected draft used the same dialectical moves as the previous turn. Choose different moves this time.`
    );
  }

  // Constructive move requirement
  if (hints.some(h => /constructive move|CONCEDE.*PIVOT.*INTEGRATE/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — ADD CONSTRUCTIVE MOVE:\n` +
      `The rejected draft used only adversarial moves. Include at least one constructive move: CONCEDE-AND-PIVOT, INTEGRATE, EXTEND, or SPECIFY.`
    );
  }

  // Commitment schema compliance (COMMIT move)
  if (hints.some(h => /concessions|conditions_for_change|sharpest_disagreements|commitment.*sub-fields/i.test(h))) {
    sections.push(
      `MANDATORY CORRECTION — COMMITMENT STRUCTURE:\n` +
      `The rejected draft was missing required commitment fields. Your response MUST include a "commitment" object with ALL THREE sub-fields:\n` +
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
      `ADDITIONAL CORRECTIONS:\n` +
      unmatched.map(h => `- ${h}`).join('\n')
    );
  }

  return sections.length > 0
    ? `\n\n=== CORRECTIONS REQUIRED (draft was rejected) ===\n` +
      `Apply these corrections WHILE executing YOUR ARGUMENT PLAN above. When a correction appears to conflict with a planned move (e.g., a correction faults you for "reframing" but the plan calls for REFRAME), THE PLAN TAKES PRECEDENCE — execute the planned move and treat the correction as guidance on HOW to execute it better, not as a directive to abandon it.\n\n` +
      `Address ONLY the specific issues listed. Do NOT swap an unflagged claim for a new claim just because you are rewriting — that pattern produces lateral motion (new problems replacing old ones), not improvement. If a flagged claim cannot be strengthened with available evidence, prefer narrowing its scope or removing it cleanly over substituting an unrelated claim.\n\n` +
      `${priorDraft && targetedFields ? buildDraftHarvestBlock(priorDraft, targetedFields) + '\n\n' : ''}` +
      `${sections.join('\n\n')}\n`
    : '';
}

// ── Statement deduplication ──────────────────────────────
// LLMs (especially Gemini flash) sometimes produce a statement where the entire
// content is repeated verbatim — 3 paragraphs followed by the same 3 paragraphs.
// Detect and truncate before the statement reaches the transcript.

/** Strip hallucinated markdown headings the LLM sometimes prepends despite prompt instructions. */
function stripLeadingHeadings(statement: string): string {
  return statement.replace(/^(?:#{1,3}\s+.*\n*)+/, '').trimStart();
}

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
      directive_response: result.plan?.directive_response,
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
  const brief = tagProvenance(briefParsed.product, {
    pipeline_run: 0, stage: 'brief', attempt: 0,
    model: input.model, timestamp: new Date().toISOString(),
  });
  const briefJson = toPromptJson(brief);

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
  const plan = tagProvenance(planParsed.product, {
    pipeline_run: 0, stage: 'plan', attempt: 0,
    model: input.model, timestamp: new Date().toISOString(),
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
  const draft = tagProvenance(draftParsed.product, {
    pipeline_run: 0, stage: 'draft', attempt: 0,
    model: input.model, timestamp: new Date().toISOString(),
  });
  const draftJson = toPromptJson(draft);

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
  // Fuzzy-correct hallucinated node IDs before filtering (same as assemblePipelineResult)
  let taxonomyRefs: TaxonomyRef[];
  if (validNodeIds) {
    const { sanitized, corrections, removed } = sanitizeNodeIds(rawRefs.map(r => r.node_id), validNodeIds);
    if (corrections.length > 0) console.log(`[pipeline] Opening: corrected ${corrections.length} hallucinated node ID(s): ${corrections.map(c => `${c.from}→${c.to}`).join(', ')}`);
    if (removed.length > 0) console.log(`[pipeline] Opening: removed ${removed.length} invalid node ID(s): ${removed.join(', ')}`);
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
      turn_symbols: result.draft.turn_symbols?.length ? result.draft.turn_symbols : undefined,
    },
  };
}
