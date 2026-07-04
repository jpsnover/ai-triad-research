// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { app, ipcMain, shell, dialog, BrowserWindow, clipboard, net } from 'electron';
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
  readAggregatedCruxes,
  readLineageCategories,
  readLineageEnrichments,
  discoverSources,
  loadSummary,
  loadSnapshot,
  resolveSourceDocument,
  getSummariesDir,
  loadSyntheticCorpus,
  loadSyntheticEmbeddings,
  updateSyntheticEmbeddings,
} from './fileIO.js';
import {
  listDebateSessions,
  loadDebateSession,
  saveDebateSession,
  deleteDebateSession,
  loadDebateComments,
  saveDebateComments,
} from './debateIO.js';
import {
  listChatSessions,
  loadChatSession,
  saveChatSession,
  deleteChatSession,
} from './chatIO.js';
import { debateToText, debateToMarkdown, debateToPdf, debateToPackage } from './debateExport.js';
import { storeApiKey, hasApiKey, getApiKeySummary, exportKeysForSharing, importKeysFromSharing, deleteApiKey, deleteAllApiKeys, addApiKey, removeApiKey, getMaskedKeys } from './apiKeyStore.js';
import type { KeySharePayload } from './apiKeyStore.js';
import { isDataAvailable, getDataRootPath, setDataRootPath, loadDataConfig, PROJECT_ROOT, getSourcesDir, writeJsonFileAtomic } from './fileIO.js';
import { computeEmbeddings, computeQueryEmbedding, generateText, generateTextWithSearch, generateChatStream, updateNodeEmbeddings, classifyNli, setDebateTemperature, getEmbeddingInfo } from './embeddings.js';
import type { ChatMessage } from './embeddings.js';
import { refreshAIModels } from './modelDiscovery.js';
import { checkForDataUpdates, pullDataUpdates, getChangedFiles, getFileDiff } from './dataUpdateChecker.js';
import { diagnosePythonEmbeddings } from './diagnosePython.js';
import type { NodeEmbeddingInput, NliPair } from './embeddings.js';
import { ActionableError } from '../../../lib/debate/errors.js';
import { renameSyncWithRetry } from '../../../lib/debate/persistence.js';
import { stampNodeAuthorship } from '../server/storage/editMeta.js';
import {
  isAzureReviewConfigured,
  adminReviewQueue,
  adminReviewStats,
  adminReviewDetail,
  adminReviewAction,
  adminRemoveCommunityItem,
} from './communityReviewIO.js';
import { DEFAULT_MODEL, DEFAULT_TEMPERATURE } from '../../../lib/ai-client/index.js';
import { z } from 'zod';
import path from 'path';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

// IPC input schemas for high-risk handlers (extracted to ipcSchemas.ts for unit testing)
import { VALID_POV, SafePath, NodeId } from './ipcSchemas.js';

