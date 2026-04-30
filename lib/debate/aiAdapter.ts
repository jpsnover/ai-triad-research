// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Multi-backend AI client for CLI debate runner.
 * Supports Gemini, Claude, and Groq with retry logic.
 */

import fs from 'fs';
import path from 'path';
import { tavilySearch, buildSearchAugmentedPrompt } from '../search/tavily';
import type { GenerateRequest, GenerateResponse, LLMBackend } from './cacheTypes';
import { buildCacheUsage, emptyCacheUsage, flattenEnvelope } from './cacheTypes';

// ── Interface ────────────────────────────────────────────

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
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

// ── Model registry ───────────────────────────────────────

interface ModelEntry {
  id: string;
  apiModelId: string;
  label: string;
  backend: string;
}

interface ModelRegistry {
  backends: { id: string; label: string }[];
  models: ModelEntry[];
}

let _registry: ModelRegistry | null = null;

function loadRegistry(repoRoot: string): ModelRegistry {
  if (_registry) return _registry;
  const configPath = path.join(repoRoot, 'ai-models.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Model registry not found at: ${configPath}\n` +
      `This file is required for AI model resolution.\n` +
      `Ensure you are running from the ai-triad-research repo root, or set the working directory correctly.`
    );
  }
  try {
    _registry = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ModelRegistry;
  } catch (err) {
    throw new Error(
      `Failed to parse model registry at ${configPath}: ${err instanceof Error ? err.message : err}\n` +
      `The file exists but contains invalid JSON. Check for syntax errors.`
    );
  }
  return _registry;
}

function resolveModel(registry: ModelRegistry, friendlyId: string): { apiModelId: string; backend: string } {
  const entry = registry.models.find(m => m.id === friendlyId);
  if (entry) return { apiModelId: entry.apiModelId, backend: entry.backend };
  // Infer backend from prefix
  if (friendlyId.startsWith('gemini')) return { apiModelId: friendlyId, backend: 'gemini' };
  if (friendlyId.startsWith('claude')) return { apiModelId: friendlyId, backend: 'claude' };
  if (friendlyId.startsWith('groq')) return { apiModelId: friendlyId, backend: 'groq' };
  if (friendlyId.startsWith('openai')) return { apiModelId: friendlyId, backend: 'openai' };
  return { apiModelId: friendlyId, backend: 'gemini' };
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
  throw new Error(`No API key for ${backend}. Set ${BACKEND_ENV_KEYS[backend] ?? 'AI_API_KEY'} environment variable.`);
}

// ── Retry helper ─────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  label: string = 'API call',
): Promise<T> {
  const delays = [5, 15, 45]; // seconds
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      const isRetryable =
        msg.includes('429') || msg.includes('503') ||
        lower.includes('rate') || lower.includes('unavailable') ||
        lower.includes('fetch failed') || lower.includes('econnreset') ||
        lower.includes('etimedout') || lower.includes('enotfound') ||
        lower.includes('socket hang up') || lower.includes('network') ||
        lower.includes('timed out');
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = delays[attempt - 1] ?? 45;
      process.stderr.write(`[retry] ${label} attempt ${attempt}/${maxRetries} failed (${msg.slice(0, 80)}), waiting ${delay}s...\n`);
      await new Promise(r => setTimeout(r, delay * 1000));
    }
  }
  throw new Error(`${label} failed after ${maxRetries} retries`);
}

// ── Timeout helper ───────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

// ── Usage telemetry ─────────────────────────────────────

interface ProviderResult {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
    totalTokens?: number;
  };
}

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

// ── Backend implementations ──────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function generateViaGemini(
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const url = `${GEMINI_BASE}/${apiModelId}:generateContent?key=${apiKey}`;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const response = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxTokens ?? 16384,
        },
      }),
    }),
    timeoutMs,
    'Gemini API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Gemini response');

  if (response.status === 429 || response.status === 503) {
    throw new Error(`Gemini ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let json: {
    candidates?: { content: { parts: { text: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; totalTokenCount?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Gemini API returned invalid JSON (${bodyText.length} bytes).\n` +
      `First 200 chars: ${bodyText.slice(0, 200)}\n` +
      `This usually means the response was truncated or the API returned an HTML error page. Check your API key and model ID.`
    );
  }
  if (!json.candidates?.length) {
    throw new Error(`No candidates in Gemini response: ${bodyText.slice(0, 300)}`);
  }
  const text = json.candidates[0].content.parts.map(p => p.text).join('');
  const um = json.usageMetadata;
  const usage = um ? {
    promptTokens: um.promptTokenCount,
    completionTokens: um.candidatesTokenCount,
    cachedTokens: um.cachedContentTokenCount,
    totalTokens: um.totalTokenCount,
  } : undefined;
  return { text, usage };
}

