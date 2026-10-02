// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors.js';
import { getGlobalRecorder } from '../../flight-recorder/index.js';
import { makeFetchSignal } from '../retry.js';
import { fetchWithDiagnostics } from '../instrumentation.js';
import type { FetchFn, GenerateOptions, ProviderResult } from '../types.js';
import { DEFAULT_TEMPERATURE } from '../defaults.js';
import { normalizeStopReason } from './stopReason.js';

/** GLM bills reasoning_content against max_tokens, so a 16k budget let a ~46KB debate-brief prompt
 *  reason until the cap and return 0 output chars (2026-10-02 dump). 32_000 = the clampMaxTokens
 *  ceiling in taxonomy-editor aiHandlers.ts. */
export const ZAI_DEFAULT_MAX_TOKENS = 32_000;

/** 'default' sends no reasoning control (provider default effort); 'low' sends reasoning_effort:'low'.
 *  Verified live 2026-10-02: glm-5.3 / glm-5.3-flash REJECT thinking:{type:'disabled'} (error 1210,
 *  "always engages in thinking") but honour reasoning_effort:'low' with 0 reasoning chars. glm-5.2
 *  ignores reasoning_effort (still reasons) — it relies on the 32k budget alone. */
type ZaiReasoning = 'default' | 'low';

interface ZaiChoice { finish_reason?: string; message: { content: string; reasoning_content?: string } }

export async function generateViaZai(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  // Structured-output calls want the JSON, not a reasoning trace — reasoning only burns budget there.
  // Free-text calls keep the provider-default reasoning, with a low-effort retry if reasoning eats the
  // whole budget (Z.AI exposes no reasoning-token cap, so the retry is how the budget is bounded).
  const structured = !!(opts.responseSchema || opts.jsonMode);
  const first = await requestZai(fetchFn, prompt, apiModelId, apiKey, opts, structured ? 'low' : 'default');
  if (first.kind === 'ok') return first.result;
  if (first.kind === 'reasoning-exhausted' && !structured) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'ai-client',
      level: 'warn',
      message: `Z.AI reasoning exhausted max_tokens with 0 output chars — retrying once with reasoning_effort low`,
      data: {
        model: apiModelId,
        maxTokens: opts.maxTokens ?? ZAI_DEFAULT_MAX_TOKENS,
        reasoningChars: first.reasoningChars,
        completionTokens: first.completionTokens,
      },
    });
    const retry = await requestZai(fetchFn, prompt, apiModelId, apiKey, opts, 'low');
    if (retry.kind === 'ok') return retry.result;
    throw retry.error;
  }
  throw first.error;
}

type ZaiAttempt =
  | { kind: 'ok'; result: ProviderResult }
  | { kind: 'reasoning-exhausted'; error: ActionableError; reasoningChars: number; completionTokens?: number }
  | { kind: 'empty'; error: ActionableError };

async function requestZai(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
  reasoning: ZaiReasoning,
): Promise<ZaiAttempt> {
  const timeoutMs = opts.timeoutMs!;
  const maxTokens = opts.maxTokens ?? ZAI_DEFAULT_MAX_TOKENS;

  const messages: { role: string; content: string }[] = [];
  if (opts.systemMessage) messages.push({ role: 'system', content: opts.systemMessage });
  messages.push({ role: 'user', content: prompt });

  const { response, bodyText, diagnostics } = await fetchWithDiagnostics(fetchFn, 'https://api.z.ai/api/paas/v4/chat/completions', {
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
      ...(reasoning === 'low' ? { reasoning_effort: 'low' } : {}),
      ...(opts.responseSchema ? {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'response', schema: opts.responseSchema, strict: true },
        },
      } : opts.jsonMode ? {
        response_format: { type: 'json_object' },
      } : {}),
    }),
    signal: makeFetchSignal(timeoutMs, opts.signal),
  }, 60_000, 'Reading Z.AI response');

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
    model?: string; // provider-reported served identity (t/3677)
    choices?: ZaiChoice[];
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
  const u = json.usage;
  if (!text) {
    const reasoningExhausted = choice.finish_reason === 'length' && !!choice.message.reasoning_content;
    const reasoningPreview = choice.message.reasoning_content?.slice(0, 150) ?? '';
    const error = new ActionableError({
      goal: 'Generate text via Z.AI',
      problem: reasoningExhausted
        ? `Z.AI exhausted token budget on reasoning_content (finish_reason: "length", max_tokens: ${maxTokens}, reasoning: ${reasoning}, completion_tokens: ${u?.completion_tokens ?? 'unknown'}), producing 0 output chars. Reasoning preview: ${reasoningPreview}`
        : `Z.AI returned empty content (0 chars) after ${response.status} (reasoning: ${reasoning}) — model may not support this prompt format or response_format. Raw: ${bodyText.slice(0, 300)}`,
      location: 'ai-client.generateViaZai',
      nextSteps: reasoningExhausted
        ? ['Increase max_tokens (current budget may be too low for reasoning models)', 'Switch to a non-reasoning model', 'Simplify the prompt to reduce reasoning depth']
        : ['Try a different model', 'Check if this model supports json_schema response_format', 'Contact Z.AI support'],
    });
    return reasoningExhausted
      ? { kind: 'reasoning-exhausted', error, reasoningChars: choice.message.reasoning_content!.length, completionTokens: u?.completion_tokens }
      : { kind: 'empty', error };
  }
  const usage = u ? {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    totalTokens: u.total_tokens,
  } : undefined;
  const rawStopReason = choice.finish_reason ?? undefined;
  return { kind: 'ok', result: { text, usage, rawResponsePreview: undefined, stopReason: normalizeStopReason(rawStopReason), rawStopReason, diagnostics, providerReportedModel: json.model } };
}
