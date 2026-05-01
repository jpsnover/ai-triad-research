// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { FetchFn, GenerateOptions, ProviderResult, BackendId } from './types';
import type { ModelRegistry } from './registry';
import { resolveModel } from './registry';
import { withRetry, type RetryConfig, CLI_RETRY_CONFIG } from './retry';
import { generateViaGemini } from './providers/gemini';
import { generateViaClaude } from './providers/claude';
import { generateViaGroq } from './providers/groq';
import { generateViaOpenAI } from './providers/openai';

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
    default: return generateViaGemini(fetchFn, prompt, apiModelId, apiKey, opts);
  }
}

export function createAIClient(
  deps: AIClientDeps,
  registry: ModelRegistry,
  retryConfig: RetryConfig = CLI_RETRY_CONFIG,
): AIClient {
  return {
    async generateText(prompt: string, model: string, opts?: GenerateOptions): Promise<ProviderResult> {
      const { apiModelId, backend } = resolveModel(registry, model);
      const apiKey = await deps.resolveApiKey(backend);
      const t0 = performance.now();
      const result = await withRetry(
        () => callProvider(deps.fetch, backend, prompt, apiModelId, apiKey, opts ?? {}),
        retryConfig,
        `${backend}/${apiModelId}`,
        deps.onRetryLog,
      );
      deps.onUsage?.(backend, apiModelId, performance.now() - t0, result.usage);
      return result;
    },
  };
}
