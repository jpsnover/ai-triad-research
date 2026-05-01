// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors';
import { withTimeout } from '../retry';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const GEMINI_TYPE_MAP: Record<string, string> = {
  string: 'STRING', number: 'NUMBER', integer: 'INTEGER',
  boolean: 'BOOLEAN', array: 'ARRAY', object: 'OBJECT',
};

export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (typeof schema.type === 'string') result.type = GEMINI_TYPE_MAP[schema.type] ?? schema.type.toUpperCase();
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.nullable) result.nullable = schema.nullable;
  if (schema.required) result.required = schema.required;
  if (schema.items && typeof schema.items === 'object') {
    result.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }
  if (schema.properties && typeof schema.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties as Record<string, unknown>)) {
      props[k] = typeof v === 'object' && v ? toGeminiSchema(v as Record<string, unknown>) : v;
    }
    result.properties = props;
  }
  return result;
}

export async function generateViaGemini(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const url = `${GEMINI_BASE}/${apiModelId}:generateContent?key=${apiKey}`;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const genConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.7,
    maxOutputTokens: opts.maxTokens ?? 16384,
  };
  if (opts.jsonMode || opts.responseSchema) {
    genConfig.responseMimeType = 'application/json';
    if (opts.responseSchema) {
      genConfig.responseSchema = toGeminiSchema(opts.responseSchema);
    }
  }

  const response = await withTimeout(
    fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: genConfig,
      }),
    }),
    timeoutMs,
    'Gemini API request',
  );

  const bodyText = await withTimeout(response.text(), 60_000, 'Reading Gemini response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via Gemini',
      problem: `Gemini ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaGemini',
      nextSteps: ['Wait a minute and retry', 'Switch to a different model', 'Check API quota'],
    });
  }
  if (!response.ok) {
    throw new ActionableError({
      goal: 'Generate text via Gemini',
      problem: `Gemini API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaGemini',
      nextSteps: ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  let json: {
    candidates?: { content: { parts: { text: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; totalTokenCount?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse Gemini API response',
      problem: `Gemini API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaGemini',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.candidates?.length) {
    throw new ActionableError({
      goal: 'Generate text via Gemini',
      problem: `No candidates in Gemini response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaGemini',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
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
