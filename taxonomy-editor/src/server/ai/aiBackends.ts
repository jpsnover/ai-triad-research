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
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

const require = createRequire(import.meta.url);
import { getApiKey, getApiKeys, getProjectRoot, EMBED_SCRIPT, resolveDataPath, type AIBackend } from '../config.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { parseJsonRobust } from '../../../../lib/debate/helpers.js';
import { extractProviderReason, deriveKeyErrorMessage } from './providerErrors.js';
import { readFileWithMtime } from './fsCache.js';
import { tavilySearch, buildSearchAugmentedPrompt } from '../../../../lib/search/tavily.js';
import { resolveEmbeddings, type EmbeddingFallback } from '../../../../lib/embeddings/embeddingResolver.js';
import type { EmbeddingsFile } from '../../../../lib/electron-shared/embeddingIO.js';
// t/1641/t/1643: in-process ONNX all-MiniLM-L6-v2 384-dim encoder (shared lib, t/1651).
// Aliased on import — this file also exports `computeEmbeddings`. Provides the hosted
// fallback when the Python ML venv is absent (DevOps venv slim, t/1642).
import {
  computeEmbedding as onnxComputeEmbedding,
  computeEmbeddings as onnxComputeEmbeddings,
  tryWarmup as onnxTryWarmup,
} from '../../../../lib/embeddings/onnxEmbedding.js';
import {
  resolveBackend,
  callProvider,
  withRetry,
  buildModelIdMap,
  getApiModelId as getApiModelIdFromMap,
  getDefaultTimeout,
  withTimeout,
  SERVER_RETRY_CONFIG,
  geminiGroundedSearch,
  DEFAULT_MODEL,
  getUsage,
  renderTemplate,
  type UsageConfig,
  type GenerateOptions,
  type ProviderResult,
  type RateLimitType,
  type GroundingCitation as SharedGroundingCitation,
} from '../../../../lib/ai-client/index.js';

import { log } from '../logger.js';

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

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

