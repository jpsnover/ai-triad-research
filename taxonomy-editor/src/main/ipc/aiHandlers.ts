// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// AI / embeddings handlers (t/1689 split of ipcHandlers.ts, ADR-007).
// Model config + discovery, embedding compute, NLI, text generation (plain +
// grounded search), chat streaming, debate temperature, URL fetch, and the
// read-only calibration views. Handler bodies moved verbatim; channels unchanged.

import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT, getDataRootPath } from '../fileIO.js';
import { computeEmbeddings, computeQueryEmbedding, generateText, generateTextWithSearch, generateChatStream, updateNodeEmbeddings, classifyNli, setDebateTemperature, getEmbeddingInfo } from '../embeddings.js';
import type { ChatMessage, NodeEmbeddingInput, NliPair } from '../embeddings.js';
import { refreshAIModels } from '../modelDiscovery.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { DEFAULT_TEMPERATURE } from '../../../../lib/ai-client/index.js';
import { buildEmbeddingFailureError } from '../embeddingErrors.js';

export function registerAiHandlers(): void {
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

  ipcMain.handle('refresh-ai-models', async () => {
    return refreshAIModels();
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
      console.error('[IPC] compute-embeddings failed:', err instanceof Error ? err.message : String(err));
      throw buildEmbeddingFailureError(
        'Compute text embeddings for taxonomy nodes',
        'ipcHandlers.computeEmbeddings',
        'Embedding computation failed',
        err,
      );
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
      console.error('[IPC] compute-query-embedding failed:', err instanceof Error ? err.message : String(err));
      throw buildEmbeddingFailureError(
        'Compute embedding for a search query',
        'ipcHandlers.computeQueryEmbedding',
        'Query embedding failed',
        err,
      );
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
      console.error('[IPC] update-node-embeddings failed:', err instanceof Error ? err.message : String(err));
      throw buildEmbeddingFailureError(
        `Update embeddings for ${nodes.length} taxonomy node(s)`,
        'ipcHandlers.updateNodeEmbeddings',
        'Embedding update failed',
        err,
      );
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

  ipcMain.handle('fetch-url-content', async (_event, url: string) => {
    // S-SSRF: Only allow http/https protocols to prevent file:// and internal network access
    if (!/^https?:\/\//i.test(url)) {
      return { content: '', error: 'Only http/https URLs are allowed' };
    }
    try {
      const { fetchUrlContent } = await import('../../../../lib/debate/taxonomyLoader.js');
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
}
