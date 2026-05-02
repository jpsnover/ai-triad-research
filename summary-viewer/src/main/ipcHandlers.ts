// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { ipcMain, clipboard } from 'electron';
import { z } from 'zod';
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
import {
  validatedHandle,
  oneString,
  oneUnknown,
  stringArray,
  stringAndRecord,
  stringAndOptionalString,
  optionalString,
  twoStringsAndOptional,
  unknownArray,
} from '../../../lib/electron-shared/utils/validatedIpc';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

export function registerIpcHandlers(): void {
  // === No-arg handlers (no validation needed) ===

  ipcMain.handle('get-taxonomy-dirs', () => getTaxonomyDirs());
  ipcMain.handle('get-active-taxonomy-dir', () => getActiveTaxonomyDirName());
  ipcMain.handle('discover-sources', () => discoverSources());
  ipcMain.handle('load-taxonomy', () => loadTaxonomy());
  ipcMain.handle('load-policy-registry', () => readPolicyRegistry());
  ipcMain.handle('refresh-ai-models', async () => refreshAIModels());
  ipcMain.handle('load-embeddings', () => loadEmbeddings());

  ipcMain.handle('load-ai-models', () => {
    try {
      const configPath = path.join(PROJECT_ROOT, 'ai-models.json');
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  // === Single string arg ===

  validatedHandle('set-taxonomy-dir', oneString, (_event, dirName) => {
    setActiveTaxonomyDir(dirName);
  });

  validatedHandle('load-summary', oneString, (_event, docId) => {
    return loadSummary(docId);
  });

  validatedHandle('load-snapshot', oneString, (_event, sourceId) => {
    return readSnapshot(sourceId);
  });

  validatedHandle('compute-query-embedding', oneString, async (_event, text) => {
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

  validatedHandle('clipboard-write-text', oneString, (_event, text) => {
    clipboard.writeText(text);
  });

  // === Optional / string + optional string ===

  validatedHandle('has-api-key', optionalString, (_event, backend?) => {
    return hasApiKey(backend as 'gemini' | 'claude' | 'groq' | 'openai' | undefined);
  });

  validatedHandle('set-api-key', stringAndOptionalString, (_event, key, backend?) => {
    storeApiKey(key, backend as 'gemini' | 'claude' | 'groq' | 'openai' | undefined);
  });

  validatedHandle('get-nodes-by-pov-category', stringAndOptionalString, (_event, pov, category?) => {
    return getNodesByPovCategory(pov, category);
  });

  // === String array ===

  validatedHandle('compute-embeddings', stringArray, async (_event, texts) => {
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

  // === Two strings + optional ===

  validatedHandle('generate-content', twoStringsAndOptional, async (_event, systemPrompt, userPrompt, model?) => {
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

  // === String + record ===

  validatedHandle('update-node-fields', stringAndRecord, (_event, nodeId, fields) => {
    return updateNodeFields(nodeId, fields);
  });

  // === Object / unknown args ===

  validatedHandle('add-taxonomy-node', oneUnknown, (_event, req) => {
    return addTaxonomyNode(req as AddTaxonomyNodeRequest);
  });

  validatedHandle('persist-edges', unknownArray, (_event, edges) => {
    return persistEdges(edges as Parameters<typeof persistEdges>[0]);
  });
}
