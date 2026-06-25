// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors.js';
import { withTimeout } from '../retry.js';
import type { FetchFn, GenerateOptions, ProviderResult, ToolCall } from '../types.js';

export async function generateViaClaude(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs!;

  const userContent = opts.responseSchema
    ? `${prompt}\n\nYou MUST respond with a JSON object conforming to this schema:\n${JSON.stringify(opts.responseSchema, null, 2)}`
    : prompt;

  const reqBody: Record<string, unknown> = {
    model: apiModelId,
    max_tokens: opts.maxTokens ?? 8192,
    messages: [{ role: 'user', content: userContent }],
  };
  // Only include temperature when explicitly requested — some models (e.g. claude-opus-4-7) reject it
  if (opts.temperature != null) {
    reqBody.temperature = opts.temperature;
  }
  if (opts.systemMessage) {
    reqBody.system = [{ type: 'text', text: opts.systemMessage, cache_control: { type: 'ephemeral' } }];
  }
  if (opts.tools?.length) {
    reqBody.tools = opts.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  const response = await withTimeout(
    fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    }),
    timeoutMs,
    'Claude API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Claude response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via Claude',
      problem: `Claude ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaClaude',
      nextSteps: ['Wait a minute and retry', 'Switch to a different AI provider (Settings → AI Model)', 'Check API quota'],
    });
  }
  // Some models (e.g. claude-opus-4-7) reject temperature — retry without it
  if (response.status === 400 && reqBody.temperature != null && bodyText.includes('temperature')) {
    delete reqBody.temperature;
    const retryResponse = await withTimeout(
      fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody),
      }),
      timeoutMs,
      'Claude API request (retry without temperature)',
    );
    const retryBodyText = await withTimeout(retryResponse.text(), 60_000, 'Reading Claude retry response');
    if (!retryResponse.ok) {
      throw new ActionableError({
        goal: 'Generate text via Claude',
        problem: `Claude API error ${retryResponse.status}: ${retryBodyText.slice(0, 500)}`,
        location: 'ai-client.generateViaClaude',
        nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
      });
    }
    return parseClaudeResponse(retryBodyText);
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate text via Claude',
      problem: `Claude API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaClaude',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  return parseClaudeResponse(bodyText);
}

function parseClaudeResponse(bodyText: string): ProviderResult {
  let json: {
    content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse Claude API response',
      problem: `Claude API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaClaude',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.content?.length) {
    throw new ActionableError({
      goal: 'Generate text via Claude',
      problem: `No content in Claude response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaClaude',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }
  const text = json.content.filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  const toolUseBlocks = json.content.filter(c => c.type === 'tool_use');
  const toolCalls: ToolCall[] | undefined = toolUseBlocks.length > 0
    ? toolUseBlocks.map(c => ({
        name: c.name!,
        arguments: c.input ?? {},
        id: c.id!,
      }))
    : undefined;
  const u = json.usage;
  const usage = u ? {
    promptTokens: u.input_tokens,
    completionTokens: u.output_tokens,
    cachedTokens: (u.cache_read_input_tokens ?? 0) || undefined,
    totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) || undefined,
  } : undefined;
  return { text, usage, toolCalls };
}
