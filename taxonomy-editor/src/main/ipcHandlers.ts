// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import {
  readTaxonomyFile,
  writeTaxonomyFile,
  readAllConflictFiles,
  writeConflictFile,
  createConflictFile,
  deleteConflictFile,
  readEdgesFile,
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
import { debateToText, debateToMarkdown, debateToPdf } from './debateExport';
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

  ipcMain.handle('load-edges', () => {
    return readEdgesFile();
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

  ipcMain.handle('export-debate-to-file', async (event, session: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { cancelled: true };

    const data = session as { title?: string };
    const defaultName = (data.title || 'debate')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 60);

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Debate',
      defaultPath: `${defaultName}.json`,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Plain Text', extensions: ['txt'] },
        { name: 'PDF', extensions: ['pdf'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { cancelled: true };
    }

    const fs = await import('fs');
    const filePath = result.filePath;
    const ext = filePath.split('.').pop()?.toLowerCase() || 'json';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const debate = session as any;

    switch (ext) {
      case 'md': {
        const md = debateToMarkdown(debate);
        fs.writeFileSync(filePath, md, 'utf-8');
        break;
      }
      case 'txt': {
        const txt = debateToText(debate);
        fs.writeFileSync(filePath, txt, 'utf-8');
        break;
      }
      case 'pdf': {
        const pdfBuffer = await debateToPdf(debate);
        fs.writeFileSync(filePath, pdfBuffer);
        break;
      }
      default: {
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2) + '\n', 'utf-8');
        break;
      }
    }

    return { cancelled: false, filePath };
  });
}
