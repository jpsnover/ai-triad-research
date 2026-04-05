// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain, shell, dialog, BrowserWindow, clipboard } from 'electron';
import fs from 'fs';
import { execFile } from 'child_process';
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
  buildNodeSourceIndex,
  buildPolicySourceIndex,
  readPolicyRegistry,
} from './fileIO';
import {
  listDebateSessions,
  loadDebateSession,
  saveDebateSession,
  deleteDebateSession,
} from './debateIO';
import {
  listChatSessions,
  loadChatSession,
  saveChatSession,
  deleteChatSession,
} from './chatIO';
import { debateToText, debateToMarkdown, debateToPdf } from './debateExport';
import { storeApiKey, hasApiKey } from './apiKeyStore';
import { isDataAvailable, getDataRootPath, loadDataConfig } from './fileIO';
import { computeEmbeddings, computeQueryEmbedding, generateText, generateTextWithSearch, updateNodeEmbeddings, classifyNli, setDebateTemperature } from './embeddings';
import { refreshAIModels } from './modelDiscovery';
import { checkForDataUpdates, pullDataUpdates } from './dataUpdateChecker';
import { diagnosePythonEmbeddings } from './diagnosePython';
import type { NodeEmbeddingInput, NliPair } from './embeddings';
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

  ipcMain.handle('load-policy-registry', () => {
    return readPolicyRegistry();
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

  ipcMain.handle('is-data-available', () => {
    return isDataAvailable();
  });

  ipcMain.handle('get-data-root', () => {
    return getDataRootPath();
  });

  ipcMain.handle('clone-data-repo', async (_event, targetPath: string) => {
    const repoUrl = 'https://github.com/jpsnover/ai-triad-data.git';
    return new Promise<{ success: boolean; message: string }>((resolve) => {
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      execFile('git', ['clone', repoUrl, targetPath], { timeout: 300000 }, (err, stdout, stderr) => {
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
    storeApiKey(key, backend as 'gemini' | 'claude' | 'groq' | undefined);
  });

  ipcMain.handle('has-api-key', (_event, backend?: string) => {
    return hasApiKey(backend as 'gemini' | 'claude' | 'groq' | undefined);
  });

  ipcMain.handle('compute-embeddings', async (_event, texts: string[], ids?: string[]) => {
    try {
      return { vectors: await computeEmbeddings(texts, ids) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] compute-embeddings failed:', msg);
      const diagnosis = diagnosePythonEmbeddings();
      throw new Error(`Embedding computation failed: ${msg}. ${diagnosis}`);
    }
  });

  ipcMain.handle('compute-query-embedding', async (_event, text: string) => {
    try {
      return { vector: await computeQueryEmbedding(text) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] compute-query-embedding failed:', msg);
      const diagnosis = diagnosePythonEmbeddings();
      throw new Error(`Query embedding failed: ${msg}. ${diagnosis}`);
    }
  });

  ipcMain.handle('update-node-embeddings', async (_event, nodes: NodeEmbeddingInput[]) => {
    try {
      await updateNodeEmbeddings(nodes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] update-node-embeddings failed:', msg);
      const diagnosis = diagnosePythonEmbeddings();
      throw new Error(`Embedding update failed for ${nodes.length} node(s): ${msg}. ${diagnosis}`);
    }
  });

  ipcMain.handle('nli-classify', async (_event, pairs: NliPair[]) => {
    return { results: await classifyNli(pairs) };
  });

  ipcMain.handle('generate-text', async (event, prompt: string, model?: string, timeoutMs?: number) => {
    try {
      return {
        text: await generateText(prompt, model, (progress) => {
          event.sender.send('generate-text-progress', progress);
        }, timeoutMs),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] generate-text failed:', msg);
      throw new Error(`AI generation failed: ${msg}`);
    }
  });

  ipcMain.handle('set-debate-temperature', (_event, temp: number | null) => {
    setDebateTemperature(temp);
  });

  ipcMain.handle('generate-text-with-search', async (_event, prompt: string, model?: string) => {
    try {
      return await generateTextWithSearch(prompt, model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[IPC] generate-text-with-search failed:', msg);
      throw new Error(`AI grounded search failed: ${msg}`);
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