export function getDebateTemperature(): number | null {
  return _debateTemperature;
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
    const { content: raw, mtimeMs } = readFileWithMtime(configPath);
    if (!_modelMapCache || mtimeMs !== _modelConfigMtime) {
      const registry = JSON.parse(raw) as { models: { id: string; apiModelId?: string }[]; fallbackChains?: Record<string, string[]>; defaults?: Record<string, string> };
      _modelMapCache = buildModelIdMap(registry as { models: { id: string; apiModelId: string; label: string; backend: string }[]; backends: [] });
      _fallbackChainCache = registry.fallbackChains ?? {};
      _defaultsCache = registry.defaults ?? {};
      _modelConfigMtime = mtimeMs;
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

/** Parse a withRetry progress message and forward it to onRetry + the recorder. */
function reportProviderRetry(
  msg: string,
  backend: string,
  apiModel: string,
  onRetry?: (p: GenerateTextProgress) => void,
): void {
  const attemptMatch = msg.match(/attempt (\d+)\/(\d+)/);
  const backoffMatch = msg.match(/waiting (\d+)s/);
  const reasonMatch = msg.match(/failed \((.+?)\), waiting/);
  const attempt = attemptMatch ? parseInt(attemptMatch[1], 10) : 1;
  const maxRetries = attemptMatch ? parseInt(attemptMatch[2], 10) : SERVER_RETRY_CONFIG.maxRetries;
  const backoffSeconds = backoffMatch ? parseInt(backoffMatch[1], 10) : 5;
  const reason = reasonMatch?.[1] ?? msg;
  onRetry?.({ attempt, maxRetries, backoffSeconds, limitType: 'unknown', limitMessage: msg });
  getGlobalRecorder()?.record({
    type: 'ai.retry', component: 'ai-adapter', level: 'warn',
    message: `Retry ${attempt}/${maxRetries}: ${reason}`,
    data: { attempt, maxRetries, backoffSeconds, reason, backend, model: apiModel },
  });
}

/** Heuristic 429/rate-limit detection from a provider error (t/835). */
export function is429Error(err: unknown): boolean {
  // t/997: Gemini returns RESOURCE_EXHAUSTED for BOTH RPM/TPM rate limits AND a
  // too-long context window. Only the rate-limit variant is a 429 — context
  // overflow is a 400-class error, so it must not trigger 429 handling, paid
  // fallback, or retries.
  if (isContextTooLongError(err)) return false;
  const s = String((err as Error)?.message ?? err);
  return /\b429\b/.test(s) || /rate.?limit/i.test(s) || /RESOURCE_EXHAUSTED/i.test(s)
    || /\bquota\b/i.test(s) || /too many requests/i.test(s);
}

/**
 * t/997: detect a context-window-exceeded error (input too long for the model).
 * Gemini surfaces these as RESOURCE_EXHAUSTED too, so without this they'd be
 * misread as a rate limit. Matches context-overflow phrasings while deliberately
 * NOT matching RPM/TPM quota messages ("per minute", "requests", "rate limit").
 */
export function isContextTooLongError(err: unknown): boolean {
  const s = String((err as Error)?.message ?? err).toLowerCase();
  return /context[ _-]?(length|window)/.test(s)
    || /(input|prompt) (is )?too long/.test(s)
    || /(input )?token count[^.]{0,40}exceed/.test(s)
    || /exceeds the maximum (number of )?(input |context )?tokens/.test(s)
    || /request (payload|entity)[^.]{0,40}(too large|exceeds|limit)/.test(s);
}

/** Best-effort retry-after (ms) parsed from a provider error; defaults to 30s. */
export function retryAfterMs(err: unknown): number {
  const s = String((err as Error)?.message ?? err);
  const m = s.match(/retry[- ]?after[^0-9]*(\d+)\s*(ms|s|sec|seconds)?/i) || s.match(/\b(\d+)\s*(s|sec|seconds)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return (m[2] ?? 's').toLowerCase().startsWith('ms') ? n : n * 1000;
  }
  return 30_000;
}

// Normalize the caller-supplied key(s) to a filtered array, or undefined when the
// caller passed nothing (→ fall back to the stored keys for each backend).
function normalizeExplicitKeys(explicitApiKey: string | string[] | undefined): string[] | undefined {
  if (explicitApiKey === undefined) return undefined;
  return Array.isArray(explicitApiKey) ? explicitApiKey.filter(Boolean) : [explicitApiKey];
}

// Per-attempt generation options: explicit temperature > debate override > 0.7;
// explicit timeout > backend default.
function buildGenerateOptions(
  options: { temperature?: number } | undefined,
  timeoutMs: number | undefined,
  currentModel: string,
): GenerateOptions {
  return {
    temperature: options?.temperature ?? _debateTemperature ?? 0.7,
    timeoutMs: timeoutMs ?? getDefaultTimeout(currentModel),
  };
}

// No key for any model in the chain — throw a backend-named ActionableError.
function throwNoApiKeyError(backend: string, modelsToTry: string[]): never {
  const names: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI', tavily: 'Tavily', deepseek: 'DeepSeek', moonshot: 'Moonshot (Kimi)' };
  const backendName = names[backend] ?? backend;
  throw new ActionableError({
    goal: `Generate text via ${backendName}`,
    problem: `No API key configured for any model in the fallback chain: ${modelsToTry.join(' → ')}`,
    location: 'aiBackends.generateText',
    nextSteps: [`Set your ${backendName} API key in Settings`, 'Or switch to a backend that has a key configured'],
  });
}

export async function generateText(
  prompt: string,
  model?: string,
  onRetry?: (p: GenerateTextProgress) => void,
  timeoutMs?: number,
  explicitApiKey?: string | string[],
  options?: { temperature?: number },
): Promise<GenerateResult> {
  const resolved = model || DEFAULT_MODEL;
  const explicitKeys = normalizeExplicitKeys(explicitApiKey);
  const modelsToTry = buildModelsToTry(resolved, explicitKeys !== undefined);

  let lastError: unknown;
  for (let mi = 0; mi < modelsToTry.length; mi++) {
    const currentModel = modelsToTry[mi];
    const backend = resolveBackend(currentModel);
    const keys = explicitKeys ?? await getApiKeys(backend);
    if (keys.length === 0) {
      if (mi < modelsToTry.length - 1) {
        getGlobalRecorder()?.record({
          type: 'ai.fallback', component: 'ai-adapter', level: 'info',
          message: `Skipping ${currentModel}: no ${backend} API key — trying next fallback`,
          data: { model: currentModel, backend, fallbackIndex: mi, chain: modelsToTry },
        });
        continue;
      }
      throwNoApiKeyError(backend, modelsToTry);
    }

    const apiModel = getApiModelId(currentModel);
    const opts = buildGenerateOptions(options, timeoutMs, currentModel);

    const runWithRetry = (apiKey: string) => withRetry(
      () => callProvider(fetch, backend, prompt, apiModel, apiKey, opts),
      SERVER_RETRY_CONFIG,
      `${backend}/${apiModel}`,
      (msg: string) => reportProviderRetry(msg, backend, apiModel, onRetry),
    );

    try {
      const result = await runWithRetry(keys[0]);

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
export type { GroundingSegment } from '../../../../lib/ai-client/providers/gemini-search.js';

export async function generateTextWithSearch(
  prompt: string, model?: string, explicitApiKey?: string | string[],
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
      const { text } = await generateText(augmentedPrompt, resolved, undefined, undefined, explicitApiKey);
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
    const result = await generateText(prompt, resolved, undefined, undefined, explicitApiKey);
    return { text: result.text };
  }

  const apiKey = (typeof explicitApiKey === 'string' ? explicitApiKey : explicitApiKey?.[0])
    ?? await getApiKey('gemini');
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

// ── UsageID wrappers (t/1262) ──

/**
 * Resolve AI call parameters from the UsageID registry, then delegate to
 * generateText(). Tier-based model overrides and key rotation are preserved —
 * the registry provides defaults; the caller passes overrides for tier pinning.
 */
export async function generateTextByUsage(
  usageId: string,
  values: Record<string, string>,
  overrides?: Partial<UsageConfig>,
  onRetry?: (p: GenerateTextProgress) => void,
  explicitApiKey?: string | string[],
): Promise<GenerateResult> {
  const repoRoot = getProjectRoot();
  const config = getUsage(usageId, repoRoot);
  const merged = overrides ? { ...config, ...overrides } : config;

  const prompt = merged.messageTemplate
    ? renderTemplate(merged.messageTemplate, values)
    : merged.message ?? values.prompt ?? '';

  getGlobalRecorder()?.record({
    type: 'ai.call_by_usage', component: 'ai-backends', level: 'info',
    message: `generateTextByUsage: ${usageId}`,
    data: { usageId, model: merged.model, hasOverrides: !!overrides, valueKeys: Object.keys(values) },
  });

  return generateText(prompt, merged.model, onRetry, merged.timeoutMs, explicitApiKey, { temperature: merged.temperature });
}

/**
 * UsageID wrapper for search — resolves config from the registry, then
 * delegates to generateTextWithSearch(). The execution path (Gemini grounding
 * or Tavily augmentation) is unchanged; the registry provides observability
 * and centralized parameter defaults.
 */
export async function generateTextWithSearchByUsage(
  usageId: string,
  values: Record<string, string>,
  overrides?: Partial<UsageConfig>,
  explicitApiKey?: string | string[],
): Promise<{ text: string; searchQueries?: string[]; citations?: SharedGroundingCitation[] }> {
  const repoRoot = getProjectRoot();
  const config = getUsage(usageId, repoRoot);
  const merged = overrides ? { ...config, ...overrides } : config;

  const prompt = merged.messageTemplate
    ? renderTemplate(merged.messageTemplate, values)
    : merged.message ?? values.prompt ?? '';

  getGlobalRecorder()?.record({
    type: 'ai.call_by_usage', component: 'ai-backends', level: 'info',
    message: `generateTextWithSearchByUsage: ${usageId}`,
    data: { usageId, model: merged.model, hasOverrides: !!overrides, valueKeys: Object.keys(values) },
  });

  return generateTextWithSearch(prompt, merged.model, explicitApiKey);
}

// ── Embeddings ──

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
  } catch (err) {
    // ENOENT is expected (no precomputed cache) → fall through to fresh
    // embedding. Anything else (corrupt JSON, permissions) silently re-embeds
    // against the API quota, so surface it at warn.
    const code = (err as NodeJS.ErrnoException).code;
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'ai-backends',
      level: code === 'ENOENT' ? 'info' : 'warn',
      message: code === 'ENOENT'
        ? 'No embeddings cache file — computing fresh'
        : 'Embeddings cache unreadable — falling back to full re-embed (API quota)',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return null;
  }
}

const EMBEDDINGS_REQUEST_TIMEOUT_MS = 45_000;

// t/1641/t/1643: `_explicitApiKey` is retained for call-site arity (server.ts passes
// the free-tier key) but is no longer consumed — embeddings are computed by the local
// Python encoder or the in-process ONNX fallback, both 384-dim/all-MiniLM-L6-v2, no API.
export async function computeEmbeddings(texts: string[], ids?: string[], _explicitApiKey?: string): Promise<number[][]> {
  const startMs = Date.now();
  const local = loadEmbeddingsFile();
  const chain: EmbeddingFallback[] = [];

  // Local Python encoder stays primary when present (TL ruling t/1641#10).
  if (await isPythonEmbeddingAvailable()) {
    chain.push({
      name: 'python-batch',
      compute: (t, missingIds) => {
        const finalIds = missingIds
          ? missingIds.map((id, j) => id ?? `_idx_${j}`)
          : t.map((_, j) => `_idx_${j}`);
        return computeBatchViaLocalPython(t, finalIds);
      },
    });
  }

  // t/1641/t/1643: in-process ONNX all-MiniLM-L6-v2 (shared lib t/1651) — hosted
  // fallback when the Python ML venv is absent (DevOps venv slim, t/1642). Same
  // 384-dim vector space as the stored corpus; no API key, no network.
  if (await onnxTryWarmup()) {
    chain.push({
      name: 'onnx-batch',
      compute: (t) => onnxComputeEmbeddings(t),
    });
  }

  try {
    const result = await withTimeout(
      resolveEmbeddings(texts, ids, local, chain),
      EMBEDDINGS_REQUEST_TIMEOUT_MS,
      'embeddings-compute',
    );
    const elapsedMs = Date.now() - startMs;
    getGlobalRecorder()?.record({
      type: 'ai.response', component: 'ai-backends', level: 'info',
      message: `computeEmbeddings completed: ${texts.length} inputs in ${elapsedMs}ms`,
      data: { inputCount: texts.length, dimensions: result[0]?.length ?? 0, elapsedMs, chainMembers: chain.map(c => c.name) },
    });
    return result;
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'ai-backends', level: 'error',
      message: `Embedding computation failed after ${elapsedMs}ms (${texts.length} inputs)`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      data: { inputCount: texts.length, elapsedMs, chainMembers: chain.map(c => c.name) },
    });
    throw new ActionableError({
      goal: 'Compute embeddings',
      problem: `No local embedding encoder available after ${elapsedMs}ms — the Python sentence-transformers venv is absent and the in-process ONNX all-MiniLM-L6-v2 fallback failed to initialize`,
      location: 'aiBackends.computeEmbeddings',
      nextSteps: [
        'Verify the baked ONNX model directory is present (AI_TRIAD_ONNX_MODEL_DIR points to model.onnx + tokenizer.json + tokenizer_config.json)',
        'Or install Python with sentence-transformers: pip install sentence-transformers',
      ],
    });
  }
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
      } catch (e) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'ai-backends', level: 'warn',
          message: 'Failed to parse Python embedding output',
          error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack },
        });
        reject(new Error(`Parse failed: ${e}`));
      }
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

