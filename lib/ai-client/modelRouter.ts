// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Tiered model routing: routes AI tasks to local (Ollama) or cloud models
 * based on task complexity. Checks Ollama availability and falls back to
 * cloud when local inference is unavailable.
 */

import type { FetchFn } from './types.js';
import type { ModelRegistry } from './registry.js';
import { isOllamaAvailable } from './providers/ollama.js';

// ── Task tiers ───────────────────────────────────────────

export enum TaskTier {
  /** Simple tasks: summarization, enrichment, attribute extraction */
  LOCAL = 'local',
  /** Medium complexity: scoring, standard claim extraction */
  CLOUD_FAST = 'cloud_fast',
  /** High complexity: debate drafting, synthesis, policy analysis */
  CLOUD_FRONTIER = 'cloud_frontier',
}

// ── Purpose strings ──────────────────────────────────────
//
// These align with PromptType from cacheTypes.ts plus taxonomy
// enrichment tasks from the broader pipeline.

export type TaskPurpose =
  // Tier 1 — Local
  | 'summarization'
  | 'lineage_enrichment'
  | 'vocabulary_enrichment'
  | 'steelman_analysis'
  | 'fallacy_analysis'
  | 'graph_attribute_extraction'
  | 'taxonomy_refinement'
  // Tier 2 — Cloud Fast
  | 'moderator'
  | 'topic_critique'
  | 'claim_extraction'
  | 'brief'
  | 'plan'
  | 'gap_injection'
  | 'missing_args'
  | 'clarification'
  // Tier 3 — Cloud Frontier
  | 'draft'
  | 'cite'
  | 'synth_extract'
  | 'synth_map'
  | 'synth_evaluate'
  | 'policy_analysis'
  | 'legacy_monolithic';

/** Map each task purpose to its preferred tier. */
export const PURPOSE_TIER_MAP: Record<TaskPurpose, TaskTier> = {
  // Tier 1 — Local (simple extraction / enrichment)
  summarization:              TaskTier.LOCAL,
  lineage_enrichment:         TaskTier.LOCAL,
  vocabulary_enrichment:      TaskTier.LOCAL,
  steelman_analysis:          TaskTier.LOCAL,
  fallacy_analysis:           TaskTier.LOCAL,
  graph_attribute_extraction: TaskTier.LOCAL,
  taxonomy_refinement:        TaskTier.LOCAL,
  // Tier 2 — Cloud Fast (moderate reasoning)
  moderator:                  TaskTier.CLOUD_FAST,
  topic_critique:             TaskTier.CLOUD_FAST,
  claim_extraction:           TaskTier.CLOUD_FAST,
  brief:                      TaskTier.CLOUD_FAST,
  plan:                       TaskTier.CLOUD_FAST,
  gap_injection:              TaskTier.CLOUD_FAST,
  missing_args:               TaskTier.CLOUD_FAST,
  clarification:              TaskTier.CLOUD_FAST,
  // Tier 3 — Cloud Frontier (complex multi-step reasoning)
  draft:                      TaskTier.CLOUD_FRONTIER,
  cite:                       TaskTier.CLOUD_FRONTIER,
  synth_extract:              TaskTier.CLOUD_FRONTIER,
  synth_map:                  TaskTier.CLOUD_FRONTIER,
  synth_evaluate:             TaskTier.CLOUD_FRONTIER,
  policy_analysis:            TaskTier.CLOUD_FRONTIER,
  legacy_monolithic:          TaskTier.CLOUD_FRONTIER,
};

// ── Router configuration ─────────────────────────────────

export interface RouterConfig {
  /** Whether to prefer local models for Tier 1 tasks (default: true) */
  preferLocal: boolean;
  /** Default model for Tier 2 (cloud fast) tasks */
  cloudFastModel: string;
  /** Default model for Tier 3 (cloud frontier) tasks */
  cloudFrontierModel: string;
  /** Local model to use for Tier 1 tasks */
  localModel: string;
}

const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  preferLocal: true,
  cloudFastModel: 'gemini-3.1-flash-lite',
  cloudFrontierModel: 'gemini-2.5-flash',
  localModel: 'ollama-gemma4-e4b',
};

// ── Router state ─────────────────────────────────────────

let _ollamaAvailable: boolean | null = null;
let _config: RouterConfig = { ...DEFAULT_ROUTER_CONFIG };

/**
 * Probe Ollama availability and cache the result.
 * Call at startup for accurate routing; otherwise probes on first routed call.
 */
export async function probeOllama(fetchFn: FetchFn): Promise<boolean> {
  _ollamaAvailable = await isOllamaAvailable(fetchFn);
  return _ollamaAvailable;
}

/** Update router configuration. Merges with current config. */
export function configureRouter(overrides: Partial<RouterConfig>): void {
  _config = { ..._config, ...overrides };
}

/** Get current router configuration (for diagnostics / flight recorder). */
export function getRouterConfig(): Readonly<RouterConfig & { ollamaAvailable: boolean | null }> {
  return { ..._config, ollamaAvailable: _ollamaAvailable };
}

// ── Core routing ─────────────────────────────────────────

export interface RoutedModel {
  /** The model ID to pass to generateText / callProvider */
  model: string;
  /** The tier that was selected */
  tier: TaskTier;
  /** Whether the model is local (Ollama) */
  isLocal: boolean;
  /** The purpose that determined the tier */
  purpose: TaskPurpose;
}

/**
 * Resolve the best model for a given task purpose.
 *
 * @param purpose — The task type (maps to a tier via PURPOSE_TIER_MAP)
 * @param explicitModel — User's explicit model override (bypasses routing)
 * @param fetchFn — Fetch function for Ollama probe (only used if not yet probed)
 * @returns The resolved model with routing metadata
 */
export async function resolveModelForPurpose(
  purpose: TaskPurpose,
  explicitModel?: string,
  fetchFn?: FetchFn,
): Promise<RoutedModel> {
  // Explicit model override — user always wins
  if (explicitModel) {
    const tier = PURPOSE_TIER_MAP[purpose] ?? TaskTier.CLOUD_FAST;
    const isLocal = explicitModel.startsWith('ollama');
    return { model: explicitModel, tier, isLocal, purpose };
  }

  const tier = PURPOSE_TIER_MAP[purpose] ?? TaskTier.CLOUD_FAST;

  // For Tier 1 tasks, try local if preferred and available
  if (tier === TaskTier.LOCAL && _config.preferLocal) {
    // Lazy probe if not yet checked
    if (_ollamaAvailable === null && fetchFn) {
      _ollamaAvailable = await isOllamaAvailable(fetchFn);
    }
    if (_ollamaAvailable) {
      return { model: _config.localModel, tier, isLocal: true, purpose };
    }
    // Fall through to cloud fast when Ollama unavailable
  }

  // Cloud routing by tier
  switch (tier) {
    case TaskTier.LOCAL:
      // Ollama unavailable — fall back to cloud fast
      return { model: _config.cloudFastModel, tier, isLocal: false, purpose };
    case TaskTier.CLOUD_FAST:
      return { model: _config.cloudFastModel, tier, isLocal: false, purpose };
    case TaskTier.CLOUD_FRONTIER:
      return { model: _config.cloudFrontierModel, tier, isLocal: false, purpose };
  }
}

/**
 * Synchronous tier lookup — returns the tier for a purpose without
 * resolving a model. Useful for logging and diagnostics.
 */
export function getTierForPurpose(purpose: TaskPurpose): TaskTier {
  return PURPOSE_TIER_MAP[purpose] ?? TaskTier.CLOUD_FAST;
}
