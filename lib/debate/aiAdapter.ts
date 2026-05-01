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
import { tavilySearch, buildSearchAugmentedPrompt } from '../search/tavily';
import { ActionableError } from './errors';
import type { GenerateRequest, GenerateResponse } from './cacheTypes';
import { buildCacheUsage, emptyCacheUsage, flattenEnvelope } from './cacheTypes';

// ── Shared ai-client imports ────────────────────────────
import {
  callProvider,
  withRetry,
  withTimeout,
  CLI_RETRY_CONFIG,
  resolveModel,
  GEMINI_BASE,
} from '../ai-client';
import type {
  ProviderResult,
  GenerateOptions as SharedGenerateOptions,
  ModelRegistry,
} from '../ai-client';

// ── Interface ────────────────────────────────────────────

export interface GenerateOptions extends SharedGenerateOptions {
  signal?: AbortSignal;
}

export interface AIAdapter {
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
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

async function generateEnvelopeViaGemini(
  req: GenerateRequest, apiKey: string,
): Promise<ProviderResult> {
  const env = req.envelope;
  const url = `${GEMINI_BASE}/${req.model}:generateContent?key=${apiKey}`;
  const timeoutMs = req.options.timeoutMs ?? 120_000;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: envelopeSystemText(env) }] },
    contents: [{ parts: [{ text: env.layer4_variable }] }],
    generationConfig: {
      temperature: req.options.temperature ?? 0.7,
      maxOutputTokens: req.options.maxTokens ?? 16384,
    },
  };

  const response = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    timeoutMs,
    'Gemini envelope request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Gemini envelope response');
  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate envelope response via Gemini',
      problem: `Gemini ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'aiAdapter.generateEnvelopeViaGemini',
      nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate envelope response via Gemini',
      problem: `Gemini API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'aiAdapter.generateEnvelopeViaGemini',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  let json: {
    candidates?: { content: { parts: { text: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; totalTokenCount?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse Gemini envelope response',
      problem: `Gemini envelope returned invalid JSON (${bodyText.length} bytes). First 200: ${bodyText.slice(0, 200)}`,
      location: 'aiAdapter.generateEnvelopeViaGemini',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.candidates?.length) {
    throw new ActionableError({
      goal: 'Generate envelope response via Gemini',
      problem: `No candidates in Gemini envelope response: ${bodyText.slice(0, 300)}`,
      location: 'aiAdapter.generateEnvelopeViaGemini',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }
  const text = json.candidates[0].content.parts.map(p => p.text).join('');
  const um = json.usageMetadata;
  return {
    text,
    usage: um ? {
      promptTokens: um.promptTokenCount,
      completionTokens: um.candidatesTokenCount,
      cachedTokens: um.cachedContentTokenCount,
      totalTokens: um.totalTokenCount,
    } : undefined,
  };
}

async function generateEnvelopeViaClaude(
  req: GenerateRequest, apiKey: string,
): Promise<ProviderResult> {
  const env = req.envelope;
  const timeoutMs = req.options.timeoutMs ?? 180_000;

  const systemBlocks: { type: string; text: string; cache_control?: { type: string } }[] = [];
  const sysText = envelopeSystemText(env);
  if (sysText.length > 0) {
    systemBlocks.push({ type: 'text', text: sysText, cache_control: { type: 'ephemeral' } });
  }

  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        system: systemBlocks,
        messages: [{ role: 'user', content: env.layer4_variable }],
        max_tokens: req.options.maxTokens ?? 8192,
        temperature: req.options.temperature ?? 0.7,
      }),
    }),
    timeoutMs,
    'Claude envelope request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Claude envelope response');
  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate envelope response via Claude',
      problem: `Claude ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'aiAdapter.generateEnvelopeViaClaude',
      nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate envelope response via Claude',
      problem: `Claude API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'aiAdapter.generateEnvelopeViaClaude',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  let json: {
    content?: { type: string; text: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse Claude envelope response',
      problem: `Claude envelope returned invalid JSON (${bodyText.length} bytes). First 200: ${bodyText.slice(0, 200)}`,
      location: 'aiAdapter.generateEnvelopeViaClaude',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.content?.length) {
    throw new ActionableError({
      goal: 'Generate envelope response via Claude',
      problem: `No content in Claude envelope response: ${bodyText.slice(0, 300)}`,
      location: 'aiAdapter.generateEnvelopeViaClaude',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }
  const text = json.content.filter(c => c.type === 'text').map(c => c.text).join('');
  const u = json.usage;
  return {
    text,
    usage: u ? {
      promptTokens: u.input_tokens,
      completionTokens: u.output_tokens,
      cachedTokens: (u.cache_read_input_tokens ?? 0) || undefined,
      totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) || undefined,
    } : undefined,
  };
}

async function generateEnvelopeViaChatCompletions(
  req: GenerateRequest, apiKey: string, baseUrl: string, label: string,
): Promise<ProviderResult> {
  const env = req.envelope;
  const timeoutMs = req.options.timeoutMs ?? 120_000;

  const response = await withTimeout(
    fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: 'system', content: envelopeSystemText(env) },
          { role: 'user', content: env.layer4_variable },
        ],
        temperature: req.options.temperature ?? 0.7,
        max_tokens: req.options.maxTokens ?? 8192,
      }),
    }),
    timeoutMs,
    `${label} envelope request`,
  );

  const bodyText = await withTimeout(response.text(), 60_000, `Reading ${label} envelope response`);
  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: `Generate envelope response via ${label}`,
      problem: `${label} ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'aiAdapter.generateEnvelopeViaChatCompletions',
      nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: `Generate envelope response via ${label}`,
      problem: `${label} API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'aiAdapter.generateEnvelopeViaChatCompletions',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  let json: {
    choices?: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: `Parse ${label} envelope response`,
      problem: `${label} envelope returned invalid JSON (${bodyText.length} bytes). First 200: ${bodyText.slice(0, 200)}`,
      location: 'aiAdapter.generateEnvelopeViaChatCompletions',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.choices?.length) {
    throw new ActionableError({
      goal: `Generate envelope response via ${label}`,
      problem: `No choices in ${label} envelope response: ${bodyText.slice(0, 300)}`,
      location: 'aiAdapter.generateEnvelopeViaChatCompletions',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }
  const text = json.choices[0].message.content;
  const u = json.usage;
  return {
    text,
    usage: u ? {
      promptTokens: u.prompt_tokens,
      completionTokens: u.completion_tokens,
      cachedTokens: u.prompt_tokens_details?.cached_tokens,
      totalTokens: u.total_tokens,
    } : undefined,
  };
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

  const retryLog = (msg: string) => process.stderr.write(msg + '\n');

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
      const result = await withRetry(async () => {
        switch (backend) {
          case 'claude':
            return generateEnvelopeViaClaude(resolvedReq, apiKey);
          case 'groq':
            return generateEnvelopeViaChatCompletions(resolvedReq, apiKey, 'https://api.groq.com/openai/v1/chat/completions', 'Groq');
          case 'openai':
            return generateEnvelopeViaChatCompletions(resolvedReq, apiKey, 'https://api.openai.com/v1/chat/completions', 'OpenAI');
          default:
            return generateEnvelopeViaGemini(resolvedReq, apiKey);
        }
      }, CLI_RETRY_CONFIG, `${backend}/${apiModelId}`, retryLog);

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
      const { backend } = resolveModel(registry, resolved);

      // Gemini has built-in search grounding
      if (backend === 'gemini') {
        const apiKey = resolveApiKey(backend, explicitApiKey);
        const { apiModelId } = resolveModel(registry, resolved);
        const url = `${GEMINI_BASE}/${apiModelId}:generateContent?key=${apiKey}`;

        const response = await withTimeout(
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
            }),
          }),
          60_000,
          'Gemini grounded search',
        );

        if (!response.ok) {
          const body = await response.text();
          throw new ActionableError({
            goal: 'Generate text with Gemini grounded search',
            problem: `Gemini search error ${response.status}: ${body.slice(0, 300)}`,
            location: 'aiAdapter.generateTextWithSearch',
            nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
          });
        }

        const json = await response.json() as {
          candidates?: { content: { parts: { text: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { title?: string } }[] } }[];
        };
        if (!json.candidates?.length) throw new ActionableError({
          goal: 'Generate text with Gemini grounded search',
          problem: 'No candidates from Gemini grounded search',
          location: 'aiAdapter.generateTextWithSearch',
          nextSteps: ['Retry the request', 'Try a different model'],
        });

        const text = json.candidates[0].content.parts.map(p => p.text).join('');
        const chunks = json.candidates[0].groundingMetadata?.groundingChunks ?? [];
        const searchQueries = chunks.map(c => c.web?.title).filter((t): t is string => !!t);

        return { text, searchQueries: searchQueries.length ? searchQueries : undefined };
      }

      // Non-Gemini: use Tavily if key available
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

      // No search provider available — plain generation
      const text = await doGenerateText(prompt, resolved);
      return { text };
    },
  };

  return adapter;
}
