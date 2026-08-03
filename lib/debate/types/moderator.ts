// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SpeakerId, DebatePhase } from './phase.js';

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

export interface ClaimDriftEntry {
  /** AN node ID of the opening claim */
  claim_id: string;
  /** Cosine similarity of the best-matching current-turn claim */
  similarity: number;
  /** Drift classification */
  status: 'maintained' | 'refined' | 'abandoned';
  /** If concession tracker recorded a concession covering this claim */
  concession_exempt: boolean;
}

export interface PerClaimDriftSnapshot {
  round: number;
  speaker: string;
  claims: ClaimDriftEntry[];
  /** Fraction of claims abandoned without concession */
  sycophancy_score: number;
}

/** Post-debate classification of an AN node's outcome. */
export interface ClaimOutcome {
  claim_id: string;
  speaker: string;
  bdi_category?: 'belief' | 'desire' | 'intention';
  argumentation_scheme?: string;
  specificity?: 'precise' | 'general' | 'abstract';
  text_length: number;
  base_strength: number;
  final_computed_strength: number;
  reference_count: number;
  outcome: 'thrived' | 'survived' | 'died';
}

/** Aggregate claim outcome stats for calibration logging. */
export interface ClaimOutcomeSummary {
  total: number;
  thrived: number;
  survived: number;
  died: number;
  thrived_rate: number;
  died_rate: number;
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

// ── Active Moderator types ─────────────────────────────

export type InterventionFamily =
  | 'procedural'
  | 'elicitation'
  | 'repair'
  | 'reconciliation'
  | 'reflection'
  | 'synthesis';

export type InterventionMove =
  | 'REDIRECT' | 'BALANCE' | 'SEQUENCE'
  | 'PIN' | 'PROBE' | 'CHALLENGE'
  | 'CLARIFY' | 'CHECK' | 'SUMMARIZE'
  | 'ACKNOWLEDGE' | 'REVOICE'
  | 'POLICY_CHALLENGE' | 'CRUX_FOCUS'
  | 'META-REFLECT'
  | 'COMPRESS' | 'COMMIT';

export type InteractionalForce =
  | 'directive'
  | 'interrogative'
  | 'declarative'
  | 'reflective';

export const MOVE_TO_FAMILY: Record<InterventionMove, InterventionFamily> = {
  REDIRECT: 'procedural', BALANCE: 'procedural', SEQUENCE: 'procedural',
  PIN: 'elicitation', PROBE: 'elicitation', CHALLENGE: 'elicitation', CRUX_FOCUS: 'elicitation',
  CLARIFY: 'repair', CHECK: 'repair', SUMMARIZE: 'repair',
  ACKNOWLEDGE: 'reconciliation', REVOICE: 'reconciliation',
  POLICY_CHALLENGE: 'elicitation',
  'META-REFLECT': 'reflection',
  COMPRESS: 'synthesis', COMMIT: 'synthesis',
};

export const MOVE_TO_FORCE: Record<InterventionMove, InteractionalForce> = {
  REDIRECT: 'directive', BALANCE: 'directive', SEQUENCE: 'directive',
  PIN: 'interrogative', PROBE: 'interrogative', CHALLENGE: 'interrogative', CRUX_FOCUS: 'interrogative',
  CLARIFY: 'interrogative', CHECK: 'reflective', SUMMARIZE: 'declarative',
  ACKNOWLEDGE: 'declarative', REVOICE: 'reflective',
  POLICY_CHALLENGE: 'interrogative',
  'META-REFLECT': 'reflective',
  COMPRESS: 'reflective', COMMIT: 'reflective',
};

export const FAMILY_BURDEN_WEIGHT: Record<InterventionFamily, number> = {
  procedural: 0.5,
  elicitation: 1.0,
  repair: 0.75,
  reconciliation: 0.25,
  reflection: 0.6,
  synthesis: 0.8,
};

export interface InterventionMetadata {
  family: InterventionFamily;
  move: InterventionMove;
  force: InteractionalForce;
  burden: number;
  target_debater: SpeakerId;
  trigger_reason: string;
  source_evidence: {
    signal?: string;
    node_id?: string;
    round?: number;
    claim?: string;
  };
  prerequisite_applied?: string;
  original_claim_text?: string;
}

export interface ModeratorIntervention {
  family: InterventionFamily;
  move: InterventionMove;
  force: InteractionalForce;
  burden: number;
  target_debater: SpeakerId;
  text: string;
  original_claim_text?: string;
  trigger_reason: string;
  prerequisite_applied?: string;
  source_evidence: {
    signal?: string;
    node_id?: string;
    round?: number;
    claim?: string;
  };
}

export interface SelectionResult {
  responder: SpeakerId;
  addressing: SpeakerId | 'general';
  focus_point: string;
  agreement_detected: boolean;
  metaphor_reframe?: string;
  drift_detected?: boolean;
  intervene: boolean;
  suggested_move?: InterventionMove;
  target_debater?: SpeakerId;
  trigger_reasoning?: string;
  trigger_evidence?: {
    signal_name: string;
    observed_behavior: string;
    source_claim?: string;
    source_round?: number;
  };
}

export interface EngineValidationResult {
  proceed: boolean;
  validated_move: InterventionMove;
  validated_family: InterventionFamily;
  validated_target: SpeakerId;
  suppressed_reason?: 'budget_exhausted' | 'cooldown_active' | 'phase_mismatch'
    | 'same_debater_consecutive' | 'prerequisite_override'
    | 'engine_override';
  suppression_explanation?: string;
  prerequisite_applied?: string;
  burden_diagnostic?: {
    debater: SpeakerId;
    burden: number;
    avg: number;
    threshold_multiplier: number;
  };
}

export interface DebateHealthScore {
  value: number;
  trend: number;
  consecutive_decline: number;
  components: {
    engagement: number;
    novelty: number;
    responsiveness: number;
    coverage: number;
    balance: number;
  };
}

export interface ModeratorState {
  interventions_fired: number;
  budget_total: number;
  budget_remaining: number;
  rounds_since_last_intervention: number;
  required_gap: number;
  last_target: SpeakerId | null;
  last_family: InterventionFamily | null;

