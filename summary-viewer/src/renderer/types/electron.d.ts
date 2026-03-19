// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface AddTaxonomyNodeRequest {
  pov: string;
  category: string;
  label: string;
  description: string;
  interpretations?: {
    accelerationist: string;
    safetyist: string;
    skeptic: string;
  };
  docId?: string;
  conceptIndex?: number;
}

export interface AddTaxonomyNodeResult {
  success: boolean;
  nodeId: string;
  error?: string;
}

export interface ElectronAPI {
  getTaxonomyDirs: () => Promise<string[]>;
  getActiveTaxonomyDir: () => Promise<string>;
  setTaxonomyDir: (dirName: string) => Promise<void>;
  discoverSources: () => Promise<unknown[]>;
  loadSummary: (docId: string) => Promise<unknown>;
  loadSnapshot: (sourceId: string) => Promise<string>;
  loadTaxonomy: () => Promise<unknown>;
  addTaxonomyNode: (req: AddTaxonomyNodeRequest) => Promise<AddTaxonomyNodeResult>;
  setApiKey: (key: string) => Promise<void>;
  hasApiKey: () => Promise<boolean>;
  computeEmbeddings: (texts: string[]) => Promise<number[][]>;
  computeQueryEmbedding: (text: string) => Promise<number[]>;
  generateContent: (systemPrompt: string, userPrompt: string) => Promise<string>;
  openInTaxonomyEditor: (nodeId: string) => Promise<{ ok: boolean; error?: string }>;
  onMenuConfigureApiKey: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
