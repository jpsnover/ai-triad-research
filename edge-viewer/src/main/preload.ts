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

  readAllNodes: (): Promise<{ pov: string; nodes: unknown[] }[]> =>
    ipcRenderer.invoke('read-all-nodes'),

  readEdges: (): Promise<unknown> =>
    ipcRenderer.invoke('read-edges'),

  updateEdgeStatus: (index: number, status: string): Promise<{ index: number; status: string }> =>
    ipcRenderer.invoke('update-edge-status', index, status),

  bulkUpdateEdges: (indices: number[], status: string): Promise<{ updated: number; status: string }> =>
    ipcRenderer.invoke('bulk-update-edges', indices, status),
});

declare global {
  interface Window {
    electronAPI: {
      getTaxonomyDirs: () => Promise<string[]>;
      getActiveTaxonomyDir: () => Promise<string>;
      setTaxonomyDir: (dirName: string) => Promise<void>;
      readAllNodes: () => Promise<{ pov: string; nodes: unknown[] }[]>;
      readEdges: () => Promise<unknown>;
      updateEdgeStatus: (index: number, status: string) => Promise<{ index: number; status: string }>;
      bulkUpdateEdges: (indices: number[], status: string) => Promise<{ updated: number; status: string }>;
    };
  }
}
