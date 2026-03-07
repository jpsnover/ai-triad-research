// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain } from 'electron';
import {
  getTaxonomyDirs,
  getActiveTaxonomyDir,
  setTaxonomyDir,
  readAllNodes,
  readEdges,
  writeEdges,
} from './fileIO';

const CHANNELS = [
  'get-taxonomy-dirs',
  'get-active-taxonomy-dir',
  'set-taxonomy-dir',
  'read-all-nodes',
  'read-edges',
  'update-edge-status',
  'bulk-update-edges',
];

export function registerIpcHandlers(): void {
  ipcMain.handle('get-taxonomy-dirs', () => getTaxonomyDirs());
  ipcMain.handle('get-active-taxonomy-dir', () => getActiveTaxonomyDir());
  ipcMain.handle('set-taxonomy-dir', (_e, dirName: string) => setTaxonomyDir(dirName));
  ipcMain.handle('read-all-nodes', () => readAllNodes());
  ipcMain.handle('read-edges', () => readEdges());

  ipcMain.handle(
    'update-edge-status',
    (_e, index: number, status: string) => {
      const data = readEdges() as Record<string, unknown>;
      if (!data) throw new Error('No edges.json found');
      const edges = data['edges'] as Record<string, unknown>[];
      if (index < 0 || index >= edges.length) throw new Error(`Index ${index} out of range`);
      edges[index]['status'] = status;
      writeEdges(data);
      return { index, status };
    }
  );

  ipcMain.handle(
    'bulk-update-edges',
    (_e, indices: number[], status: string) => {
      const data = readEdges() as Record<string, unknown>;
      if (!data) throw new Error('No edges.json found');
      const edges = data['edges'] as Record<string, unknown>[];
      let updated = 0;
      for (const idx of indices) {
        if (idx >= 0 && idx < edges.length) {
          edges[idx]['status'] = status;
          updated++;
        }
      }
      writeEdges(data);
      return { updated, status };
    }
  );
}

export function cleanupIpcHandlers(): void {
  for (const ch of CHANNELS) {
    ipcMain.removeHandler(ch);
  }
}