// t/1641/t/1643: `_explicitApiKey` is retained for call-site arity (server.ts passes
// the free-tier key) but is no longer consumed — the query embedding is computed by
// the local Python encoder or the in-process ONNX fallback, both 384-dim/all-MiniLM-L6-v2.
// This closes t/1643: the old Gemini fallback returned a 3072-dim RETRIEVAL_QUERY vector
// in a different vector space than the stored 384-dim MiniLM corpus, silently breaking
// cosine similarity whenever Python was absent.
export async function computeQueryEmbedding(text: string, _explicitApiKey?: string): Promise<number[]> {
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
        message: 'Local Python embedding failed; falling back to in-process ONNX',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      _pythonAvailable = false;
    }
  }

  // In-process ONNX all-MiniLM-L6-v2 (shared lib t/1651) — hosted fallback when the
  // Python ML venv is absent (DevOps venv slim, t/1642). Same 384-dim space as the
  // stored corpus; no API key, no network.
  if (await onnxTryWarmup()) {
    try {
      const vec = await onnxComputeEmbedding(text);
      setCachedQueryEmbedding(text, vec);
      return vec;
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ai-backends',
        level: 'error',
        message: 'In-process ONNX query embedding failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      // fall through to the ActionableError below
    }
  }

  throw new ActionableError({
    goal: 'Compute query embedding',
    problem: 'No local embedding encoder available — the Python sentence-transformers venv is absent and the in-process ONNX all-MiniLM-L6-v2 fallback failed to initialize',
    location: 'aiBackends.computeQueryEmbedding',
    nextSteps: [
      'Verify the baked ONNX model directory is present (AI_TRIAD_ONNX_MODEL_DIR points to model.onnx + tokenizer.json + tokenizer_config.json)',
      'Or install Python with sentence-transformers: pip install sentence-transformers',
    ],
  });
}

