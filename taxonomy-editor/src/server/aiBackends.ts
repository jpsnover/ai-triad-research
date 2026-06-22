// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AI backend service — mirrors main/embeddings.ts without Electron's net.fetch.
 * Uses standard fetch (Node 22+).
 *
 * Provider logic (Gemini, Claude, Groq, OpenAI), retry, and utility functions
 * are delegated to the shared lib/ai-client package.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';

const require = createRequire(import.meta.url);
import { getApiKey, getProjectRoot, EMBED_SCRIPT, resolveDataPath, type AIBackend } from './config.js';
import { ActionableError } from '../../../lib/debate/errors.js';
import { tavilySearch, buildSearchAugmentedPrompt } from '../../../lib/search/tavily.js';
import {
  resolveBackend,
  callProvider,
  withRetry,
  buildModelIdMap,
  getApiModelId as getApiModelIdFromMap,
  getDefaultTimeout,
  SERVER_RETRY_CONFIG,
  callGeminiBatchEmbed,
  geminiGroundedSearch,
  DEFAULT_MODEL,
  type GenerateOptions,
  type ProviderResult,
  type RateLimitType,
  type GroundingCitation as SharedGroundingCitation,
} from '../../../lib/ai-client/index.js';

import { log } from './logger.js';

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// ── Constants ──

const BATCH_SIZE = 100;

// ── Multi-provider availability (t/772) ──

export interface BackendAvailability {
  id: string;
  available: boolean;
  models?: string[];
  reason?: 'no_key' | 'tier_restricted' | 'rate_limited';
}

interface ModelRegistry {
  backends?: { id: string }[];
  models?: { id: string; backend: string }[];
}

/**
 * Pure computation behind GET /api/backends/available (t/772): a backend is
 * available only when BOTH a key exists for it AND it's authorized for the
 * caller's tier — so the multi-provider UI stops assigning speaker models to
 * backends that 403 at generation time. tier_restricted takes precedence over
 * no_key (a missing key is moot if the tier forbids the backend).
 */
export function computeAvailableBackends(
  registry: ModelRegistry,
  allowedBackends: string[],
  keyPresence: Record<string, boolean>,
): BackendAvailability[] {
  const models = registry.models ?? [];
  return (registry.backends ?? []).map(({ id }) => {
    const tierAllowed = allowedBackends.includes(id);
    if (!tierAllowed) return { id, available: false, reason: 'tier_restricted' as const };
    if (!keyPresence[id]) return { id, available: false, reason: 'no_key' as const };
    return { id, available: true, models: models.filter(m => m.backend === id).map(m => m.id) };
  });
}

// ── Temperature state ──

let _debateTemperature: number | null = null;

export function setDebateTemperature(temp: number | null): void {
  if (temp === _debateTemperature) return;
  _debateTemperature = temp;
}

// ── Re-export shared types ──

export type { RateLimitType };

export interface GenerateTextProgress {
  attempt: number;
  maxRetries: number;
  backoffSeconds: number;
  limitType: RateLimitType;
  limitMessage: string;
}

// ── Model ID mapping (mtime-cached) ──

let _modelMapCache: Record<string, string> | null = null;
let _fallbackChainCache: Record<string, string[]> | null = null;
let _defaultsCache: Record<string, string> | null = null;
let _modelConfigMtime = 0;

function loadModelConfig(): { modelMap: Record<string, string>; fallbackChains: Record<string, string[]>; defaults: Record<string, string> } {
  try {
    const configPath = path.join(getProjectRoot(), 'ai-models.json');
    const stat = fs.statSync(configPath);
    if (!_modelMapCache || stat.mtimeMs !== _modelConfigMtime) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const registry = JSON.parse(raw) as { models: { id: string; apiModelId?: string }[]; fallbackChains?: Record<string, string[]>; defaults?: Record<string, string> };
      _modelMapCache = buildModelIdMap(registry as { models: { id: string; apiModelId: string; label: string; backend: string }[]; backends: [] });
      _fallbackChainCache = registry.fallbackChains ?? {};
      _defaultsCache = registry.defaults ?? {};
      _modelConfigMtime = stat.mtimeMs;
      log.api.debug({ models: Object.keys(_modelMapCache!).length, chains: Object.keys(_fallbackChainCache!).length }, 'Reloaded model config');
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'ai-backends',
      level: 'error',
      message: 'Operation failed',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    log.api.warn({ err }, 'Failed to load model config');
    if (!_modelMapCache) _modelMapCache = {};
    if (!_fallbackChainCache) _fallbackChainCache = {};
    if (!_defaultsCache) _defaultsCache = {};
  }
  return { modelMap: _modelMapCache!, fallbackChains: _fallbackChainCache!, defaults: _defaultsCache! };
}

