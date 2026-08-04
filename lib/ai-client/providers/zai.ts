// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors.js';
import { withTimeout } from '../retry.js';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types.js';
import { DEFAULT_TEMPERATURE } from '../defaults.js';

export async function generateViaZai(
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
    fetchFn('https://api.z.ai/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModelId,
        messages,
        temperature: opts.fixedTemperature ?? opts.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: opts.maxTokens ?? 16384,
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
    'Z.AI API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Z.AI response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via Z.AI',
      problem: `Z.AI ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaZai',
      nextSteps: ['Wait a minute and retry', 'Switch to a different AI provider (Settings → AI Model)', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate text via Z.AI',
      problem: `Z.AI API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaZai',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  let json: {
    choices?: { finish_reason?: string; message: { content: string; reasoning_content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse Z.AI API response',
      problem: `Z.AI API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaZai',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.choices?.length) {
    throw new ActionableError({
      goal: 'Generate text via Z.AI',
      problem: `No choices in Z.AI response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaZai',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }
  const choice = json.choices[0];
  const text = choice.message.content;
  if (!text) {
    const reasoningExhausted = choice.finish_reason === 'length' && !!choice.message.reasoning_content;
    throw new ActionableError({
      goal: 'Generate text via Z.AI',
      problem: reasoningExhausted
        ? `Z.AI exhausted token budget on reasoning_content (finish_reason: "length"), producing 0 output chars. Reasoning preview: ${choice.message.reasoning_content!.slice(0, 150)}`
        : `Z.AI returned empty content (0 chars) after ${response.status} — model may not support this prompt format or response_format. Raw: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaZai',
      nextSteps: reasoningExhausted
        ? ['Increase max_tokens (current budget may be too low for reasoning models)', 'Switch to a non-reasoning model', 'Simplify the prompt to reduce reasoning depth']
        : ['Try a different model', 'Check if this model supports json_schema response_format', 'Contact Z.AI support'],
    });
  }
  const u = json.usage;
  const usage = u ? {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
  } : undefined;
  return { text, usage, rawResponsePreview: text ? undefined : bodyText.slice(0, 200) };
}
