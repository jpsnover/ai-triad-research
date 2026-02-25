import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  discoverSources: (): Promise<unknown[]> =>
    ipcRenderer.invoke('discover-sources'),

  loadSummary: (docId: string): Promise<unknown> =>
    ipcRenderer.invoke('load-summary', docId),

  loadSnapshot: (sourceId: string): Promise<string> =>
    ipcRenderer.invoke('load-snapshot', sourceId),

  loadTaxonomy: (): Promise<unknown> =>
    ipcRenderer.invoke('load-taxonomy'),

  addTaxonomyNode: (req: { pov: string; category: string; label: string; description: string }): Promise<unknown> =>
    ipcRenderer.invoke('add-taxonomy-node', req),
});
