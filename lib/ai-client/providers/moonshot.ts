// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors.js';
import { makeFetchSignal } from '../retry.js';
import { fetchWithDiagnostics } from '../instrumentation.js';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types.js';
import { DEFAULT_TEMPERATURE } from '../defaults.js';
import { normalizeStopReason } from './stopReason.js';

const MOONSHOT_BASE = 'https://api.moonshot.ai/v1';

/** Kimi K3 bills reasoning_content against max_tokens, so the old 8192 default let a ~46KB debate-brief
 *  prompt reason to the cap and return 0 output chars (2026-10-02 dump: 38KB body, finish_reason
 *  "length"). 32_000 = the clampMaxTokens ceiling in taxonomy-editor aiHandlers.ts — mirrors zai.ts. */
export const MOONSHOT_DEFAULT_MAX_TOKENS = 32_000;

export async function generateViaMoonshot(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  const timeoutMs = opts.timeoutMs!;
  const maxTokens = opts.maxTokens ?? MOONSHOT_DEFAULT_MAX_TOKENS;

  const messages: { role: string; content: string }[] = [];
  if (opts.systemMessage) messages.push({ role: 'system', content: opts.systemMessage });
  messages.push({ role: 'user', content: prompt });

  const { response, bodyText, diagnostics } = await fetchWithDiagnostics(fetchFn, `${MOONSHOT_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: apiModelId,
      messages,
      temperature: opts.fixedTemperature ?? opts.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: maxTokens,
      ...(opts.jsonMode ? {
        response_format: { type: 'json_object' },
      } : {}),
    }),
    signal: makeFetchSignal(timeoutMs, opts.signal),
  }, 60_000, 'Reading Moonshot response');

  if (response.status === 429 || response.status === 503) {
    throw new ActionableError({
      goal: 'Generate text via Moonshot',
      problem: `Moonshot ${response.status}: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaMoonshot',
      nextSteps: ['Wait a minute and retry', 'Switch to a different AI provider (Settings → AI Model)', 'Check API quota'],
    });
  }
  if (!response.ok) {
    const isTemperatureError = /temperature/i.test(bodyText);
    throw new ActionableError({
      goal: 'Generate text via Moonshot',
      problem: `Moonshot API error ${response.status}: ${bodyText.slice(0, 500)}`,
      location: 'ai-client.generateViaMoonshot',
      nextSteps: isTemperatureError
        ? [
            'This model requires a fixed temperature — add `"fixedTemperature": 1` to its entry in ai-models.json',
            'Or switch to a different model that accepts variable temperature',
          ]
        : ['Check your API key', 'Verify the model ID', 'Try a different model'],
    });
  }

  let json: {
    model?: string; // provider-reported served identity (t/3677)
    choices?: { message: { content: string; reasoning_content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number };
  };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new ActionableError({
      goal: 'Parse Moonshot API response',
      problem: `Moonshot API returned invalid JSON (${bodyText.length} bytes). First 200 chars: ${bodyText.slice(0, 200)}`,
      location: 'ai-client.generateViaMoonshot',
      nextSteps: ['Retry the request', 'Check the API key and model ID'],
    });
  }
  if (!json.choices?.length) {
    throw new ActionableError({
      goal: 'Generate text via Moonshot',
      problem: `No choices in Moonshot response: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaMoonshot',
      nextSteps: ['Retry the request', 'Try a different model'],
    });
  }
  const choice = json.choices[0];
  const text = choice.message.content;
  const u = json.usage;
  // Name the reasoning-exhaustion case here: downstream only sees stopReason 'max_tokens' and would
  // report a generic truncation, hiding that the budget went to reasoning, not output.
  if (!text && choice.finish_reason === 'length' && choice.message.reasoning_content) {
    throw new ActionableError({
      goal: 'Generate text via Moonshot',
      problem: `Moonshot exhausted token budget on reasoning_content (finish_reason: "length", max_tokens: ${maxTokens}, completion_tokens: ${u?.completion_tokens ?? 'unknown'}), producing 0 output chars. Reasoning preview: ${choice.message.reasoning_content.slice(0, 150)}`,
      location: 'ai-client.generateViaMoonshot',
      nextSteps: ['Increase max_tokens (current budget may be too low for reasoning models)', 'Switch to a non-reasoning model', 'Simplify the prompt to reduce reasoning depth'],
    });
  }
  const usage = u ? {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    cachedTokens: u.prompt_cache_hit_tokens,
    totalTokens: u.total_tokens,
  } : undefined;
  const rawStopReason = choice.finish_reason ?? undefined;
  return { text, usage, rawResponsePreview: text ? undefined : bodyText.slice(0, 200), stopReason: normalizeStopReason(rawStopReason), rawStopReason, diagnostics, providerReportedModel: json.model };
}
