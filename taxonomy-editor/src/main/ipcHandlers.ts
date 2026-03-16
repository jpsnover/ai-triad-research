// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain, shell } from 'electron';
import {
  readTaxonomyFile,
  writeTaxonomyFile,
  readAllConflictFiles,
  writeConflictFile,
  createConflictFile,
  deleteConflictFile,
  getTaxonomyDirs,
  getActiveTaxonomyDirName,
  setActiveTaxonomyDir,
} from './fileIO';
import {
  listDebateSessions,
  loadDebateSession,
  saveDebateSession,
  deleteDebateSession,
} from './debateIO';
import { storeApiKey, hasApiKey } from './apiKeyStore';
import { computeEmbeddings, computeQueryEmbedding, generateText, updateNodeEmbeddings } from './embeddings';
import type { NodeEmbeddingInput } from './embeddings';

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

  ipcMain.handle('load-taxonomy-file', (_event, pov: string) => {
    return readTaxonomyFile(pov);
  });

  ipcMain.handle('save-taxonomy-file', (_event, pov: string, data: unknown) => {
    writeTaxonomyFile(pov, data);
  });

  ipcMain.handle('load-conflict-files', () => {
    return readAllConflictFiles();
  });

  ipcMain.handle('save-conflict-file', (_event, claimId: string, data: unknown) => {
    writeConflictFile(claimId, data);
  });

  ipcMain.handle('create-conflict-file', (_event, claimId: string, data: unknown) => {
    createConflictFile(claimId, data);
  });

  ipcMain.handle('delete-conflict-file', (_event, claimId: string) => {
    deleteConflictFile(claimId);
  });

  ipcMain.handle('set-api-key', (_event, key: string) => {
    storeApiKey(key);
  });

  ipcMain.handle('has-api-key', () => {
    return hasApiKey();
  });

  ipcMain.handle('compute-embeddings', async (_event, texts: string[], ids?: string[]) => {
    return { vectors: await computeEmbeddings(texts, ids) };
  });

  ipcMain.handle('compute-query-embedding', async (_event, text: string) => {
    return { vector: await computeQueryEmbedding(text) };
  });

  ipcMain.handle('update-node-embeddings', async (_event, nodes: NodeEmbeddingInput[]) => {
    await updateNodeEmbeddings(nodes);
  });

  ipcMain.handle('generate-text', async (event, prompt: string, model?: string) => {
    return {
      text: await generateText(prompt, model, (progress) => {
        event.sender.send('generate-text-progress', progress);
      }),
    };
  });

  ipcMain.handle('open-external', (_event, url: string) => {
    // Only allow http/https URLs
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // ── Debate session handlers ────────────────────────────
  ipcMain.handle('list-debate-sessions', () => {
    return listDebateSessions();
  });

  ipcMain.handle('load-debate-session', (_event, id: string) => {
    return loadDebateSession(id);
  });

  ipcMain.handle('save-debate-session', (_event, session: unknown) => {
    saveDebateSession(session);
  });

  ipcMain.handle('delete-debate-session', (_event, id: string) => {
    deleteDebateSession(id);
  });
}
