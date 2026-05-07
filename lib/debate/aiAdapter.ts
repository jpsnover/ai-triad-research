// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Multi-backend AI client for CLI debate runner.
 * Supports Gemini, Claude, and Groq with retry logic.
 *
 * Provider implementations, retry/timeout helpers, model resolution, and
 * type definitions are imported from the shared `lib/ai-client` package.
 * This module keeps CLI-specific concerns: filesystem registry loading,
 * env-var key resolution, envelope generation, fallback chains, and
 * the `ExtendedAIAdapter` factory.
 */

import fs from 'fs';
import path from 'path';
import { tavilySearch, buildSearchAugmentedPrompt } from '../search/tavily.js';
import { ActionableError } from './errors.js';
import type { GenerateRequest, GenerateResponse } from './cacheTypes.js';
import { buildCacheUsage, emptyCacheUsage, flattenEnvelope } from './cacheTypes.js';

// ── Shared ai-client imports ────────────────────────────
import {
  callProvider,
  withRetry,
  CLI_RETRY_CONFIG,
  resolveModel,
  GEMINI_BASE,
  geminiGroundedSearch,
} from '../ai-client/index.js';
import type {
  ProviderResult,
  GenerateOptions as SharedGenerateOptions,
  ModelRegistry,
} from '../ai-client/index.js';

// ── Interface ────────────────────────────────────────────

export interface GenerateOptions extends SharedGenerateOptions {
  // Re-declare commonly used fields for resilience against resolution failures
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface AIAdapter {
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
  /** Optional callback for retry progress events. Set by the engine to surface retries in the UI. */
  onRetryProgress?: (info: { attempt: number; maxRetries: number; backoffSeconds: number; message: string }) => void;
}

/**
 * Extended adapter with optional capabilities for interventions that need
 * web search, NLI, or embeddings. CLI adapters may not implement these —
 * consumers must check availability before calling.
 */
export interface ExtendedAIAdapter extends AIAdapter {
  generate?(request: GenerateRequest): Promise<GenerateResponse>;
  generateTextWithSearch?(prompt: string, model?: string): Promise<{ text: string; searchQueries?: string[] }>;
  nliClassify?(pairs: { text_a: string; text_b: string }[]): Promise<{ results: { nli_label: string; nli_entailment: number }[] }>;
  computeQueryEmbedding?(text: string): Promise<{ vector: number[] }>;
}

// ── Model registry (filesystem loading) ─────────────────

let _registry: ModelRegistry | null = null;

function loadRegistry(repoRoot: string): ModelRegistry {
  if (_registry) return _registry;
  const configPath = path.join(repoRoot, 'ai-models.json');
  if (!fs.existsSync(configPath)) {
    throw new ActionableError({
      goal: 'Load AI model registry',
      problem: `Model registry not found at: ${configPath}`,
      location: 'aiAdapter.loadRegistry',
      nextSteps: ['Run from the ai-triad-research repo root', 'Check ai-models.json exists'],
    });
  }
  try {
    _registry = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ModelRegistry;
  } catch (err) {
    throw new ActionableError({
      goal: 'Parse AI model registry',
      problem: `Failed to parse model registry at ${configPath}: ${err instanceof Error ? err.message : err}`,
      location: 'aiAdapter.loadRegistry',
      nextSteps: ['Run from the ai-triad-research repo root', 'Check ai-models.json exists'],
      innerError: err,
    });
  }
  return _registry;
}

// ── API key resolution ───────────────────────────────────

const BACKEND_ENV_KEYS: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  tavily: 'TAVILY_API_KEY',
};

function resolveApiKey(backend: string, explicitKey?: string): string {
  if (explicitKey) return explicitKey;
  const backendKey = process.env[BACKEND_ENV_KEYS[backend] ?? ''];
  if (backendKey) return backendKey;
  const fallback = process.env.AI_API_KEY;
  if (fallback) return fallback;
  throw new ActionableError({
    goal: `Resolve API key for ${backend} backend`,
    problem: `No API key for ${backend}`,
    location: 'aiAdapter.resolveApiKey',
    nextSteps: [`Set the ${BACKEND_ENV_KEYS[backend] ?? 'AI_API_KEY'} environment variable or Register-AIBackend`],
  });
}

// ── Usage telemetry ─────────────────────────────────────

function emitUsageTelemetry(
  backend: string,
  model: string,
  latencyMs: number,
  usage?: ProviderResult['usage'],
): void {
  const entry = {
    ts: new Date().toISOString(),
    backend,
    model,
    latencyMs: Math.round(latencyMs),
    ...usage,
  };
  process.stderr.write(`[usage] ${JSON.stringify(entry)}\n`);
}

// ── Envelope-based generation (structured prompt with caching) ──

function envelopeSystemText(env: { layer1_static: string; layer2_persona: string; layer3_turn: string }): string {
  return [env.layer3_turn, env.layer1_static, env.layer2_persona]
    .filter(s => s.length > 0)
    .join('\n\n');
}

function callEnvelopeProvider(
  backend: string,
  req: GenerateRequest,
  apiKey: string,
): Promise<ProviderResult> {
  const sysText = envelopeSystemText(req.envelope);
  return callProvider(fetch, backend, req.envelope.layer4_variable, req.model, apiKey, {
    ...req.options,
    systemMessage: sysText || undefined,
  });
}

// ── Token counting ──────────────────────────────────────

