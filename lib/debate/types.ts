// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type PoverId = 'prometheus' | 'sentinel' | 'cassandra' | 'user';

/**
 * Progressive debate phases — each phase has different goals and instruction sets.
 * - thesis-antithesis: Rounds 1–2. Debaters stake out positions and challenge each other's core claims.
 * - exploration: Middle rounds. Debaters probe deeper, find cruxes, and test edge cases.
 * - synthesis: Final rounds. Debaters identify convergence, narrow remaining disagreements, and propose integrations.
 */
export type DebatePhase = 'thesis-antithesis' | 'exploration' | 'synthesis';

/** Determine which debate phase a given round falls in. */
export function getDebatePhase(round: number, totalRounds: number): DebatePhase {
  if (round <= 2) return 'thesis-antithesis';
  if (round > totalRounds - 2) return 'synthesis';
  return 'exploration';
}

/** Canonical dialectical schemes (AIF-aligned). */
export type DialecticalScheme =
  | 'DISTINGUISH'
  | 'COUNTEREXAMPLE'
  | 'CONCEDE-AND-PIVOT'
  | 'REFRAME'
  | 'EMPIRICAL CHALLENGE'
  | 'EXTEND'
  | 'UNDERCUT'
  | 'SPECIFY'
  // Legacy dialectical moves — accept but don't prompt for these
  | 'CONCEDE'
  | 'REDUCE'
  | 'ESCALATE';

/** Walton-derived argumentation scheme taxonomy for AI policy discourse (t/183). */
export type ArgumentationScheme =
  // Evidence-Based
  | 'ARGUMENT_FROM_EVIDENCE'
  | 'ARGUMENT_FROM_EXPERT_OPINION'
  | 'ARGUMENT_FROM_PRECEDENT'
  // Reasoning
  | 'ARGUMENT_FROM_CONSEQUENCES'
  | 'ARGUMENT_FROM_ANALOGY'
  | 'PRACTICAL_REASONING'
  | 'ARGUMENT_FROM_DEFINITION'
  // Value
  | 'ARGUMENT_FROM_VALUES'
  | 'ARGUMENT_FROM_FAIRNESS'
  // Meta-Argumentative
  | 'ARGUMENT_FROM_IGNORANCE'
  | 'SLIPPERY_SLOPE'
  | 'ARGUMENT_FROM_RISK'
  // Figurative
  | 'ARGUMENT_FROM_METAPHOR'
  | 'OTHER';

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
  /** Pre-CQ: bare string IDs. Post-CQ: objects with relevance. Check typeof. */
  policy_refs?: (string | { policy_id: string; relevance: string })[];
  metadata?: Record<string, unknown>;
  addressing?: PoverId | 'all';
  /** Cached AI-generated summaries at different detail tiers (DT-2). */
  summaries?: {
    brief: string;   // 2-3 sentences: core claim + strongest reasoning
    medium: string;  // 1-2 paragraphs: main argument + key evidence
  };
  /** Which detail tier to display by default. Absent = show full content. */
  display_tier?: 'brief' | 'medium' | 'detailed';
}

export interface ContextSummary {
  up_to_entry_id: string;
  summary: string;
}

export type DebateSourceType = 'topic' | 'document' | 'url' | 'situations';

export type DebateAudience =
  | 'policymakers'
  | 'technical_researchers'
  | 'industry_leaders'
  | 'academic_community'
  | 'general_public';

export const DEBATE_AUDIENCES: { id: DebateAudience; label: string }[] = [
  { id: 'policymakers', label: 'Policymakers' },
  { id: 'technical_researchers', label: 'Technical Researchers' },
  { id: 'industry_leaders', label: 'Industry Leaders' },
  { id: 'academic_community', label: 'Academic Community' },
  { id: 'general_public', label: 'General Public' },
];

