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

  addTaxonomyNode: (req: { pov: string; category: string; label: string; description: string; interpretations?: { accelerationist: string; safetyist: string; skeptic: string } }): Promise<unknown> =>
    ipcRenderer.invoke('add-taxonomy-node', req),

  setApiKey: (key: string): Promise<void> =>
    ipcRenderer.invoke('set-api-key', key),

  hasApiKey: (): Promise<boolean> =>
    ipcRenderer.invoke('has-api-key'),

  computeEmbeddings: (texts: string[]): Promise<number[][]> =>
    ipcRenderer.invoke('compute-embeddings', texts),

  computeQueryEmbedding: (text: string): Promise<number[]> =>
    ipcRenderer.invoke('compute-query-embedding', text),
});