export async function countTokens(
  text: string,
  apiKey?: string,
): Promise<{ tokenCount: number; accurate: boolean }> {
  const key = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.AI_API_KEY;
  if (key) {
    try {
      const url = `${GEMINI_BASE}/gemini-2.5-flash:countTokens?key=${key}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const data = await resp.json() as { totalTokens: number };
        return { tokenCount: data.totalTokens, accurate: true };
      }
    } catch { /* fall through to heuristic */ }
  }
  const charsPerToken = /^\s*[\[{]/.test(text) ? 2.5 : 3.2;
  return { tokenCount: Math.ceil(text.length / charsPerToken), accurate: false };
}

// ── Factory ──────────────────────────────────────────────

export function createCLIAdapter(repoRoot: string, explicitApiKey?: string): ExtendedAIAdapter {
  const registry = loadRegistry(repoRoot);

  const retryLog = (msg: string) => {
    process.stderr.write(msg + '\n');
    const match = msg.match(/attempt (\d+)\/(\d+) failed .+waiting (\d+)s/);
    if (match) {
      adapter.onRetryProgress?.({
        attempt: parseInt(match[1], 10),
        maxRetries: parseInt(match[2], 10),
        backoffSeconds: parseInt(match[3], 10),
        message: msg,
      });
    }
  };

  async function doGenerateText(prompt: string, model: string, options?: GenerateOptions): Promise<string> {
    const { apiModelId, backend } = resolveModel(registry, model);
    const apiKey = resolveApiKey(backend, explicitApiKey);
    const opts = options ?? {};

    const t0 = performance.now();
    try {
      const result = await withRetry(
        () => callProvider(fetch, backend, prompt, apiModelId, apiKey, opts),
        CLI_RETRY_CONFIG, `${backend}/${apiModelId}`, retryLog,
      );
      emitUsageTelemetry(backend, apiModelId, performance.now() - t0, result.usage);
      return result.text;
    } catch (primaryErr) {
      const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      const isAuthError = errMsg.includes('401') || errMsg.includes('403');
      const chain = registry.fallbackChains?.[model] ?? [];
      for (const fbModel of chain) {
        const fb = resolveModel(registry, fbModel);
        if (isAuthError && fb.backend === backend) continue;
        let fbKey: string;
        try { fbKey = resolveApiKey(fb.backend, explicitApiKey); } catch { continue; }
        process.stderr.write(`[cascade] ${backend}/${apiModelId} failed, trying ${fb.backend}/${fb.apiModelId}\n`);
        try {
          const fbResult = await withRetry(
            () => callProvider(fetch, fb.backend, prompt, fb.apiModelId, fbKey, opts),
            { ...CLI_RETRY_CONFIG, maxRetries: 2 }, `cascade:${fb.backend}/${fb.apiModelId}`, retryLog,
          );
          emitUsageTelemetry(fb.backend, fb.apiModelId, performance.now() - t0, fbResult.usage);
          return fbResult.text;
        } catch { continue; }
      }
      throw primaryErr;
    }
  }

  async function doGenerate(request: GenerateRequest): Promise<GenerateResponse> {
    const { apiModelId, backend } = resolveModel(registry, request.model);
    const apiKey = resolveApiKey(backend, explicitApiKey);
    const resolvedReq = { ...request, model: apiModelId };

    const t0 = performance.now();
    try {
      const result = await withRetry(
        () => callEnvelopeProvider(backend, resolvedReq, apiKey),
        CLI_RETRY_CONFIG, `${backend}/${apiModelId}`, retryLog,
      );

      const latency = performance.now() - t0;
      const usage = buildCacheUsage({
        inputTokens: result.usage?.promptTokens,
        outputTokens: result.usage?.completionTokens,
        cacheReadTokens: result.usage?.cachedTokens,
      });
      emitUsageTelemetry(backend, apiModelId, latency, result.usage);
      return { text: result.text, usage, model: apiModelId, backend, responseTimeMs: Math.round(latency) };
    } catch (err) {
      // Graceful degradation: fall back to flat generateText
      process.stderr.write(`[envelope-fallback] ${backend}/${apiModelId}: ${err instanceof Error ? err.message.slice(0, 100) : err}\n`);
      const flatPrompt = flattenEnvelope(request.envelope);
      const text = await doGenerateText(flatPrompt, request.model, request.options);
      const latency = performance.now() - t0;
      return { text, usage: emptyCacheUsage(), model: apiModelId, backend, responseTimeMs: Math.round(latency) };
    }
  }

  const adapter: ExtendedAIAdapter = {
    generateText: doGenerateText,
    generate: process.env.DEBATE_ENVELOPE !== '0' ? doGenerate : undefined,

    async generateTextWithSearch(prompt: string, model?: string): Promise<{ text: string; searchQueries?: string[] }> {
      const resolved = model || 'gemini-3.1-flash-lite-preview';
      const { backend, apiModelId } = resolveModel(registry, resolved);

      if (backend === 'gemini') {
        const apiKey = resolveApiKey(backend, explicitApiKey);
        const result = await geminiGroundedSearch(fetch, prompt, apiModelId, apiKey);
        return { text: result.text, searchQueries: result.searchQueries };
      }

      const tavilyKey = process.env.TAVILY_API_KEY;
      if (tavilyKey) {
        const searchQuery = prompt.length > 400 ? prompt.slice(0, 400) : prompt;
        const searchResult = await tavilySearch(searchQuery, tavilyKey, {
          maxResults: 5,
          includeAnswer: true,
          searchDepth: 'basic',
        });
        const { augmentedPrompt, searchQueries } = buildSearchAugmentedPrompt(prompt, searchResult);
        const text = await doGenerateText(augmentedPrompt, resolved);
        return { text, searchQueries: searchQueries.length ? searchQueries : undefined };
      }

      const text = await doGenerateText(prompt, resolved);
      return { text };
    },
  };

  return adapter;
}