function loadModelMap(): Record<string, string> {
  return loadModelConfig().modelMap;
}

function getFallbackChain(modelId: string): string[] {
  const { fallbackChains, defaults } = loadModelConfig();
  const explicit = fallbackChains[modelId];
  if (explicit) return explicit;

  const backend = resolveBackend(modelId);
  const chain: string[] = [];
  const sameDefault = defaults[backend];
  if (sameDefault && sameDefault !== modelId) chain.push(sameDefault);
  for (const fb of ['gemini', 'groq'] as const) {
    if (fb === backend) continue;
    const fbDefault = defaults[fb];
    if (fbDefault && !chain.includes(fbDefault)) { chain.push(fbDefault); break; }
  }

  if (chain.length > 0) {
    getGlobalRecorder()?.record({
      type: 'ai.fallback', component: 'ai-backends', level: 'info',
      message: `Auto-generated fallback chain for ${modelId}: ${chain.join(' → ')}`,
      data: { model: modelId, chain, source: 'auto-generated' },
    });
  }

  return chain;
}

function getApiModelId(friendlyId: string): string {
  const map = loadModelMap();
  const mapped = getApiModelIdFromMap(map, friendlyId);

  if (mapped !== friendlyId && !map[friendlyId]) {
    getGlobalRecorder()?.record({
      type: 'ai.fallback', component: 'ai-backends', level: 'warn',
      message: `Fuzzy-remapped model ${friendlyId} → ${mapped}`,
      data: { requestedModel: friendlyId, resolvedModel: mapped },
    });
    log.api.warn({ friendlyId, mapped }, 'Fuzzy-remapped unknown model ID');
  } else if (mapped === friendlyId && !map[friendlyId]) {
    log.api.warn({ friendlyId }, 'Unknown model ID — sending as-is (this may fail)');
  }

  return mapped;
}

// ── Token usage tracking ──

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GenerateResult {
  text: string;
  tokenUsage?: TokenUsage;
}

/** Convert shared ProviderResult.usage to the local TokenUsage shape. */
function mapUsage(usage: ProviderResult['usage']): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.promptTokens ?? 0,
    outputTokens: usage.completionTokens ?? 0,
    totalTokens: usage.totalTokens ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)),
  };
}

// ── Public API ──

export { resolveBackend };

/**
 * The ordered list of models generateText() will attempt: the resolved model
 * followed by its fallback chain.
 *
 * t/829: when an explicit key is supplied (e.g. the free-tier server Gemini
 * key), that key belongs to a single provider — so cross-provider fallbacks are
 * dropped. Passing a Gemini key to Groq/Claude only produces auth errors,
 * making the fallback chain useless. Without an explicit key each model resolves
 * its own per-backend key, so the full cross-provider chain is kept.
 */
export function buildModelsToTry(resolved: string, hasExplicitKey: boolean): string[] {
  return filterChainForExplicitKey([resolved, ...getFallbackChain(resolved)], hasExplicitKey);
}

/**
 * Pure filter (t/829): when an explicit key is in play, keep only models that
 * resolve to the same backend as the first (resolved) model — the explicit key
 * belongs to one provider. No-op when there's no explicit key or the chain is
 * empty. Split out from buildModelsToTry so the filtering is unit-testable
 * without loading ai-models.json.
 */
export function filterChainForExplicitKey(models: string[], hasExplicitKey: boolean): string[] {
  if (!hasExplicitKey || models.length === 0) return models;
  const primaryBackend = resolveBackend(models[0]);
  return models.filter(m => resolveBackend(m) === primaryBackend);
}

