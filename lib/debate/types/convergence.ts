// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SpeakerId, DebatePhase } from './phase.js';

export interface ConvergenceSignals {
  entry_id: string;
  round: number;
  speaker: SpeakerId;
  move_polarity: {
    confrontational: number;
    collaborative: number;
    ratio: number;
  };
  dialectical_engagement: {
    targeted: number;
    standalone: number;
    ratio: number;
  };
  argument_redundancy: {
    avg_self_overlap: number;
    max_self_overlap: number;
    /** Peak cosine similarity between this turn's embedding and any prior turn by the same speaker. Absent when embeddings unavailable. */
    semantic_max_similarity?: number;
    /** True when semantic_max_similarity exceeds the recycling threshold (default 0.85). */
    semantically_recycled?: boolean;
  };
  dominant_counterargument: {
    node_id: string;
    strength: number;
    attacker: string;
    bdi_category?: 'belief' | 'desire' | 'intention';
  } | null;
  concession_opportunity: {
    strong_attacks_faced: number;
    concession_used: boolean;
    outcome: 'taken' | 'missed' | 'none';
  };
  position_drift: {
    overlap_with_opening: number;
    drift: number;
  };
  crux_engagement_rate: {
    used_this_turn: boolean;
    cumulative_count: number;
    cumulative_follow_through: number;
  };
  /** ArCo (Argument Coherence) — semantic relevance of this turn to the debate topic.
   *  Per-turn similarity between the turn embedding and the topic embedding.
   *  phase_mean is the running mean ArCo across all turns in the current phase.
   *  Absent when topic embedding is unavailable. */
  arco?: {
    turn_similarity: number;
    phase_mean: number;
    drift_warning: boolean;
  };
  /** Clause-coverage signal — which clause of the decomposed resolution this
   *  turn most closely engages with. best_clause_id is the index into
   *  topic.clauses (0-based) of the highest-similarity clause; null when no
   *  clause similarity exceeds the floor. Absent when clause embeddings
   *  unavailable. */
  clause_coverage?: {
    best_clause_id: number | null;
    best_similarity: number;
    /** True when best_similarity falls below the no-clause-engaged floor. */
    no_clause_engaged: boolean;
  };
}

/** Per-turn process reward entry — stored alongside convergence signals for correlation analysis. */
export interface ProcessRewardEntry {
  entry_id: string;
  round: number;
  speaker: SpeakerId;
  phase: DebatePhase;
  /** Composite process reward in [0,1]. Higher = better turn quality. */
  score: number;
  /** Per-component sub-scores in [0,1]. */
  components: {
    engagement: number;
    novelty: number;
    consistency: number;
    grounding: number;
    move_quality: number;
    crux_relevance: number;
  };
}

// ── Crux Resolution Types ────────────────────────────

export type CruxResolutionState =
  | 'identified'
  | 'engaged'
  | 'one_side_conceded'
  | 'resolved'
  | 'irreducible'
  // Terminal (t/1676): the debate ended without adjudicating the crux — it was surfaced
  // but never cross-engaged by both sides (or never surfaced). Set only by the debate-end
  // finalization sweep, never by the per-turn state machine. Distinct from the
  // preference-layer `undecidable` (cannot order two claims' strength) — do not conflate.
  | 'undecided';

export interface CruxStateTransition {
  from: CruxResolutionState;
  to: CruxResolutionState;
  turn: number;
  trigger: string;
}

export interface TrackedCrux {
  id: string;
  description: string;
  identified_turn: number;
  state: CruxResolutionState;
  history: CruxStateTransition[];
  disagreement_type?: 'empirical' | 'values' | 'definitional';
  /** Counterfactual reasoning type (RATIO 2024). */
  counterfactual_type?: 'interventional' | 'backtracking' | 'normative' | 'none';
  attacking_claim_ids: string[];
  speakers_involved: string[];
  last_computed_strength: number;
  support_polarity: number;
}

// ── Cross-debate crux registry types (Area 2) ───────

export interface CruxOccurrence {
  debate_id: string;
  debate_topic: string;
  date: string;
  an_id: string;
  final_state: CruxResolutionState;
  turns_engaged: number;
  intervention_issued: boolean;
  resolved_post_intervention: boolean;
  model: string;
}

export interface CruxRegistryEntry {
  id: string;
  description: string;
  embedding: number[];
  disagreement_type: 'empirical' | 'values' | 'definitional';
  first_seen_debate: string;
  first_seen_date: string;
  occurrences: CruxOccurrence[];
  related_taxonomy_nodes: string[];
  promoted_to_situation: string | null;
}

export interface CruxRegistry {
  version: 1;
  entries: CruxRegistryEntry[];
  last_updated: string;
}

// ── Convergence radar types ──────────────────────────

export interface ConvergenceIssue {
  id: string;
  label: string;
  taxonomy_ref: string | null;
  convergence: number;
  claim_ids: string[];
  history: { turn: number; value: number }[];
  /** QBAF-derived convergence strength (0-1). Preferred over heuristic `convergence` when present. */
  qbaf_strength?: number;
}

export interface ConvergenceTracker {
  issues: ConvergenceIssue[];
  available_issues: { taxonomy_ref: string; label: string; claim_count: number }[];
  last_updated_turn: number;
}
