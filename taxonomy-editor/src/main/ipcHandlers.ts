// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { app, ipcMain, shell, dialog, BrowserWindow, clipboard } from 'electron';
import fs from 'fs';
import { execFile } from 'child_process';
import {
  readTaxonomyFile,
  writeTaxonomyFile,
  readAllConflictFiles,
  readConflictClusters,
  writeConflictFile,
  createConflictFile,
  deleteConflictFile,
  readEdgesFile,
  writeEdgesFile,
  getTaxonomyDirs,
  getActiveTaxonomyDirName,
  setActiveTaxonomyDir,
  buildNodeSourceIndex,
  buildPolicySourceIndex,
  readPolicyRegistry,
  discoverSources,
  loadSummary,
  loadSnapshot,
} from './fileIO';
import {
  listDebateSessions,
  loadDebateSession,
  saveDebateSession,
  deleteDebateSession,
  loadDebateComments,
  saveDebateComments,
} from './debateIO';
import {
  listChatSessions,
  loadChatSession,
  saveChatSession,
  deleteChatSession,
} from './chatIO';
import { debateToText, debateToMarkdown, debateToPdf, debateToPackage } from './debateExport';
import { storeApiKey, hasApiKey } from './apiKeyStore';
import { isDataAvailable, getDataRootPath, setDataRootPath, loadDataConfig, PROJECT_ROOT } from './fileIO';
import { computeEmbeddings, computeQueryEmbedding, generateText, generateTextWithSearch, generateChatStream, updateNodeEmbeddings, classifyNli, setDebateTemperature } from './embeddings';
import type { ChatMessage } from './embeddings';
import { refreshAIModels } from './modelDiscovery';
import { checkForDataUpdates, pullDataUpdates } from './dataUpdateChecker';
import { diagnosePythonEmbeddings } from './diagnosePython';
import type { NodeEmbeddingInput, NliPair } from './embeddings';
import { ActionableError } from '../../../lib/debate/errors';
import { z } from 'zod';
import path from 'path';