export interface DebateSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** App version that created this debate session. */
  app_version?: string;
  /** Target audience for tone, language, and concern prioritization. */
  audience?: DebateAudience;
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
  /** QBAF strength snapshots after each turn — for timeline visualization. Absent in pre-QBAF debates. */
  qbaf_timeline?: QbafTimelineEntry[];
  /** Coverage tracking — which source claims have been discussed. Absent for topic-only debates or pre-coverage debates. */
  claim_coverage?: ClaimCoverageEntry[];
  /** Persona-free neutral evaluations at up to 3 checkpoints. Absent in pre-evaluator debates. */
  neutral_evaluations?: import('./neutralEvaluator').NeutralEvaluation[];
  /** Speaker mapping used for neutral evaluator (randomized per debate). Absent in pre-evaluator debates. */
  neutral_speaker_mapping?: import('./neutralEvaluator').SpeakerMapping;
  /** Unanswered claims ledger — persistent tracking across the 8-entry compression window. */
  unanswered_claims_ledger?: UnansweredClaimEntry[];
  /** Position drift snapshots per round — embedding similarity tracking for sycophancy detection. */
  position_drift?: DriftSnapshot[];
  /** Missing arguments identified post-synthesis by a fresh LLM with no transcript context. */
  missing_arguments?: MissingArgument[];
  /** Post-debate taxonomy refinement suggestions with before/after descriptions. */
  taxonomy_suggestions?: TaxonomySuggestion[];
  /** Post-debate dialectic traces explaining why positions prevailed — argument chains from the AN graph. */
  dialectic_traces?: import('./dialecticTrace').DialecticTrace[];
  /** Session-level aggregate of claim-extraction health — computed incrementally after each extraction turn. */
  extraction_summary?: ExtractionSummary;
  /** Per-entry turn-validation trail. Keyed by transcript entry id. See docs/debate-turn-validation.md. */
  turn_validations?: Record<string, TurnValidationTrail>;
}

// ── Turn validation (see docs/debate-turn-validation.md) ──

export interface TurnValidationConfig {
  /** Master switch. Default: true. */
  enabled?: boolean;
  /** Max retries per turn. Hard-capped at 2 (higher values clamped). Default: 2. */
  maxRetries?: 0 | 1 | 2;
  /** Skip the LLM judge (Stage B) and use only deterministic checks. Default: false. */
  deterministicOnly?: boolean;
  /** Model override for the Stage-B judge. */
  judgeModel?: string;
  /** Per-phase sampling rate, 0..1. Default 1 (always). Persisted but not yet honored. */
  sampleRate?: {
    'thesis-antithesis'?: number;
    exploration?: number;
    synthesis?: number;
  };
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
  score: number;
  dimensions: TurnValidationDimensions;
  repairHints: string[];
  clarifies_taxonomy: TaxonomyClarificationHint[];
  judge_used: boolean;
  judge_model?: string;
}

export interface TurnAttempt {
  attempt: number;
  model: string;
  prompt_delta: string;
  raw_response: string;
  response_time_ms: number;
  validation: TurnValidation;
}

export interface TurnValidationTrail {
  attempts: TurnAttempt[];
  final: TurnValidation;
}

/** Per-turn snapshot of QBAF computed strengths for timeline visualization (D-Q2). */
export interface QbafTimelineEntry {
  turn: number;
  strengths: Record<string, number>;
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
  /** FIRE: How reliably this claim was extracted from the source (0-1). Distinct from argument quality. */
  extraction_confidence?: number;
  /** QBAF: AI-assigned intrinsic argument strength (0-1). Absent in pre-QBAF debates. */
  base_strength?: number;
  /** QBAF: Post-propagation acceptability via gradual semantics (0-1). Absent in pre-QBAF debates. */
  computed_strength?: number;
  /** QBAF: How the base_strength was determined. 'ai_rubric' for AI-scored D/I claims, 'human' for user-assigned, 'default_pending' for unscored Beliefs (default 0.5). */
  scoring_method?: 'ai_rubric' | 'human' | 'default_pending';
  /** BDI classification from claim extraction. */
  bdi_category?: 'belief' | 'desire' | 'intention';
  /** Claim specificity — precise Belief claims are auto-fact-checked. */
  specificity?: 'precise' | 'general' | 'abstract';
  /** If this claim is a steelman of an opponent's position, the opponent's PoverId. */
  steelman_of?: string;
  /** Inline verification status from web search (Intervention 2). */
  verification_status?: 'verified' | 'disputed' | 'unverifiable' | 'pending';
  /** Evidence summary from inline verification. */
  verification_evidence?: string;
}

export interface ArgumentNetworkEdge {
  id: string;
  source: string;
  target: string;
  type: 'supports' | 'attacks';
  attack_type?: 'rebut' | 'undercut' | 'undermine';
  scheme?: DialecticalScheme;
  warrant?: string;
  /** QBAF: Attack/support magnitude (0-1). Absent in pre-QBAF debates. */
  weight?: number;
  /** Walton argumentation scheme classifying the reasoning pattern. Absent in pre-scheme debates. */
  argumentation_scheme?: ArgumentationScheme;
  /** Which critical questions (1-indexed) of the scheme were addressed by this edge. */
  critical_questions_addressed?: number[];
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
  /** QBAF-derived convergence strength (0-1). Preferred over heuristic `convergence` when present. */
  qbaf_strength?: number;
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
  /** Legacy claim-extraction capture — prompt, raw response, parse count, schemes. */
  claim_extraction?: {
    prompt: string;
    raw_response: string;
    response_time_ms: number;
    claims_parsed: number;
    schemes_classified: string[];
  };
  /** Full extraction-lifecycle trace — status, sizes, funnel, overlap distribution, AN delta. */
  extraction_trace?: ClaimExtractionTrace;
  edge_tensions?: string;
  argument_network_context?: string;
  selection_reasoning?: string;
  stage_diagnostics?: StageDiagnostics[];
}

