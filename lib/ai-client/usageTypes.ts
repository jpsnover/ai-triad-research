// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ActionableError } from '../debate/errors.js';
import type { ToolDefinition } from './types.js';
import { parseVersionedModelId, type ModelRegistry } from './registry.js';

export interface UsageConfig {
  description: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  responseSchema?: Record<string, unknown>;
  systemMessage?: string;
  systemMessageTemplate?: string;
  message?: string;
  messageTemplate?: string;
  tools?: ToolDefinition[];
  tags?: string[];
  _extends?: string;
  /** Pin intent for the currency check (t/3676). Absent = assumed `current`.
   *  `comparability` — deliberately frozen for cross-run reproducibility;
   *  must name the corpus/run in `comparabilityCorpus` (the lapse condition).
   *  `current` — intended to track the newest suitable model; falling behind is drift. */
  _intent?: 'comparability' | 'current';
  comparabilityCorpus?: string;
}

export type UsageRegistry = Record<string, UsageConfig>;

export interface UsageValidationError {
  usageId: string;
  field: string;
  message: string;
}

export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  const missing: string[] = [];
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) {
      missing.push(key);
      return `{{${key}}}`;
    }
    return values[key];
  });
  if (missing.length > 0) {
    throw new ActionableError({
      goal: 'Render template for AI usage',
      problem: `Missing template variable${missing.length > 1 ? 's' : ''}: ${missing.map(k => `{{${k}}}`).join(', ')}`,
      location: 'usageTypes.renderTemplate',
      nextSteps: missing.map(k => `Provide '${k}' in the values hash`),
    });
  }
  return rendered;
}

// _pinPolicy is a top-level policy declaration (unannotated = assumed current), not a usage entry.
const META_FIELDS = new Set(['_schema_version', '_doc', '_pinPolicy']);

export function loadUsageRegistry(repoRoot: string): UsageRegistry {
  const configPath = path.join(repoRoot, 'ai-usages.json');
  if (!fs.existsSync(configPath)) {
    throw new ActionableError({
      goal: 'Load AI usage registry',
      problem: `Usage registry not found at: ${configPath}`,
      location: 'usageTypes.loadUsageRegistry',
      nextSteps: ['Create ai-usages.json at the repo root', 'Run from the ai-triad-research repo root'],
    });
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new ActionableError({
      goal: 'Parse AI usage registry',
      problem: `Failed to parse usage registry at ${configPath}: ${errMsg}`,
      location: 'usageTypes.loadUsageRegistry',
      nextSteps: ['Check ai-usages.json for JSON syntax errors'],
      innerError: err,
    });
  }

  const registry: UsageRegistry = {};
  for (const [key, value] of Object.entries(raw)) {
    if (META_FIELDS.has(key)) continue;
    registry[key] = value as UsageConfig;
  }

  for (const [id, config] of Object.entries(registry)) {
    if (!config._extends) continue;

    const parentId = config._extends;
    if (parentId === id) {
      throw new ActionableError({
        goal: 'Resolve _extends for usage config',
        problem: `Usage "${id}" extends itself`,
        location: 'usageTypes.loadUsageRegistry',
        nextSteps: [`Fix the _extends field in "${id}"`],
      });
    }

    const parent = registry[parentId];
    if (!parent) {
      throw new ActionableError({
        goal: 'Resolve _extends for usage config',
        problem: `Usage "${id}" extends unknown parent "${parentId}"`,
        location: 'usageTypes.loadUsageRegistry',
        nextSteps: [`Create usage "${parentId}" in ai-usages.json`, `Fix the _extends field in "${id}"`],
      });
    }

    if (parent._extends === id) {
      throw new ActionableError({
        goal: 'Resolve _extends for usage config',
        problem: `Circular _extends: "${id}" ↔ "${parentId}"`,
        location: 'usageTypes.loadUsageRegistry',
        nextSteps: [`Remove the cycle between "${id}" and "${parentId}"`],
      });
    }

    const { _extends: _parentExtends, ...parentFields } = parent;
    const { _extends: _childExtends, ...childFields } = config;
    registry[id] = { ...parentFields, ...childFields };
  }

  return registry;
}

export function validateUsageConfig(
  registry: UsageRegistry,
  modelRegistry: ModelRegistry,
): UsageValidationError[] {
  const errors: UsageValidationError[] = [];
  // Production-faithful exact-match predicate (SO e/210#5 condition 1, t/3664#13 fold).
  // ai-usages.json had six `gemini-flash-lite-latest` entries repointed to `gemini-3.5-flash-lite`
  // in the same PR. Any future `*-latest` alias must be rejected here — the same way production's
  // resolveModel rejects it on the exact-`models.find` branch — so the gate and production stay in
  // lockstep. The realGate FIXTURE arm confirms this (t/3664#14).
  const validModelIds = new Set(modelRegistry.models.map((m) => m.id));

  for (const [usageId, config] of Object.entries(registry)) {
    if (!config.description || typeof config.description !== 'string' || config.description.trim() === '') {
      errors.push({ usageId, field: 'description', message: 'description is required and must be a non-empty string' });
    }

    if (!validModelIds.has(config.model)) {
      errors.push({ usageId, field: 'model', message: `Unknown model "${config.model}" in usage "${usageId}" — add a registry entry to ai-models.json or update ai-usages.json (key: ${usageId}.model) to a registered id` });
    }

    if (config.temperature != null && (config.temperature < 0 || config.temperature > 2)) {
      errors.push({ usageId, field: 'temperature', message: `temperature ${config.temperature} is out of range [0, 2]` });
    }

    if (config.maxTokens != null && (!Number.isInteger(config.maxTokens) || config.maxTokens <= 0)) {
      errors.push({ usageId, field: 'maxTokens', message: `maxTokens must be a positive integer, got ${config.maxTokens}` });
    }

    if (config.timeoutMs != null && (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0)) {
      errors.push({ usageId, field: 'timeoutMs', message: `timeoutMs must be a positive integer, got ${config.timeoutMs}` });
    }
  }

  return errors;
}

export interface CurrencyCheckResult {
  usageId: string;
  currentModel: string;
  newerModel: string;
  family: string;
}

/** Returns usages that pin an outdated model version when a newer one exists in the registry.
 *  Usages with `_intent: 'comparability'` are intentionally frozen and skipped.
 *  Backends not covered by parseVersionedModelId (groq, openai, ollama, etc.) are silently skipped —
 *  name that gap in the close-out (SO e/216#2 condition 5). */
export function checkUsageCurrency(
  registry: UsageRegistry,
  modelRegistry: ModelRegistry,
): CurrencyCheckResult[] {
  // Reuse parseVersionedModelId so "newest in family" agrees with alias resolution (SO condition 1).
  const familyLatest = new Map<string, { id: string; version: number }>();
  for (const m of modelRegistry.models) {
    const parsed = parseVersionedModelId(m.id);
    if (!parsed) continue;
    const cur = familyLatest.get(parsed.family);
    if (!cur || parsed.version > cur.version) {
      familyLatest.set(parsed.family, { id: m.id, version: parsed.version });
    }
  }

  const results: CurrencyCheckResult[] = [];
  for (const [usageId, config] of Object.entries(registry)) {
    if (config._intent === 'comparability') continue;
    const parsed = parseVersionedModelId(config.model);
    if (!parsed) continue;
    const latest = familyLatest.get(parsed.family);
    if (latest && parsed.version < latest.version) {
      results.push({ usageId, currentModel: config.model, newerModel: latest.id, family: parsed.family });
    }
  }
  return results;
}