export async function updateNodeEmbeddings(nodes: { id: string; text: string; pov: string; exclusionText?: string }[]): Promise<void> {
  if (nodes.length === 0) return;
  const filePath = getEmbeddingsPath();

  // t/1641: encode a batch of {id,text} to an id→vector map. Local Python
  // sentence-transformers is primary when present; the in-process ONNX
  // all-MiniLM-L6-v2 fallback (shared lib t/1651) covers the hosted case where
  // the Python ML venv has been slimmed away (DevOps venv slim, t/1642). Same
  // 384-dim/all-MiniLM-L6-v2 space either way; no API key, no network.
  const encodeBatch = async (batch: { id: string; text: string }[]): Promise<Record<string, number[]>> => {
    const ids = batch.map(b => b.id);
    const texts = batch.map(b => b.text);
    let vecs: number[][] | null = null;

    if (await isPythonEmbeddingAvailable()) {
      try {
        vecs = await computeBatchViaLocalPython(texts, ids);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'ai-backends', level: 'warn',
          message: 'Local Python batch embedding failed; falling back to in-process ONNX',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        _pythonAvailable = false;
      }
    }

    if (!vecs) {
      if (!(await onnxTryWarmup())) {
        throw new ActionableError({
          goal: 'Update node embeddings',
          problem: 'No local embedding encoder available — the Python sentence-transformers venv is absent and the in-process ONNX all-MiniLM-L6-v2 fallback failed to initialize',
          location: 'aiBackends.updateNodeEmbeddings',
          nextSteps: [
            'Verify the baked ONNX model directory is present (AI_TRIAD_ONNX_MODEL_DIR points to model.onnx + tokenizer.json + tokenizer_config.json)',
            'Or install Python with sentence-transformers: pip install sentence-transformers',
          ],
        });
      }
      try {
        vecs = await onnxComputeEmbeddings(texts);
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'ai-backends', level: 'error',
          message: 'In-process ONNX batch embedding failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        throw new ActionableError({
          goal: 'Update node embeddings',
          problem: 'The in-process ONNX all-MiniLM-L6-v2 encoder failed while embedding a node batch',
          location: 'aiBackends.updateNodeEmbeddings',
          nextSteps: [
            'Verify the baked ONNX model directory is intact (AI_TRIAD_ONNX_MODEL_DIR points to model.onnx + tokenizer.json + tokenizer_config.json)',
            'Or install Python with sentence-transformers: pip install sentence-transformers',
          ],
        });
      }
    }

    const map: Record<string, number[]> = {};
    ids.forEach((id, i) => { map[id] = vecs![i]; });
    return map;
  };

  const vectors = await encodeBatch(nodes.map(n => ({ id: n.id, text: n.text })));
  const exclNodes = nodes.filter(n => n.exclusionText);
  const exclVectors: Record<string, number[]> = exclNodes.length > 0
    ? await encodeBatch(exclNodes.map(n => ({ id: n.id, text: n.exclusionText! })))
    : {};

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