// IPC input schemas for high-risk handlers
const VALID_POV = z.enum(['accelerationist', 'safetyist', 'skeptic', 'situations', 'cross_cutting']);
const SafePath = z.string().min(1).max(500);
const NodeId = z.string().regex(/^[a-z]{2,3}-[a-z]+-\d{3}$|^cc-\d{3}$|^pol-\d{3}$/);

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
    const parsed = VALID_POV.safeParse(pov);
    if (!parsed.success) throw new ActionableError({ goal: 'Save taxonomy file', problem: `Invalid POV: ${pov}`, location: 'ipcHandlers:save-taxonomy-file', nextSteps: ['Use a valid POV name'] });
    writeTaxonomyFile(parsed.data, data);
  });

  ipcMain.handle('load-policy-registry', () => {
    return readPolicyRegistry();
  });

  ipcMain.handle('load-conflict-files', () => {
    return readAllConflictFiles();
  });

  ipcMain.handle('load-conflict-clusters', () => {
    return readConflictClusters();
  });

  // Dictionary
  ipcMain.handle('load-dictionary', () => {
    try {
      const dictDir = path.join(getDataRootPath(), 'dictionary');
      const stdDir = path.join(dictDir, 'standardized');
      const colDir = path.join(dictDir, 'colloquial');

      const standardized: unknown[] = [];
      if (fs.existsSync(stdDir)) {
        for (const f of fs.readdirSync(stdDir).filter(f => f.endsWith('.json'))) {
          try {
            standardized.push(JSON.parse(fs.readFileSync(path.join(stdDir, f), 'utf-8')));
          } catch { /* skip malformed */ }
        }
      }

      const colloquial: unknown[] = [];
      if (fs.existsSync(colDir)) {
        for (const f of fs.readdirSync(colDir).filter(f => f.endsWith('.json'))) {
          try {
            colloquial.push(JSON.parse(fs.readFileSync(path.join(colDir, f), 'utf-8')));
          } catch { /* skip malformed */ }
        }
      }

      return { standardized, colloquial, lintViolations: [] };
    } catch {
      return { standardized: [], colloquial: [], lintViolations: [] };
    }
  });

  // Summaries & Sources
  ipcMain.handle('discover-sources', () => discoverSources());
  ipcMain.handle('load-summary', (_event, docId: string) => loadSummary(docId));
  ipcMain.handle('load-snapshot', (_event, sourceId: string) => {
    const content = loadSnapshot(sourceId);
    return content ? { content } : null;
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

  ipcMain.handle('is-data-available', () => {
    return isDataAvailable();
  });

  ipcMain.handle('get-data-root', () => {
    return getDataRootPath();
  });

  ipcMain.handle('set-data-root', (_event, newRoot: string) => {
    SafePath.parse(newRoot);
    setDataRootPath(path.resolve(newRoot));
    // Relaunch so module-level cached paths are re-derived from the updated config
    app.relaunch();
    app.quit();
  });

  ipcMain.handle('clone-data-repo', async (_event, targetPath: string) => {
    // Validate target path is within user's home directory
    const resolved = path.resolve(targetPath);
    const home = app.getPath('home');
    if (!resolved.startsWith(home + path.sep) && resolved !== home) {
      return { success: false, message: `Target path must be within ${home}` };
    }
    const repoUrl = 'https://github.com/jpsnover/ai-triad-data.git';
    return new Promise<{ success: boolean; message: string }>((resolve) => {
      const parentDir = path.dirname(resolved);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      execFile('git', ['clone', repoUrl, resolved], { timeout: 300000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ success: false, message: stderr || err.message });
        } else {
          resolve({ success: true, message: stdout || 'Cloned successfully' });
        }
      });
    });
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
    storeApiKey(key, backend as 'gemini' | 'claude' | 'groq' | 'openai' | undefined);
  });

  ipcMain.handle('has-api-key', (_event, backend?: string) => {
    return hasApiKey(backend as 'gemini' | 'claude' | 'groq' | 'openai' | undefined);
  });

  ipcMain.handle('compute-embeddings', async (_event, texts: string[], ids?: string[]) => {
    try {
      return { vectors: await computeEmbeddings(texts, ids) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] compute-embeddings failed:', msg);
      const diagnosis = diagnosePythonEmbeddings();
      throw new ActionableError({
        goal: 'Compute text embeddings for taxonomy nodes',
        problem: `Embedding computation failed: ${msg}. ${diagnosis}`,
        location: 'ipcHandlers.computeEmbeddings',
        nextSteps: [
          'Verify Python is installed and accessible on PATH',
          'Run "pip install sentence-transformers" to install the embedding model',
          'Check the console log for detailed Python diagnostics',
        ],
      });
    }
  });

  ipcMain.handle('compute-query-embedding', async (_event, text: string) => {
    try {
      return { vector: await computeQueryEmbedding(text) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] compute-query-embedding failed:', msg);
      const diagnosis = diagnosePythonEmbeddings();
      throw new ActionableError({
        goal: 'Compute embedding for a search query',
        problem: `Query embedding failed: ${msg}. ${diagnosis}`,
        location: 'ipcHandlers.computeQueryEmbedding',
        nextSteps: [
          'Verify Python is installed and accessible on PATH',
          'Run "pip install sentence-transformers" to install the embedding model',
          'Check the console log for detailed Python diagnostics',
        ],
      });
    }
  });

  ipcMain.handle('update-node-embeddings', async (_event, nodes: NodeEmbeddingInput[]) => {
    try {
      await updateNodeEmbeddings(nodes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] update-node-embeddings failed:', msg);
      const diagnosis = diagnosePythonEmbeddings();
      throw new ActionableError({
        goal: `Update embeddings for ${nodes.length} taxonomy node(s)`,
        problem: `Embedding update failed: ${msg}. ${diagnosis}`,
        location: 'ipcHandlers.updateNodeEmbeddings',
        nextSteps: [
          'Verify Python is installed and accessible on PATH',
          'Run "pip install sentence-transformers" to install the embedding model',
          'Check the console log for detailed Python diagnostics',
        ],
      });
    }
  });

  ipcMain.handle('nli-classify', async (_event, pairs: NliPair[]) => {
    return { results: await classifyNli(pairs) };
  });

  ipcMain.handle('generate-text', async (event, prompt: string, model?: string, timeoutMs?: number, temperature?: number) => {
    try {
      return {
        text: await generateText(prompt, model, (progress) => {
          event.sender.send('generate-text-progress', progress);
        }, timeoutMs, temperature),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] generate-text failed:', msg);
      throw new ActionableError({
        goal: 'Generate text via AI backend',
        problem: `AI generation failed: ${msg}`,
        location: 'ipcHandlers.generateText',
        nextSteps: [
          'Verify your API key is set (Settings > API Keys)',
          'Check that the selected AI model is available and not rate-limited',
          'Try a different AI backend if the current one is unreachable',
        ],
      });
    }
  });

  ipcMain.handle('set-debate-temperature', (_event, temp: number | null) => {
    setDebateTemperature(temp);
  });

  ipcMain.handle('start-chat-stream', async (event, systemInstruction: string, messages: ChatMessage[], model?: string, temperature?: number) => {
    console.log('[IPC:chat-stream] start, model:', model, 'msgs:', messages.length);
    const send = (channel: string, data: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, data);
    };
    const fullText = await generateChatStream(
      systemInstruction,
      messages,
      (chunk) => send('chat-stream-chunk', chunk),
      model,
      temperature,
    );
    console.log('[IPC:chat-stream] done, returning', fullText.length, 'chars');
    send('chat-stream-done', fullText);
    return fullText;
  });

  ipcMain.handle('generate-text-with-search', async (_event, prompt: string, model?: string) => {
    try {
      return await generateTextWithSearch(prompt, model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] generate-text-with-search failed:', msg);
      throw new ActionableError({
        goal: 'Generate AI text with grounded web search',
        problem: `AI grounded search failed: ${msg}`,
        location: 'ipcHandlers.generateTextWithSearch',
        nextSteps: [
          'Verify your API key is set (Settings > API Keys)',
          'Check that the selected model supports grounded search (e.g. Gemini)',
          'Try the request again — transient network errors are common',
        ],
      });
    }
  });

  // ── Harvest IPC handlers ──────────────────────────────────

  ipcMain.handle('harvest-create-conflict', async (_event, conflict: Record<string, unknown>) => {
    const conflictId = conflict.claim_id as string;
    const conflictsDir = path.join(getDataRootPath(), 'conflicts');
    if (!fs.existsSync(conflictsDir)) fs.mkdirSync(conflictsDir, { recursive: true });
    const filePath = path.join(conflictsDir, `${conflictId}.json`);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(conflict, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, filePath);
    console.log(`[harvest] Created conflict: ${conflictId}`);
    return { created: true, path: filePath };
  });

  ipcMain.handle('harvest-add-debate-ref', async (_event, nodeId: string, debateId: string) => {
    NodeId.parse(nodeId);
    z.string().min(1).parse(debateId);
    const config = loadDataConfig();
    const taxonomyDir = path.join(getDataRootPath(), config.taxonomy_dir);
    // Find which file contains this node
    for (const fname of ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json']) {
      const filePath = path.join(taxonomyDir, fname);
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const node = data.nodes?.find((n: { id: string }) => n.id === nodeId);
      if (!node) continue;
      if (!node.debate_refs) node.debate_refs = [];
      if (!node.debate_refs.includes(debateId)) {
        node.debate_refs.push(debateId);
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        fs.renameSync(tmpPath, filePath);
        console.log(`[harvest] Added debate_ref ${debateId} to ${nodeId}`);
      }
      return { updated: true };
    }
    return { updated: false, error: `Node ${nodeId} not found` };
  });

  ipcMain.handle('harvest-update-steelman', async (_event, nodeId: string, attackerPov: string, newText: string) => {
    NodeId.parse(nodeId);
    VALID_POV.parse(attackerPov);
    z.string().min(1).parse(newText);
    const config = loadDataConfig();
    const taxonomyDir = path.join(getDataRootPath(), config.taxonomy_dir);
    for (const fname of ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json']) {
      const filePath = path.join(taxonomyDir, fname);
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const node = data.nodes?.find((n: { id: string }) => n.id === nodeId);
      if (!node) continue;
      if (!node.graph_attributes) node.graph_attributes = {};
      const sv = node.graph_attributes.steelman_vulnerability;
      if (typeof sv === 'string') {
        // Migrate from string to object
        node.graph_attributes.steelman_vulnerability = { [`from_${attackerPov}`]: newText };
      } else if (typeof sv === 'object' && sv !== null) {
        sv[`from_${attackerPov}`] = newText;
      } else {
        node.graph_attributes.steelman_vulnerability = { [`from_${attackerPov}`]: newText };
      }
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmpPath, filePath);
      console.log(`[harvest] Updated steelman on ${nodeId} from_${attackerPov}`);
      return { updated: true };
    }
    return { updated: false, error: `Node ${nodeId} not found` };
  });

  ipcMain.handle('harvest-add-verdict', async (_event, conflictId: string, verdict: Record<string, unknown>) => {
    const conflictsDir = path.join(getDataRootPath(), 'conflicts');
    const filePath = path.join(conflictsDir, `${conflictId}.json`);
    if (!fs.existsSync(filePath)) return { updated: false, error: `Conflict ${conflictId} not found` };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    data.verdict = verdict;
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, filePath);
    console.log(`[harvest] Added verdict to conflict: ${conflictId}`);
    return { updated: true };
  });

  ipcMain.handle('harvest-queue-concept', async (_event, concept: Record<string, unknown>) => {
    const queuePath = path.join(getDataRootPath(), 'harvest-queue.json');
    let queue: { queued_at: string; items: Record<string, unknown>[] } = { queued_at: new Date().toISOString(), items: [] };
    if (fs.existsSync(queuePath)) {
      try { queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')); } catch { /* start fresh */ }
    }
    queue.items.push({ ...concept, status: 'queued', queued_at: new Date().toISOString() });
    queue.queued_at = new Date().toISOString();
    const tmpPath = queuePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(queue, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, queuePath);
    console.log(`[harvest] Queued concept: ${concept.label}`);
    return { queued: true };
  });

  ipcMain.handle('harvest-save-manifest', async (_event, manifest: Record<string, unknown>) => {
    const harvestsDir = path.join(getDataRootPath(), 'harvests');
    if (!fs.existsSync(harvestsDir)) fs.mkdirSync(harvestsDir, { recursive: true });
    const debateId = manifest.debate_id as string;
    const filePath = path.join(harvestsDir, `${debateId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    console.log(`[harvest] Saved manifest: ${debateId}`);
    return { saved: true };
  });

  ipcMain.handle('open-external', (_event, url: string) => {
    // Only allow http/https URLs
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('open-file', (_event, filePath: string) => {
    // Only allow opening files that actually exist on disk
    if (fs.existsSync(filePath)) {
      shell.openPath(filePath);
    }
  });

  // Clipboard (Electron 40: renderer clipboard API deprecated → use main process)
  ipcMain.handle('clipboard-write-text', (_event, text: string) => {
    clipboard.writeText(text);
  });

  // Taxonomy proposal files (for batch approve UI)
  ipcMain.handle('list-proposals', () => {
    const proposalDir = path.join(getDataRootPath(), loadDataConfig().taxonomy_dir, 'proposals');
    if (!fs.existsSync(proposalDir)) return [];
    return fs.readdirSync(proposalDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(proposalDir, f), 'utf-8'));
          return { filename: f, ...data };
        } catch {
          return { filename: f, error: 'Failed to parse' };
        }
      });
  });

  ipcMain.handle('save-proposal', (_event, filename: string, data: unknown) => {
    const proposalDir = path.join(getDataRootPath(), loadDataConfig().taxonomy_dir, 'proposals');
    if (!fs.existsSync(proposalDir)) fs.mkdirSync(proposalDir, { recursive: true });
    if (!/^proposal-[\d-]+\.json$/.test(filename)) {
      return { error: 'Invalid proposal filename' };
    }
    const filePath = path.join(proposalDir, filename);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return { saved: true };
  });

  // PowerShell prompt file reader (for Prompt Inspector)
  ipcMain.handle('read-ps-prompt', (_event, promptName: string) => {
    // Sanitize: only allow alphanumeric, hyphens, no path traversal
    if (!/^[a-z0-9-]+$/.test(promptName)) {
      return { text: null, error: 'Invalid prompt name' };
    }
    const promptPath = path.join(PROJECT_ROOT, 'scripts', 'AITriad', 'Prompts', `${promptName}.prompt`);
    if (!fs.existsSync(promptPath)) {
      return { text: null, error: `Prompt file not found: ${promptName}.prompt` };
    }
    try {
      const text = fs.readFileSync(promptPath, 'utf-8');
      return { text };
    } catch (err) {
      return { text: null, error: String(err) };
    }
  });

  // List all available PS prompt files
  ipcMain.handle('list-ps-prompts', () => {
    const promptDir = path.join(PROJECT_ROOT, 'scripts', 'AITriad', 'Prompts');
    if (!fs.existsSync(promptDir)) return [];
    return fs.readdirSync(promptDir)
      .filter(f => f.endsWith('.prompt'))
      .map(f => f.replace('.prompt', ''));
  });

  ipcMain.handle('build-node-source-index', () => {
    return buildNodeSourceIndex();
  });

  ipcMain.handle('build-policy-source-index', () => {
    return buildPolicySourceIndex();
  });

  ipcMain.handle('load-edges', () => {
    return readEdgesFile();
  });

  ipcMain.handle('update-edge-status', (_event, index: number, status: string) => {
    const data = readEdgesFile() as Record<string, unknown>;
    if (!data) throw new ActionableError({
      goal: 'Update the status of a taxonomy edge',
      problem: 'No edges.json found in the active taxonomy directory',
      location: 'ipcHandlers.updateEdgeStatus',
      nextSteps: [
        'Verify the data directory is configured correctly (Settings > Data Root)',
        'Check that edges.json exists in the active taxonomy directory',
      ],
    });
    const edges = data['edges'] as Record<string, unknown>[];
    if (index < 0 || index >= edges.length) throw new ActionableError({
      goal: 'Update the status of a taxonomy edge',
      problem: `Edge index ${index} is out of range (0..${edges.length - 1})`,
      location: 'ipcHandlers.updateEdgeStatus',
      nextSteps: [
        'Reload the edges list to get the current indices',
        'This may indicate a stale UI — try refreshing the page',
      ],
    });
    edges[index]['status'] = status;
    if (status === 'approved') {
      delete edges[index]['direction_flag'];
    }
    writeEdgesFile(data);
    return { index, status };
  });

  ipcMain.handle('swap-edge-direction', (_event, index: number) => {
    const data = readEdgesFile() as Record<string, unknown>;
    if (!data) throw new ActionableError({
      goal: 'Swap the direction of a taxonomy edge',
      problem: 'No edges.json found in the active taxonomy directory',
      location: 'ipcHandlers.swapEdgeDirection',
      nextSteps: [
        'Verify the data directory is configured correctly (Settings > Data Root)',
        'Check that edges.json exists in the active taxonomy directory',
      ],
    });
    const edges = data['edges'] as Record<string, unknown>[];
    if (index < 0 || index >= edges.length) throw new ActionableError({
      goal: 'Swap the direction of a taxonomy edge',
      problem: `Edge index ${index} is out of range (0..${edges.length - 1})`,
      location: 'ipcHandlers.swapEdgeDirection',
      nextSteps: [
        'Reload the edges list to get the current indices',
        'This may indicate a stale UI — try refreshing the page',
      ],
    });
    const edge = edges[index];
    const tmp = edge['source'];
    edge['source'] = edge['target'];
    edge['target'] = tmp;
    delete edge['direction_flag'];
    writeEdgesFile(data);
    return { index, source: edge['source'], target: edge['target'] };
  });

  ipcMain.handle('bulk-update-edges', (_event, indices: number[], status: string) => {
    const data = readEdgesFile() as Record<string, unknown>;
    if (!data) throw new ActionableError({
      goal: 'Bulk-update the status of taxonomy edges',
      problem: 'No edges.json found in the active taxonomy directory',
      location: 'ipcHandlers.bulkUpdateEdges',
      nextSteps: [
        'Verify the data directory is configured correctly (Settings > Data Root)',
        'Check that edges.json exists in the active taxonomy directory',
      ],
    });
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

  ipcMain.handle('load-debate-comments', (_event, debateId: string) => {
    return loadDebateComments(debateId);
  });

  ipcMain.handle('save-debate-comments', (_event, debateId: string, data: unknown) => {
    saveDebateComments(debateId, data);
  });

  // ── Chat session handlers ─���───────────────────────────
  ipcMain.handle('list-chat-sessions', () => {
    return listChatSessions();
  });

  ipcMain.handle('load-chat-session', (_event, id: string) => {
    return loadChatSession(id);
  });

  ipcMain.handle('save-chat-session', (_event, session: unknown) => {
    saveChatSession(session);
  });

  ipcMain.handle('delete-chat-session', (_event, id: string) => {
    deleteChatSession(id);
  });

  ipcMain.handle('export-debate-to-file', async (event, session: unknown, format?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { cancelled: true };

    const data = session as { title?: string };
    const defaultName = (data.title || 'debate')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 60);

    // Map format to default extension for the save dialog
    const formatExtMap: Record<string, string> = { json: 'json', markdown: 'md', text: 'txt', pdf: 'pdf', package: 'zip' };
    const defaultExt = formatExtMap[format || 'json'] || 'json';

    // Put the requested format first in the filter list
    const allFilters = [
      { name: 'JSON', extensions: ['json'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Plain Text', extensions: ['txt'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Package (ZIP)', extensions: ['zip'] },
    ];
    const selectedIdx = allFilters.findIndex(f => f.extensions[0] === defaultExt);
    const filters = selectedIdx > 0
      ? [allFilters[selectedIdx], ...allFilters.filter((_, i) => i !== selectedIdx)]
      : allFilters;

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Debate',
      defaultPath: `${defaultName}.${defaultExt}`,
      filters,
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
      case 'zip': {
        const zipBytes = await debateToPackage(debate, {
          generatePdf: async (s) => {
            const buf = await debateToPdf(s);
            return new Uint8Array(buf);
          },
        });
        fs.writeFileSync(filePath, Buffer.from(zipBytes));
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
    // S-SSRF: Only allow http/https protocols to prevent file:// and internal network access
    if (!/^https?:\/\//i.test(url)) {
      return { content: '', error: 'Only http/https URLs are allowed' };
    }
    try {
      const { fetchUrlContent } = await import('../../../lib/debate/taxonomyLoader.js');
      const markdown = await fetchUrlContent(url);
      return { content: markdown };
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

  ipcMain.handle('get-calibration-history', () => {
    try {
      const dataRoot = getDataRootPath();

      // Read parameter history
      const histPath = path.join(dataRoot, 'calibration', 'parameter-history.json');
      let history: unknown[] = [];
      if (fs.existsSync(histPath)) {
        try { history = JSON.parse(fs.readFileSync(histPath, 'utf-8')); } catch { /* corrupt */ }
      }

      // Capture current snapshot from provisional-weights.json
      const weightsPath = path.join(PROJECT_ROOT, 'lib', 'debate', 'provisional-weights.json');
      let weights: Record<string, unknown> = {};
      try { weights = JSON.parse(fs.readFileSync(weightsPath, 'utf-8')); } catch { /* use defaults */ }

      const current = {
        exploration_exit: (weights?.thresholds as Record<string, number>)?.exploration_exit ?? 0.65,
        relevance_threshold: 0.45,
        attack_weights: [1.0, 1.1, 1.2],
        draft_temperature: 0.7,
        saturation_weights: (weights?.saturation as Record<string, number>) ?? {
          recycling_pressure: 0.30, crux_maturity: 0.25, concession_plateau: 0.15,
          engagement_fatigue: 0.15, pragmatic_convergence: 0.05, scheme_stagnation: 0.10,
        },
        recent_window: 8,
        gc_trigger: (weights?.network as Record<string, number>)?.gc_trigger ?? 175,
        polarity_resolved: 0.85,
        max_nodes_cap: 50,
        semantic_recycling_threshold: 0.85,
        cluster_min_similarity: 0.55,
        duplicate_similarity_threshold: 0.85,
        fire_confidence_threshold: 0.7,
        cohesion_clear_theme: 0.60,
        kp_divisor: 500,
      };

      return { current, history };
    } catch {
      return { current: null, history: [] };
    }
  });

  // ── Flight recorder dump ──
  ipcMain.handle('dump-flight-recorder', (_event, ndjson: string) => {
    const dumpDir = path.join(app.getPath('userData'), 'flight-recorder');
    fs.mkdirSync(dumpDir, { recursive: true });

    // Filesystem-safe ISO timestamp
    const ts = new Date().toISOString().replace(/:/g, '-');
    const filePath = path.join(dumpDir, `flight-recorder-${ts}.jsonl`);
    fs.writeFileSync(filePath, ndjson, 'utf-8');

    // Retention: keep last 20 files, max 50 MB
    const MAX_FILES = 20;
    const MAX_BYTES = 50 * 1024 * 1024;
    try {
      const files = fs.readdirSync(dumpDir)
        .filter(f => f.startsWith('flight-recorder-') && f.endsWith('.jsonl'))
        .map(f => ({ name: f, path: path.join(dumpDir, f), mtime: fs.statSync(path.join(dumpDir, f)).mtimeMs, size: fs.statSync(path.join(dumpDir, f)).size }))
        .sort((a, b) => b.mtime - a.mtime);  // newest first

      // Delete beyond file count limit
      for (const f of files.slice(MAX_FILES)) {
        fs.unlinkSync(f.path);
      }
      // Delete oldest until within disk budget
      const remaining = files.slice(0, MAX_FILES);
      let totalSize = remaining.reduce((s, f) => s + f.size, 0);
      for (let i = remaining.length - 1; i >= 0 && totalSize > MAX_BYTES; i--) {
        fs.unlinkSync(remaining[i].path);
        totalSize -= remaining[i].size;
      }
    } catch { /* retention cleanup is best-effort */ }

    const filename = path.basename(filePath);
    console.log(`[flight-recorder] Dump written: ${filePath}`);
    return { filePath, filename };
  });

  ipcMain.handle('pick-directory', async (_event, defaultPath?: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { cancelled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Select research data directory',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    return { cancelled: false, path: result.filePaths[0] };
  });
}
