// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { BackendId } from './types';

export interface ModelEntry {
  id: string;
  apiModelId: string;
  label: string;
  backend: string;
}

export interface ModelRegistry {
  backends: { id: string; label: string }[];
  models: ModelEntry[];
  fallbackChains?: Record<string, string[]>;
  contextWindows?: Record<string, number>;
}

export function resolveBackend(model: string): BackendId {
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  if (model.startsWith('openai')) return 'openai';
  return 'gemini';
}

export function resolveModel(registry: ModelRegistry, friendlyId: string): { apiModelId: string; backend: string } {
  const entry = registry.models.find(m => m.id === friendlyId);
  if (entry) return { apiModelId: entry.apiModelId, backend: entry.backend };
  if (friendlyId.startsWith('gemini')) return { apiModelId: friendlyId, backend: 'gemini' };
  if (friendlyId.startsWith('claude')) return { apiModelId: friendlyId, backend: 'claude' };
  if (friendlyId.startsWith('groq')) return { apiModelId: friendlyId, backend: 'groq' };
  if (friendlyId.startsWith('openai')) return { apiModelId: friendlyId, backend: 'openai' };
  return { apiModelId: friendlyId, backend: 'gemini' };
}

export function buildModelIdMap(registry: ModelRegistry): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of registry.models) {
    if (m.apiModelId && m.apiModelId !== m.id) {
      map[m.id] = m.apiModelId;
    }
  }
  return map;
}

export function getApiModelId(map: Record<string, string>, friendlyId: string): string {
  return map[friendlyId] || friendlyId;
}
