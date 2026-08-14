// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type OverviewTab = 'topic-scope' | 'extraction' | 'argument-network' | 'arg-strength' | 'commitments' | 'transcript' | 'convergence' | 'reflections' | 'gaps' | 'grounding' | 'lineage' | 'adaptive' | 'pov-progression' | 'fr-context' | 'prompt-diff' | 'utility' | 'exclusion-overview' | 'emotional-register';

export type EntryTab = 'tax-refs' | 'details' | 'claims' | 'evidence' | 'citations' | 'brief' | 'plan' | 'draft' | 'lookahead' | 'cite' | 'moderator' | 'exclusion' | 'affect';

export interface AgentUtilityLocal {
  position_strength: number;
  attack_effectiveness: number;
  crux_engagement: number;
  composite: number;
}

export interface UtilitySnapshot {
  turn: number;
  entryId: string;
  speaker: string;
  byAgent: Record<string, AgentUtilityLocal>;
}

export const UTILITY_WEIGHTS: Record<string, { position: number; attack: number; crux: number }> = {
  accelerationist: { position: 0.33, attack: 0.34, crux: 0.33 },
  safetyist: { position: 0.33, attack: 0.34, crux: 0.33 },
  skeptic: { position: 0.33, attack: 0.34, crux: 0.33 },
};

export interface ModeratorTraceData {
  selected?: string; focus_point?: string; selection_reason?: string;
  excluded_last_speaker?: string | null; recent_scheme?: string | null;
  convergence_score?: number | null; convergence_triggered?: boolean;
  candidates?: { debater: string; computed_strength: number | null; claim_count?: number; scored_count?: number; rank: number }[];
  commitment_snapshot?: Record<string, { asserted: number; conceded: number; challenged: number }>;
  selection_prompt?: string; selection_response?: string;
  health_score?: number; health_components?: Record<string, number>; health_trend?: number;
  intervention_recommended?: boolean; intervention_move?: string | null;
  intervention_validated?: boolean; intervention_suppressed_reason?: string | null;
  intervention_suppression_explanation?: string | null;
  intervention_target?: string | null;
  trigger_reasoning?: string | null; trigger_evidence?: Record<string, unknown> | null;
  budget_remaining?: number; budget_total?: number;
  cooldown_rounds_left?: number; burden_per_debater?: Record<string, number>;
}
