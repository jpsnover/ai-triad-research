// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateAudience, DebatePhase, SpeakerId } from './types.js';
import type { GenerateOptions } from './aiAdapter.js';

export type PromptType =
  | 'brief' | 'plan' | 'draft' | 'cite'
  | 'moderator' | 'synth_extract' | 'synth_map' | 'synth_evaluate'
  | 'clarification' | 'summarization' | 'gap_injection'
  | 'missing_args' | 'taxonomy_refinement' | 'legacy_monolithic';

export interface PromptEnvelope {
  layer1_static: string;
  layer2_persona: string;
  layer3_turn: string;
  layer4_variable: string;
  meta: {
    promptType: PromptType;
    persona?: SpeakerId;
    audience?: DebateAudience;
    phase?: DebatePhase;
    layer1Hash?: string;
  };
}

export interface CacheHint {
  cacheableLayers?: (1 | 2 | 3)[];
  extendedTtl?: boolean;
}

export interface CacheUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  uncachedInputTokens: number;
  cacheHitRatio: number;
  raw?: Record<string, unknown>;
}

export interface GenerateRequest {
  envelope: PromptEnvelope;
  model: string;
  options: GenerateOptions;
  cacheHint?: CacheHint;
}

export interface GenerateResponse {
  text: string;
  usage: CacheUsage;
  model: string;
  backend: string;
  responseTimeMs: number;
}

export interface LLMBackend {
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  generateText(prompt: string, model: string, options?: GenerateOptions): Promise<string>;
}

export function emptyCacheUsage(): CacheUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    uncachedInputTokens: 0,
    cacheHitRatio: 0,
  };
}

export function buildCacheUsage(raw: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  rawFields?: Record<string, unknown>;
}): CacheUsage {
  const input = raw.inputTokens ?? 0;
  const output = raw.outputTokens ?? 0;
  const read = raw.cacheReadTokens ?? 0;
  const write = raw.cacheWriteTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    uncachedInputTokens: Math.max(0, input - read - write),
    cacheHitRatio: input > 0 ? read / input : 0,
    raw: raw.rawFields,
  };
}

export function flattenEnvelope(env: PromptEnvelope): string {
  return [env.layer1_static, env.layer2_persona, env.layer3_turn, env.layer4_variable]
    .filter(s => s.length > 0)
    .join('\n\n');
}
