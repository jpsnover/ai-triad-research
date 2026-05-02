// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { ipcMain, clipboard } from 'electron';
import { ActionableError } from '../../../lib/debate/errors';
import {
  discoverSources,
  loadSummary,
  loadTaxonomy,
  readSnapshot,
  addTaxonomyNode,
  readPolicyRegistry,
  getTaxonomyDirs,
  getActiveTaxonomyDirName,
  setActiveTaxonomyDir,
  updateNodeFields,
  persistEdges,
  getNodesByPovCategory,
} from './fileIO';
import type { AddTaxonomyNodeRequest } from './fileIO';
import { loadEmbeddings, computeEmbeddings, computeQueryEmbedding } from './embeddings';
import { generateContent } from './generateContent';
import { storeApiKey, hasApiKey } from './apiKeyStore';
import { refreshAIModels } from './modelDiscovery';
import { diagnosePythonEmbeddings } from './diagnosePython';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

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

  ipcMain.handle('load-policy-registry', () => {
    return readPolicyRegistry();
  });

  ipcMain.handle('add-taxonomy-node', (_event, req: AddTaxonomyNodeRequest) => {
    return addTaxonomyNode(req);
  });

  ipcMain.handle('set-api-key', (_event, key: string, backend?: string) => {
    storeApiKey(key, backend as 'gemini' | 'claude' | 'groq' | 'openai' | undefined);
  });

  ipcMain.handle('has-api-key', (_event, backend?: string) => {
    return hasApiKey(backend as 'gemini' | 'claude' | 'groq' | 'openai' | undefined);
  });

  ipcMain.handle('load-ai-models', () => {
    try {
      const configPath = path.join(PROJECT_ROOT, 'ai-models.json');
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  ipcMain.handle('refresh-ai-models', async () => {
    return refreshAIModels();
  });

  ipcMain.handle('load-embeddings', () => {
    return loadEmbeddings();
  });

  ipcMain.handle('compute-embeddings', async (_event, texts: string[]) => {
    try {
      return await computeEmbeddings(texts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] compute-embeddings failed:', msg);
      const diagnosis = diagnosePythonEmbeddings();
      throw new ActionableError({
        goal: 'Compute embeddings for taxonomy search',
        problem: `Embedding computation failed: ${msg}`,
        location: 'ipcHandlers.ts:compute-embeddings',
        nextSteps: [
          diagnosis,
          'Verify Python 3 is installed and on PATH',
          'Run: pip install sentence-transformers',
          'Check that the embedding model (all-MiniLM-L6-v2) is accessible',
        ],
      });
    }
  });

  ipcMain.handle('compute-query-embedding', async (_event, text: string) => {
    try {
      return await computeQueryEmbedding(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] compute-query-embedding failed:', msg);
      const diagnosis = diagnosePythonEmbeddings();
      throw new ActionableError({
        goal: 'Compute query embedding for semantic search',
        problem: `Query embedding failed: ${msg}`,
        location: 'ipcHandlers.ts:compute-query-embedding',
        nextSteps: [
          diagnosis,
          'Verify Python 3 is installed and on PATH',
          'Run: pip install sentence-transformers',
          'Check that the embedding model (all-MiniLM-L6-v2) is accessible',
        ],
      });
    }
  });

  ipcMain.handle('generate-content', async (_event, systemPrompt: string, userPrompt: string, model?: string) => {
    try {
      return await generateContent(systemPrompt, userPrompt, model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] generate-content failed:', msg);
      throw new ActionableError({
        goal: 'Generate AI content',
        problem: `AI generation failed: ${msg}`,
        location: 'ipcHandlers.ts:generate-content',
        nextSteps: [
          'Check that a valid API key is configured in Settings',
          'Verify network connectivity to the AI backend',
          'Try switching to a different AI model or backend',
        ],
      });
    }
  });

  // ── Enrichment pipeline IPC ──────────────────────────────────────────────

  ipcMain.handle('update-node-fields', (_event, nodeId: string, fields: Record<string, unknown>) => {
    return updateNodeFields(nodeId, fields);
  });

  ipcMain.handle('persist-edges', (_event, edges: unknown[]) => {
    return persistEdges(edges as Parameters<typeof persistEdges>[0]);
  });

  ipcMain.handle('get-nodes-by-pov-category', (_event, pov: string, category?: string) => {
    return getNodesByPovCategory(pov, category);
  });

  // Clipboard (Electron 40: renderer clipboard API deprecated)
  ipcMain.handle('clipboard-write-text', (_event, text: string) => {
    clipboard.writeText(text);
  });
}
