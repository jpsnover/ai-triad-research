// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2583 — xAI (Grok) exposes an OpenAI-compatible /chat/completions endpoint at
// https://api.x.ai/v1 (Bearer auth, system+user messages). Request/response shape
// matches Groq/z.ai/Moonshot exactly; the model id (grok-4.6) flows from
// ai-models.json via apiModelId.
import { ActionableError } from '../../debate/errors.js';
import { withTimeout, makeFetchSignal } from '../retry.js';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types.js';
import { DEFAULT_TEMPERATURE } from '../defaults.js';

const XAI_BASE = 'https://api.x.ai/v1';

export async function generateViaXai(
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

  const response = await fetchFn(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: apiModelId,
      messages,
      temperature: opts.fixedTemperature ?? opts.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: opts.maxTokens ?? 8192,
      ...(opts.jsonMode ? {
        response_format: { type: 'json_object' },
      } : {}),
    }),
    signal: makeFetchSignal(timeoutMs, opts.signal),
  });

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading xAI response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via xAI',
      problem: `xAI ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaXai',
      nextSteps: ['Wait a minute and retry', 'Switch to a different AI provider (Settings → AI Model)', 'Check API quota'],
    });
  }
  if (!response.ok) {
    const isTemperatureError = /temperature/i.test(bodyText);
    throw new ActionableError({
      goal: 'Generate text via xAI',
      problem: `xAI API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaXai',
      nextSteps: isTemperatureError
        ? [
            'This model requires a fixed temperature — add `"fixedTemperature": 1` to its entry in ai-models.json',
            'Or switch to a different model that accepts variable temperature',
          ]
        : ['Check your API key', 'Verify the model ID', 'Try a different model'],
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
      goal: 'Parse xAI API response',
      problem: `xAI API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaXai',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.choices?.length) {
    throw new ActionableError({
      goal: 'Generate text via xAI',
      problem: `No choices in xAI response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaXai',
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
  return { text, usage, rawResponsePreview: text ? undefined : bodyText.slice(0, 200) };
}
