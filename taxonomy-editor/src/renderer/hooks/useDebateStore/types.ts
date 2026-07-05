// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { ConfigSlice } from './slices/configSlice';
import type { SessionSlice } from './slices/sessionSlice';
import type { TopicCritiqueSlice } from './slices/topicCritiqueSlice';
import type { ClarificationSlice } from './slices/clarificationSlice';
import type { ArgumentNetworkSlice } from './slices/argumentNetworkSlice';
import type { SynthesisSlice } from './slices/synthesisSlice';
import type { DebateLoopSlice } from './slices/debateLoopSlice';
import type { DebatePhaseSlice } from './slices/debatePhaseSlice';
import type { DebateReflectionSlice } from './slices/debateReflectionSlice';
import type { ExplorationSlice } from './slices/explorationSlice';

export type DebateStore =
  ConfigSlice &
  SessionSlice &
  TopicCritiqueSlice &
  ClarificationSlice &
  ArgumentNetworkSlice &
  SynthesisSlice &
  DebateLoopSlice &
  DebatePhaseSlice &
  DebateReflectionSlice &
  ExplorationSlice;

// ── Shared types used across slices ──────────────────────────

export interface ReflectionEdit {
  edit_type: 'revise' | 'add' | 'qualify' | 'deprecate';
  node_id: string | null;
  category: 'Beliefs' | 'Desires' | 'Intentions';
  current_label: string | null;
  proposed_label: string;
  current_description: string | null;
  proposed_description: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  evidence_entries: string[];
  status: 'pending' | 'approved' | 'dismissed';
}

export interface ReflectionResult {
  pover: string;
  label: string;
  reflection_summary: string;
  edits: ReflectionEdit[];
}

export interface ConsensusProposal {
  pov: string;
  editIndex: number;
  proposed_label: string;
  proposed_description: string;
  rationale: string;
  evidence_entries: string[];
}

export interface ConsensusCluster {
  id: string;
  proposals: ConsensusProposal[];
  similarityScores: Record<string, number>;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface NodeScoringSource {
  source: 'an' | 'topic';
  anScore: number;
  topicScore: number;
  bestClaimId?: string;
  bestClaimText?: string;
  bestClaimSim?: number;
}

export interface RelevanceSourceEntry {
  node_id: string;
  source: 'an' | 'topic';
  an_score: number;
  topic_score: number;
  best_claim_id?: string;
  best_claim_text?: string;
  best_claim_sim?: number;
}
