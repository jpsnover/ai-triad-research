// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface ElectronAPI {
  getTaxonomyDirs: () => Promise<string[]>;
  getActiveTaxonomyDir: () => Promise<string>;
  setTaxonomyDir: (dirName: string) => Promise<void>;
  loadTaxonomyFile: (pov: string) => Promise<unknown>;
  saveTaxonomyFile: (pov: string, data: unknown) => Promise<void>;
  loadConflictFiles: () => Promise<unknown[]>;
  saveConflictFile: (claimId: string, data: unknown) => Promise<void>;
  createConflictFile: (claimId: string, data: unknown) => Promise<void>;
  deleteConflictFile: (claimId: string) => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  hasApiKey: () => Promise<boolean>;
  computeEmbeddings: (texts: string[], ids?: string[]) => Promise<{ vectors: number[][] }>;
  updateNodeEmbeddings: (nodes: { id: string; text: string; pov: string }[]) => Promise<void>;
  computeQueryEmbedding: (text: string) => Promise<{ vector: number[] }>;
  generateText: (prompt: string, model?: string) => Promise<{ text: string }>;
  onGenerateTextProgress: (callback: (progress: { attempt: number; maxRetries: number; backoffSeconds: number; limitType: string; limitMessage: string }) => void) => () => void;
  onReloadTaxonomy: (callback: () => void) => () => void;
  onFocusNode: (callback: (nodeId: string) => void) => () => void;
  growWindow: (deltaWidth: number) => Promise<void>;
  shrinkWindow: (deltaWidth: number) => Promise<void>;
  isMaximized: () => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
  loadEdges: () => Promise<unknown>;
  listDebateSessions: () => Promise<unknown[]>;
  loadDebateSession: (id: string) => Promise<unknown>;
  saveDebateSession: (session: unknown) => Promise<void>;
  deleteDebateSession: (id: string) => Promise<void>;
  exportDebateToFile: (session: unknown) => Promise<{ cancelled: boolean; filePath?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