const NLI_TIMEOUT_MS = 30_000;
const NLI_LABELS = ['entailment', 'neutral', 'contradiction'] as const;
type NliLabel = (typeof NLI_LABELS)[number];

/** The four fields the Python `nli-classify` path merges into each input item (see scripts/embed_taxonomy.py cmd_nli_classify). */
interface NliFields {
  nli_label: NliLabel;
  nli_entailment: number;
  nli_neutral: number;
  nli_contradiction: number;
}

/**
 * Primary path: classify pairs via the local Python sentence-transformers
 * cross-encoder. Resolves with the merged items (input fields + 4 NLI fields)
 * or rejects on subprocess/parse failure so the caller can fall back.
 */
function classifyNliViaPython(pairs: { text_a: string; text_b: string }[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(PYTHON, [EMBED_SCRIPT, 'nli-classify'], { timeout: NLI_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const isTimeout = !!(err as { killed?: boolean }).killed || /ETIMEDOUT|timed?\s*out/i.test(err.message);
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'ai-backends', level: 'warn',
          message: `NLI classify (local Python) failed: ${isTimeout ? 'timeout' : 'subprocess error'} — trying API fallback`,
          error: { name: err.name ?? 'Error', message: err.message, stack: err.stack },
          data: { pairCount: pairs.length, isTimeout, stderr: stderr?.slice(0, 500), backend: 'local-python' },
        });
        reject(err);
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch (e) {
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'ai-backends', level: 'warn',
          message: 'Failed to parse NLI classify output (local Python) — trying API fallback',
          error: { name: (e as Error).name ?? 'Error', message: String(e), stack: (e as Error).stack },
          data: { pairCount: pairs.length, stdoutLength: stdout?.length },
        });
        reject(e);
      }
    });
    child.stdin!.write(JSON.stringify(pairs));
    child.stdin!.end();
  });
}