export async function generateText(
  prompt: string,
  model?: string,
  onRetry?: (p: GenerateTextProgress) => void,
  timeoutMs?: number,
  explicitApiKey?: string,
): Promise<GenerateResult> {
  const resolved = model || DEFAULT_MODEL;
  const modelsToTry = buildModelsToTry(resolved, explicitApiKey !== undefined);

  let lastError: unknown;
  for (let mi = 0; mi < modelsToTry.length; mi++) {
    const currentModel = modelsToTry[mi];
    const backend = resolveBackend(currentModel);
    const apiKey = explicitApiKey ?? await getApiKey(backend);
    if (!apiKey) {
      if (mi < modelsToTry.length - 1) {
        getGlobalRecorder()?.record({
          type: 'ai.fallback', component: 'ai-adapter', level: 'info',
          message: `Skipping ${currentModel}: no ${backend} API key — trying next fallback`,
          data: { model: currentModel, backend, fallbackIndex: mi, chain: modelsToTry },
        });
        continue;
      }
      const names: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI', tavily: 'Tavily', deepseek: 'DeepSeek' };
      const backendName = names[backend] ?? backend;
      throw new ActionableError({
        goal: `Generate text via ${backendName}`,
        problem: `No API key configured for any model in the fallback chain: ${modelsToTry.join(' → ')}`,
        location: 'aiBackends.generateText',
        nextSteps: [`Set your ${backendName} API key in Settings`, 'Or switch to a backend that has a key configured'],
      });
    }

    const apiModel = getApiModelId(currentModel);
    const opts: GenerateOptions = {
      temperature: _debateTemperature ?? 0.7,
      timeoutMs: timeoutMs ?? getDefaultTimeout(currentModel),
    };

    try {
      const result = await withRetry(
        () => callProvider(fetch, backend, prompt, apiModel, apiKey, opts),
        SERVER_RETRY_CONFIG,
        `${backend}/${apiModel}`,
        (msg: string) => {
          const attemptMatch = msg.match(/attempt (\d+)\/(\d+)/);
          const backoffMatch = msg.match(/waiting (\d+)s/);
          const reasonMatch = msg.match(/failed \((.+?)\), waiting/);
          const attempt = attemptMatch ? parseInt(attemptMatch[1], 10) : 1;
          const maxRetries = attemptMatch ? parseInt(attemptMatch[2], 10) : SERVER_RETRY_CONFIG.maxRetries;
          const backoffSeconds = backoffMatch ? parseInt(backoffMatch[1], 10) : 5;
          const reason = reasonMatch?.[1] ?? msg;
          onRetry?.({
            attempt, maxRetries, backoffSeconds,
            limitType: 'unknown',
            limitMessage: msg,
          });
          getGlobalRecorder()?.record({
            type: 'ai.retry', component: 'ai-adapter', level: 'warn',
            message: `Retry ${attempt}/${maxRetries}: ${reason}`,
            data: { attempt, maxRetries, backoffSeconds, reason, backend, model: apiModel },
          });
        },
      );

      if (mi > 0) {
        getGlobalRecorder()?.record({
          type: 'ai.fallback', component: 'ai-adapter', level: 'info',
          message: `Fallback succeeded: ${currentModel} (after ${resolved} failed)`,
          data: { originalModel: resolved, fallbackModel: currentModel, fallbackIndex: mi },
        });
      }
      return { text: result.text, tokenUsage: mapUsage(result.usage) };
    } catch (err) {
      lastError = err;
      if (mi < modelsToTry.length - 1) {
        const nextModel = modelsToTry[mi + 1];
        getGlobalRecorder()?.record({
          type: 'ai.fallback', component: 'ai-adapter', level: 'warn',
          message: `${currentModel} failed after retries — falling back to ${nextModel}`,
          data: { failedModel: currentModel, nextModel, fallbackIndex: mi, error: String(err), chain: modelsToTry },
        });
      }
    }
  }

  throw lastError;
}

export type { SharedGroundingCitation as GroundingCitation };
export type { GroundingSegment } from '../../../lib/ai-client/providers/gemini-search.js';