// ── Turn pipeline types ──────────────────────────────

export type TurnStageId = 'brief' | 'plan' | 'draft' | 'cite';

export interface TurnStageConfig {
  brief_temperature?: number;
  plan_temperature?: number;
  draft_temperature?: number;
  cite_temperature?: number;
}

export interface StageDiagnostics {
  stage: TurnStageId;
  prompt: string;
  raw_response: string;
  model: string;
  temperature: number;
  response_time_ms: number;
  work_product: Record<string, unknown>;
  parse_error?: string;
}

export interface BriefWorkProduct {
  situation_assessment: string;
  key_claims_to_address: { claim: string; speaker: string; an_id?: string }[];
  relevant_taxonomy_nodes: { node_id: string; why: string }[];
  relevant_commitments: { speaker: string; commitment: string; type: string }[];
  edge_tensions: { edge: string; relevance: string }[];
  phase_considerations: string;
}

export interface PlanWorkProduct {
  strategic_goal: string;
  planned_moves: { move: string; target?: string; detail: string }[];
  target_claims: string[];
  argument_sketch: string;
  anticipated_responses: string[];
  evidence_needed: string[];
}

export interface TurnSymbol {
  symbol: string;
  tooltip: string;
}

export interface DraftWorkProduct {
  statement: string;
  turn_symbols: TurnSymbol[];
  claim_sketches: { claim: string; targets: string[] }[];
  key_assumptions: { assumption: string; if_wrong: string }[];
  disagreement_type: string;
  position_update?: string;
}

export interface CiteWorkProduct {
  taxonomy_refs: TaxonomyRef[];
  policy_refs: string[];
  move_annotations: { move: string; target?: string; detail: string }[];
  grounding_confidence: number;
}

export interface TurnPipelineResult {
  brief: BriefWorkProduct;
  plan: PlanWorkProduct;
  draft: DraftWorkProduct;
  cite: CiteWorkProduct;
  stage_diagnostics: StageDiagnostics[];
  total_time_ms: number;
}

/**
 * Per-turn trace for the claim-extraction pipeline. Used to diagnose
 * "AN nodes stop being registered" plateau failures.
 */
export interface ClaimExtractionTrace {
  entry_id: string;
  round: number;
  speaker: PoverId;

  /** Lifecycle outcome for the extraction call. */
  status:
    | 'ok'                // at least one claim accepted
    | 'no_new_nodes'      // extraction ran but zero accepted (all rejected or empty)
    | 'adapter_error'     // underlying AI call threw
    | 'parse_error'       // response received but JSON parse failed
    | 'empty_response'    // AI returned 0 candidates
    | 'truncated_response'// response body appears truncated
    | 'skipped';          // extraction intentionally bypassed
  error_message?: string;
  attempt_count: number;

  // Sizes — catches context-bloat failure mode
  prompt_chars: number;
  prompt_token_estimate: number;
  response_chars: number;
  response_truncated: boolean;
  model: string;
  response_time_ms: number;

  // Funnel
  candidates_proposed: number;
  candidates_accepted: number;
  candidates_rejected: number;
  rejection_reasons: Record<string, number>;

  // Overlap distribution — catches "AN saturated" failure mode
  rejected_overlap_pcts: number[];
  max_overlap_vs_existing: number;

  // Cumulative state
  an_node_count_before: number;
  an_node_count_after: number;
  an_nodes_added_ids: string[];

  // Drift signals
  prompt_hash: string;
  extraction_prompt_version: string;
}

