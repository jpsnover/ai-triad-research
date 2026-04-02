// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Shared analysis types for the main process
// Mirrors the renderer types but usable without React/DOM dependencies

export type AnalysisStatus =
  | 'idle'
  | 'queued'
  | 'reading'
  | 'stage1_running'
  | 'stage1_complete'
  | 'stage2_running'
  | 'stage2_complete'
  | 'merging'
  | 'complete'
  | 'error';

export type PovCamp = 'accelerationist' | 'safetyist' | 'skeptic' | 'situations';
export type Alignment = 'agrees' | 'contradicts';
export type StrengthLevel = 'strong' | 'moderate' | 'weak';

export interface RawPoint {
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface RawMapping {
  pointIndex: number;
  nodeId: string;
  nodeLabel: string;
  category: string;
  camp: PovCamp;
  alignment: Alignment;
  strength: StrengthLevel;
  explanation: string;
}

export interface AnalysisResult {
  sourceId: string;
  points: RawPoint[];
  mappings: RawMapping[];
  completedAt: string;
  model: string;
}

export interface AiSettings {
  model: string;
  temperature: number;
}

export interface PromptOverrides {
  stage1: string | null;
  stage2: string | null;
}