export async function generateTextWithSearch(
  prompt: string, model?: string,
): Promise<{ text: string; searchQueries?: string[]; citations?: SharedGroundingCitation[] }> {
  const resolved = model || DEFAULT_MODEL;
  const backend = resolveBackend(resolved);

  if (backend !== 'gemini') {
    const tavilyKey = await getApiKey('tavily');
    if (tavilyKey) {
      const searchQuery = prompt.length > 400 ? prompt.slice(0, 400) : prompt;
      log.api.info({ model: resolved, queryLength: searchQuery.length }, 'Tavily search');
      const searchResult = await tavilySearch(searchQuery, tavilyKey, {
        maxResults: 5,
        includeAnswer: true,
        searchDepth: 'basic',
      });
      const { augmentedPrompt, searchQueries, citations: searchCitations } = buildSearchAugmentedPrompt(prompt, searchResult);
      const { text } = await generateText(augmentedPrompt, resolved);
      const citations: SharedGroundingCitation[] = searchCitations.map(c => ({
        uri: c.uri,
        title: c.title,
        segments: [],
      }));
      return {
        text,
        searchQueries: searchQueries.length ? searchQueries : undefined,
        citations: citations.length ? citations : undefined,
      };
    }
    const result = await generateText(prompt, resolved);
    return { text: result.text };
  }

  const apiKey = await getApiKey('gemini');
  if (!apiKey) {
    throw new ActionableError({
      goal: 'Perform grounded search via Gemini',
      problem: 'No Gemini API key configured',
      location: 'aiBackends.generateTextWithSearch',
      nextSteps: ['Set your Gemini API key in Settings'],
    });
  }

  const apiModel = getApiModelId(resolved);
  return geminiGroundedSearch(fetch, prompt, apiModel, apiKey);
}

// ── Embeddings ──

interface EmbeddingsFile {
  model: string;
  dimension: number;
  node_count: number;
  nodes: Record<string, { pov: string; vector: number[]; exclusion_vector?: number[] | null }>;
}

let embeddingsCache: EmbeddingsFile | null = null;

function getEmbeddingsPath(): string {
  return path.join(resolveDataPath('taxonomy/Origin'), 'embeddings.json');
}

function loadEmbeddingsFile(): EmbeddingsFile | null {
  try {
    const p = getEmbeddingsPath();
    if (embeddingsCache) return embeddingsCache;
    embeddingsCache = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return embeddingsCache;
  } catch {
    /* telemetry — silent by design */
    return null;
  }
}

function callGeminiBatchApi(texts: string[], taskType: string, apiKey: string): Promise<number[][]> {
  return callGeminiBatchEmbed(fetch, texts, taskType, apiKey, SERVER_RETRY_CONFIG);
}

export async function computeEmbeddings(texts: string[], ids?: string[]): Promise<number[][]> {
  const local = loadEmbeddingsFile();
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const missing: number[] = [];

  if (ids && local) {
    for (let i = 0; i < texts.length; i++) {
      const nid = ids[i];
      if (nid && local.nodes[nid]) results[i] = local.nodes[nid].vector;
      else missing.push(i);
    }
  } else {
    for (let i = 0; i < texts.length; i++) missing.push(i);
  }

  if (missing.length > 0) {
    const missingTexts = missing.map(i => texts[i]);
    const missingIds = ids ? missing.map(i => ids[i] ?? `_idx_${i}`) : missing.map((_, j) => `_idx_${j}`);
    let computed: number[][] | null = null;

    // Try Gemini batch API first
    const apiKey = await getApiKey('gemini');
    if (apiKey) {
      try {
        const all: number[][] = [];
        for (let i = 0; i < missingTexts.length; i += BATCH_SIZE) {
          const batch = missingTexts.slice(i, i + BATCH_SIZE);
          all.push(...await callGeminiBatchApi(batch, 'RETRIEVAL_DOCUMENT', apiKey));
        }
        computed = all;
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'ai.fallback', component: 'embeddings', level: 'warn',
          message: `Gemini batch embed failed — trying local Python fallback`,
          data: { count: missingTexts.length, error: String(err) },
        });
      }
    }

    // Fallback: local Python batch-encode
    if (!computed && await isPythonEmbeddingAvailable()) {
      try {
        computed = await computeBatchViaLocalPython(missingTexts, missingIds);
        getGlobalRecorder()?.record({
          type: 'ai.fallback', component: 'embeddings', level: 'info',
          message: `Local Python batch-encode succeeded as fallback`,
          data: { count: missingTexts.length },
        });
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'embeddings', level: 'error',
          message: 'Local Python batch-encode fallback also failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
    }

    if (!computed) {
      throw new ActionableError({
        goal: 'Compute embeddings',
        problem: apiKey
          ? 'Gemini embedding API failed and local Python fallback unavailable'
          : 'No Gemini API key configured and local Python fallback unavailable',
        location: 'aiBackends.computeEmbeddings',
        nextSteps: [
          'Set your Gemini API key in Settings',
          'Or install Python with sentence-transformers: pip install sentence-transformers',
        ],
      });
    }

    for (let j = 0; j < missing.length; j++) results[missing[j]] = computed[j];
  }

  return results as number[][];
}

