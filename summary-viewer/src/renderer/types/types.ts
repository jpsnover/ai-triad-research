// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type Theme = 'light' | 'dark' | 'bkc' | 'system';

export type PovCamp = 'accelerationist' | 'safetyist' | 'skeptic';

export interface SourceInfo {
  id: string;
  title: string;
  sourceType: string;
  url: string | null;
  authors: string[];
  dateIngested: string;
  importTime: string;
  sourceTime: string;
  povTags: string[];
  topicTags: string[];
  oneLiner: string;
  hasSummary: boolean;
}

export interface KeyPoint {
  taxonomy_node_id: string | null;
  category: string;
  point: string;
  verbatim?: string;
  excerpt_context: string;
  stance: string;
}

export interface PovSummary {
  stance?: string;
  key_points: KeyPoint[];
}

export interface PipelineSummary {
  doc_id: string;
  taxonomy_version: string;
  generated_at: string;
  ai_model: string;
  temperature: number;
  pov_summaries: Record<string, PovSummary>;
  factual_claims: Array<{
    claim: string;
    doc_position: string;
    potential_conflict_id: string | null;
  }>;
  unmapped_concepts: Array<{
    concept: string;
    suggested_label?: string;
    suggested_description?: string;
    suggested_pov: string;
    suggested_category: string;
    reason: string;
    resolved_node_id?: string;
    'Accelerationist Interpretation'?: string;
    'Safetyist Interpretation'?: string;
    'Skeptic Interpretation'?: string;
  }>;
}

export interface PolicyAction {
  policy_id?: string;
  action: string;
  framing: string;
}

export interface PolicyRegistryEntry {
  id: string;
  action: string;
  source_povs: string[];
  member_count: number;
}

export interface GraphAttributes {
  epistemic_type?: string;
  rhetorical_strategy?: string;
  assumes?: string[];
  falsifiability?: string;
  audience?: string;
  emotional_register?: string;
  policy_actions?: PolicyAction[];
  intellectual_lineage?: string[];
  steelman_vulnerability?: string;
}

export interface TaxonomyNode {
  id: string;
  category: string;
  label: string;
  description: string;
  graph_attributes?: GraphAttributes;
}

export interface SelectedKeyPoint {
  docId: string;
  pov: string;
  index: number;
}

export interface PotentialEdge {
  type: string;
  target: string;
  inbound: boolean;
  bidirectional: boolean;
  confidence: number;
  rationale: string;
  strength?: string;
}
