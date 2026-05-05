// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PovKey } from '@lib/debate/types';
export type Pov = PovKey;

export type Category = 'Desires' | 'Beliefs' | 'Intentions';

export type FallacyTier = 'formal' | 'informal_structural' | 'informal_contextual' | 'cognitive_bias';

export interface PossibleFallacy {
  fallacy: string;
  /** Fallacy tier — required on new entries, absent on pre-standard data. */
  type?: FallacyTier;
  confidence: 'likely' | 'possible' | 'borderline';
  explanation: string;
}

export interface GraphAttributes {
  epistemic_type?: string;
  rhetorical_strategy?: string;
  assumes?: string[];
  falsifiability?: string;
  audience?: string;
  emotional_register?: string;
  policy_actions?: { policy_id?: string; action: string; framing: string }[];
  intellectual_lineage?: string[];
  /** Pre-Phase-6c: string. Post-Phase-6c: per-POV object. Check typeof. */
  steelman_vulnerability?: string | {
    from_accelerationist?: string;
    from_safetyist?: string;
    from_skeptic?: string;
  };
  possible_fallacies?: PossibleFallacy[];
  /** AIF node scope — added in dolce-phase-4. Absent in older nodes. */
  node_scope?: 'claim' | 'scheme' | 'bridging';
}

export type ParentRelationship = 'is_a' | 'part_of' | 'specializes';

export interface PovNode {
  id: string;
  category: Category;
  label: string;
  description: string;
  parent_id: string | null;
  parent_relationship?: ParentRelationship | null;
  parent_rationale?: string | null;
  children: string[];
  situation_refs: string[];
  conflict_ids?: string[];
  graph_attributes?: GraphAttributes;
  debate_refs?: string[];
}

export interface PovTaxonomyFile {
  _schema_version: string;
  _doc: string;
  pov: Pov;
  color_hex: string;
  last_modified: string;
  nodes: PovNode[];
}

/** BDI-decomposed interpretation — separates empirical claims, normative commitments, and strategic reasoning. */
export interface BdiInterpretation {
  belief: string;
  desire: string;
  intention: string;
  summary: string;
}

/** Interpretation is either a plain string (legacy) or BDI-decomposed object. */
export type Interpretation = string | BdiInterpretation;

/** Extract display text from an interpretation (handles both formats). */
export function interpretationText(interp: Interpretation | undefined): string {
  if (!interp) return '';
  if (typeof interp === 'string') return interp;
  return interp.summary;
}

export interface SituationNode {
  id: string;
  label: string;
  description: string;
  interpretations: {
    accelerationist: Interpretation;
    safetyist: Interpretation;
    skeptic: Interpretation;
  };
  linked_nodes: string[];
  conflict_ids: string[];
  graph_attributes?: GraphAttributes;
  /** Cross-POV disagreement classification — added in dolce-phase-4. Absent in older nodes. */
  disagreement_type?: 'definitional' | 'interpretive' | 'structural';
  debate_refs?: string[];
  /** Parent situation node ID for hierarchy. Absent on root nodes. */
  parent_id?: string | null;
  /** Relationship to parent: is_a, part_of, or specializes. */
  parent_relationship?: 'is_a' | 'part_of' | 'specializes' | null;
  /** Rationale for the parent relationship. */
  parent_rationale?: string | null;
}

/** @deprecated Use SituationNode */
export type CrossCuttingNode = SituationNode;

export interface SituationsFile {
  _schema_version: string;
  _doc: string;
  last_modified: string;
  nodes: SituationNode[];
}

/** @deprecated Use SituationsFile */
export type CrossCuttingFile = SituationsFile;

export type ConflictStance = 'supports' | 'disputes' | 'neutral' | 'qualifies';

export interface ConflictInstance {
  doc_id: string;
  stance: ConflictStance;
  assertion: string;
  date_flagged: string;
}

export interface ConflictNote {
  author: string;
  date: string;
  note: string;
}

export interface ConflictQbafNode {
  id: string;
  text: string;
  source_pov: string;
  base_strength: number;
  computed_strength: number;
  bdi_category?: string;
  bdi_sub_scores?: Record<string, number>;
}

export interface ConflictQbafEdge {
  source: string;
  target: string;
  type: 'attacks' | 'supports';
  attack_type?: 'rebut' | 'undercut' | 'undermine';
  weight: number;
}

export interface ConflictQbaf {
  graph: {
    nodes: ConflictQbafNode[];
    edges: ConflictQbafEdge[];
  };
  resolution?: {
    prevailing_claim: string;
    prevailing_strength: number;
    margin: number;
    criterion: string;
  };
  computed_at: string;
  algorithm: string;
  iterations: number;
}

export interface DialecticTraceStep {
  step: number;
  claim_id: string;
  speaker: string;
  claim: string;
  action: 'asserted' | 'attacked' | 'supported' | 'conceded' | 'unaddressed';
  scheme?: string;
  attack_type?: 'rebut' | 'undercut' | 'undermine';
  responds_to?: string;
  strength?: number;
  turn?: number;
}

export interface DialecticTrace {
  conflict: string;
  prevailing: string;
  criterion: string;
  steps: DialecticTraceStep[];
  debate_id: string;
  generated_at: string;
}

export interface ConflictVerdict {
  prevailing_stance?: string;
  criterion?: string;
  rationale?: string;
  debate_id?: string;
  dialectic_trace?: DialecticTrace;
}

export interface ConflictFile {
  claim_id: string;
  claim_label: string;
  description: string;
  status: 'open' | 'resolved' | 'wont-fix';
  linked_taxonomy_nodes: string[];
  instances: ConflictInstance[];
  human_notes: ConflictNote[];
  /** QBAF argument graph + resolution. Absent on pre-QBAF conflicts. */
  qbaf?: ConflictQbaf;
  /** Resolution verdict from debate harvest. */
  verdict?: ConflictVerdict;
}

export type TabId = 'accelerationist' | 'safetyist' | 'skeptic' | 'situations' | 'conflicts' | 'cruxes' | 'debate' | 'chat' | 'summaries';

// ── Edge types (from taxonomy/Origin/edges.json) ─────────

export type EdgeStatus = 'proposed' | 'approved' | 'rejected';

/** Canonical edge types (AIF-aligned, Phase 5). Legacy types still appear in pre-migration data. */
export type CanonicalEdgeType =
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'ASSUMES'
  | 'WEAKENS'
  | 'RESPONDS_TO'
  | 'TENSION_WITH'
  | 'INTERPRETS';

/** Accept both canonical and legacy edge types — backward-compat handler (kept permanently). */
export type EdgeType = CanonicalEdgeType | (string & {});

export interface Edge {
  source: string;
  target: string;
  type: EdgeType;
  bidirectional: boolean;
  confidence: number;
  weight?: number;
  rationale: string;
  status: EdgeStatus;
  discovered_at: string;
  model: string;
  strength?: 'strong' | 'moderate' | 'weak';
  notes?: string;
  direction_flag?: 'ok' | 'suspect' | null;
}

export interface EdgeTypeDefinition {
  type: EdgeType;
  bidirectional: boolean;
  definition: string;
  llm_proposed?: boolean;
}

export interface EdgesFile {
  _schema_version: string;
  _doc: string;
  last_modified: string;
  edge_types: EdgeTypeDefinition[];
  edges: Edge[];
  discovery_log?: unknown[];
}
