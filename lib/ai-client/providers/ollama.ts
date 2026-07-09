// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors.js';
import { withTimeout } from '../retry.js';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types.js';

export const OLLAMA_BASE = 'http://localhost:11434';

/**
 * Check if Ollama is running locally by hitting the /api/tags endpoint.
 * Returns true if reachable, false otherwise.
 */
export async function isOllamaAvailable(fetchFn: FetchFn): Promise<boolean> {
  try {
    const res = await withTimeout(
      fetchFn(`${OLLAMA_BASE}/api/tags`),
      3000,
      'Ollama availability check',
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function generateViaOllama(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  _apiKey: string, // unused — Ollama is local, no auth needed
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs!;

  const messages: { role: string; content: string }[] = [];
  if (opts.systemMessage) messages.push({ role: 'system', content: opts.systemMessage });
  messages.push({ role: 'user', content: prompt });

  const reqBody: Record<string, unknown> = {
    model: apiModelId,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 8192,
  };

  // Structured JSON output via Ollama's format parameter
  if (opts.responseSchema) {
    reqBody.format = opts.responseSchema;
  } else if (opts.jsonMode) {
    reqBody.format = 'json';
  }

  const response = await withTimeout(
    fetchFn(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    }),
    timeoutMs,
    'Ollama API request',
  );

  const bodyText = await withTimeout(response.text(), 120_000, 'Reading Ollama response');

  if (response.status === 503 || response.status === 500) {
    throw new ActionableError({
      goal: 'Generate text via Ollama',
      problem: `Ollama ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaOllama',
      nextSteps: [
        'Verify Ollama is running: ollama serve',
        'Check if the model is pulled: ollama list',
        'Pull the model: ollama pull gemma4:4b-it-q4_0',
      ],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate text via Ollama',
      problem: `Ollama API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaOllama',
      nextSteps: [
        'Check if Ollama is running: ollama serve',
        'Verify the model name: ollama list',
        'Try a different model',
      ],
    });
  }

  let json: {
    choices?: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse Ollama API response',
      problem: `Ollama returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaOllama',
      nextSteps: ['Retry the request', 'Check the model name'],
    });
  }
  if (!json.choices?.length) {
    throw new ActionableError({
      goal: 'Generate text via Ollama',
      problem: `No choices in Ollama response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaOllama',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }
  const text = json.choices[0].message.content;
  const u = json.usage;
  const usage = u ? {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
  } : undefined;
  return { text, usage, rawResponsePreview: text ? undefined : bodyText.slice(0, 200) };
}
