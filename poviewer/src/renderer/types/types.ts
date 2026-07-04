// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// === Theme ===
export type Theme = 'light' | 'dark' | 'bkc' | 'system';

// === POV Camps ===
import { POV_META, type PovMetaKey } from '../../../../lib/electron-shared/povMeta';
export type PovCamp = PovMetaKey;

export type Alignment = 'agrees' | 'contradicts' | 'extends' | 'qualifies';

export type StrengthLevel = 'strong' | 'moderate' | 'weak';

// === Taxonomy ===
export interface TaxonomyNode {
  id: string;
  category: string;
  label: string;
  description: string;
  parent_id: string | null;
  children: string[];
  situation_refs: string[];
  conflict_ids?: string[];
}

export interface TaxonomyFile {
  _schema_version: string;
  pov: PovCamp;
  color_hex: string;
  last_modified: string;
  nodes: TaxonomyNode[];
}

export interface SituationNode {
  id: string;
  label: string;
  description: string;
  interpretations: Record<string, string>;
  linked_nodes: string[];
  conflict_ids: string[];
}

export interface SituationsFile {
  _schema_version: string;
  last_modified: string;
  nodes: SituationNode[];
}

// === Points & Mappings ===
export interface Mapping {
  camp: PovCamp;
  nodeId: string;
  nodeLabel: string;
  nodeDescription?: string;
  nodePlainDescription?: string | null;
  category: string;
  alignment: Alignment;
  strength: StrengthLevel;
  explanation: string;
}

export interface Point {
  id: string;
  sourceId: string;
  startOffset: number;
  endOffset: number;
  text: string;
  verbatim?: string;
  mappings: Mapping[];
  isCollision: boolean;
  collisionNote?: string;
}

// === Search ===
export type SearchMode = 'raw' | 'wildcard' | 'regex';

// === Sources & Notebooks ===
export type SourceStatus = 'analyzed' | 'pending' | 'analyzing' | 'error';
export type SourceType = 'docx' | 'pdf' | 'url' | 'markdown';

export interface SourceMetadata {
  id: string;
  title: string;
  sourceType: SourceType;
  url: string | null;
  addedAt: string;
  status: SourceStatus;
  filePath?: string;
}

export interface Source {
  id: string;
  title: string;
  url: string | null;
  sourceType: SourceType;
  status: SourceStatus;
  snapshotText: string;
  points: Point[];
  filePath?: string;
}

export interface Notebook {
  id: string;
  name: string;
  sources: Source[];
  taxonomyFiles: string[];
}

// === Taxonomy Meta (loaded file info) ===
export interface TaxonomyMeta {
  pov: string;
  colorHex: string;
  nodeCount: number;
  lastModified: string;
  isLoading: boolean;
}

// === POV Colors & Labels (canonical source: lib/electron-shared/povMeta) ===
export const POV_COLORS: Record<PovCamp, string> = {
  accelerationist: POV_META.accelerationist.color,
  safetyist: POV_META.safetyist.color,
  skeptic: POV_META.skeptic.color,
  situations: POV_META.situations.color,
};

export const POV_LABELS: Record<PovCamp, string> = {
  accelerationist: POV_META.accelerationist.label,
  safetyist: POV_META.safetyist.label,
  skeptic: POV_META.skeptic.label,
  situations: POV_META.situations.label,
};
