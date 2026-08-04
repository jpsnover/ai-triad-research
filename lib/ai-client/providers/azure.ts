// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors.js';
import { withTimeout } from '../retry.js';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types.js';
import { DEFAULT_TEMPERATURE } from '../defaults.js';

function resolveEndpoint(): string {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint) {
    throw new ActionableError({
      goal: 'Resolve Azure OpenAI endpoint',
      problem: 'AZURE_OPENAI_ENDPOINT environment variable is not set',
      location: 'ai-client.generateViaAzure',
      nextSteps: [
        'Set AZURE_OPENAI_ENDPOINT to your Azure OpenAI resource URL (e.g., https://my-resource.openai.azure.com)',
        'Find the endpoint in Azure Portal → your OpenAI resource → Keys and Endpoint',
      ],
    });
  }
  return endpoint.replace(/\/+$/, '');
}

export async function generateViaAzure(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs!;
  const endpoint = resolveEndpoint();
  const deploymentName = apiModelId;
  const apiVersion = '2024-10-21';

  const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

  const messages: { role: string; content: string }[] = [];
  if (opts.systemMessage) messages.push({ role: 'system', content: opts.systemMessage });
  messages.push({ role: 'user', content: prompt });

  const reqBody: Record<string, unknown> = {
    messages,
    temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: opts.maxTokens ?? 8192,
  };
  if (opts.jsonMode) {
    reqBody.response_format = { type: 'json_object' };
  }

  const response = await withTimeout(
    fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(reqBody),
    }),
    timeoutMs,
    'Azure OpenAI API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Azure OpenAI response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via Azure OpenAI',
      problem: `Azure OpenAI ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaAzure',
      nextSteps: ['Wait a minute and retry', 'Switch to a different AI provider (Settings → AI Model)', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate text via Azure OpenAI',
      problem: `Azure OpenAI API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaAzure',
      nextSteps: ['Check your API key and endpoint', 'Verify the deployment name', 'Try a different model'],
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
      goal: 'Parse Azure OpenAI API response',
      problem: `Azure OpenAI API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaAzure',
      nextSteps: ['Retry the request', 'Check the API key and deployment name'],
    });
  }
  if (!json.choices?.length) {
    throw new ActionableError({
      goal: 'Generate text via Azure OpenAI',
      problem: `No choices in Azure OpenAI response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaAzure',
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
