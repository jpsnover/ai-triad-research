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

  loadConflictFiles: (): Promise<unknown[]> =>
    ipcRenderer.invoke('load-conflict-files'),

  saveConflictFile: (claimId: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('save-conflict-file', claimId, data),

  createConflictFile: (claimId: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('create-conflict-file', claimId, data),

  deleteConflictFile: (claimId: string): Promise<void> =>
    ipcRenderer.invoke('delete-conflict-file', claimId),

  setApiKey: (key: string): Promise<void> =>
    ipcRenderer.invoke('set-api-key', key),

  hasApiKey: (): Promise<boolean> =>
    ipcRenderer.invoke('has-api-key'),

  computeEmbeddings: (texts: string[], ids?: string[]): Promise<{ vectors: number[][] }> =>
    ipcRenderer.invoke('compute-embeddings', texts, ids),

  updateNodeEmbeddings: (nodes: { id: string; text: string; pov: string }[]): Promise<void> =>
    ipcRenderer.invoke('update-node-embeddings', nodes),

  computeQueryEmbedding: (text: string): Promise<{ vector: number[] }> =>
    ipcRenderer.invoke('compute-query-embedding', text),

  generateText: (prompt: string, model?: string): Promise<{ text: string }> =>
    ipcRenderer.invoke('generate-text', prompt, model),

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

  // Edges
  loadEdges: (): Promise<unknown> =>
    ipcRenderer.invoke('load-edges'),

  // Debate sessions
  listDebateSessions: (): Promise<unknown[]> =>
    ipcRenderer.invoke('list-debate-sessions'),

  loadDebateSession: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('load-debate-session', id),

  saveDebateSession: (session: unknown): Promise<void> =>
    ipcRenderer.invoke('save-debate-session', session),

  deleteDebateSession: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-debate-session', id),
});