function computeBatchViaLocalPython(texts: string[], ids: string[]): Promise<number[][]> {
  const input = texts.map((text, i) => ({ id: ids[i], text }));
  return new Promise((resolve, reject) => {
    const child = execFile(PYTHON, [EMBED_SCRIPT, 'batch-encode'], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`Python batch-encode failed: ${err.message}\n${stderr}`)); return; }
      try {
        const map = JSON.parse(stdout) as Record<string, number[]>;
        const vectors = ids.map(id => map[id]);
        if (vectors.some(v => !v || !Array.isArray(v))) { reject(new Error('Incomplete vectors from batch-encode')); return; }
        resolve(vectors as number[][]);
      } catch (e) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'ai-backends',
          level: 'warn',
          message: 'Failed to parse batch-encode output',
          error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack },
        });
        reject(new Error(`Parse failed: ${e}`));
      }
    });
    child.stdin?.write(JSON.stringify(input));
    child.stdin?.end();
  });
}

// ── Python embedding availability probe ──

let _pythonAvailable: boolean | null = null;

function isPythonEmbeddingAvailable(): Promise<boolean> {
  if (_pythonAvailable !== null) return Promise.resolve(_pythonAvailable);
  return new Promise(resolve => {
    execFile(PYTHON, ['-c', 'import sentence_transformers'], { timeout: 10_000 }, (err) => {
      _pythonAvailable = !err;
      if (!_pythonAvailable) log.server.info('[embeddings] Python sentence-transformers unavailable — using API only');
      resolve(_pythonAvailable);
    });
  });
}

function computeQueryViaLocalPython(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [EMBED_SCRIPT, 'encode', text], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`Python embed failed: ${err.message}\n${stderr}`)); return; }
      try {
        const v = JSON.parse(stdout) as number[];
        if (!Array.isArray(v) || v.length === 0) { reject(new Error('Empty vector')); return; }
        resolve(v);
      } catch (e) { /* telemetry — silent by design */ reject(new Error(`Parse failed: ${e}`)); }
    });
  });
}

// ── Query embedding LRU cache ──

const QUERY_CACHE_MAX = 256;
const _queryCache = new Map<string, number[]>();

function getCachedQueryEmbedding(text: string): number[] | undefined {
  const vec = _queryCache.get(text);
  if (vec) {
    _queryCache.delete(text);
    _queryCache.set(text, vec);
  }
  return vec;
}

function setCachedQueryEmbedding(text: string, vec: number[]): void {
  if (_queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = _queryCache.keys().next().value!;
    _queryCache.delete(oldest);
  }
  _queryCache.set(text, vec);
}

export async function computeQueryEmbedding(text: string): Promise<number[]> {
  const cached = getCachedQueryEmbedding(text);
  if (cached) return cached;

  if (await isPythonEmbeddingAvailable()) {
    try {
      const vec = await computeQueryViaLocalPython(text);
      setCachedQueryEmbedding(text, vec);
      return vec;
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ai-backends',
        level: 'warn',
        message: 'Local Python embedding failed; falling back to API',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      _pythonAvailable = false;
    }
  }

  const apiKey = await getApiKey('gemini');
  if (!apiKey) {
    throw new ActionableError({
      goal: 'Compute query embedding',
      problem: 'No Gemini API key and local Python embedding unavailable',
      location: 'aiBackends.computeQueryEmbedding',
      nextSteps: [
        'Set your Gemini API key in Settings',
        'Or install Python with sentence-transformers: pip install sentence-transformers',
      ],
    });
  }
  const vectors = await callGeminiBatchApi([text], 'RETRIEVAL_QUERY', apiKey);
  setCachedQueryEmbedding(text, vectors[0]);
  return vectors[0];
}