/** Clamp/normalize an LLM-returned score into [0,1]; non-finite → 0. */
function normNliScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Coerce one parsed LLM result object into the 4 canonical NLI fields.
 * Tolerates a missing/garbled label by deriving it from the argmax score.
 */
function coerceNliFields(raw: Record<string, unknown>): NliFields {
  const nli_entailment = normNliScore(raw.nli_entailment ?? raw.entailment);
  const nli_neutral = normNliScore(raw.nli_neutral ?? raw.neutral);
  const nli_contradiction = normNliScore(raw.nli_contradiction ?? raw.contradiction);
  const rawLabel = String(raw.nli_label ?? raw.label ?? '').toLowerCase().trim();
  let nli_label: NliLabel;
  if ((NLI_LABELS as readonly string[]).includes(rawLabel)) {
    nli_label = rawLabel as NliLabel;
  } else {
    const scores: [NliLabel, number][] = [
      ['entailment', nli_entailment], ['neutral', nli_neutral], ['contradiction', nli_contradiction],
    ];
    nli_label = scores.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }
  return { nli_label, nli_entailment, nli_neutral, nli_contradiction };
}

/**
 * Fallback path: classify pairs via a hosted LLM (UsageID
 * `server.nli-classify-fallback`). Used when the local Python encoder is
 * unavailable (e.g. the ML venv has been removed from the image — t/1641).
 * BYOK: the caller supplies the API key per-request (ADR-002); no keys baked.
 * Returns each input item passed through plus the 4 NLI fields, matching the
 * Python contract so downstream consumers are unaffected.
 */
async function classifyNliViaApi(
  pairs: { text_a: string; text_b: string }[],
  apiKey?: string | string[],
): Promise<unknown[]> {
  const items = pairs.map((p, index) => ({ index, text_a: p.text_a, text_b: p.text_b }));
  const result = await generateTextByUsage(
    'server.nli-classify-fallback',
    { pairs: JSON.stringify(items) },
    undefined,
    undefined,
    apiKey,
  );

  const parsed = parseJsonRobust(result.text);
  const rows: Record<string, unknown>[] = Array.isArray(parsed)
    ? (parsed as Record<string, unknown>[])
    : Array.isArray((parsed as { results?: unknown })?.results)
      ? ((parsed as { results: Record<string, unknown>[] }).results)
      : [];

  if (rows.length === 0) {
    throw new ActionableError({
      goal: 'Classify NLI pairs via hosted LLM fallback',
      problem: `LLM NLI fallback returned no parseable results (${result.text?.length ?? 0} chars)`,
      location: 'aiBackends.classifyNliViaApi',
      nextSteps: [
        'Verify the server.nli-classify-fallback UsageID prompt requests a JSON array',
        'Check the AI backend is reachable and the supplied key is valid',
      ],
    });
  }

  // Map results back to pairs by declared index; fall back to positional order.
  const byIndex = new Map<number, Record<string, unknown>>();
  rows.forEach((row, i) => {
    const idx = typeof row.index === 'number' ? row.index : i;
    if (!byIndex.has(idx)) byIndex.set(idx, row);
  });

  return pairs.map((p, i) => ({
    ...p,
    ...coerceNliFields(byIndex.get(i) ?? rows[i] ?? {}),
  }));
}

