// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors';
import { withTimeout } from '../retry';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types';

export async function generateViaOpenAI(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const reqBody: Record<string, unknown> = {
    model: apiModelId,
    input: prompt,
    max_output_tokens: opts.maxTokens ?? 16384,
  };
  if (opts.systemMessage) {
    reqBody.instructions = opts.systemMessage;
  }

  const response = await withTimeout(
    fetchFn('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqBody),
    }),
    timeoutMs,
    'OpenAI API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading OpenAI response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via OpenAI',
      problem: `OpenAI ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaOpenAI',
      nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate text via OpenAI',
      problem: `OpenAI API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaOpenAI',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  let json: {
    output?: { type: string; content?: { type: string; text: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse OpenAI API response',
      problem: `OpenAI API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaOpenAI',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  const msgOutput = json.output?.find(o => o.type === 'message');
  const text = msgOutput?.content?.find(c => c.type === 'output_text')?.text;
  if (!text) {
    throw new ActionableError({
      goal: 'Generate text via OpenAI',
      problem: `No message output in OpenAI response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaOpenAI',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
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
