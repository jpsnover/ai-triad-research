// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Subset of taxonomy types used by debate logic.
// Full taxonomy types live in taxonomy-editor/src/renderer/types/taxonomy.ts.

export type Pov = 'accelerationist' | 'safetyist' | 'skeptic';
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

export interface SituationNode {
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
  debate_refs?: string[];
}

/** @deprecated Use SituationNode. Kept for backward compatibility. */
export type CrossCuttingNode = SituationNode;

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
