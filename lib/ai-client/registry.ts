// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ActionableError } from '../debate/errors.js';
import type { BackendId, ModelCapabilities, TokenUsage } from './types.js';

export interface ModelEntry {
  id: string;
  apiModelId: string;
  label: string;
  backend: string;
}

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

export interface ModelRegistry {
  backends: { id: string; label: string }[];
  models: ModelEntry[];
  fallbackChains?: Record<string, string[]>;
  defaults?: Record<string, string>;
  contextWindows?: Record<string, number>;
  debateTiers?: Record<string, Record<string, string>>;
  capabilityDefaults?: Record<string, Partial<ModelCapabilities>>;
  modelCapabilities?: Record<string, Partial<ModelCapabilities>>;
  pricing?: Record<string, ModelPricing>;
}

export function resolveBackend(model: string): BackendId {
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  if (model.startsWith('openai')) return 'openai';
  if (model.startsWith('azure')) return 'azure';
  if (model.startsWith('ollama')) return 'ollama';
  if (model.startsWith('deepseek')) return 'deepseek';
  if (model.startsWith('zai')) return 'zai';
  return 'gemini';
}

export function resolveModel(registry: ModelRegistry, friendlyId: string): { apiModelId: string; backend: string } {
  const entry = registry.models.find(m => m.id === friendlyId);
  if (entry) return { apiModelId: entry.apiModelId, backend: entry.backend };
  if (friendlyId.startsWith('gemini')) return { apiModelId: friendlyId, backend: 'gemini' };
  if (friendlyId.startsWith('claude')) return { apiModelId: friendlyId, backend: 'claude' };
  if (friendlyId.startsWith('groq')) return { apiModelId: friendlyId, backend: 'groq' };
  if (friendlyId.startsWith('openai')) return { apiModelId: friendlyId, backend: 'openai' };
  if (friendlyId.startsWith('azure')) return { apiModelId: friendlyId, backend: 'azure' };
  if (friendlyId.startsWith('ollama')) return { apiModelId: friendlyId, backend: 'ollama' };
  if (friendlyId.startsWith('deepseek')) return { apiModelId: friendlyId, backend: 'deepseek' };
  if (friendlyId.startsWith('zai')) return { apiModelId: friendlyId, backend: 'zai' };
  return { apiModelId: friendlyId, backend: 'gemini' };
}

export function getDefaultTimeout(model: string): number {
  const backend = resolveBackend(model);
  switch (backend) {
    case 'ollama':    return 300_000;
    case 'deepseek':  return 180_000;
    case 'openai':    return 180_000;
    case 'azure':     return 180_000;
    case 'claude':    return 180_000;
    case 'groq':      return 120_000;
    case 'zai':       return 180_000;
    case 'gemini':    return 120_000;
    default:          return 120_000;
  }
}

function parseVersionedModelId(id: string): { family: string; version: number } | null {
  const gemini = id.match(/^(gemini)-(\d+\.\d+)-(.+?)(?:-preview)?$/);
  if (gemini) return { family: `${gemini[1]}-${gemini[3]}`, version: parseFloat(gemini[2]) };
  const claude = id.match(/^(claude-(?:opus|sonnet|haiku))-(\d+(?:-\d+)?)$/);
  if (claude) return { family: claude[1], version: parseFloat(claude[2].replace('-', '.')) };
  return null;
}

export function buildModelIdMap(registry: ModelRegistry): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of registry.models) {
    map[m.id] = m.apiModelId;
  }

  const families = new Map<string, { apiModelId: string; version: number }[]>();
  for (const m of registry.models) {
    const parsed = parseVersionedModelId(m.id);
    if (!parsed) continue;
    const latestKey = `${parsed.family}-latest`;
    if (map[latestKey]) continue;
    if (!families.has(latestKey)) families.set(latestKey, []);
    families.get(latestKey)!.push({ apiModelId: m.apiModelId, version: parsed.version });
  }
  for (const [alias, members] of families) {
    if (map[alias]) continue;
    members.sort((a, b) => b.version - a.version);
    map[alias] = members[0].apiModelId;
  }

  return map;
}

