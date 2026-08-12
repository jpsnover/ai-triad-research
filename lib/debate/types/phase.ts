// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { CruxResolutionState } from './convergence.js';

export type SpeakerId = 'accelerationist' | 'safetyist' | 'skeptic' | 'user';

/** Legacy speaker names from pre-rename debates. Used by migration shim. */
export const LEGACY_SPEAKER_MAP: Record<string, Exclude<SpeakerId, 'user'>> = {
  prometheus: 'accelerationist',
  sentinel: 'safetyist',
  cassandra: 'skeptic',
};

/** Map legacy speaker IDs to current IDs. Returns the input unchanged if not a legacy name. */
export function migrateSpeakerId(id: string): string {
  return LEGACY_SPEAKER_MAP[id] ?? id;
}

/** Normalize an array of speaker IDs, converting any legacy character names to POV keys.
 *  e.g. ['prometheus', 'sentinel'] → ['accelerationist', 'safetyist'] */
export function normalizeActivePovers(povers: string[]): SpeakerId[] {
  return povers.map(p => migrateSpeakerId(p) as SpeakerId);
}

/**
 * Progressive debate phases — each phase has different goals and instruction sets.
 * - confrontation: Rounds 1–2. Debaters stake out positions and challenge each other's core claims.
 * - argumentation: Middle rounds. Debaters probe deeper, find cruxes, and test edge cases.
 * - concluding: Final rounds. Debaters identify convergence, narrow remaining disagreements, and propose integrations.
 */
export type DebatePhase = 'confrontation' | 'argumentation' | 'concluding' | 'terminated';

/** Determine which debate phase a given round falls in.
 * @deprecated Use evaluatePhaseTransition() from phaseTransitions.ts for adaptive staging.
 * Retained as the fixed-round fallback when useAdaptiveStaging is false. */
export function getDebatePhase(round: number, totalRounds: number): DebatePhase {
  if (round <= 2) return 'confrontation';
  // Guarantee at least 6 argumentation statements (2 full rounds of 3 debaters)
  // before allowing concluding phase, regardless of totalRounds setting.
  const minArgRounds = 6;
  const concludingThreshold = Math.max(totalRounds - 2, minArgRounds + 2);
  if (round > concludingThreshold) return 'concluding';
  return 'argumentation';
}

// ── Adaptive Staging Types ──────────────────────────────────────────

export type DebatePacing = 'tight' | 'moderate' | 'thorough' | 'quick';
export type DialecticalStyle = 'adversarial' | 'deliberative' | 'integrative' | 'socratic';

export interface PhaseBoundsOverride {
  maxConfrontationRounds?: number;
  maxArgumentationRounds?: number;
  maxConcludingRounds?: number;
}

export interface PhaseTransitionConfig {
  useAdaptiveStaging: boolean;
  maxTotalRounds: number;
  pacing: DebatePacing;
  dialecticalStyle: DialecticalStyle;
  argumentationExitThreshold: number;
  concludingExitThreshold: number;
  allowEarlyTermination: boolean;
  phaseBoundsOverride?: PhaseBoundsOverride;
}

export interface PhaseContext {
  phase: DebatePhase;
  rationale: string;
  rounds_in_phase: number;
  phase_progress: number;
  approaching_transition: boolean;
}

export interface PhaseState {
  current_phase: DebatePhase;
  rounds_in_phase: number;
  total_rounds_elapsed: number;
  regression_count: number;
  argumentation_exit_threshold: number;
  concluding_exit_threshold: number;
  prior_crux_clusters: string[][];
  veto_history: { round: number; veto_type: string }[];
  gc_ran_this_phase: boolean;
  api_calls_used: number;
  confidence_state: { consecutiveDeferrals: number; effectiveFloor: number };
}

export interface SignalContext {
  network: {
    nodes: ReadonlyArray<{
      id: string; speaker: string; computed_strength: number;
      base_strength?: number;
      base_strength_category?: string;
      argumentation_scheme?: string;
      taxonomy_refs: ReadonlyArray<{ node_id: string; relevance: string }>;
      turn_number: number;
      embedding?: number[];
    }>;
    edges: ReadonlyArray<{
      id: string; source: string; target: string;
      type: 'supports' | 'attacks';
      attack_type?: string; weight: number; scheme?: string;
      argumentation_scheme?: string;
    }>;
    nodeCount: number;
    edgeCount?: number;
  };

  transcript: {
    currentRound: number;
    roundsInPhase: number;
    activePovsCount: number;
    lastNRounds(n: number): ReadonlyArray<{
      round: number; speaker: string; text: string;
      extraction_status: string; claims_accepted: number; claims_rejected: number;
      category_validity_ratio: number;
    }>;
  };

  priorSignals: {
    get(signalId: string, roundsBack: number): number | null;
    movingAverage(signalId: string, window: number): number | null;
  };

  convergenceSignals: {
    argument_redundancy: { avg_self_overlap: number; semantic_max_similarity?: number };
    dialectical_engagement: { ratio: number };
    position_drift: { drift: number };
    concession_opportunity: { outcome: string; strong_attacks_faced: number };
  };

  /** Recent per-turn process reward scores (PRM). Empty array if unavailable. */
  processRewards: ReadonlyArray<{ round: number; score: number }>;

  phase: {
    current: DebatePhase;
    allPovsResponded: boolean;
    cruxNodes: ReadonlyArray<{
      id: string; crossPovAttackCount: number;
      computedStrength: number;
    }>;
    cruxResolution: ReadonlyArray<{
      id: string; state: CruxResolutionState;
      support_polarity: number;
    }>;
    priorCruxClusters: ReadonlyArray<ReadonlyArray<string>>;
    regressionCount: number;
    argumentationExitThreshold: number;
    concludingExitThreshold: number;
  };

  extraction: {
    lastRoundStatus: string;
    lastRoundClaimsAccepted: number;
    lastRoundCategoryValidityRatio: number;
  };
}

export type SignalMaturity = 'v1-ship' | 'post-validation' | 'research';

export interface Signal {
  id: string;
  weight: number;
  compute: (ctx: SignalContext) => number;
  enabled: boolean;
  maturity: SignalMaturity;
}

export type PredicateAction = 'stay' | 'transition' | 'force_transition' | 'regress' | 'terminate';

export interface PredicateResult {
  action: PredicateAction;
  new_phase?: DebatePhase;
  reason: string;
  veto_active: boolean;
  force_active: boolean;
  confidence_deferred: boolean;
  components: Record<string, number>;
}

export interface SignalTelemetryRecord {
  round: number;
  phase: DebatePhase;
  signals: Record<string, number>;
  composite: { argumentative_saturation_score: number | null; convergence_score: number | null };
  confidence: { extraction: number; stability: number; global: number };
  predicate_result: PredicateResult;
  phase_progress: number;
  regression_pressure: number;
  human_override: string | null;
  network_size: number;
  elapsed_ms: number;
}

export interface AdaptiveStagingDiagnostics {
  enabled: boolean;
  phases: { phase: DebatePhase; rounds: number[]; exit_reason: string; force_active: boolean }[];
  regressions: { from_round: number; crux_id: string; threshold_after: number }[];
  total_predicate_evaluations: number;
  confidence_deferrals: number;
  vetoes_fired: number;
  forces_fired: number;
  human_overrides: { round: number; type: string; signal_scores: Record<string, number> }[];
  network_size_peak: number;
  gc_events: { round: number; before: number; after: number; pruned: number }[];
  signal_telemetry: SignalTelemetryRecord[];
}
