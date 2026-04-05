// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Multi-backend AI client for CLI debate runner.
 * Supports Gemini, Claude, and Groq with retry logic.
 */

import fs from 'fs';
import path from 'path';

// ── Interface ────────────────────────────────────────────

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AIAdapter {
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
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
  return { apiModelId: friendlyId, backend: 'gemini' };
}

// ── API key resolution ───────────────────────────────────

const BACKEND_ENV_KEYS: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
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
      const isRetryable = msg.includes('429') || msg.includes('503') || msg.includes('rate') || msg.includes('unavailable');
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

// ── Backend implementations ──────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function generateViaGemini(
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<string> {
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

  let json: { candidates?: { content: { parts: { text: string }[] } }[] };
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
  return json.candidates[0].content.parts.map(p => p.text).join('');
}

async function generateViaClaude(
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<string> {
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

  let json: { content?: { type: string; text: string }[] };
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
  return json.content.filter(c => c.type === 'text').map(c => c.text).join('');
}

async function generateViaGroq(
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<string> {
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

  let json: { choices?: { message: { content: string } }[] };
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
  return json.choices[0].message.content;
}

// ── Factory ──────────────────────────────────────────────

export function createCLIAdapter(repoRoot: string, explicitApiKey?: string): AIAdapter {
  const registry = loadRegistry(repoRoot);

  return {
    async generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string> {
      const { apiModelId, backend } = resolveModel(registry, model);
      const apiKey = resolveApiKey(backend, explicitApiKey);
      const opts = options ?? {};

      return withRetry(async () => {
        switch (backend) {
          case 'claude':
            return generateViaClaude(prompt, apiModelId, apiKey, opts);
          case 'groq':
            return generateViaGroq(prompt, apiModelId, apiKey, opts);
          default:
            return generateViaGemini(prompt, apiModelId, apiKey, opts);
        }
      }, 3, `${backend}/${apiModelId}`);
    },
  };
}
