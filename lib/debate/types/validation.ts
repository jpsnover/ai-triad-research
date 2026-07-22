// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StageDiagnostics } from './pipeline.js';

// ── Turn validation (see docs/debate-turn-validation.md) ──

export interface TurnValidationConfig {
  /** Master switch. Default: true. */
  enabled?: boolean;
  /** Max retries per turn. Hard-capped at 4 (higher values clamped). Default: 0 (retries disabled). */
  maxRetries?: 0 | 1 | 2 | 3 | 4;
  /** Minimum orchestration score to accept a turn without retry. Default: 0.75. */
  scoreThreshold?: number;
  /** Skip the LLM judge (Stage B) and use only deterministic checks. Default: false. */
  deterministicOnly?: boolean;
  /** Model override for the Stage-B judge. */
  judgeModel?: string;
  /** Per-phase sampling rate, 0..1. Default 1 (always). Persisted but not yet honored. */
  sampleRate?: {
    'confrontation'?: number;
    argumentation?: number;
    concluding?: number;
  };
  /** Model for the draft quality pre-check. Default: gemini-3.1-flash-lite. */
  preCheckModel?: string;
  /** Disable the draft quality pre-check. Default: false. */
  skipPreCheck?: boolean;
}

export type TurnValidationOutcome = 'pass' | 'retry' | 'accept_with_flag' | 'skipped';

export interface TurnValidationDimensions {
  schema:      { pass: boolean; issues: string[] };
  grounding:   { pass: boolean; issues: string[] };
  advancement: { pass: boolean; signals: string[] };
  clarifies:   { pass: boolean; signals: string[] };
}

export interface TaxonomyClarificationHint {
  action: 'narrow' | 'broaden' | 'split' | 'merge' | 'qualify' | 'retire' | 'new_node';
  node_id?: string;
  node_ids?: string[];
  label?: string;
  evidence_claim_id?: string;
  rationale: string;
}

export interface TurnValidation {
  outcome: TurnValidationOutcome;
  /** Per-step process reward (Lightman et al. 2023) — evaluates this turn's
   *  quality as an intermediate reasoning step, independent of debate outcome. */
  process_reward: number;
  dimensions: TurnValidationDimensions;
  repairHints: string[];
  clarifies_taxonomy: TaxonomyClarificationHint[];
  judge_used: boolean;
  judge_model?: string;
  /** Which condition would have triggered a retry (informational when retries disabled). */
  retry_trigger?: 'stageA_error' | 'judge_retry' | 'judge_quality_low' | 'score_below_threshold' | 'none';
  /** Stage A deterministic score (0-1). */
  stageA_score?: number;
  /** LLM judge quality_score (0-1), undefined if judge not used. */
  judge_quality_score?: number;
  /** LLM judge recommendation, undefined if judge not used. */
  judge_recommend?: 'pass' | 'accept_with_flag' | 'retry';
  /** The configured scoreThreshold used for this validation. */
  score_threshold?: number;
  /** Composite validation score (0-1), derived from stageA + judge scores. */
  score?: number;
}

/** Classification of how actionable a repair hint is. */
export type HintSpecificity = 'concrete' | 'structural' | 'evaluative';

/** Where a repair hint originated. */
export type HintSource = 'validation_error' | 'validation_warning' | 'judge_weakness';

/** Tracked effectiveness of a single repair hint across retry attempts. */
export interface HintEffectiveness {
  hint_text: string;
  category: string;                // QUALITY, DRAFT, STRUCTURAL, etc.
  source: HintSource;
  specificity: HintSpecificity;
  resolution: 'fixed' | 'partially_fixed' | 'ignored' | 'made_worse' | 'pending';
  /** Fragment from the statement that the hint referenced (if extractable). */
  cited_fragment?: string;
  /** Whether the cited fragment still appears in the retry statement. */
  fragment_persists?: boolean;
  pre_score: number;
  post_score?: number;
  score_delta?: number;
}

/** Per-hint failure streak for hopeless hint suppression. */
export interface HintStreak {
  hint_key: string;
  consecutive_failures: number;
  suppressed: boolean;
}

/** Suppression threshold: suppress a hint after this many consecutive turn-level failures. */
export const HINT_SUPPRESSION_THRESHOLD = 5;

export interface TurnAttempt {
  attempt: number;
  model: string;
  prompt_delta: string;
  raw_response: string;
  response_time_ms: number;
  validation: TurnValidation;
  /** Full pipeline stage diagnostics for this attempt — preserved across orchestration retries. */
  stage_diagnostics?: StageDiagnostics[];
  /** Effectiveness tracking for repair hints that were injected into THIS attempt. */
  hint_effectiveness?: HintEffectiveness[];
  /** Repair hints from the judge that triggered this rerun (only set for attemptIdx > 0). */
  input_repair_hints?: string[];
}

export interface TurnValidationTrail {
  attempts: TurnAttempt[];
  final: TurnValidation;
}

/** Per-BDI-criterion sub-scores. Only the 3 criteria matching the claim's bdi_category are populated. */
export interface BdiSubScores {
  // Beliefs criteria (Q-0 calibration: r = -0.12 to 0.20 — low AI reliability)
  evidence_quality?: number;
  source_reliability?: number;
  falsifiability?: number;
  // Desires criteria (Q-0 calibration: r = 0.65)
  values_grounding?: number;
  tradeoff_acknowledgment?: number;
  precedent_citation?: number;
  // Intentions criteria (Q-0 calibration: r = 0.71)
  mechanism_specificity?: number;
  scope_bounding?: number;
  failure_mode_addressing?: number;
}

/** Per-turn snapshot of QBAF computed strengths for timeline visualization (D-Q2). */
export interface QbafTimelineEntry {
  turn: number;
  strengths: Record<string, number>;
  /** Per-node BDI sub-score breakdown at this snapshot. Absent in pre-BDI-separation debates. */
  bdi_breakdown?: Record<string, BdiSubScores>;
}

/** Per-source-claim coverage entry — tracks whether a document claim was discussed in the debate (CT-1). */
export interface ClaimCoverageEntry {
  /** Source document claim ID (from DocumentINode). */
  claim_id: string;
  /** Whether any AN node matched above the similarity threshold. */
  discussed: boolean;
  /** Highest cosine similarity score against any AN node. */
  best_match_score: number;
  /** AN node ID that best matched this source claim, if discussed. */
  matched_an_node?: string;
}