/**
 * Classify NLI (entailment/neutral/contradiction) for each text pair.
 *
 * Primary path is the local Python cross-encoder; when it is unavailable or
 * fails (subprocess error, timeout, or unparseable output) the request falls
 * back to a hosted LLM via UsageID `server.nli-classify-fallback`. The fallback
 * needs a caller-supplied API key (BYOK, ADR-002) — omit it and only the local
 * path is attempted. Output items preserve input fields and add the 4 NLI
 * fields regardless of which path served the request.
 */
export async function classifyNli(
  pairs: { text_a: string; text_b: string }[],
  apiKey?: string | string[],
): Promise<unknown[]> {
  if (pairs.length === 0) return [];

  try {
    return await classifyNliViaPython(pairs);
  } catch (pyErr) {
    try {
      const results = await classifyNliViaApi(pairs, apiKey);
      getGlobalRecorder()?.record({
        type: 'ai.fallback', component: 'ai-backends', level: 'info',
        message: 'NLI classify served by hosted LLM fallback (local Python unavailable)',
        data: { pairCount: pairs.length, backend: 'llm-fallback' },
      });
      return results;
    } catch (apiErr) {
      const isTimeout = !!(pyErr as { killed?: boolean }).killed || /ETIMEDOUT|timed?\s*out/i.test((pyErr as Error).message ?? '');
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'ai-backends', level: 'error',
        message: 'NLI classify failed on both local Python and API fallback',
        error: { name: (apiErr as Error).name ?? 'Error', message: String(apiErr), stack: (apiErr as Error).stack },
        data: {
          pairCount: pairs.length,
          pythonError: String((pyErr as Error).message ?? pyErr).slice(0, 300),
          apiError: String((apiErr as Error).message ?? apiErr).slice(0, 300),
        },
      });
      if (apiErr instanceof ActionableError) throw apiErr;
      throw new ActionableError({
        goal: 'Classify NLI pairs',
        problem: isTimeout
          ? `Local Python NLI subprocess timed out after ${NLI_TIMEOUT_MS / 1000}s and the API fallback also failed (${pairs.length} pairs)`
          : `Local Python NLI encoder failed and the API fallback also failed: ${String((apiErr as Error).message ?? apiErr)}`,
        location: 'aiBackends.classifyNli',
        nextSteps: [
          'Verify the AI backend is reachable and a valid API key was supplied for the fallback',
          'If the local encoder should be available, verify Python sentence-transformers is installed',
          'Reduce the number of pairs per request',
        ],
      });
    }
  }
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
          // t/1624: a non-200 is a result, not a swallowed failure. Parse the
          // provider error body for the specific reason (SERVICE_DISABLED,
          // restricted, quota, invalid…) instead of collapsing every case into a
          // bare `HTTP ${status}`, and record it structured. NO key material in
          // the message/log/FR — the key rides in the fetch URL, never the payload.
          let reason: string | undefined;
          try {
            reason = extractProviderReason(await resp.json());
          } catch {
            /* body absent or non-JSON — silent by design: the non-200 is still
               recorded below with reason:null, so no diagnostic is lost. */
          }
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'ai-backends',
            level: 'warn',
            message: 'Gemini model discovery rejected the request',
            data: { backend: 'gemini', httpStatus: resp.status, reason: reason ?? null },
          });
          result[backend] = { ok: false, count: 0, error: deriveKeyErrorMessage(resp.status, reason) };
          continue;
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
