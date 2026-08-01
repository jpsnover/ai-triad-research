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
  /** Reasoning models that reject arbitrary temperature (e.g. moonshot kimi-k3, which
   *  only accepts 1) — when set, the provider MUST send exactly this value (t/2068). */
  fixedTemperature?: number;
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
  if (model.startsWith('moonshot')) return 'moonshot';
  return 'gemini';
}

export function resolveModel(registry: ModelRegistry, friendlyId: string): { apiModelId: string; backend: string; fixedTemperature?: number } {
  const entry = registry.models.find(m => m.id === friendlyId);
  if (entry) return { apiModelId: entry.apiModelId, backend: entry.backend, fixedTemperature: entry.fixedTemperature };
  if (friendlyId.startsWith('gemini')) return { apiModelId: friendlyId, backend: 'gemini' };
  if (friendlyId.startsWith('claude')) return { apiModelId: friendlyId, backend: 'claude' };
  if (friendlyId.startsWith('groq')) return { apiModelId: friendlyId, backend: 'groq' };
  if (friendlyId.startsWith('openai')) return { apiModelId: friendlyId, backend: 'openai' };
  if (friendlyId.startsWith('azure')) return { apiModelId: friendlyId, backend: 'azure' };
  if (friendlyId.startsWith('ollama')) return { apiModelId: friendlyId, backend: 'ollama' };
  if (friendlyId.startsWith('deepseek')) return { apiModelId: friendlyId, backend: 'deepseek' };
  if (friendlyId.startsWith('zai')) return { apiModelId: friendlyId, backend: 'zai' };
  if (friendlyId.startsWith('moonshot')) return { apiModelId: friendlyId, backend: 'moonshot' };
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
    case 'zai':       return 240_000;
    case 'moonshot':  return 240_000;
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

export type ConfigIssueSeverity = 'warning' | 'info';

export interface ConfigIssue {
  severity: ConfigIssueSeverity;
  /** The offending model id as written in the config. */
  modelId: string;
  /** Dotted path to the config site referencing it (e.g. "debateTiers.advanced.gemini"). */
  referenceSite: string;
  message: string;
}

/**
 * Diagnose model-id references in a registry that do not resolve to a real model.
 *
 * Pure and non-throwing — returns a list of issues rather than failing, because
 * `resolveModel` verbatim passthrough is intentional (un-curated-but-valid provider
 * models such as azure-* BYOK ids legitimately are absent from the curated `models[]`
 * array) and `pricing` is a deliberate superset keyed by apiModelId.
 *
 * - `defaults` / `debateTiers` values that resolve to neither a real model nor a known
 *   `*-latest` alias are flagged `warning` (likely typo or a model that no longer exists).
 * - `pricing` keys with no matching `models[].apiModelId` are flagged `info` (superset,
 *   harmless until a matching model is discovered).
 *
 * Config keys beginning with `_` (e.g. `_comment`) are skipped.
 */
export function validateModelConfig(registry: ModelRegistry): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const idMap = buildModelIdMap(registry);

  const isResolvable = (id: string): boolean => {
    // Known model id, or a synthesized `*-latest` alias present in the map.
    if (idMap[id]) return true;
    // A live `-latest` that getApiModelId can resolve to a real apiModelId.
    return getApiModelId(idMap, id) !== id;
  };

  const checkReference = (id: unknown, site: string): void => {
    if (typeof id !== 'string' || id.length === 0) return;
    if (isResolvable(id)) return;
    issues.push({
      severity: 'warning',
      modelId: id,
      referenceSite: site,
      message: `Model id "${id}" referenced at ${site} does not map to any entry in models[] or a known -latest alias. It would be passed verbatim to the provider API by resolveModel and only fail as a 400 at request time.`,
    });
  };

  if (registry.defaults) {
    for (const [backend, id] of Object.entries(registry.defaults)) {
      if (backend.startsWith('_')) continue;
      checkReference(id, `defaults.${backend}`);
    }
  }

  if (registry.debateTiers) {
    for (const [tier, tierMap] of Object.entries(registry.debateTiers)) {
      if (tier.startsWith('_') || typeof tierMap !== 'object' || tierMap === null) continue;
      for (const [backend, id] of Object.entries(tierMap)) {
        if (backend.startsWith('_')) continue;
        checkReference(id, `debateTiers.${tier}.${backend}`);
      }
    }
  }

  if (registry.pricing) {
    const knownApiModelIds = new Set(registry.models.map(m => m.apiModelId));
    for (const key of Object.keys(registry.pricing)) {
      if (key.startsWith('_')) continue;
      if (knownApiModelIds.has(key)) continue;
      issues.push({
        severity: 'info',
        modelId: key,
        referenceSite: `pricing.${key}`,
        message: `Pricing entry "${key}" has no matching models[].apiModelId. Pricing is keyed by apiModelId and is a superset by design, so this is unused until a matching model is discovered.`,
      });
    }
  }

  return issues;
}

/**
 * Opt-in strict gate: throw an {@link ActionableError} if the registry has any
 * `warning`-severity config issue. `info` issues (pricing superset) are ignored.
 *
 * Not wired into the default `loadModelRegistry` path — verbatim passthrough is
 * load-bearing and the current committed config has legitimate warning-free-but-
 * unmapped references. Call this from CI or a `Test-AIModelConfig` cmdlet to fail
 * loud on drift before it reaches production.
 */
export function assertModelConfigValid(registry: ModelRegistry): void {
  const warnings = validateModelConfig(registry).filter(i => i.severity === 'warning');
  if (warnings.length === 0) return;
  const detail = warnings.map(w => `  - ${w.referenceSite} -> "${w.modelId}"`).join('\n');
  throw new ActionableError({
    goal: 'Validate AI model registry configuration',
    problem: `${warnings.length} model id reference(s) do not resolve to a real model or known alias:\n${detail}`,
    location: 'registry.assertModelConfigValid',
    nextSteps: [
      'Fix the typo in ai-models.json, or add the model to the models[] array',
      'If the id is an intentional provider passthrough, confirm the provider accepts it',
      'Run validateModelConfig(registry) to see the full issue list including info-level notes',
    ],
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
