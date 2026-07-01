// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../debate/errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import type { FetchFn, GenerateOptions, ProviderResult, TokenUsage } from './types.js';
import type { ModelRegistry } from './registry.js';
import { resolveModel, loadModelRegistry } from './registry.js';
import { withRetry, type RetryConfig, CLI_RETRY_CONFIG } from './retry.js';
import { callProvider } from './client.js';
import type { UsageConfig, UsageRegistry } from './usageTypes.js';
import { renderTemplate, loadUsageRegistry } from './usageTypes.js';

export interface UsageCallDeps {
  repoRoot: string;
  fetch: FetchFn;
  resolveApiKey: (backend: string) => string | Promise<string>;
  onUsage?: (backend: string, model: string, latencyMs: number, usage?: TokenUsage) => void;
  retryConfig?: RetryConfig;
}

let _cachedUsageRegistry: UsageRegistry | null = null;
let _cachedModelRegistry: ModelRegistry | null = null;
let _cachedRepoRoot: string | null = null;

function getOrLoadRegistries(repoRoot: string): { usages: UsageRegistry; models: ModelRegistry } {
  if (_cachedUsageRegistry && _cachedModelRegistry && _cachedRepoRoot === repoRoot) {
    return { usages: _cachedUsageRegistry, models: _cachedModelRegistry };
  }
  _cachedUsageRegistry = loadUsageRegistry(repoRoot);
  _cachedModelRegistry = loadModelRegistry(repoRoot);
  _cachedRepoRoot = repoRoot;
  return { usages: _cachedUsageRegistry, models: _cachedModelRegistry };
}

export function clearUsageRegistryCache(): void {
  _cachedUsageRegistry = null;
  _cachedModelRegistry = null;
  _cachedRepoRoot = null;
}

export function getUsage(usageId: string, repoRoot: string): UsageConfig {
  const { usages } = getOrLoadRegistries(repoRoot);
  const config = usages[usageId];
  if (!config) {
    const available = Object.keys(usages);
    throw new ActionableError({
      goal: `Look up usage config "${usageId}"`,
      problem: `Unknown UsageID "${usageId}"`,
      location: 'usageRegistry.getUsage',
      nextSteps: [
        `Available UsageIDs: ${available.slice(0, 10).join(', ')}${available.length > 10 ? ` (${available.length} total)` : ''}`,
        'Check ai-usages.json for valid IDs',
      ],
    });
  }
  return config;
}

export function listUsages(
  repoRoot: string,
  tag?: string,
): Array<{ id: string; config: UsageConfig }> {
  const { usages } = getOrLoadRegistries(repoRoot);
  const entries = Object.entries(usages).map(([id, config]) => ({ id, config }));
  if (!tag) return entries;
  return entries.filter(e => e.config.tags?.includes(tag));
}

export async function callByUsage(
  usageId: string,
  values: Record<string, string>,
  deps: UsageCallDeps,
  overrides?: Partial<UsageConfig>,
): Promise<ProviderResult> {
  const { usages, models } = getOrLoadRegistries(deps.repoRoot);
  const baseConfig = usages[usageId];
  if (!baseConfig) {
    const available = Object.keys(usages);
    throw new ActionableError({
      goal: `Call AI via UsageID "${usageId}"`,
      problem: `Unknown UsageID "${usageId}"`,
      location: 'usageRegistry.callByUsage',
      nextSteps: [
        `Available UsageIDs: ${available.slice(0, 10).join(', ')}${available.length > 10 ? ` (${available.length} total)` : ''}`,
        'Check ai-usages.json for valid IDs',
      ],
    });
  }

  const config = overrides ? { ...baseConfig, ...overrides } : baseConfig;

  const systemMessage = config.systemMessageTemplate
    ? renderTemplate(config.systemMessageTemplate, values)
    : config.systemMessage;

  const userMessage = config.messageTemplate
    ? renderTemplate(config.messageTemplate, values)
    : config.message ?? '';

  const { apiModelId, backend } = resolveModel(models, config.model);

  const opts: GenerateOptions = {
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    jsonMode: config.jsonMode,
    responseSchema: config.responseSchema,
    systemMessage,
    tools: config.tools,
  };

  getGlobalRecorder()?.record({
    type: 'ai.call_by_usage',
    component: 'usage-registry',
    level: 'info',
    data: {
      usageId,
      model: config.model,
      apiModelId,
      backend,
      hasOverrides: !!overrides,
      valueKeys: Object.keys(values),
    },
  });

  const apiKey = await deps.resolveApiKey(backend);
  const retryConfig = deps.retryConfig ?? CLI_RETRY_CONFIG;
  const t0 = performance.now();

  const result = await withRetry(
    () => callProvider(deps.fetch, backend, userMessage, apiModelId, apiKey, opts),
    retryConfig,
    `${backend}/${apiModelId}`,
  );

  const latencyMs = performance.now() - t0;
  deps.onUsage?.(backend, apiModelId, latencyMs, result.usage);

  return result;
}
