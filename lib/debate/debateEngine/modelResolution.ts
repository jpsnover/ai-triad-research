// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals, DebateConfig } from './internals.js';
import { isCompactModel } from '../prompts.js';

export function modelTierRank(model: string): number {
  const m = model.toLowerCase();
  if (isCompactModel(m)) return 1;
  if (m.includes('flash')) return 2;
  if (m.includes('haiku') || m.includes('deepseek')) return 3;
  if (m.includes('sonnet') || m.includes('llama')) return 3;
  if (m.includes('opus') || m.includes('pro')) return 4;
  return 3;
}

export function resolveStageModel(engine: DebateEngineInternals, key: keyof NonNullable<DebateConfig['stageModels']>): string {
  return engine.config.stageModels?.[key] ?? engine.config.model;
}

export function recordRateLimit(engine: DebateEngineInternals): void {
  engine._lastRateLimitTime = Date.now();
  engine._rateLimitBackoffMs = Math.min(
    Math.max(engine._rateLimitBackoffMs * 2, 15_000),
    120_000,
  );
}

export function clearRateLimitBackoff(engine: DebateEngineInternals): void {
  if (engine._rateLimitBackoffMs > 0) {
    engine._rateLimitBackoffMs = Math.floor(engine._rateLimitBackoffMs / 2);
    if (engine._rateLimitBackoffMs < 2_000) {
      engine._rateLimitBackoffMs = 0;
      engine._lastRateLimitTime = 0;
    }
  }
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('429') || /rate[_ -]?limit/i.test(msg);
}

export function resolveModelForSpeaker(engine: DebateEngineInternals, speaker: string): string {
  return engine.config.speakerModels?.[speaker] ?? engine.config.model;
}

export function buildFailoverChain(engine: DebateEngineInternals, primaryModel: string): string[] {
  const chain = [primaryModel];
  if (engine.config.fallbackChain) {
    for (const m of engine.config.fallbackChain) {
      if (!chain.includes(m)) chain.push(m);
    }
  }
  if (!chain.includes(engine.config.model)) chain.push(engine.config.model);
  if (engine.config.maxModelId) {
    const maxRank = modelTierRank(engine.config.maxModelId);
    return chain.filter(m => modelTierRank(m) <= maxRank);
  }
  return chain;
}
