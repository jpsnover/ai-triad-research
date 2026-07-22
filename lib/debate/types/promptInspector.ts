// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Prompt Inspector types (Phase A: type definition only) ──────────

import type { Category } from '../taxonomyTypes.js';

export type PromptGroup = 'debate-setup' | 'debate-turns' | 'debate-analysis' | 'moderator' | 'chat' | 'taxonomy' | 'research' | 'powershell';
export type DataSourceId = 'taxonomyNodes' | 'situationNodes' | 'vulnerabilities' | 'fallacies' | 'policyRegistry' | 'sourceDocument' | 'commitments' | 'argumentNetwork' | 'establishedPoints';

/** Per-prompt configuration. Optional and sparse — missing values fall back to coded defaults. */
export interface PromptConfig {
  promptId: string;
  temperature?: number;
  model?: string;
  responseLength?: 'brief' | 'medium' | 'detailed';
  dataSources: {
    taxonomyNodes?: { maxTotal: number; minPerBdi: number; threshold: number; bdiFilter: Record<Category, boolean> };
    situationNodes?: { max: number; min: number; threshold: number };
    vulnerabilities?: { enabled: boolean; max: number };
    fallacies?: { enabled: boolean; confidenceFilter: 'likely' | 'all' };
    policyRegistry?: { enabled: boolean; max: number };
    sourceDocument?: { truncationLimit: number };
    commitments?: { enabled: boolean };
    argumentNetwork?: { enabled: boolean };
    establishedPoints?: { enabled: boolean; max: number };
  };
}

/** Result from generatePromptPreview — includes assembled text and metadata for Phase B. */
export interface PromptPreviewResult {
  text: string;
  tokenEstimate: number;
  sections: { name: string; charCount: number; tokenEstimate: number }[];
}
