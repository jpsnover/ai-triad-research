// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain, shell, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import {
  readTaxonomyFile,
  writeTaxonomyFile,
  readAllConflictFiles,
  writeConflictFile,
  createConflictFile,
  deleteConflictFile,
  readEdgesFile,
  writeEdgesFile,
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
import { refreshAIModels } from './modelDiscovery';
import { checkForDataUpdates, pullDataUpdates } from './dataUpdateChecker';
import type { NodeEmbeddingInput } from './embeddings';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

export function registerIpcHandlers(): void {
  ipcMain.handle('load-ai-models', () => {
    try {
      const configPath = path.join(PROJECT_ROOT, 'ai-models.json');
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
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

  ipcMain.handle('check-data-updates', async () => {
    return checkForDataUpdates();
  });

  ipcMain.handle('pull-data-updates', async () => {
    return pullDataUpdates();
  });

  ipcMain.handle('refresh-ai-models', async () => {
    return refreshAIModels();
  });

  ipcMain.handle('set-api-key', (_event, key: string, backend?: string) => {
    storeApiKey(key, backend as 'gemini' | 'claude' | 'groq' | undefined);
  });

  ipcMain.handle('has-api-key', (_event, backend?: string) => {
    return hasApiKey(backend as 'gemini' | 'claude' | 'groq' | undefined);
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

  ipcMain.handle('update-edge-status', (_event, index: number, status: string) => {
    const data = readEdgesFile() as Record<string, unknown>;
    if (!data) throw new Error('No edges.json found');
    const edges = data['edges'] as Record<string, unknown>[];
    if (index < 0 || index >= edges.length) throw new Error(`Index ${index} out of range`);
    edges[index]['status'] = status;
    writeEdgesFile(data);
    return { index, status };
  });

  ipcMain.handle('bulk-update-edges', (_event, indices: number[], status: string) => {
    const data = readEdgesFile() as Record<string, unknown>;
    if (!data) throw new Error('No edges.json found');
    const edges = data['edges'] as Record<string, unknown>[];
    let updated = 0;
    for (const idx of indices) {
      if (idx >= 0 && idx < edges.length) {
        edges[idx]['status'] = status;
        updated++;
      }
    }
    writeEdgesFile(data);
    return { updated, status };
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

  ipcMain.handle('fetch-url-content', async (_event, url: string) => {
    try {
      const resp = await fetch(url);
      const html = await resp.text();

      // Extract readable text from HTML:
      // 1. Remove script, style, noscript, svg, and head tags with their content
      let cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '');

      // 2. Replace block-level tags with newlines for readability
      cleaned = cleaned
        .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer|nav|aside)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/td>/gi, '\t')
        .replace(/<hr\s*\/?>/gi, '\n---\n');

      // 3. Strip all remaining HTML tags
      cleaned = cleaned.replace(/<[^>]+>/g, '');

      // 4. Decode common HTML entities
      cleaned = cleaned
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));

      // 5. Collapse whitespace: multiple blank lines → double newline, multiple spaces → single
      cleaned = cleaned
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return { content: cleaned };
    } catch (err) {
      return { content: '', error: String(err) };
    }
  });

  ipcMain.handle('pick-document-file', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { cancelled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Select a document for debate',
      filters: [
        { name: 'Documents', extensions: ['md', 'txt', 'pdf', 'docx', 'html'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const filePath = result.filePaths[0];
    const fs = await import('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    return { cancelled: false, filePath, content };
  });
}
