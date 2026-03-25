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
  checkDataUpdates: () => Promise<unknown>;
  pullDataUpdates: () => Promise<unknown>;
  loadAIModels: () => Promise<unknown>;
  refreshAIModels: () => Promise<unknown>;
  setApiKey: (key: string, backend?: string) => Promise<void>;
  hasApiKey: (backend?: string) => Promise<boolean>;
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
  updateEdgeStatus: (index: number, status: string) => Promise<unknown>;
  bulkUpdateEdges: (indices: number[], status: string) => Promise<unknown>;
  listDebateSessions: () => Promise<unknown[]>;
  loadDebateSession: (id: string) => Promise<unknown>;
  saveDebateSession: (session: unknown) => Promise<void>;
  deleteDebateSession: (id: string) => Promise<void>;
  exportDebateToFile: (session: unknown) => Promise<{ cancelled: boolean; filePath?: string }>;
  fetchUrlContent: (url: string) => Promise<{ content: string; error?: string }>;
  pickDocumentFile: () => Promise<{ cancelled: boolean; filePath?: string; content?: string }>;
  terminalSpawn: () => Promise<void>;
  terminalWrite: (data: string) => Promise<void>;
  terminalResize: (cols: number, rows: number) => Promise<void>;
  terminalKill: () => Promise<void>;
  onTerminalData: (callback: (data: string) => void) => () => void;
  onTerminalExit: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
