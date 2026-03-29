// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getTaxonomyDirs: (): Promise<string[]> =>
    ipcRenderer.invoke('get-taxonomy-dirs'),

  getActiveTaxonomyDir: (): Promise<string> =>
    ipcRenderer.invoke('get-active-taxonomy-dir'),

  setTaxonomyDir: (dirName: string): Promise<void> =>
    ipcRenderer.invoke('set-taxonomy-dir', dirName),

  loadTaxonomyFile: (pov: string): Promise<unknown> =>
    ipcRenderer.invoke('load-taxonomy-file', pov),

  saveTaxonomyFile: (pov: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('save-taxonomy-file', pov, data),

  loadPolicyRegistry: (): Promise<unknown> =>
    ipcRenderer.invoke('load-policy-registry'),

  loadConflictFiles: (): Promise<unknown[]> =>
    ipcRenderer.invoke('load-conflict-files'),

  saveConflictFile: (claimId: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('save-conflict-file', claimId, data),

  createConflictFile: (claimId: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('create-conflict-file', claimId, data),

  deleteConflictFile: (claimId: string): Promise<void> =>
    ipcRenderer.invoke('delete-conflict-file', claimId),

  isDataAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('is-data-available'),

  getDataRoot: (): Promise<string> =>
    ipcRenderer.invoke('get-data-root'),

  cloneDataRepo: (targetPath: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('clone-data-repo', targetPath),

  checkDataUpdates: (): Promise<unknown> =>
    ipcRenderer.invoke('check-data-updates'),

  pullDataUpdates: (): Promise<unknown> =>
    ipcRenderer.invoke('pull-data-updates'),

  loadAIModels: (): Promise<unknown> =>
    ipcRenderer.invoke('load-ai-models'),

  refreshAIModels: (): Promise<unknown> =>
    ipcRenderer.invoke('refresh-ai-models'),

  setApiKey: (key: string, backend?: string): Promise<void> =>
    ipcRenderer.invoke('set-api-key', key, backend),

  hasApiKey: (backend?: string): Promise<boolean> =>
    ipcRenderer.invoke('has-api-key', backend),

  computeEmbeddings: (texts: string[], ids?: string[]): Promise<{ vectors: number[][] }> =>
    ipcRenderer.invoke('compute-embeddings', texts, ids),

  updateNodeEmbeddings: (nodes: { id: string; text: string; pov: string }[]): Promise<void> =>
    ipcRenderer.invoke('update-node-embeddings', nodes),

  computeQueryEmbedding: (text: string): Promise<{ vector: number[] }> =>
    ipcRenderer.invoke('compute-query-embedding', text),

  generateText: (prompt: string, model?: string): Promise<{ text: string }> =>
    ipcRenderer.invoke('generate-text', prompt, model),

  generateTextWithSearch: (prompt: string, model?: string): Promise<{ text: string; searchQueries?: string[] }> =>
    ipcRenderer.invoke('generate-text-with-search', prompt, model),

  // Harvest
  harvestCreateConflict: (conflict: Record<string, unknown>): Promise<{ created: boolean }> =>
    ipcRenderer.invoke('harvest-create-conflict', conflict),
  harvestAddDebateRef: (nodeId: string, debateId: string): Promise<{ updated: boolean }> =>
    ipcRenderer.invoke('harvest-add-debate-ref', nodeId, debateId),
  harvestUpdateSteelman: (nodeId: string, attackerPov: string, newText: string): Promise<{ updated: boolean }> =>
    ipcRenderer.invoke('harvest-update-steelman', nodeId, attackerPov, newText),
  harvestAddVerdict: (conflictId: string, verdict: Record<string, unknown>): Promise<{ updated: boolean }> =>
    ipcRenderer.invoke('harvest-add-verdict', conflictId, verdict),
  harvestQueueConcept: (concept: Record<string, unknown>): Promise<{ queued: boolean }> =>
    ipcRenderer.invoke('harvest-queue-concept', concept),

  // Diagnostics window
  openDiagnosticsWindow: (): Promise<void> => ipcRenderer.invoke('open-diagnostics-window'),
  sendDiagnosticsState: (state: unknown): void => ipcRenderer.send('diagnostics-state-update', state),
  onDiagnosticsStateUpdate: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('diagnostics-state-update', listener);
    return () => { ipcRenderer.removeListener('diagnostics-state-update', listener); };
  },
  harvestSaveManifest: (manifest: Record<string, unknown>): Promise<{ saved: boolean }> =>
    ipcRenderer.invoke('harvest-save-manifest', manifest),

  nliClassify: (pairs: Array<{ text_a: string; text_b: string }>): Promise<{ results: Array<{ nli_label: string; nli_entailment: number; nli_neutral: number; nli_contradiction: number; margin: number }> }> =>
    ipcRenderer.invoke('nli-classify', pairs),

  onGenerateTextProgress: (callback: (progress: { attempt: number; maxRetries: number; backoffSeconds: number; limitType: string; limitMessage: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { attempt: number; maxRetries: number; backoffSeconds: number; limitType: string; limitMessage: string }) => callback(progress);
    ipcRenderer.on('generate-text-progress', listener);
    return () => { ipcRenderer.removeListener('generate-text-progress', listener); };
  },

  onReloadTaxonomy: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('reload-taxonomy', listener);
    return () => { ipcRenderer.removeListener('reload-taxonomy', listener); };
  },

  onFocusNode: (callback: (nodeId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, nodeId: string) => callback(nodeId);
    ipcRenderer.on('focus-node', listener);
    return () => { ipcRenderer.removeListener('focus-node', listener); };
  },

  growWindow: (deltaWidth: number): Promise<void> =>
    ipcRenderer.invoke('grow-window', deltaWidth),

  shrinkWindow: (deltaWidth: number): Promise<void> =>
    ipcRenderer.invoke('shrink-window', deltaWidth),

  isMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke('is-maximized'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  // Node ↔ Source index
  buildNodeSourceIndex: (): Promise<unknown> =>
    ipcRenderer.invoke('build-node-source-index'),

  // Policy ↔ Source index
  buildPolicySourceIndex: (): Promise<unknown> =>
    ipcRenderer.invoke('build-policy-source-index'),

  // Edges
  loadEdges: (): Promise<unknown> =>
    ipcRenderer.invoke('load-edges'),

  updateEdgeStatus: (index: number, status: string): Promise<unknown> =>
    ipcRenderer.invoke('update-edge-status', index, status),

  bulkUpdateEdges: (indices: number[], status: string): Promise<unknown> =>
    ipcRenderer.invoke('bulk-update-edges', indices, status),

  // Chat sessions
  listChatSessions: (): Promise<unknown[]> =>
    ipcRenderer.invoke('list-chat-sessions'),

  loadChatSession: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('load-chat-session', id),

  saveChatSession: (session: unknown): Promise<void> =>
    ipcRenderer.invoke('save-chat-session', session),

  deleteChatSession: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-chat-session', id),

  // Debate sessions
  listDebateSessions: (): Promise<unknown[]> =>
    ipcRenderer.invoke('list-debate-sessions'),

  loadDebateSession: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('load-debate-session', id),

  saveDebateSession: (session: unknown): Promise<void> =>
    ipcRenderer.invoke('save-debate-session', session),

  deleteDebateSession: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-debate-session', id),

  exportDebateToFile: (session: unknown): Promise<{ cancelled: boolean; filePath?: string }> =>
    ipcRenderer.invoke('export-debate-to-file', session),

  // URL fetch (from main process to avoid CSP)
  fetchUrlContent: (url: string): Promise<{ content: string; error?: string }> =>
    ipcRenderer.invoke('fetch-url-content', url),

  // File picker
  pickDocumentFile: (): Promise<{ cancelled: boolean; filePath?: string; content?: string }> =>
    ipcRenderer.invoke('pick-document-file'),

  // Terminal
  terminalSpawn: (): Promise<void> =>
    ipcRenderer.invoke('terminal:spawn'),
  terminalWrite: (data: string): Promise<void> =>
    ipcRenderer.invoke('terminal:write', data),
  terminalResize: (cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', cols, rows),
  terminalKill: (): Promise<void> =>
    ipcRenderer.invoke('terminal:kill'),
  onTerminalData: (callback: (data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on('terminal:data', handler);
    return () => { ipcRenderer.removeListener('terminal:data', handler); };
  },
  onTerminalExit: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('terminal:exit', handler);
    return () => { ipcRenderer.removeListener('terminal:exit', handler); };
  },
});
