// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type Pov = 'accelerationist' | 'safetyist' | 'skeptic';
export type Category = 'Goals/Values' | 'Data/Facts' | 'Methods';

export interface PovNode {
  id: string;
  category: Category;
  label: string;
  description: string;
  parent_id: string | null;
  children: string[];
  cross_cutting_refs: string[];
  conflict_ids?: string[];
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
}

export interface CrossCuttingFile {
  _schema_version: string;
  _doc: string;
  last_modified: string;
  nodes: CrossCuttingNode[];
}

export interface ConflictInstance {
  doc_id: string;
  position: string;
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

export type TabId = 'accelerationist' | 'safetyist' | 'skeptic' | 'cross-cutting' | 'conflicts';
