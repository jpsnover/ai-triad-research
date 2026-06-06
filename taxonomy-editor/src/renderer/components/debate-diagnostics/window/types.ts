// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type OverviewTab = 'topic-scope' | 'extraction' | 'argument-network' | 'commitments' | 'transcript' | 'convergence' | 'reflections' | 'gaps' | 'grounding' | 'lineage' | 'adaptive' | 'pov-progression' | 'fr-context' | 'prompt-diff' | 'utility';

export type EntryTab = 'tax-refs' | 'details' | 'claims' | 'evidence' | 'citations' | 'brief' | 'plan' | 'draft' | 'lookahead' | 'cite' | 'moderator';

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
