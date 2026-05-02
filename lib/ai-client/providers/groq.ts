// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors';
import { withTimeout } from '../retry';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types';

export async function generateViaGroq(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const messages: { role: string; content: string }[] = [];
  if (opts.systemMessage) messages.push({ role: 'system', content: opts.systemMessage });
  messages.push({ role: 'user', content: prompt });

  const response = await withTimeout(
    fetchFn('https://api.groq.com/openai/v1/chat/completions', {
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
        ...(opts.responseSchema ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'response', schema: opts.responseSchema, strict: true },
          },
        } : opts.jsonMode ? {
          response_format: { type: 'json_object' },
        } : {}),
      }),
    }),
    timeoutMs,
    'Groq API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Groq response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via Groq',
      problem: `Groq ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaGroq',
      nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate text via Groq',
      problem: `Groq API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaGroq',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
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
      goal: 'Parse Groq API response',
      problem: `Groq API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaGroq',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.choices?.length) {
    throw new ActionableError({
      goal: 'Generate text via Groq',
      problem: `No choices in Groq response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaGroq',
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
  return { text, usage };
}