export async function updateNodeEmbeddings(nodes: { id: string; text: string; pov: string; exclusionText?: string }[]): Promise<void> {
  if (nodes.length === 0) return;
  const filePath = getEmbeddingsPath();
  const items = nodes.map(n => ({ id: n.id, text: n.text }));

  const vectors = await new Promise<Record<string, number[]>>((resolve, reject) => {
    const child = execFile(PYTHON, [EMBED_SCRIPT, 'batch-encode'], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`batch-encode failed: ${err.message}\n${stderr}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { /* telemetry — silent by design */ reject(new Error(`Parse failed: ${e}`)); }
    });
    child.stdin!.write(JSON.stringify(items));
    child.stdin!.end();
  });

  const exclItems = nodes.filter(n => n.exclusionText).map(n => ({ id: n.id, text: n.exclusionText! }));
  let exclVectors: Record<string, number[]> = {};
  if (exclItems.length > 0) {
    exclVectors = await new Promise<Record<string, number[]>>((resolve, reject) => {
      const child = execFile(PYTHON, [EMBED_SCRIPT, 'batch-encode'], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) { reject(new Error(`batch-encode (exclusion) failed: ${err.message}\n${stderr}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch (e) { /* telemetry — silent by design */ reject(new Error(`Parse exclusion failed: ${e}`)); }
      });
      child.stdin!.write(JSON.stringify(exclItems));
      child.stdin!.end();
    });
  }

  let data: EmbeddingsFile;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { /* telemetry — silent by design */ data = { model: 'all-MiniLM-L6-v2', dimension: 384, node_count: 0, nodes: {} }; }

  for (const node of nodes) {
    if (vectors[node.id]) {
      data.nodes[node.id] = {
        pov: node.pov,
        vector: vectors[node.id],
        exclusion_vector: exclVectors[node.id] ?? null,
      };
    }
  }
  data.node_count = Object.keys(data.nodes).length;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  embeddingsCache = null;
}

// ── NLI classification ──

export async function classifyNli(pairs: { text_a: string; text_b: string }[]): Promise<unknown[]> {
  if (pairs.length === 0) return [];
  return new Promise((resolve, reject) => {
    const child = execFile(PYTHON, [EMBED_SCRIPT, 'nli-classify'], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`NLI failed: ${err.message}\n${stderr}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { /* telemetry — silent by design */ reject(new Error(`Parse failed: ${e}`)); }
    });
    child.stdin!.write(JSON.stringify(pairs));
    child.stdin!.end();
  });
}

// ── Model discovery (refresh) ──

export async function refreshAIModels(): Promise<unknown> {
  const result: Record<string, { ok: boolean; count: number; error?: string }> = {};
  for (const backend of ['gemini', 'claude', 'groq'] as AIBackend[]) {
    const key = await getApiKey(backend);
    if (!key) { result[backend] = { ok: false, count: 0, error: 'No API key' }; continue; }
    try {
      if (backend === 'gemini') {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (!resp.ok) {
          throw new ActionableError({
            goal: 'Refresh AI model list',
            problem: `Gemini model discovery failed with HTTP ${resp.status}`,
            location: 'aiBackends.refreshAIModels',
            nextSteps: ['Check your Gemini API key', 'Try again later'],
          });
        }
        const json = await resp.json() as { models: unknown[] };
        result[backend] = { ok: true, count: json.models?.length || 0 };
      } else {
        result[backend] = { ok: true, count: 0, error: 'Discovery not implemented for this backend in container mode' };
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ai-backends',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      result[backend] = { ok: false, count: 0, error: String(err) };
    }
  }
  return result;
}
