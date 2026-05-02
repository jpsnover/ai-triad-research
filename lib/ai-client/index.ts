// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type { GenerateOptions, ProviderResult, TokenUsage, RateLimitType, RetryProgress, BackendId, FetchFn } from './types.js';
export type { ModelEntry, ModelRegistry } from './registry.js';
export { resolveBackend, resolveModel, buildModelIdMap, getApiModelId } from './registry.js';
export { withTimeout, withRetry, retryableFetch, parseRateLimitType, CLI_RETRY_CONFIG, SERVER_RETRY_CONFIG } from './retry.js';
export type { RetryConfig } from './retry.js';
export { generateViaGemini, GEMINI_BASE, GEMINI_SAFETY_SETTINGS, toGeminiSchema } from './providers/gemini.js';
export { generateViaClaude } from './providers/claude.js';
export { generateViaGroq } from './providers/groq.js';
export { generateViaOpenAI } from './providers/openai.js';
export { callGeminiBatchEmbed } from './providers/gemini-embeddings.js';
export { geminiGroundedSearch } from './providers/gemini-search.js';
export type { GroundingSegment, GroundingCitation, GroundedSearchResult } from './providers/gemini-search.js';
export type { AIClientDeps, AIClient } from './client.js';
export { callProvider, createAIClient } from './client.js';
