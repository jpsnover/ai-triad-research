import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
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

  computeEmbeddings: (texts: string[]): Promise<{ vectors: number[][] }> =>
    ipcRenderer.invoke('compute-embeddings', texts),

  computeQueryEmbedding: (text: string): Promise<{ vector: number[] }> =>
    ipcRenderer.invoke('compute-query-embedding', text),
});
