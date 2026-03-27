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

  discoverSources: (): Promise<unknown[]> =>
    ipcRenderer.invoke('discover-sources'),

  loadSummary: (docId: string): Promise<unknown> =>
    ipcRenderer.invoke('load-summary', docId),

  loadSnapshot: (sourceId: string): Promise<string> =>
    ipcRenderer.invoke('load-snapshot', sourceId),

  loadTaxonomy: (): Promise<unknown> =>
    ipcRenderer.invoke('load-taxonomy'),

  addTaxonomyNode: (req: { pov: string; category: string; label: string; description: string; interpretations?: { accelerationist: string; safetyist: string; skeptic: string }; docId?: string; conceptIndex?: number }): Promise<unknown> =>
    ipcRenderer.invoke('add-taxonomy-node', req),

  setApiKey: (key: string, backend?: string): Promise<void> =>
    ipcRenderer.invoke('set-api-key', key, backend),

  hasApiKey: (backend?: string): Promise<boolean> =>
    ipcRenderer.invoke('has-api-key', backend),

  loadAIModels: (): Promise<unknown> =>
    ipcRenderer.invoke('load-ai-models'),

  refreshAIModels: (): Promise<unknown> =>
    ipcRenderer.invoke('refresh-ai-models'),

  loadEmbeddings: (): Promise<Record<string, number[]> | null> =>
    ipcRenderer.invoke('load-embeddings'),

  computeEmbeddings: (texts: string[]): Promise<number[][]> =>
    ipcRenderer.invoke('compute-embeddings', texts),

  computeQueryEmbedding: (text: string): Promise<number[]> =>
    ipcRenderer.invoke('compute-query-embedding', text),

  generateContent: (systemPrompt: string, userPrompt: string, model?: string): Promise<string> =>
    ipcRenderer.invoke('generate-content', systemPrompt, userPrompt, model),

  openInTaxonomyEditor: (nodeId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('open-in-taxonomy-editor', nodeId),

  onMenuSettings: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-settings', handler);
    return () => { ipcRenderer.removeListener('menu-settings', handler); };
  },
});