export function registerIpcHandlers(): void {
  ipcMain.handle('load-ai-models', () => {
    try {
      const configPath = path.join(PROJECT_ROOT, 'ai-models.json');
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      /* telemetry — silent by design */
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

  ipcMain.handle('save-taxonomy-file', (event, pov: string, data: unknown) => {
    const parsed = VALID_POV.safeParse(pov);
    if (!parsed.success) throw new ActionableError({ goal: 'Save taxonomy file', problem: `Invalid POV: ${pov}`, location: 'ipcHandlers:save-taxonomy-file', nextSteps: ['Use a valid POV name'] });
    // Stamp _edit_meta / _edit_history before writing so desktop edits record
    // authorship just like the web server's PUT /api/taxonomy/:pov handler.
    // The renderer may send either { nodes: [...] } or a bare nodes array — handle both.
    const incoming = data as { nodes?: unknown[] };
    const newNodes: unknown[] | null = Array.isArray(incoming.nodes)
      ? incoming.nodes
      : Array.isArray(data) ? (data as unknown[]) : null;
    let toWrite: unknown = data;
    if (newNodes) {
      let oldNodes: unknown[] = [];
      try {
        const existing = readTaxonomyFile(parsed.data);
        // Existing file may also be either shape — extract nodes from either.
        oldNodes = Array.isArray(existing)
          ? existing
          : ((existing as { nodes?: unknown[] })?.nodes ?? []);
      } catch (err) {
        // Missing file on first write is benign (ENOENT); a corrupt existing file
        // means we can't diff for history — record it but still save against an
        // empty baseline so the edit is never blocked.
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'ipc-save-taxonomy',
          level: 'warn',
          message: 'Could not read existing taxonomy for edit-history diff; stamping against empty baseline',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
      const stamped = stampNodeAuthorship(
        oldNodes as Parameters<typeof stampNodeAuthorship>[0],
        newNodes as Parameters<typeof stampNodeAuthorship>[1],
      );
      // Preserve on-disk authorship metadata for nodes this save did NOT change.
      // stampNodeAuthorship only (re)writes _edit_meta/_edit_history for added/modified
      // nodes; unchanged nodes are returned verbatim from the incoming payload. On a
      // desktop re-save that payload lacks the history already written to disk (the
      // renderer never receives the stamps back), so without this the 2nd+ save of a
      // file strips the history the 1st save recorded — every node ends up with none (t/828).
      type NodeMeta = { id: string; _edit_meta?: unknown; _edit_history?: unknown };
      const oldById = new Map((oldNodes as NodeMeta[]).map((n) => [n.id, n]));
      let stampedCount = 0;
      let preservedCount = 0;
      for (const node of stamped as NodeMeta[]) {
        if (node._edit_meta !== undefined) stampedCount++; // stamp wrote metadata (added/modified node)
        const old = oldById.get(node.id);
        if (!old) continue;
        if (node._edit_meta === undefined && old._edit_meta !== undefined) { node._edit_meta = old._edit_meta; preservedCount++; }
        if (node._edit_history === undefined && old._edit_history !== undefined) node._edit_history = old._edit_history;
      }
      // Observability (t/828): one event per save so a future history-strip is immediately
      // visible from a flight-recorder dump — stampedCount:0 with a high unchanged count on a
      // re-save was the signature that took hours of static analysis to find.
      getGlobalRecorder()?.record({
        type: 'state.change',
        component: 'ipc-save-taxonomy',
        level: 'info',
        message: 'save.stamp',
        data: {
          pov: parsed.data,
          total: stamped.length,
          stampedCount,
          unchangedCount: stamped.length - stampedCount,
          preservedCount,
        },
      });
      if (Array.isArray(incoming.nodes)) {
        incoming.nodes = stamped;       // object form: mutate nodes in place, write the wrapper
      } else {
        toWrite = stamped;              // bare-array form: write the stamped array directly
      }
    }
    writeTaxonomyFile(parsed.data, toWrite);
    // Notify all other windows to reload taxonomy data
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== event.sender) {
        win.webContents.send('reload-taxonomy');
      }
    }
  });

  ipcMain.handle('load-policy-registry', () => {
    return readPolicyRegistry();
  });

  ipcMain.handle('load-lineage-categories', () => {
    return readLineageCategories();
  });

  ipcMain.handle('load-lineage-info', () => {
    return readLineageEnrichments();
  });

  ipcMain.handle('load-conflict-files', () => {
    return readAllConflictFiles();
  });

  ipcMain.handle('load-conflict-clusters', () => {
    return readConflictClusters();
  });

  ipcMain.handle('load-aggregated-cruxes', () => {
    return readAggregatedCruxes();
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
          } catch { /* telemetry — silent by design;  skip malformed */ }
        }
      }

      const colloquial: unknown[] = [];
      if (fs.existsSync(colDir)) {
        for (const f of fs.readdirSync(colDir).filter(f => f.endsWith('.json'))) {
          try {
            colloquial.push(JSON.parse(fs.readFileSync(path.join(colDir, f), 'utf-8')));
          } catch { /* telemetry — silent by design;  skip malformed */ }
        }
      }

      return { standardized, colloquial, lintViolations: [] };
    } catch {
      /* telemetry — silent by design */
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
  ipcMain.handle('source-documents:resolve', (_event, docId: string) =>
    resolveSourceDocument(docId),
  );

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

  ipcMain.handle('get-changed-files', async () => {
    return getChangedFiles();
  });

  ipcMain.handle('get-file-diff', async (_event, filePath: string) => {
    return getFileDiff(filePath);
  });

  ipcMain.handle('refresh-ai-models', async () => {
    return refreshAIModels();
  });

  ipcMain.handle('set-api-key', (_event, key: string, backend?: string) => {
    storeApiKey(key, backend as 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | undefined);
  });

  ipcMain.handle('validate-api-key', async (_event, key: string, backend: string): Promise<{ valid: boolean; error?: string }> => {
    try {
      let valid = false;
      if (backend === 'gemini') {
        const r = await net.fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
        valid = r.ok;
      } else if (backend === 'claude') {
        const r = await net.fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
        valid = r.ok;
      } else if (backend === 'groq') {
        const r = await net.fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
        });
        valid = r.ok;
      } else {
        return { valid: false, error: `Unsupported backend: ${backend}` };
      }
      return valid ? { valid: true } : { valid: false, error: 'Invalid API key' };
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'ipc-handlers', level: 'warn',
        message: 'Key validation request failed',
        data: { backend },
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return { valid: false, error: 'Could not reach provider — check your network' };
    }
  });

  ipcMain.handle('has-api-key', (_event, backend?: string) => {
    if (backend === 'ollama') return true;
    return hasApiKey(backend as 'gemini' | 'claude' | 'groq' | 'openai' | 'deepseek' | undefined);
  });

  ipcMain.handle('get-api-key-summary', () => {
    return getApiKeySummary();
  });

  ipcMain.handle('delete-api-key', (_event, backend?: string) => {
    deleteApiKey(backend as Parameters<typeof deleteApiKey>[0]);
  });

  ipcMain.handle('delete-all-api-keys', () => {
    deleteAllApiKeys();
  });

  // Multi-key management (t/834). get-api-keys returns MASKED keys only — raw keys
  // never cross the IPC boundary to the renderer.
  ipcMain.handle('add-api-key', (_event, key: string, backend?: string) => {
    return addApiKey(key, backend as Parameters<typeof addApiKey>[1]);
  });

  ipcMain.handle('remove-api-key', (_event, index: number, backend?: string) => {
    removeApiKey(index, backend as Parameters<typeof removeApiKey>[1]);
  });

  ipcMain.handle('get-api-keys', (_event, backend?: string) => {
    return getMaskedKeys(backend as Parameters<typeof getMaskedKeys>[0]);
  });

  ipcMain.handle('export-keys-for-sharing', async (_event, passphrase: string) => {
    const payload = exportKeysForSharing(passphrase);
    const payloadStr = JSON.stringify(payload);
    const QRCode = await import('qrcode');
    const dataUrl = await QRCode.toDataURL(payloadStr, { errorCorrectionLevel: 'M', width: 400 });
    return { dataUrl, payloadText: payloadStr };
  });

  ipcMain.handle('import-keys-from-sharing', (_event, payload: KeySharePayload, passphrase: string) => {
    return importKeysFromSharing(payload, passphrase);
  });

  ipcMain.handle('get-embedding-info', () => {
    const info: Record<string, unknown> = getEmbeddingInfo();
    try {
      const cfgPath = path.join(PROJECT_ROOT, 'lib', 'debate', 'calibration-config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      info.calibration_version = cfg.schema_version;
    } catch { /* telemetry — silent by design;  calibration config not found — leave undefined */ }
    return info;
  });

  ipcMain.handle('compute-embeddings', async (_event, texts: string[], ids?: string[]) => {
    try {
      return { vectors: await computeEmbeddings(texts, ids) };
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
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
      (chunk: string) => send('chat-stream-chunk', chunk),
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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
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
    renameSyncWithRetry(tmpPath, filePath);
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
        renameSyncWithRetry(tmpPath, filePath);
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
      renameSyncWithRetry(tmpPath, filePath);
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
    renameSyncWithRetry(tmpPath, filePath);
    console.log(`[harvest] Added verdict to conflict: ${conflictId}`);
    return { updated: true };
  });

  ipcMain.handle('harvest-queue-concept', async (_event, concept: Record<string, unknown>) => {
    const queuePath = path.join(getDataRootPath(), 'harvest-queue.json');
    let queue: { queued_at: string; items: Record<string, unknown>[] } = { queued_at: new Date().toISOString(), items: [] };
    if (fs.existsSync(queuePath)) {
      try { queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')); } catch { /* telemetry — silent by design;  start fresh */ }
    }
    queue.items.push({ ...concept, status: 'queued', queued_at: new Date().toISOString() });
    queue.queued_at = new Date().toISOString();
    const tmpPath = queuePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(queue, null, 2) + '\n', 'utf-8');
    renameSyncWithRetry(tmpPath, queuePath);
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
      void shell.openExternal(url);
    }
  });

  ipcMain.handle('open-file', (_event, filePath: string) => {
    // Only allow opening files that actually exist on disk
    if (fs.existsSync(filePath)) {
      void shell.openPath(filePath);
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
          /* telemetry — silent by design */
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
    renameSyncWithRetry(tmpPath, filePath);
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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
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
    const data = readEdgesFile() as { edges: Record<string, unknown>[]; [k: string]: unknown } | null;
    if (!data?.edges) return data;
    return {
      ...data,
      edges: data.edges.map(({ rationale, ...rest }) => rest),
    };
  });

  ipcMain.handle('load-edge-detail', (_event, index: number) => {
    const data = readEdgesFile() as { edges: Record<string, unknown>[] } | null;
    if (!data?.edges) throw new ActionableError({
      goal: 'Load edge detail with rationale',
      problem: 'No edges.json found in the active taxonomy directory',
      location: 'ipcHandlers.loadEdgeDetail',
      nextSteps: [
        'Verify the data directory is configured correctly (Settings > Data Root)',
        'Check that edges.json exists in the active taxonomy directory',
      ],
    });
    if (index < 0 || index >= data.edges.length) throw new ActionableError({
      goal: 'Load edge detail with rationale',
      problem: `Edge index ${index} is out of range (0..${data.edges.length - 1})`,
      location: 'ipcHandlers.loadEdgeDetail',
      nextSteps: ['Reload the edges list to get current indices'],
    });
    return data.edges[index];
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

  ipcMain.handle('generate-news-report', async (_event, debateId: string) => {
    const session = await loadDebateSession(debateId) as Record<string, unknown>;
    const transcript = (session.transcript ?? []) as Array<{ type: string; content: string; speaker: string }>;
    const hasSynthesis = transcript.some(e => e.type === 'synthesis' || e.type === 'concluding');
    if (!hasSynthesis) {
      throw new ActionableError({
        goal: 'Generate news report from debate',
        problem: 'No synthesis entry found in the debate transcript',
        location: 'ipcHandlers.generateNewsReport',
        nextSteps: ['Run synthesis before generating the news report'],
      });
    }

    const { extractTranscriptHighlights, summarizeArgumentNetwork } = await import('../../../lib/debate/newsReport.js');
    const { newsReportPrompt } = await import('../../../lib/debate/prompts.js');

    const anNodes = ((session.argument_network as Record<string, unknown>)?.nodes ?? []) as unknown[];
    const anEdges = ((session.argument_network as Record<string, unknown>)?.edges ?? []) as unknown[];
    const highlights = extractTranscriptHighlights(transcript as never[], anNodes as never[]);
    const argSummary = summarizeArgumentNetwork(anNodes as never[], anEdges as never[]);
    const synthesisEntry = transcript.find(e => e.type === 'synthesis' || e.type === 'concluding');
    const synthesisJson = synthesisEntry?.content ?? '';
    const docAnalysis = (session.document_analysis as string | undefined) ?? undefined;
    const topic = ((session.topic as Record<string, unknown>)?.refined ?? (session.topic as Record<string, unknown>)?.original ?? '') as string;

    const audience = (session.audience as string | undefined) ?? undefined;
    const prompt = newsReportPrompt(topic, synthesisJson, argSummary, highlights, docAnalysis, undefined, audience as import('../../../lib/debate/types.js').DebateAudience | undefined);
    const text = await generateText(prompt, undefined, undefined, 120_000);
    return { article: text };
  });

  // ── Source evidence (runs in main process for filesystem access) ──
  type SourceEvidenceIndex = import('../../../lib/debate/evidenceFromSummaries.js').SourceEvidenceIndex;
  type DocTitleMap = import('../../../lib/debate/evidenceFromSummaries.js').DocTitleMap;
  let _evidenceIndex: SourceEvidenceIndex | null = null;
  let _docTitles: DocTitleMap | undefined;
  function loadEvidenceIndex(): SourceEvidenceIndex | null {
    if (_evidenceIndex) return _evidenceIndex;
    try {
      const config = loadDataConfig();
      const taxDir = path.join(getDataRootPath(), config.taxonomy_dir);
      const indexPath = path.join(taxDir, 'source_evidence_index.json');
      if (!fs.existsSync(indexPath)) return null;
      _evidenceIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      return _evidenceIndex;
    } catch { /* telemetry — silent by design */ return null; }
  }

  /** Build doc_id → metadata map from source metadata.json files (best-effort). */
  function loadDocTitles(): DocTitleMap | undefined {
    if (_docTitles) return _docTitles;
    try {
      const config = loadDataConfig();
      const sourcesRoot = config.sources_root
        ? path.resolve(PROJECT_ROOT, config.sources_root)
        : null;
      if (!sourcesRoot || !fs.existsSync(sourcesRoot)) return undefined;
      const metaMap: Record<string, { title: string; resolved_url?: string; provenance_label?: string }> = {};
      const dirs = fs.readdirSync(sourcesRoot, { withFileTypes: true });
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(sourcesRoot, entry.name, 'metadata.json');
        if (!fs.existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.title) {
            const docMeta: { title: string; resolved_url?: string; provenance_label?: string } = { title: meta.title };
            if (meta.resolved_url) docMeta.resolved_url = meta.resolved_url;
            if (meta.provenance?.length > 0 && meta.provenance[0].id) {
              docMeta.provenance_label = meta.provenance[0].id;
            }
            // Fallback: if no resolved_url yet but url field exists, use it
            if (!docMeta.resolved_url && meta.url) docMeta.resolved_url = meta.url;
            metaMap[entry.name] = docMeta;
          }
        } catch { /* telemetry — silent by design;  skip malformed metadata */ }
      }
      _docTitles = Object.keys(metaMap).length > 0 ? metaMap as unknown as DocTitleMap : undefined;
      if (_docTitles) console.log(`[evidence] Loaded ${Object.keys(metaMap).length} document metadata entries`);
      return _docTitles;
    } catch { /* telemetry — silent by design */ return undefined; }
  }

  ipcMain.handle('load-source-evidence-index', () => loadEvidenceIndex());
  ipcMain.handle('load-doc-titles', () => loadDocTitles());

  ipcMain.handle('get-source-evidence', async (_event, nodeIds: string[], pov: string) => {
    const emptyResult = { facts: [], keyPoints: [], formattedBlock: '', nodesCovered: [], totalCandidates: 0 };
    const index = loadEvidenceIndex();
    if (!index) return emptyResult;
    try {
      const { retrieveSourceEvidence } = await import('../../../lib/debate/evidenceFromSummaries.js');
      const docTitles = loadDocTitles();
      return retrieveSourceEvidence(nodeIds, pov, index, 3, 2, docTitles);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      console.warn(`[ipc] get-source-evidence failed: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
      return emptyResult;
    }
  });

  // ── Chat session handlers ─���───────────────────────────
  // ── Evidence QBAF (runs full pipeline in main process) ──
  ipcMain.handle('run-evidence-qbaf', async (_event, claimText: string, claimId: string, model?: string) => {
    const sourcesDir = getSourcesDir();
    if (!sourcesDir || !fs.existsSync(sourcesDir)) return null;

    try {
      const { retrieveEvidence } = await import('../../../lib/debate/evidenceRetriever.js');
      const { buildEvidenceQbaf } = await import('../../../lib/debate/evidenceQbaf.js');
      type AIAdapter = import('../../../lib/debate/aiAdapter.js').AIAdapter;

      const evidenceItems = retrieveEvidence(claimText, sourcesDir, { topK: 10 });
      if (evidenceItems.length === 0) return null;

      const adapter: AIAdapter = {
        generateText: async (prompt: string, mdl: string, opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number }) => {
          return generateText(prompt, mdl, undefined, opts?.timeoutMs, opts?.temperature);
        },
      };

      const evalModel = model || DEFAULT_MODEL;
      const result = await buildEvidenceQbaf(claimText, evidenceItems, adapter, evalModel, {
        claimBaseStrength: 0.5,
      });
      return { ...result, claim_id: claimId };
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ipc] run-evidence-qbaf failed for ${claimId}: ${msg}`);
      return null;
    }
  });

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

  ipcMain.handle('export-debate-to-file', async (event, session: unknown, format?: string, exportOptions?: { includeTaxonomyRefs?: boolean; includeReasoning?: boolean }) => {
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

    const debate = session as any;

    switch (ext) {
      case 'md': {
        const md = debateToMarkdown(debate, exportOptions);
        fs.writeFileSync(filePath, md, 'utf-8');
        break;
      }
      case 'txt': {
        const txt = debateToText(debate, exportOptions);
        fs.writeFileSync(filePath, txt, 'utf-8');
        break;
      }
      case 'pdf': {
        const pdfBuffer = await debateToPdf(debate, exportOptions);
        fs.writeFileSync(filePath, pdfBuffer);
        break;
      }
      case 'zip': {
        const zipBytes = await debateToPackage(debate, {
          ...exportOptions,
          generatePdf: async (s) => {
            const buf = await debateToPdf(s, exportOptions);
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
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return { content: '', error: String(err) };
    }
  });

  // Submit a debate/chat to the remote Community Library.
  // Routed through the main process (net.fetch) rather than a renderer fetch:
  // the renderer origin (http://localhost:5173 in dev, file:// when packaged) is
  // never in the server's CORS allowlist, so a renderer fetch is blocked with
  // "Failed to fetch". Main-process requests are not subject to browser CORS.
  ipcMain.handle(
    'community-submit',
    async (_event, baseUrl: unknown, payload: unknown) => {
      // Validate untrusted IPC input at the boundary (TS types are erased at runtime).
      const base = z.string().url().parse(baseUrl).replace(/\/+$/, '');
      // S-SSRF: only allow http/https to prevent file:// and internal protocols.
      if (!/^https?:\/\//i.test(base)) {
        throw new Error('Community server URL must be an http(s) URL. Set it in Settings to share debates.');
      }
      const submitPayload = z
        .object({ type: z.enum(['chat', 'debate']), data: z.unknown(), note: z.string().optional() })
        .parse(payload);
      const url = `${base}/api/community/submit`;
      try {
        const res = await net.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submitPayload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return (await res.json()) as { submissionId: string };
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'ipc-handlers',
          level: 'error',
          message: 'Community submit failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        throw err;
      }
    },
  );

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
        try { history = JSON.parse(fs.readFileSync(histPath, 'utf-8')); } catch { /* telemetry — silent by design;  corrupt */ }
      }

      // Capture current snapshot from provisional-weights.json
      const weightsPath = path.join(PROJECT_ROOT, 'lib', 'debate', 'provisional-weights.json');
      let weights: Record<string, unknown> = {};
      try { weights = JSON.parse(fs.readFileSync(weightsPath, 'utf-8')); } catch { /* telemetry — silent by design;  use defaults */ }

      const current = {
        exploration_exit: (weights?.thresholds as Record<string, number>)?.exploration_exit ?? 0.65,
        relevance_threshold: 0.45,
        attack_weights: [1.0, 1.1, 1.2],
        draft_temperature: DEFAULT_TEMPERATURE,
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
      /* telemetry — silent by design */
      return { current: null, history: [] };
    }
  });

  // ── Calibration log (per-debate metrics) ──
  ipcMain.handle('get-calibration-log', () => {
    try {
      const dataRoot = getDataRootPath();
      const logPath = path.join(dataRoot, 'calibration', 'core', 'calibration-log.jsonl');
      if (!fs.existsSync(logPath)) return { entries: [], validationReport: null };

      // JSONL: one JSON object per line. Parse each non-empty line independently.
      const entries = fs.readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));

      // Also load validation report if available
      const reportPath = path.join(dataRoot, 'calibration', 'validation-report.json');
      let validationReport = null;
      if (fs.existsSync(reportPath)) {
        try { validationReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch { /* telemetry — silent by design;  ok */ }
      }

      return { entries, validationReport };
    } catch {
      /* telemetry — silent by design */
      return { entries: [], validationReport: null };
    }
  });

  // ── Flight recorder: forward events from popup windows to main ──
  ipcMain.on('forward-flight-event', (event, payload: unknown) => {
    // Forward to the main window's renderer (which owns the real recorder)
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== event.sender) {
        win.webContents.send('flight-event-from-popup', payload);
      }
    }
  });

  // Forward re-extract-claims request from popout to main window (t/226)
  ipcMain.on('request-re-extract-claims', (event, entryId: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents !== event.sender) {
        win.webContents.send('re-extract-claims', entryId);
      }
    }
  });

  // ── Flight recorder: popup requests main window to dump ──
  ipcMain.handle('trigger-main-dump', (event) => {
    return new Promise<{ filePath: string }>((resolve, reject) => {
      // Find the main window (any window that isn't the sender)
      const mainWin = BrowserWindow.getAllWindows().find(w => w.webContents !== event.sender);
      if (!mainWin || mainWin.isDestroyed()) {
        reject(new Error('Main window not available'));
        return;
      }
      // One-time listener for the dump result from the main window
      let timeout: ReturnType<typeof setTimeout>;
      const handler = (_e: Electron.IpcMainEvent, result: { filePath: string }) => {
        clearTimeout(timeout);
        resolve(result);
      };
      timeout = setTimeout(() => {
        ipcMain.removeListener('dump-result', handler);
        reject(new Error('Dump request timed out'));
      }, 10_000);
      ipcMain.once('dump-result', handler);
      mainWin.webContents.send('trigger-dump');
    });
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
    } catch { /* telemetry — silent by design;  retention cleanup is best-effort */ }

    const filename = path.basename(filePath);
    console.log(`[flight-recorder] Dump written: ${filePath}`);
    return { filePath, filename };
  });

  ipcMain.handle('open-flight-recorder-viewer', (_event, dumpPath: string) => {
    if (!fs.existsSync(dumpPath)) return;

    const viewerPath = path.join(PROJECT_ROOT, 'tools', 'flight-recorder-viewer.html');
    if (!fs.existsSync(viewerPath)) {
      // Fallback: open raw file if viewer HTML not found
      void shell.openPath(dumpPath);
      return;
    }

    const dumpContent = fs.readFileSync(dumpPath, 'utf-8');
    const viewerHtml = fs.readFileSync(viewerPath, 'utf-8');

    // Escape for embedding in a JS template literal
    const escaped = dumpContent
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const autoLoadScript = `<script>
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('fileName').textContent = '${path.basename(dumpPath).replace(/'/g, "\\'")}';
  parseNdjson(\`${escaped}\`);
});
</script>`;

    const outputHtml = viewerHtml.replace('</body>', `${autoLoadScript}\n</body>`);

    const tempDir = path.join(app.getPath('temp'), 'flight-recorder-viewer');
    fs.mkdirSync(tempDir, { recursive: true });
    const ts = new Date().toISOString().replace(/:/g, '-');
    const tempFile = path.join(tempDir, `viewer-${ts}.html`);
    fs.writeFileSync(tempFile, outputHtml, 'utf-8');

    void shell.openPath(tempFile);
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

  // ── Research file access (path-validated) ───────────────────────────────────
  const RESEARCH_DIR = path.join(PROJECT_ROOT, 'research');
  const MAX_RESEARCH_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

  function resolveResearchPath(relativePath: string): string {
    const resolved = path.resolve(RESEARCH_DIR, relativePath);
    if (!resolved.startsWith(RESEARCH_DIR + path.sep) && resolved !== RESEARCH_DIR) {
      throw new ActionableError({
        goal: 'Access research file',
        problem: `Path traversal blocked: "${relativePath}" resolves outside research/`,
        location: 'ipcHandlers:resolveResearchPath',
        nextSteps: ['Use a relative path within the research/ directory'],
      });
    }
    return resolved;
  }

  ipcMain.handle('read-research-file', (_event, relativePath: string) => {
    const filePath = resolveResearchPath(relativePath);
    try {
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_RESEARCH_FILE_SIZE) {
        throw new ActionableError({
          goal: 'Read research file',
          problem: `File exceeds 10 MB size limit (${(stat.size / 1024 / 1024).toFixed(1)} MB)`,
          location: `ipcHandlers:read-research-file(${relativePath})`,
          nextSteps: ['Use a smaller file or process it in chunks'],
        });
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      if (err instanceof ActionableError) throw err;
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-research-file',
        level: 'error',
        message: `Failed to read research file: ${relativePath}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return null;
    }
  });

  ipcMain.handle('write-research-file', (_event, relativePath: string, data: unknown) => {
    const filePath = resolveResearchPath(relativePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeJsonFileAtomic(filePath, data);
  });

  ipcMain.handle('load-synthetic-corpus', (_event, pov: string) => {
    return loadSyntheticCorpus(pov);
  });

  ipcMain.handle('load-synthetic-embeddings', () => {
    return loadSyntheticEmbeddings();
  });

  ipcMain.handle('update-synthetic-embeddings', (_event, nodeId: string, pov: string, vectors: number[][]) => {
    updateSyntheticEmbeddings(nodeId, pov, vectors);
  });

  ipcMain.handle('submit-feedback', (_event, rating: string, text?: string, category?: string, context?: Record<string, unknown>) => {
    if (rating !== 'up' && rating !== 'down') return { ok: false };
    const feedbackDir = path.join(getDataRootPath(), 'admin', 'feedback');
    fs.mkdirSync(feedbackDir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ts = new Date().toISOString().replace(/:/g, '-');
    const entry = { id, timestamp: new Date().toISOString(), rating, text: text?.trim() || null, category: category || 'general', context: context || null };
    fs.writeFileSync(path.join(feedbackDir, `feedback-${ts}-${id.slice(0, 8)}.json`), JSON.stringify(entry, null, 2));
    return { ok: true, id };
  });

  ipcMain.handle('capture-screenshot', async (_event, opts?: { width?: number; height?: number; defaultName?: string }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { cancelled: true };

    const width = opts?.width ?? 960;
    const height = opts?.height ?? 600;
    const originalBounds = win.getBounds();

    // Resize, wait for paint, capture, restore
    win.setContentSize(width, height);
    await new Promise(r => setTimeout(r, 500));
    const image = await win.webContents.capturePage();
    win.setBounds(originalBounds);

    const result = await dialog.showSaveDialog(win, {
      title: 'Save Screenshot',
      defaultPath: opts?.defaultName ?? 'screenshot.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };

    fs.writeFileSync(result.filePath, image.toPNG());
    return { cancelled: false, filePath: result.filePath };
  });

  ipcMain.handle('report-error', (_event, error: Record<string, unknown>, context?: Record<string, unknown>) => {
    const errorsDir = path.join(getDataRootPath(), 'admin', 'errors');
    fs.mkdirSync(errorsDir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const ts = new Date().toISOString().replace(/:/g, '-');
    const entry = { id, timestamp: new Date().toISOString(), error, context: context ?? {} };
    fs.writeFileSync(path.join(errorsDir, `error-${ts}-${id.slice(0, 8)}.json`), JSON.stringify(entry, null, 2));
    return { ok: true };
  });

  // ── Community Review (Azure Blob) ──

  ipcMain.handle('admin-review-configured', () => {
    return isAzureReviewConfigured();
  });

  ipcMain.handle('admin-review-queue', async () => {
    // Read — degrade gracefully when Azure isn't configured or the call fails (t/1088).
    if (!isAzureReviewConfigured()) return { items: [] };
    try {
      return await adminReviewQueue();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-admin-review-queue',
        level: 'warn',
        message: 'admin-review-queue failed; returning empty queue',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return { items: [] };
    }
  });

  ipcMain.handle('admin-review-stats', async () => {
    // Polled by the renderer Toolbar. Degrade gracefully when Azure isn't configured
    // or the stats call fails — return empty rather than throwing on every poll (t/1088).
    if (!isAzureReviewConfigured()) return { total: 0, byDomain: {} };
    try {
      return await adminReviewStats();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-admin-review-stats',
        level: 'warn',
        message: 'admin-review-stats failed; returning empty stats',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return { total: 0, byDomain: {} };
    }
  });

  ipcMain.handle('admin-review-detail', async (_event, groupId: string) => {
    // Read — degrade gracefully (null) when Azure isn't configured or the call fails.
    if (!isAzureReviewConfigured()) return null;
    try {
      return await adminReviewDetail(groupId);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-admin-review-detail',
        level: 'warn',
        message: 'admin-review-detail failed; returning null',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return null;
    }
  });

  ipcMain.handle('admin-review-action', async (_event, action: {
    groupId: string;
    action: 'promote' | 'reject';
    itemIds: string[];
    reason?: string;
    edits?: Record<string, Record<string, unknown>>;
  }) => {
    // Mutation — surface failures to the user (ADR-001), don't swallow.
    if (!isAzureReviewConfigured()) throw new ActionableError({
      goal: 'Apply a community-review moderation action',
      problem: 'Azure community review is not configured (AZURE_STORAGE_ACCOUNT_URL is unset)',
      location: 'ipcHandlers.admin-review-action',
      nextSteps: [
        'Set AZURE_STORAGE_ACCOUNT_URL for the desktop app to enable community review',
        'Confirm the admin review panel should be available in this environment',
      ],
    });
    try {
      return await adminReviewAction(action);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-admin-review-action',
        level: 'error',
        message: 'admin-review-action failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      throw new ActionableError({
        goal: 'Apply a community-review moderation action',
        problem: `The ${action.action} action could not be completed`,
        location: 'ipcHandlers.admin-review-action',
        nextSteps: ['Retry the action', 'Check Azure storage connectivity and credentials'],
        innerError: err,
      });
    }
  });

  ipcMain.handle('admin-remove-community-item', async (_event, type: 'chats' | 'debates', id: string, reason?: string) => {
    // Mutation — surface failures to the user (ADR-001), don't swallow.
    if (!isAzureReviewConfigured()) throw new ActionableError({
      goal: 'Remove a community item',
      problem: 'Azure community review is not configured (AZURE_STORAGE_ACCOUNT_URL is unset)',
      location: 'ipcHandlers.admin-remove-community-item',
      nextSteps: ['Set AZURE_STORAGE_ACCOUNT_URL for the desktop app to enable community review'],
    });
    try {
      return await adminRemoveCommunityItem(type, id, reason);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-admin-remove-community-item',
        level: 'error',
        message: 'admin-remove-community-item failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      throw new ActionableError({
        goal: 'Remove a community item',
        problem: `Could not remove ${type} item ${id}`,
        location: 'ipcHandlers.admin-remove-community-item',
        nextSteps: ['Retry the removal', 'Check Azure storage connectivity and credentials'],
        innerError: err,
      });
    }
  });
}
