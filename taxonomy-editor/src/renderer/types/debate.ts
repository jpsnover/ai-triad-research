// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type PoverId = 'prometheus' | 'sentinel' | 'cassandra' | 'user';

export interface TaxonomyRef {
  node_id: string;
  relevance: string;
}

export interface TranscriptEntry {
  id: string;
  timestamp: string;
  type:
    | 'clarification'
    | 'answer'
    | 'opening'
    | 'statement'
    | 'question'
    | 'synthesis'
    | 'probing'
    | 'fact-check'
    | 'system';
  speaker: PoverId | 'system';
  content: string;
  taxonomy_refs: TaxonomyRef[];
  metadata?: Record<string, unknown>;
  addressing?: PoverId | 'all';
}

export interface ContextSummary {
  up_to_entry_id: string;
  summary: string;
}

export interface DebateSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  phase: 'setup' | 'clarification' | 'opening' | 'debate' | 'closed';
  topic: {
    original: string;
    refined: string | null;
    final: string;
  };
  active_povers: PoverId[];
  user_is_pover: boolean;
  transcript: TranscriptEntry[];
  context_summaries: ContextSummary[];
}

export interface DebateSessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  phase: DebateSession['phase'];
}

export interface FactCheckResult {
  verdict: 'supported' | 'disputed' | 'unverifiable' | 'false';
  explanation: string;
  sources: { node_id?: string; conflict_id?: string }[];
  checked_text: string;
}

export interface SynthesisResult {
  areas_of_agreement: { point: string; povers: PoverId[] }[];
  areas_of_disagreement: {
    point: string;
    positions: { pover: PoverId; stance: string }[];
  }[];
  unresolved_questions: string[];
  taxonomy_coverage: { node_id: string; how_used: string }[];
}

/** POVer display metadata */
export const POVER_INFO: Record<Exclude<PoverId, 'user'>, {
  label: string;
  pov: string;
  color: string;
  personality: string;
}> = {
  prometheus: {
    label: 'Prometheus',
    pov: 'accelerationist',
    color: 'var(--color-acc)',
    personality: 'Confident, forward-looking, frames risk as cost-of-inaction',
  },
  sentinel: {
    label: 'Sentinel',
    pov: 'safetyist',
    color: 'var(--color-saf)',
    personality: 'Methodical, evidence-driven, frames progress as conditional-on-safeguards',
  },
  cassandra: {
    label: 'Cassandra',
    pov: 'skeptic',
    color: 'var(--color-skp)',
    personality: 'Wry, pragmatic, challenges assumptions from both sides',
  },
};
