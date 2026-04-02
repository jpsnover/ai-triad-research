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
  policy_refs?: string[];
  metadata?: Record<string, unknown>;
  addressing?: PoverId | 'all';
}

export interface ContextSummary {
  up_to_entry_id: string;
  summary: string;
}

export type DebateSourceType = 'topic' | 'document' | 'url' | 'cross-cutting' | 'situations';

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
  source_type: DebateSourceType;
  /** For document: file path; for url: the URL; for topic: empty */
  source_ref: string;
  /** For document/url: the loaded text content for prompt injection */
  source_content: string;
  active_povers: PoverId[];
  user_is_pover: boolean;
  transcript: TranscriptEntry[];
  context_summaries: ContextSummary[];
  /** Tracks which prompt generation produced this session. Absent in pre-migration debates. */
  generated_with_prompt_version?: string;
  /** Debate-specific AI model override. If set, used instead of the global model for this debate only. */
  debate_model?: string;
  /** Debate protocol format. Absent in older debates (defaults to 'structured'). */
  protocol_id?: string;
  /** AI temperature for this debate (0.0-1.0). Absent uses system default. */
  debate_temperature?: number;
  /** Diagnostic data captured when diagnostics mode is enabled. */
  diagnostics?: DebateDiagnostics;
  /** Incremental argument network built during debate */
  argument_network?: {
    nodes: ArgumentNetworkNode[];
    edges: ArgumentNetworkEdge[];
  };
  /** Per-debater commitment stores */
  commitments?: Record<string, CommitmentStore>;
  /** Convergence radar tracker — updated after each AN extraction */
  convergence_tracker?: ConvergenceTracker;
  /** Pre-analysis of source document — extracted i-nodes, tensions, and summary. Absent for topic-only debates. */
  document_analysis?: DocumentAnalysis;
}

// ── Document pre-analysis types ────────────────────────

export interface DocumentINode {
  id: string;
  text: string;
  type: 'empirical' | 'normative' | 'definitional' | 'assumption' | 'evidence';
  taxonomy_refs: string[];
  policy_refs: string[];
}

export interface DocumentTensionPoint {
  description: string;
  i_node_ids: string[];
  pov_tensions: { pov: string; stance: string }[];
}

export interface DocumentAnalysis {
  claims_summary: string;
  i_nodes: DocumentINode[];
  tension_points: DocumentTensionPoint[];
}

export interface ArgumentNetworkNode {
  id: string;
  text: string;
  speaker: PoverId | 'system' | 'document';
  source_entry_id: string;
  taxonomy_refs: string[];
  turn_number: number;
}

export interface ArgumentNetworkEdge {
  id: string;
  source: string;
  target: string;
  type: 'supports' | 'attacks';
  attack_type?: 'rebut' | 'undercut' | 'undermine';
  scheme?: string;
  warrant?: string;
}

export interface CommitmentStore {
  asserted: string[];
  conceded: string[];
  challenged: string[];
}

// ── Convergence radar types ──────────────────────────

export interface ConvergenceIssue {
  id: string;
  label: string;
  taxonomy_ref: string | null;
  convergence: number;
  claim_ids: string[];
  history: { turn: number; value: number }[];
}

export interface ConvergenceTracker {
  issues: ConvergenceIssue[];
  available_issues: { taxonomy_ref: string; label: string; claim_count: number }[];
  last_updated_turn: number;
}

// ── Diagnostics types ─────────────────────────────────

export interface EntryDiagnostics {
  prompt?: string;
  raw_response?: string;
  model?: string;
  response_time_ms?: number;
  taxonomy_context?: string;
  commitment_context?: string;
  extracted_claims?: {
    accepted: { text: string; id: string; overlap_pct: number }[];
    rejected: { text: string; reason: string; overlap_pct: number }[];
  };
  edge_tensions?: string;
  argument_network_context?: string;
  selection_reasoning?: string;
}

export interface DebateOverviewDiagnostics {
  total_ai_calls: number;
  total_response_time_ms: number;
  claims_accepted: number;
  claims_rejected: number;
  move_type_counts: Record<string, number>;
  disagreement_type_counts: Record<string, number>;
}

export interface DebateDiagnostics {
  enabled: boolean;
  entries: Record<string, EntryDiagnostics>;
  overview: DebateOverviewDiagnostics;
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

/** AIF attack on a claim — added in dolce-phase-3. */
export interface ArgumentAttack {
  claim_id: string;
  claim: string;
  claimant: PoverId | string;
  attack_type: 'rebut' | 'undercut' | 'undermine';
  scheme?: 'CONCEDE' | 'DISTINGUISH' | 'REFRAME' | 'COUNTEREXAMPLE' | 'REDUCE' | 'ESCALATE';
}

/** AIF support link (S-node) with warrant and critical questions. */
export interface SupportLink {
  claim_id: string;
  scheme?: string;
  warrant?: string;
  critical_questions?: { question: string; addressed: boolean }[];
}

/** AIF claim node — added in dolce-phase-3. */
export interface ArgumentClaim {
  claim_id: string;
  claim: string;
  claimant: PoverId | string;
  type?: 'empirical' | 'normative' | 'definitional';
  /** Pre-P4: string[]. Post-P4: SupportLink[]. Check typeof [0]. */
  supported_by?: (string | SupportLink)[];
  attacked_by?: ArgumentAttack[];
}

export interface SynthesisResult {
  areas_of_agreement: { point: string; povers: PoverId[] }[];
  areas_of_disagreement: {
    point: string;
    positions: { pover: PoverId; stance: string }[];
    /** BDI layer classification — added in dolce-phase-1. Absent in older debates. */
    bdi_layer?: 'belief' | 'desire' | 'intention';
    /** How this disagreement could be resolved — added in dolce-phase-1. Absent in older debates. */
    resolvability?: 'resolvable_by_evidence' | 'negotiable_via_tradeoffs' | 'requires_term_clarification';
  }[];
  unresolved_questions: string[];
  taxonomy_coverage: { node_id: string; how_used: string }[];
  /** AIF argument map — added in dolce-phase-3. Absent in older debates. */
  argument_map?: ArgumentClaim[];
  /** Preference resolution — which arguments prevail and why. Absent in older debates. */
  preferences?: PreferenceEntry[];
  /** Policy implications — how disagreements affect concrete policy actions. */
  policy_implications?: PolicyImplication[];
}

export interface PreferenceEntry {
  conflict: string;
  claim_ids?: string[];
  prevails: string;
  criterion: string;
  rationale: string;
  what_would_change_this?: string;
}

export interface PolicyImplication {
  disagreement: string;
  policy_refs: string[];
  positions: { pover: string; stance: string }[];
  implication: string;
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
