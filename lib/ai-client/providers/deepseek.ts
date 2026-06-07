// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors.js';
import { withTimeout } from '../retry.js';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types.js';

export async function generateViaDeepSeek(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs!;

  const messages: { role: string; content: string }[] = [];
  if (opts.systemMessage) messages.push({ role: 'system', content: opts.systemMessage });
  messages.push({ role: 'user', content: prompt });

  const response = await withTimeout(
    fetchFn('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModelId,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 8192,
        ...(opts.jsonMode ? {
          response_format: { type: 'json_object' },
        } : {}),
      }),
    }),
    timeoutMs,
    'DeepSeek API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading DeepSeek response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via DeepSeek',
      problem: `DeepSeek ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaDeepSeek',
      nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate text via DeepSeek',
      problem: `DeepSeek API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaDeepSeek',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  let json: {
    choices?: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse DeepSeek API response',
      problem: `DeepSeek API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaDeepSeek',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.choices?.length) {
    throw new ActionableError({
      goal: 'Generate text via DeepSeek',
      problem: `No choices in DeepSeek response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaDeepSeek',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }
  const text = json.choices[0].message.content;
  const u = json.usage;
  const usage = u ? {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    cachedTokens: u.prompt_cache_hit_tokens,
    totalTokens: u.total_tokens,
  } : undefined;
  return { text, usage };
}

export async function generateViaDeepSeekStream(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
  onChunk?: (text: string) => void,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs!;

  const messages: { role: string; content: string }[] = [];
  if (opts.systemMessage) messages.push({ role: 'system', content: opts.systemMessage });
  messages.push({ role: 'user', content: prompt });

  const response = await withTimeout(
    fetchFn('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModelId,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 8192,
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    }),
    timeoutMs,
    'DeepSeek streaming API request',
  );

  if (response.status === 429 || response.status === 503) {
    const errBody = await response.text().catch(() => '');
    throw new ActionableError({
      goal: 'Generate text via DeepSeek (streaming)',
      problem: `DeepSeek ${response.status}: ${errBody.slice(0, 200)}`,
      location: 'ai-client.generateViaDeepSeekStream',
      nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
    });
  }
  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new ActionableError({
      goal: 'Generate text via DeepSeek (streaming)',
      problem: `DeepSeek API error ${response.status}: ${errBody.slice(0, 500)}`,
      location: 'ai-client.generateViaDeepSeekStream',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  if (!response.body) {
    throw new ActionableError({
      goal: 'Generate text via DeepSeek (streaming)',
      problem: 'DeepSeek streaming response has no body',
      location: 'ai-client.generateViaDeepSeekStream',
      nextSteps: ['Retry the request', 'Fall back to non-streaming generateViaDeepSeek'],
    });
  }

  const chunks: string[] = [];
  let usage: ProviderResult['usage'];
  const decoder = new TextDecoder();
  let buffer = '';

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') continue;

        let parsed: {
          choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number };
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          chunks.push(delta);
          onChunk?.(delta);
        }

        if (parsed.usage) {
          const u = parsed.usage;
          usage = {
            promptTokens: u.prompt_tokens,
            completionTokens: u.completion_tokens,
            cachedTokens: u.prompt_cache_hit_tokens,
            totalTokens: u.total_tokens,
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const text = chunks.join('');
  if (!text) {
    throw new ActionableError({
      goal: 'Generate text via DeepSeek (streaming)',
      problem: 'DeepSeek streaming produced no content',
      location: 'ai-client.generateViaDeepSeekStream',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }

  return { text, usage };
}
