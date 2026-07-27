// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { TurnStageId, TurnStageConfig, BriefWorkProduct, PlanWorkProduct, DraftWorkProduct, DebatePhase, DocumentAnalysis } from '../types.js';
import { DEFAULT_TEMPERATURE } from '../../ai-client/defaults.js';
import type { GenerateOptions } from '../aiAdapter.js';
import type { GenerateRequest, GenerateResponse } from '../cacheTypes.js';

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

export function normalizeDisagreementType(raw: string | undefined): string | undefined {
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
  [key: string]: unknown;
  label: string;
  pov: string;
  personality: string;
  topic: string;
  /** User-supplied supporting context, kept separate from the topic question. */
  background?: string;
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
  audience?: import('../types.js').DebateAudience;
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
  briefModel?: string;
  planModel?: string;
  draftModel?: string;
  citeModel?: string;
  stageTemperatures?: TurnStageConfig;
  repairHints?: string[];
  /** Last opponent's statement text — used by the draft quality pre-check "engages" question. */
  lastOpponentStatement?: string;
  /** Model for the draft quality pre-check. Resolved from TurnValidationConfig. */
  preCheckModel?: string;
  /** Skip the draft quality pre-check. */
  skipPreCheck?: boolean;
  /** Pre-loaded source evidence index (from source_evidence_index.json). */
  sourceEvidenceIndex?: import('../evidenceFromSummaries.js').SourceEvidenceIndex;
  /** Map of doc_id → human-readable document title for evidence citations. */
  docTitles?: import('../evidenceFromSummaries.js').DocTitleMap;
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
  /** Doc IDs from prior turn's evidence that were not cited — deprioritized in next retrieval. */
  ignoredEvidenceDocIds?: string[];
  /** Hint keys suppressed due to repeated cross-turn failures — excluded from validation errors/warnings. */
  suppressedHints?: ReadonlySet<string>;
  vocabularyExclusion?: string;
  topicScope?: import('../types.js').TopicScope;
  /** Parsed topic structure (core proposition, premises, scope constraints). */
  topicStructure?: import('../topicStructure.js').TopicStructure;
  /** Prior crux context from cross-debate registry — injected into Brief stage. */
  priorCruxContext?: string;
  /** Current debate crux context — active/resolved cruxes from this debate's crux_tracker. */
  currentCruxContext?: string;
  /** Exploration summary priming — AN sketch + convergence areas injected at Brief prompt top. */
  explorationPriming?: string;
  /** Enable salience beacon in draft prompts to reduce scope drift (experiment). */
  salienceBeacon?: boolean;
  /** Use restructured BRIEF prompt (YOUR TASK → REFERENCE → CURRENT STATE). Experiment flag (t/1029). */
  useBackgroundPrompt?: boolean;
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
  draft_temperature: DEFAULT_TEMPERATURE,
  cite_temperature: 0.15,
};
