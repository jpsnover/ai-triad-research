// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../debate/errors.js';
import type { FetchFn, GenerateOptions, ProviderResult, BackendId } from './types.js';
import type { ModelRegistry } from './registry.js';
import { resolveModel, getDefaultTimeout, estimateCost } from './registry.js';
import { withRetry, type RetryConfig, CLI_RETRY_CONFIG } from './retry.js';
import { generateViaGemini } from './providers/gemini.js';
import { generateViaClaude } from './providers/claude.js';
import { generateViaGroq } from './providers/groq.js';
import { generateViaOpenAI } from './providers/openai.js';
import { generateViaDeepSeek } from './providers/deepseek.js';
import { generateViaOllama } from './providers/ollama.js';
import { generateViaAzure } from './providers/azure.js';
import { generateViaZai } from './providers/zai.js';
import { generateViaMoonshot } from './providers/moonshot.js';
import { generateViaXai } from './providers/xai.js';

export interface AIClientDeps {
  fetch: FetchFn;
  resolveApiKey: (backend: string) => string | Promise<string>;
  onUsage?: (backend: string, model: string, latencyMs: number, usage?: ProviderResult['usage']) => void;
  onRetryLog?: (msg: string) => void;
}

export interface AIClient {
  generateText(prompt: string, model: string, opts?: GenerateOptions): Promise<ProviderResult>;
}

export function callProvider(
  fetchFn: FetchFn,
  backend: string,
  prompt: string,
  apiModelId: string,
  apiKey: string,
  opts: GenerateOptions,
): Promise<ProviderResult> {
  switch (backend) {
    case 'claude': return generateViaClaude(fetchFn, prompt, apiModelId, apiKey, opts);
    case 'groq': return generateViaGroq(fetchFn, prompt, apiModelId, apiKey, opts);
    case 'openai': return generateViaOpenAI(fetchFn, prompt, apiModelId, apiKey, opts);
    case 'azure': return generateViaAzure(fetchFn, prompt, apiModelId, apiKey, opts);
    case 'deepseek': return generateViaDeepSeek(fetchFn, prompt, apiModelId, apiKey, opts);
    case 'ollama': return generateViaOllama(fetchFn, prompt, apiModelId, apiKey, opts);
    case 'zai': return generateViaZai(fetchFn, prompt, apiModelId, apiKey, opts);
    case 'moonshot': return generateViaMoonshot(fetchFn, prompt, apiModelId, apiKey, opts);
    case 'xai': return generateViaXai(fetchFn, prompt, apiModelId, apiKey, opts);
    default: return generateViaGemini(fetchFn, prompt, apiModelId, apiKey, opts);
  }
}

export function createAIClient(
  deps: AIClientDeps,
  registry: ModelRegistry,
  retryConfig: RetryConfig = CLI_RETRY_CONFIG,
): AIClient {
  let accumulatedCostUsd = 0;
  return {
    async generateText(prompt: string, model: string, opts?: GenerateOptions): Promise<ProviderResult> {
      if (opts?.maxCostUsd != null && accumulatedCostUsd >= opts.maxCostUsd) {
        throw new ActionableError({
          goal: 'Generate text via AI',
          problem: `Budget exceeded: accumulated cost $${accumulatedCostUsd.toFixed(4)} >= cap $${opts.maxCostUsd.toFixed(4)}`,
          location: 'ai-client.createAIClient',
          nextSteps: ['Increase the budget cap', 'Start a new session to reset the budget', 'Switch to a cheaper model'],
        });
      }
      const { apiModelId, backend, fixedTemperature } = resolveModel(registry, model);
      const apiKey = await deps.resolveApiKey(backend);
      // Registry-driven per-model temperature constraint (t/2068): the model's
      // fixedTemperature (if any) overrides the caller's temperature so providers send it.
      const effectiveOpts = {
        ...opts,
        timeoutMs: opts?.timeoutMs ?? getDefaultTimeout(model, registry),
        ...(fixedTemperature != null ? { fixedTemperature } : {}),
      };
      const t0 = performance.now();
      const result = await withRetry(
        () => callProvider(deps.fetch, backend, prompt, apiModelId, apiKey, effectiveOpts),
        retryConfig,
        `${backend}/${apiModelId}`,
        deps.onRetryLog,
        effectiveOpts.signal,
      );
      if (result.usage) {
        result.estimatedCostUsd = estimateCost(registry, apiModelId, result.usage);
        if (result.estimatedCostUsd != null) {
          accumulatedCostUsd += result.estimatedCostUsd;
        }
      }
      deps.onUsage?.(backend, apiModelId, performance.now() - t0, result.usage);
      return result;
    },
  };
}
