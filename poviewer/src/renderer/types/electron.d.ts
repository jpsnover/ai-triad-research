// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface ExcerptMappingResult {
  nodeId: string;
  nodeLabel: string;
  category: string;
  camp: string;
  alignment: 'agrees' | 'contradicts';
  strength: 'strong' | 'moderate' | 'weak';
  explanation: string;
}

export interface ElectronAPI {
  // === Taxonomy Directory APIs ===
  getTaxonomyDirs: () => Promise<string[]>;
  getActiveTaxonomyDir: () => Promise<string>;
  setTaxonomyDir: (dirName: string) => Promise<void>;

  // === Existing APIs ===
  loadTaxonomyFile: (pov: string) => Promise<unknown>;
  loadSnapshot: (sourceId: string) => Promise<string>;
  loadSettings: () => Promise<unknown>;
  saveSettings: (data: unknown) => Promise<void>;
  openTaxonomyDialog: () => Promise<{ filePath: string; data: unknown } | null>;
  openSourceFileDialog: () => Promise<string[] | null>;
  addSource: (meta: { id: string; title: string; sourceType: string; url: string | null; addedAt: string; status: string }) => Promise<void>;
  readSourceFile: (filePath: string) => Promise<string>;

  // === Pipeline Discovery APIs ===
  discoverSources: () => Promise<unknown[]>;
  loadPipelineSummary: (docId: string) => Promise<unknown>;

  // === AI Engine APIs ===
  storeApiKey: (key: string) => Promise<void>;
  getApiKey: () => Promise<string | null>;
  validateApiKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
  runAnalysis: (sourceId: string, sourceText: string) => Promise<unknown>;
  cancelAnalysis: (sourceId: string) => Promise<void>;
  getAnalysisStatus: (sourceId: string) => Promise<{ running: boolean }>;

  // === PDF APIs ===
  getPdfBytes: (sourceId: string) => Promise<ArrayBuffer | null>;
  extractPdfText: (filePath: string) => Promise<{ fullText: string; pageBreaks: number[] }>;

  openExternalUrl: (url: string) => Promise<void>;
  analyzeExcerpt: (excerptText: string) => Promise<ExcerptMappingResult[]>;

  // === Annotation APIs ===
  saveAnnotations: (sourceId: string, annotations: unknown) => Promise<void>;
  loadAnnotations: (sourceId: string) => Promise<unknown>;

  // === Aggregation APIs ===
  getAggregation: (sourceIds: string[]) => Promise<Record<string, unknown>>;
  getGaps: (sourceIds: string[]) => Promise<string>;

  // === Export APIs ===
  exportBundle: (sourceIds: string[], format: string) => Promise<string | null>;
  exportMarkdown: (sourceIds: string[]) => Promise<string>;

  // === Long Doc APIs ===
  chunkDocument: (text: string) => Promise<string[]>;
  getChunkStatus: (sourceId: string) => Promise<{ running: boolean }>;

  // === Settings APIs ===
  getAiSettings: () => Promise<unknown>;
  saveAiSettings: (settings: unknown) => Promise<void>;
  getPromptOverrides: () => Promise<unknown>;
  savePromptOverrides: (overrides: unknown) => Promise<void>;

  // === Analysis Result I/O ===
  loadAnalysisResult: (sourceId: string) => Promise<unknown>;

  // === Event Listeners ===
  onAnalysisProgress: (callback: (event: unknown) => void) => () => void;
  onTaxonomyChanged: (callback: (event: { pov: string; data: unknown }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