  burden_per_debater: Record<string, number>;
  avg_burden: number;

  persona_trigger_counts: Record<string, Partial<Record<InterventionMove, number>>>;

  health_history: DebateHealthScore[];
  consecutive_decline: number;
  consecutive_rise: number;
  trajectory_freeze_until: number;

  sli_consecutive_breaches: Record<string, number>;

  phase: DebatePhase;
  round: number;
  total_rounds: number;
  argumentation_rounds: number;

  intervention_history: {
    round: number;
    move: InterventionMove;
    family: InterventionFamily;
    target: SpeakerId;
    burden: number;
  }[];

  cooldown_blocked_count: number;

  /** How many times the budget has been refilled (0 = initial budget). */
  budget_epoch: number;
  /** Cooldown gap required after each budget refill — increases with epoch. */
  refill_gap: number;

  /** Crux IDs that have already received a CRUX_FOCUS intervention (fires at most once per crux). */
  crux_focused_ids?: Set<string>;

  /** Fraction of identified cruxes each debater has addressed (updated each round). */
  crux_engagement_per_debater?: Record<string, number>;
}

export interface InterventionResponseFields {
  pin_response?: {
    position: 'agree' | 'disagree' | 'conditional';
    condition?: string;
    brief_reason: string;
  };
  probe_response?: {
    evidence_type: 'empirical' | 'precedent' | 'theoretical' | 'conceded_gap';
    evidence: string;
    critical_question_addressed?: string;
  };
  challenge_response?: {
    type: 'evolved' | 'consistent' | 'conceded';
    explanation: string;
  };
  clarification?: {
    term: string;
    definition: string;
    example: string;
  };
  check_response?: {
    understood_correctly: boolean;
    actual_target?: string;
    revised_response?: string;
  };
  revoice_response?: {
    accurate: boolean;
    correction?: string;
  };
  reflection?: {
    type: 'crux' | 'assumption_check' | 'reasoning_audit';
    crux_condition?: string;
    assumption_examined?: string;
    conclusion: string;
  };
  compressed_thesis?: string;
  commitment?: {
    concessions: string[];
    conditions_for_change: string[];
    sharpest_disagreements: Record<string, string>;
  };
  policy_challenge_response?: {
    mechanism: string;
    actor: string;
    feasibility: string;
    obstacle: string;
  };
  crux_focus_response?: {
    type: 'empirical' | 'values' | 'definitional';
    evidence_or_tradeoff: string;
    conditional_agreement?: string;
    contested_term_definition?: string;
  };
}

// ── Talmudic Moderator types ───────────────────────────

export type ModeratorMode = 'standard' | 'talmudic';

export type DialecticalDisagreementType = 'empirical' | 'causal' | 'definitional' | 'normative' | 'mixed' | 'unclear';

export interface DialecticalDiagnostic {
  focused_crux: string;
  disagreement_type: DialecticalDisagreementType;
  premise_under_examination: string | null;
  distinction_or_analogy_tested: string | null;
  unresolved_outcome: string | null;
}

export interface TalmudicReferencesConfig {
  enabled: boolean;
  corpusPath: string;
}

export interface TalmudicSourceCardEdition {
  version_title: string;
  license: string;
  text: string;
}

export interface TalmudicSourceCard {
  id: string;
  ref: string;
  sefaria_ref: string;
  sefaria_url: string;
  excerpt: string;
  checksum: string;
  source: TalmudicSourceCardEdition;
  translation: TalmudicSourceCardEdition;
  themes: string[];
  interpretive_summary: string;
  counter_reading: string;
  disagreement_types: string[];
  schemes: string[];
  usage_types: string[];
  analogy_guardrails: string[];
}

export interface TalmudicCorpus {
  version: 1;
  name: string;
  cards: TalmudicSourceCard[];
}

export interface TalmudicReferenceCandidate {
  card_id: string;
  ref: string;
  score: number;
  components: { text_tags: number; disagreement_type: number; scheme: number };
}

export interface TalmudicReferenceSelection {
  query: string;
  candidates: TalmudicReferenceCandidate[];
  selected_card?: TalmudicSourceCard;
  usage_type?: string;
  rationale?: string;
  no_match_reason?: string;
}

export interface TalmudicReferenceResponse {
  card_id: string;
  stance: 'accepts' | 'rejects' | 'distinguishes' | 'limits';
  relevant_similarity: string;
  limiting_difference: string;
  valid: boolean;
  warnings: string[];
}
