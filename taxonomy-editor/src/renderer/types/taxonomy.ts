// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type Pov = 'accelerationist' | 'safetyist' | 'skeptic';
export type Category = 'Goals/Values' | 'Data/Facts' | 'Methods/Arguments';

export interface PossibleFallacy {
  fallacy: string;
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
  steelman_vulnerability?: string;
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
  cross_cutting_refs: string[];
  conflict_ids?: string[];
  graph_attributes?: GraphAttributes;
}

export interface PovTaxonomyFile {
  _schema_version: string;
  _doc: string;
  pov: Pov;
  color_hex: string;
  last_modified: string;
  nodes: PovNode[];
}

export interface CrossCuttingNode {
  id: string;
  label: string;
  description: string;
  interpretations: {
    accelerationist: string;
    safetyist: string;
    skeptic: string;
  };
  linked_nodes: string[];
  conflict_ids: string[];
  graph_attributes?: GraphAttributes;
  /** Cross-POV disagreement classification — added in dolce-phase-4. Absent in older nodes. */
  disagreement_type?: 'definitional' | 'interpretive' | 'structural';
}

export interface CrossCuttingFile {
  _schema_version: string;
  _doc: string;
  last_modified: string;
  nodes: CrossCuttingNode[];
}

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

export interface ConflictFile {
  claim_id: string;
  claim_label: string;
  description: string;
  status: 'open' | 'resolved' | 'wont-fix';
  linked_taxonomy_nodes: string[];
  instances: ConflictInstance[];
  human_notes: ConflictNote[];
}

export type TabId = 'accelerationist' | 'safetyist' | 'skeptic' | 'cross-cutting' | 'conflicts' | 'debate';

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
  rationale: string;
  status: EdgeStatus;
  discovered_at: string;
  model: string;
  strength?: 'strong' | 'moderate' | 'weak';
  notes?: string;
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