async function generateViaClaude(
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: apiModelId,
        max_tokens: opts.maxTokens ?? 8192,
        temperature: opts.temperature ?? 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    }),
    timeoutMs,
    'Claude API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Claude response');

  if (response.status === 429 || response.status === 503) {
    throw new Error(`Claude ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`Claude API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let json: {
    content?: { type: string; text: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Claude API returned invalid JSON (${bodyText.length} bytes).\n` +
      `First 200 chars: ${bodyText.slice(0, 200)}\n` +
      `Check your API key and ensure the model ID '${apiModelId}' is valid.`
    );
  }
  if (!json.content?.length) {
    throw new Error(`No content in Claude response: ${bodyText.slice(0, 300)}`);
  }
  const text = json.content.filter(c => c.type === 'text').map(c => c.text).join('');
  const u = json.usage;
  const usage = u ? {
    promptTokens: u.input_tokens,
    completionTokens: u.output_tokens,
    cachedTokens: (u.cache_read_input_tokens ?? 0) || undefined,
    totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) || undefined,
  } : undefined;
  return { text, usage };
}

async function generateViaGroq(
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const response = await withTimeout(
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModelId,
        messages: [{ role: 'user', content: prompt }],
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 8192,
      }),
    }),
    timeoutMs,
    'Groq API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Groq response');

  if (response.status === 429 || response.status === 503) {
    throw new Error(`Groq ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`Groq API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let json: {
    choices?: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Groq API returned invalid JSON (${bodyText.length} bytes).\n` +
      `First 200 chars: ${bodyText.slice(0, 200)}\n` +
      `Check your API key and ensure the model ID '${apiModelId}' is valid.`
    );
  }
  if (!json.choices?.length) {
    throw new Error(`No choices in Groq response: ${bodyText.slice(0, 300)}`);
  }
  const text = json.choices[0].message.content;
  const u = json.usage;
  const usage = u ? {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
  } : undefined;
  return { text, usage };
}

// ── OpenAI ───────────────���───────────────────────────────

async function generateViaOpenAI(
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const response = await withTimeout(
    fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModelId,
        input: prompt,
        max_output_tokens: opts.maxTokens ?? 16384,
      }),
    }),
    timeoutMs,
    'OpenAI API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading OpenAI response');

  if (response.status === 429 || response.status === 503) {
    throw new Error(`OpenAI ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let json: {
    output?: { type: string; content?: { type: string; text: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `OpenAI API returned invalid JSON (${bodyText.length} bytes).\n` +
      `First 200 chars: ${bodyText.slice(0, 200)}\n` +
      `Check your API key and ensure the model ID '${apiModelId}' is valid.`
    );
  }
  const msgOutput = json.output?.find(o => o.type === 'message');
  const text = msgOutput?.content?.find(c => c.type === 'output_text')?.text;
  if (!text) {
    throw new Error(`No message output in OpenAI response: ${bodyText.slice(0, 300)}`);
  }
  const u = json.usage;
  const usage = u ? {
    promptTokens: u.input_tokens,
    completionTokens: u.output_tokens,
    cachedTokens: u.input_tokens_details?.cached_tokens,
    totalTokens: u.total_tokens,
  } : undefined;
  return { text, usage };
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
    throw new Error(`Gemini ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let json: {
    candidates?: { content: { parts: { text: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; totalTokenCount?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Gemini envelope returned invalid JSON (${bodyText.length} bytes). First 200: ${bodyText.slice(0, 200)}`);
  }
  if (!json.candidates?.length) {
    throw new Error(`No candidates in Gemini envelope response: ${bodyText.slice(0, 300)}`);
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
    throw new Error(`Claude ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`Claude API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let json: {
    content?: { type: string; text: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Claude envelope returned invalid JSON (${bodyText.length} bytes). First 200: ${bodyText.slice(0, 200)}`);
  }
  if (!json.content?.length) {
    throw new Error(`No content in Claude envelope response: ${bodyText.slice(0, 300)}`);
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
    throw new Error(`${label} ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`${label} API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let json: {
    choices?: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`${label} envelope returned invalid JSON (${bodyText.length} bytes). First 200: ${bodyText.slice(0, 200)}`);
  }
  if (!json.choices?.length) {
    throw new Error(`No choices in ${label} envelope response: ${bodyText.slice(0, 300)}`);
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

// ── Factory ──────────────────────────────────────────────

export function createCLIAdapter(repoRoot: string, explicitApiKey?: string): ExtendedAIAdapter {
  const registry = loadRegistry(repoRoot);

  async function doGenerateText(prompt: string, model: string, options?: GenerateOptions): Promise<string> {
    const { apiModelId, backend } = resolveModel(registry, model);
    const apiKey = resolveApiKey(backend, explicitApiKey);
    const opts = options ?? {};

    const t0 = performance.now();
    const result = await withRetry(async () => {
      switch (backend) {
        case 'claude':
          return generateViaClaude(prompt, apiModelId, apiKey, opts);
        case 'groq':
          return generateViaGroq(prompt, apiModelId, apiKey, opts);
        case 'openai':
          return generateViaOpenAI(prompt, apiModelId, apiKey, opts);
        default:
          return generateViaGemini(prompt, apiModelId, apiKey, opts);
      }
    }, 3, `${backend}/${apiModelId}`);
    emitUsageTelemetry(backend, apiModelId, performance.now() - t0, result.usage);
    return result.text;
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
      }, 3, `${backend}/${apiModelId}`);

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
          throw new Error(`Gemini search error ${response.status}: ${body.slice(0, 300)}`);
        }

        const json = await response.json() as {
          candidates?: { content: { parts: { text: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { title?: string } }[] } }[];
        };
        if (!json.candidates?.length) throw new Error('No candidates from Gemini grounded search');

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
