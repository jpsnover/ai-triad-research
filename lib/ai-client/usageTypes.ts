// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ActionableError } from '../debate/errors.js';
import type { ToolDefinition } from './types.js';
import type { ModelRegistry } from './registry.js';
import { buildModelEntryMap } from './registry.js';

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

const META_FIELDS = new Set(['_schema_version', '_doc']);

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
  // Resolve model refs via buildModelEntryMap (NOT a `models[].id` Set / `models.find`): the map also
  // carries the synthesized `*-latest` aliases (highest-versioned entry per family) that `models[]`
  // lacks. ai-usages.json legitimately selects such an alias — `gemini-flash-lite-latest` on the
  // `server.*` usages — which resolves at runtime; a bare id-Set check would false-flag it as unknown
  // and re-open t/3518. Same alias-aware resolution the timeout floor uses (getModelMinTimeout,
  // registry.ts). This is a pure SELECTION surface, so resolve-or-exempt collapses to resolve-only —
  // no marker grammar (t/3664).
  const resolvableModels = buildModelEntryMap(modelRegistry);

  for (const [usageId, config] of Object.entries(registry)) {
    if (!config.description || typeof config.description !== 'string' || config.description.trim() === '') {
      errors.push({ usageId, field: 'description', message: 'description is required and must be a non-empty string' });
    }

    if (!Object.hasOwn(resolvableModels, config.model)) {
      errors.push({ usageId, field: 'model', message: `Unknown model "${config.model}" — resolves to no ai-models.json entry or synthesized *-latest alias` });
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