export function getApiModelId(map: Record<string, string>, friendlyId: string): string {
  if (map[friendlyId]) return map[friendlyId];

  if (friendlyId.endsWith('-latest')) {
    const family = friendlyId.slice(0, -'-latest'.length);
    let best: { apiModelId: string; version: number } | null = null;
    for (const key of Object.keys(map)) {
      const parsed = parseVersionedModelId(key);
      if (parsed && parsed.family === family) {
        if (!best || parsed.version > best.version) {
          best = { apiModelId: map[key], version: parsed.version };
        }
      }
    }
    if (best) return best.apiModelId;
  }

  return friendlyId;
}

const SYSTEM_DEFAULTS: ModelCapabilities = {
  supportsTools: true,
  supportsVision: false,
  supportsStreaming: true,
  maxContextTokens: 131072,
};

/**
 * Resolve capabilities for a model. Merges: system defaults < backend defaults < model overrides.
 */
export function getModelCapabilities(registry: ModelRegistry, modelId: string): ModelCapabilities {
  const entry = registry.models.find(m => m.id === modelId);
  const backend = entry?.backend ?? resolveBackend(modelId);

  const backendDefaults = registry.capabilityDefaults?.[backend] ?? {};
  const modelOverrides = registry.modelCapabilities?.[modelId] ?? {};

  return { ...SYSTEM_DEFAULTS, ...backendDefaults, ...modelOverrides };
}

/**
 * Filter a list of model IDs to those satisfying required capabilities.
 * Only checks boolean capabilities that are explicitly set in `required`.
 */
export function filterByCapabilities(
  registry: ModelRegistry,
  modelIds: string[],
  required: Partial<Pick<ModelCapabilities, 'supportsTools' | 'supportsVision' | 'supportsStreaming'>>,
): string[] {
  return modelIds.filter(id => {
    const caps = getModelCapabilities(registry, id);
    if (required.supportsTools && !caps.supportsTools) return false;
    if (required.supportsVision && !caps.supportsVision) return false;
    if (required.supportsStreaming && !caps.supportsStreaming) return false;
    return true;
  });
}

export function estimateCost(
  registry: ModelRegistry,
  apiModelId: string,
  usage: TokenUsage,
): number | undefined {
  const p = registry.pricing?.[apiModelId];
  if (!p) return undefined;
  const inputTokens = usage.promptTokens ?? 0;
  const outputTokens = usage.completionTokens ?? 0;
  const cachedTokens = usage.cachedTokens ?? 0;
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
  const cachedCost = p.cachedInputPer1M != null
    ? (cachedTokens / 1_000_000) * p.cachedInputPer1M
    : (cachedTokens / 1_000_000) * p.inputPer1M;
  const inputCost = (nonCachedInput / 1_000_000) * p.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * p.outputPer1M;
  return inputCost + cachedCost + outputCost;
}

export function loadModelRegistry(repoRoot: string): ModelRegistry {
  const configPath = path.join(repoRoot, 'ai-models.json');
  if (!fs.existsSync(configPath)) {
    throw new ActionableError({
      goal: 'Load AI model registry',
      problem: `Model registry not found at: ${configPath}`,
      location: 'registry.loadModelRegistry',
      nextSteps: ['Run from the ai-triad-research repo root', 'Check ai-models.json exists'],
    });
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ModelRegistry;
  } catch (err) {
    throw new ActionableError({
      goal: 'Parse AI model registry',
      problem: `Failed to parse model registry at ${configPath}: ${err instanceof Error ? err.message : err}`,
      location: 'registry.loadModelRegistry',
      nextSteps: ['Check ai-models.json for JSON syntax errors'],
      innerError: err,
    });
  }
}
