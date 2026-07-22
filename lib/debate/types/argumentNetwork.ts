// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SpeakerId } from './phase.js';
import type { DialecticalScheme, ArgumentationScheme } from './session.js';
import type { BdiSubScores } from './validation.js';
import type { InterventionMove } from './moderator.js';

// ── Document pre-analysis types ────────────────────────

export interface DocumentINode {
  id: string;
  text: string;
  /** Genus-differentia rewrite optimized for taxonomy node matching (LLM output field). */
  attribution_text?: string;
  type: 'empirical' | 'normative' | 'definitional' | 'assumption' | 'evidence';
  /** FIRE: How faithfully this i-node represents the source text (0-1). */
  extraction_confidence?: number;
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
  /** Genus-differentia rewrite of the claim optimized for taxonomy node matching. Only present on enriched claims. */
  attribution_text_genus?: string;
  /** Register-normalized proposition for taxonomy matching (≤30 words, modal register matches BDI type). */
  canonical_proposition?: string;
  speaker: SpeakerId | 'system' | 'document';
  source_entry_id: string;
  taxonomy_refs: string[];
  turn_number: number;
  /** FIRE: How reliably this claim was extracted from the source (0-1). Distinct from argument quality. */
  extraction_confidence?: number;
  /** QBAF: AI-assigned intrinsic argument strength (0-1). Absent in pre-QBAF debates. */
  base_strength?: number;
  /** QBAF: Post-propagation acceptability via gradual semantics (0-1). Absent in pre-QBAF debates. */
  computed_strength?: number;
  /** QBAF: How the base_strength was determined. 'bdi_criteria' for AI-scored D/I claims, 'human' for user-assigned, 'unscored' for unscored Beliefs (default 0.5), 'fact_check' for Beliefs scored by retrieval-augmented verification, 'bdi_composite' for Desires/Intentions scored by sub-score composite. */
  scoring_method?: 'bdi_criteria' | 'human' | 'unscored' | 'fact_check' | 'bdi_composite' | 'belief_specificity' | 'belief_verification' | 'evidence_qbaf';
  /** Per-BDI-criterion sub-scores from claim extraction. Absent in pre-BDI-separation debates. */
  bdi_sub_scores?: BdiSubScores;
  /** Q-0 calibration confidence for this BDI category (Beliefs: 0.3, Desires: 0.65, Intentions: 0.71). */
  bdi_confidence?: number;
  /** BDI classification from claim extraction. */
  bdi_category?: 'belief' | 'desire' | 'intention';
  /** Claim specificity — precise Belief claims are auto-fact-checked. */
  specificity?: 'precise' | 'general' | 'abstract';
  /** 384-dim all-MiniLM-L6-v2 embedding, computed on extraction. Used for AN-based taxonomy relevance scoring. */
  embedding?: number[];
  /** Embedding computed from attribution_text_genus (genus-differentia rewrite). Used for taxonomy attribution when available. */
  attribution_embedding?: number[];
  /** If this claim is a steelman of an opponent's position, the opponent's SpeakerId. */
  steelman_of?: string;
  /** Inline verification status from web search (Intervention 2). */
  verification_status?: 'verified' | 'disputed' | 'unverifiable' | 'pending';
  /** Evidence summary from inline verification. */
  verification_evidence?: string;
  /** Evidence QBAF sub-graph: source-corpus evidence items, classification, and computed strength. */
  evidence_graph?: {
    evidence_items: {
      id: string;
      source_doc_id: string;
      text: string;
      relation: 'support' | 'contradict';
      similarity: number;
    }[];
    computed_strength: number;
    qbaf_iterations: number;
  };
  /** Post-extraction taxonomy attribution: which POV node(s) this claim instantiates. */
  claim_taxonomy_attribution?: ClaimTaxonomyAttribution;
  /** Post-extraction vocabulary disambiguation: bare colloquial terms resolved to canonical forms. */
  vocabulary_tags?: { colloquial: string; canonical: string; offset: number }[];
  /** Policymaker debates only: political salience of this claim for policy decision-making. */
  political_salience?: 'high' | 'medium' | 'low';
  /** Topic scope relevance when topic constraints are active. */
  topic_relevance?: 'on_topic' | 'adjacent' | 'off_topic';
}

export interface ClaimTaxonomyAttribution {
  /** The taxonomy node ID this claim most closely instantiates. */
  primary_ref: string;
  /** Cosine similarity between claim embedding and node embedding (0-1). */
  attribution_confidence: number;
  /** Secondary refs above the 0.40 threshold. */
  secondary_refs?: { node_id: string; similarity: number }[];
  /** Reason the claim was unattributed, if applicable. */
  unattributed_reason?: 'novel_argument' | 'no_embedding';
}

export interface ArgumentNetworkEdge {
  id: string;
  source: string;
  target: string;
  /** Non-dialectical 'revoice_of' edges express identity-across-register (no QBAF weight). */
  type: 'supports' | 'attacks' | 'revoice_of';
  attack_type?: 'rebut' | 'undercut' | 'undermine';
  scheme?: DialecticalScheme;
  warrant?: string;
  /** QBAF: Attack/support magnitude (0-1). Absent in pre-QBAF debates. */
  weight?: number;
  /** Walton argumentation scheme classifying the reasoning pattern. Absent in pre-scheme debates. */
  argumentation_scheme?: ArgumentationScheme;
  /** Which critical questions (1-indexed) of the scheme were addressed by this edge. */
  critical_questions_addressed?: number[];
  /** Engagement strength: how directly this edge rebuts/supports its target. */
  strength?: 'decisive' | 'substantial' | 'tangential';
}

export interface ANMutation {
  id: string;
  type: 'add_edge' | 'remove_edge' | 'modify_strength' | 'add_node' | 'add_flag';
  source: 'claim_extraction' | 'intervention_response';
  target_node_id?: string;
  target_edge_id?: string;
  old_value?: number;
  new_value?: number;
  provisional: boolean;
  provisional_round?: number;
  hardened: boolean;
  move?: InterventionMove;
}

export interface RevoiceGateResult {
  [key: string]: unknown;
  passed: boolean;
  anchor_source: 'taxonomy' | 'dynamic_an' | null;
  taxonomy_overlap: { original_top3: string[]; revoiced_top3: string[]; overlap_count: number };
  entity_preservation: { preserved: boolean; missing_entities: string[]; missing_thresholds: string[] };
  downgraded_to_check: boolean;
}

export interface CommitmentStore {
  asserted: string[];
  conceded: string[];
  challenged: string[];
}
