// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain } from 'electron';
import {
  discoverSources,
  loadSummary,
  loadTaxonomy,
  readSnapshot,
  addTaxonomyNode,
  getTaxonomyDirs,
  getActiveTaxonomyDirName,
  setActiveTaxonomyDir,
} from './fileIO';
import type { AddTaxonomyNodeRequest } from './fileIO';
import { computeEmbeddings, computeQueryEmbedding } from './embeddings';
import { generateContent } from './generateContent';
import { storeApiKey, hasApiKey } from './apiKeyStore';

export function registerIpcHandlers(): void {
  ipcMain.handle('get-taxonomy-dirs', () => {
    return getTaxonomyDirs();
  });

  ipcMain.handle('get-active-taxonomy-dir', () => {
    return getActiveTaxonomyDirName();
  });

  ipcMain.handle('set-taxonomy-dir', (_event, dirName: string) => {
    setActiveTaxonomyDir(dirName);
  });

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

  ipcMain.handle('set-api-key', (_event, key: string) => {
    storeApiKey(key);
  });

  ipcMain.handle('has-api-key', () => {
    return hasApiKey();
  });

  ipcMain.handle('compute-embeddings', (_event, texts: string[]) => {
    return computeEmbeddings(texts);
  });

  ipcMain.handle('compute-query-embedding', (_event, text: string) => {
    return computeQueryEmbedding(text);
  });

  ipcMain.handle('generate-content', (_event, systemPrompt: string, userPrompt: string) => {
    return generateContent(systemPrompt, userPrompt);
  });
}
