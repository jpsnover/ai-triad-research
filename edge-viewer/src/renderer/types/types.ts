// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type Theme = 'light' | 'dark' | 'bkc' | 'system';

export type EdgeStatus = 'proposed' | 'approved' | 'rejected';

export type EdgeType =
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'ASSUMES'
  | 'WEAKENS'
  | 'RESPONDS_TO'
  | 'TENSION_WITH'
  | 'CITES'
  | 'INTERPRETS'
  | 'SUPPORTED_BY';

export type Strength = 'strong' | 'moderate' | 'weak';

export type Pov = 'accelerationist' | 'safetyist' | 'skeptic' | 'cross-cutting';

export interface TaxonomyNode {
  id: string;
  label: string;
  description: string;
  category?: string;
  parent_id?: string;
}

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
  strength?: Strength;
  notes?: string;
}

export interface IndexedEdge extends Edge {
  index: number;
  sourcePov: Pov;
  targetPov: Pov;
  sourceLabel: string;
  targetLabel: string;
}

export interface EdgeTypeDefinition {
  type: EdgeType;
  bidirectional: boolean;
  definition: string;
}

export interface EdgesFile {
  _schema_version: string;
  _doc: string;
  last_modified: string;
  edge_types: EdgeTypeDefinition[];
  edges: Edge[];
  discovery_log: unknown[];
}

export interface FilterState {
  sourcePov: Pov | '';
  targetPov: Pov | '';
  edgeType: EdgeType | '';
  status: EdgeStatus | '';
  minConfidence: number;
  searchText: string;
  crossPovOnly: boolean;
}