/** Session-level aggregate of extraction health, computed incrementally. */
export interface ExtractionSummary {
  total_turns: number;
  total_proposed: number;
  total_accepted: number;
  total_rejected: number;
  acceptance_rate: number;
  /** Per-round AN node counts (cumulative). */
  an_growth_series: { round: number; cumulative_count: number }[];
  /** True if 2+ consecutive turns produced zero new AN nodes. */
  plateau_detected: boolean;
  /** Turn index where plateau first began (1-based). Absent if no plateau. */
  plateau_started_at_turn?: number;
  /** AN node ID of last successful addition before plateau (e.g. "AN-11"). */
  plateau_last_an_id?: string;
  /** Aggregate rejection reasons across the session. */
  rejection_reason_totals: Record<string, number>;
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
  scheme?: DialecticalScheme;
}

/** AIF support link (S-node) with warrant and critical questions. */
export interface SupportLink {
  claim_id: string;
  scheme?: DialecticalScheme;
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
  /** Coverage tracking — which source claims were discussed vs uncovered (CT-1). */
  claim_coverage?: ClaimCoverageEntry[];
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

// ── Intervention types ──────────────────────────────────

/** Unanswered Claims Ledger entry — tracks claims that remain unresponded to across the debate. */
export interface UnansweredClaimEntry {
  claim_id: string;
  claim_text: string;
  speaker: string;
  first_unanswered_round: number;
  addressed_round?: number;
  addressed_by?: string;
}

/** Per-round embedding similarity snapshot for position drift / sycophancy detection. */
export interface DriftSnapshot {
  round: number;
  speaker: string;
  /** Cosine similarity of current response vs speaker's own opening statement. */
  self_similarity: number;
  /** Cosine similarity of current response vs each opponent's opening statement. */
  opponent_similarities: Record<string, number>;
}

/** Argument that was never raised during the debate — identified post-synthesis by a fresh LLM. */
export interface MissingArgument {
  argument: string;
  side: string;
  why_strong: string;
  bdi_layer: 'belief' | 'desire' | 'intention';
}

/** Post-debate suggestion for revising a taxonomy node based on debate evidence. */
export interface TaxonomySuggestion {
  /** The taxonomy node targeted for revision. */
  node_id: string;
  node_label: string;
  node_pov: string;
  /** What kind of change is suggested. */
  suggestion_type: 'narrow' | 'broaden' | 'clarify' | 'split' | 'merge' | 'qualify' | 'retire' | 'new_node';
  /** Current node description (for before/after comparison). Absent for new_node. */
  current_description?: string;
  /** Proposed revised description (or new node description for new_node). May be absent on turn-validator hints which only propose a direction. */
  proposed_description?: string;
  /** Why this change is warranted — references specific debate evidence. */
  rationale: string;
  /** Which debate claims or synthesis points support this suggestion. */
  evidence_claim_ids?: string[];
  /** Where the suggestion came from. 'post-debate' = harvest pass, 'turn-validator' = mid-debate judge hint. Absent in pre-source suggestions. */
  source?: 'post-debate' | 'turn-validator';
  /** For merge suggestions: the other node(s) proposed for merging. */
  merge_with_node_ids?: string[];
  /** Transcript entry id where a turn-validator hint originated. */
  origin_entry_id?: string;
}

// ── Prompt Inspector types (Phase A: type definition only) ──────────

import type { Category } from './taxonomyTypes';

export type PromptGroup = 'debate-setup' | 'debate-turns' | 'debate-analysis' | 'moderator' | 'chat' | 'taxonomy' | 'research' | 'powershell';
export type DataSourceId = 'taxonomyNodes' | 'situationNodes' | 'vulnerabilities' | 'fallacies' | 'policyRegistry' | 'sourceDocument' | 'commitments' | 'argumentNetwork' | 'establishedPoints';

/** Per-prompt configuration. Optional and sparse — missing values fall back to coded defaults. */
export interface PromptConfig {
  promptId: string;
  temperature?: number;
  model?: string;
  responseLength?: 'brief' | 'medium' | 'detailed';
  dataSources: {
    taxonomyNodes?: { maxTotal: number; minPerBdi: number; threshold: number; bdiFilter: Record<Category, boolean> };
    situationNodes?: { max: number; min: number; threshold: number };
    vulnerabilities?: { enabled: boolean; max: number };
    fallacies?: { enabled: boolean; confidenceFilter: 'likely' | 'all' };
    policyRegistry?: { enabled: boolean; max: number };
    sourceDocument?: { truncationLimit: number };
    commitments?: { enabled: boolean };
    argumentNetwork?: { enabled: boolean };
    establishedPoints?: { enabled: boolean; max: number };
  };
}

/** Result from generatePromptPreview — includes assembled text and metadata for Phase B. */
export interface PromptPreviewResult {
  text: string;
  tokenEstimate: number;
  sections: { name: string; charCount: number; tokenEstimate: number }[];
}
