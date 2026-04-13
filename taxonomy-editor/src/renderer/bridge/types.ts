// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AppAPI — the bridge interface between the renderer and the backend.
 *
 * In Electron builds, this is implemented by delegating to window.electronAPI (IPC).
 * In web/container builds, this is implemented via REST + WebSocket calls to the server.
 *
 * Every renderer file should import `api` from '@bridge' instead of accessing
 * window.electronAPI directly.
 */
export interface AppAPI {
  // --- Taxonomy directories ---
  getTaxonomyDirs: () => Promise<string[]>;
  getActiveTaxonomyDir: () => Promise<string>;
  setTaxonomyDir: (dirName: string) => Promise<void>;

  // --- Taxonomy CRUD ---
  loadTaxonomyFile: (pov: string) => Promise<unknown>;
  saveTaxonomyFile: (pov: string, data: unknown) => Promise<void>;
  loadPolicyRegistry: () => Promise<unknown>;
  loadEdges: () => Promise<unknown>;
  updateEdgeStatus: (index: number, status: string) => Promise<unknown>;
  bulkUpdateEdges: (indices: number[], status: string) => Promise<unknown>;
  buildNodeSourceIndex: () => Promise<unknown>;
  buildPolicySourceIndex: () => Promise<unknown>;

  // --- Conflict CRUD ---
  loadConflictFiles: () => Promise<unknown[]>;
  loadConflictClusters: () => Promise<unknown | null>;
  saveConflictFile: (claimId: string, data: unknown) => Promise<void>;
  createConflictFile: (claimId: string, data: unknown) => Promise<void>;
  deleteConflictFile: (claimId: string) => Promise<void>;

  // --- Summaries & Sources ---
  discoverSources: () => Promise<unknown[]>;
  loadSummary: (docId: string) => Promise<unknown | null>;
  loadSnapshot: (sourceId: string) => Promise<{ content: string } | null>;

  // --- Data management ---
  isDataAvailable: () => Promise<boolean>;
  getDataRoot: () => Promise<string>;
  cloneDataRepo: (targetPath: string) => Promise<{ success: boolean; message: string }>;
  setDataRoot: (newRoot: string) => Promise<void>;
  pickDirectory: (defaultPath?: string) => Promise<{ cancelled: boolean; path?: string }>;
  checkDataUpdates: () => Promise<unknown>;
  pullDataUpdates: () => Promise<unknown>;

  // --- AI models & keys ---
  loadAIModels: () => Promise<unknown>;
  refreshAIModels: () => Promise<unknown>;
  setApiKey: (key: string, backend?: string) => Promise<void>;
  hasApiKey: (backend?: string) => Promise<boolean>;

  // --- AI generation ---
  generateText: (prompt: string, model?: string, timeoutMs?: number) => Promise<{ text: string }>;
  generateTextWithSearch: (prompt: string, model?: string) => Promise<{ text: string; searchQueries?: string[] }>;
  setDebateTemperature: (temp: number | null) => Promise<void>;

  // --- Embeddings & NLI ---
  computeEmbeddings: (texts: string[], ids?: string[]) => Promise<{ vectors: number[][] }>;
  updateNodeEmbeddings: (nodes: { id: string; text: string; pov: string }[]) => Promise<void>;
  computeQueryEmbedding: (text: string) => Promise<{ vector: number[] }>;
  nliClassify: (pairs: Array<{ text_a: string; text_b: string }>) => Promise<{
    results: Array<{
      nli_label: string;
      nli_entailment: number;
      nli_neutral: number;
      nli_contradiction: number;
      margin: number;
    }>;
  }>;

  // --- Debate sessions ---
  listDebateSessions: () => Promise<unknown[]>;
  loadDebateSession: (id: string) => Promise<unknown>;
  saveDebateSession: (session: unknown) => Promise<void>;
  deleteDebateSession: (id: string) => Promise<void>;
  exportDebateToFile: (session: unknown, format?: 'json' | 'markdown' | 'text' | 'pdf' | 'package') => Promise<{ cancelled: boolean; filePath?: string }>;

  // --- Chat sessions ---
  listChatSessions: () => Promise<unknown[]>;
  loadChatSession: (id: string) => Promise<unknown>;
  saveChatSession: (session: unknown) => Promise<void>;
  deleteChatSession: (id: string) => Promise<void>;

  // --- Harvest ---
  harvestCreateConflict: (conflict: Record<string, unknown>) => Promise<{ created: boolean }>;
  harvestAddDebateRef: (nodeId: string, debateId: string) => Promise<{ updated: boolean }>;
  harvestUpdateSteelman: (nodeId: string, attackerPov: string, newText: string) => Promise<{ updated: boolean }>;
  harvestAddVerdict: (conflictId: string, verdict: Record<string, unknown>) => Promise<{ updated: boolean }>;
  harvestQueueConcept: (concept: Record<string, unknown>) => Promise<{ queued: boolean }>;
  harvestSaveManifest: (manifest: Record<string, unknown>) => Promise<{ saved: boolean }>;

  // --- Proposals ---
  listProposals: () => Promise<unknown[]>;
  saveProposal: (filename: string, data: unknown) => Promise<{ saved?: boolean; error?: string }>;

  // --- PowerShell prompts ---
  readPsPrompt: (promptName: string) => Promise<{ text: string | null; error?: string }>;
  listPsPrompts: () => Promise<string[]>;

  // --- Diagnostics ---
  openDiagnosticsWindow: () => Promise<void>;
  openPovProgressionWindow: () => Promise<void>;
  closeDiagnosticsWindow: () => Promise<void>;
  sendDiagnosticsState: (state: unknown) => void;
  getCliFileArg: () => Promise<{ type: string; path: string; data?: unknown; error?: string } | null>;

  // --- Terminal ---
  terminalSpawn: () => Promise<void>;
  terminalWrite: (data: string) => Promise<void>;
  terminalResize: (cols: number, rows: number) => Promise<void>;
  terminalKill: () => Promise<void>;

  // --- File operations ---
  fetchUrlContent: (url: string) => Promise<{ content: string; error?: string }>;
  pickDocumentFile: () => Promise<{ cancelled: boolean; filePath?: string; content?: string }>;
  clipboardWriteText: (text: string) => Promise<void>;

  // --- Window control ---
  growWindow: (deltaWidth: number) => Promise<void>;
  shrinkWindow: (deltaWidth: number) => Promise<void>;
  isMaximized: () => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;

  // --- Event listeners (return unsubscribe function) ---
  onDiagnosticsStateUpdate: (callback: (state: unknown) => void) => () => void;
  onDiagnosticsPopoutClosed: (callback: () => void) => () => void;
  onGenerateTextProgress: (callback: (progress: {
    attempt: number;
    maxRetries: number;
    backoffSeconds: number;
    limitType: string;
    limitMessage: string;
  }) => void) => () => void;
  onReloadTaxonomy: (callback: () => void) => () => void;
  onFocusNode: (callback: (nodeId: string) => void) => () => void;
  onTerminalData: (callback: (data: string) => void) => () => void;
  onTerminalExit: (callback: () => void) => () => void;
}
