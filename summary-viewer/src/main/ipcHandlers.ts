import { ipcMain } from 'electron';
import { discoverSources, loadSummary, loadTaxonomy, readSnapshot, addTaxonomyNode } from './fileIO';
import type { AddTaxonomyNodeRequest } from './fileIO';

export function registerIpcHandlers(): void {
  ipcMain.handle('discover-sources', () => {
    return discoverSources();
  });

  ipcMain.handle('load-summary', (_event, docId: string) => {
    return loadSummary(docId);
  });

  ipcMain.handle('load-snapshot', (_event, sourceId: string) => {
    return readSnapshot(sourceId);
  });

  ipcMain.handle('load-taxonomy', () => {
    return loadTaxonomy();
  });

  ipcMain.handle('add-taxonomy-node', (_event, req: AddTaxonomyNodeRequest) => {
    return addTaxonomyNode(req);
  });
}
