// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export type { GenerateOptions, ProviderResult, TokenUsage, RateLimitType, RateLimitHeaders, RetryProgress, BackendId, ApiKeyBackend, FetchFn, ToolDefinition, ToolCall, ToolResult, ModelCapabilities, UrlContextEntry, UrlContextMetadata, GeminiContentPart, GeminiContent } from './types.js';
export type { ModelEntry, ModelRegistry, ModelPricing } from './registry.js';
export { ALL_API_KEY_BACKENDS } from './types.js';
export { resolveBackend, resolveModel, buildModelIdMap, buildModelEntryMap, getApiModelId, getDefaultTimeout, getModelCapabilities, filterByCapabilities, estimateCost } from './registry.js';
export { withTimeout, withRetry, retryableFetch, parseRateLimitType, parseRateLimitHeaders, CLI_RETRY_CONFIG, SERVER_RETRY_CONFIG } from './retry.js';
export type { RetryConfig } from './retry.js';
export { generateViaGemini, generateViaGeminiStream, GEMINI_BASE, GEMINI_SAFETY_SETTINGS, toGeminiSchema } from './providers/gemini.js';
export { generateViaClaude } from './providers/claude.js';
export { generateViaGroq } from './providers/groq.js';
export { generateViaOpenAI } from './providers/openai.js';
export { generateViaAzure } from './providers/azure.js';
export { generateViaDeepSeek, generateViaDeepSeekStream } from './providers/deepseek.js';
export { generateViaOllama, isOllamaAvailable, OLLAMA_BASE } from './providers/ollama.js';
export { generateViaZai } from './providers/zai.js';
export { generateViaMoonshot } from './providers/moonshot.js';
export { TaskTier, resolveModelForPurpose, probeOllama, configureRouter, getRouterConfig, getTierForPurpose, PURPOSE_TIER_MAP, resolveMultiProviderModels } from './modelRouter.js';
export type { TaskPurpose, RouterConfig, RoutedModel, ModelTier } from './modelRouter.js';
export { callGeminiBatchEmbed } from './providers/gemini-embeddings.js';
export { geminiGroundedSearch } from './providers/gemini-search.js';
export type { GroundingSegment, GroundingCitation, GroundedSearchResult } from './providers/gemini-search.js';
export type { AIClientDeps, AIClient } from './client.js';
export { callProvider, createAIClient } from './client.js';
export { DEFAULT_MODEL, DEFAULT_TEMPERATURE } from './defaults.js';
export type { UsageConfig, UsageRegistry, UsageValidationError } from './usageTypes.js';
export { renderTemplate, loadUsageRegistry, validateUsageConfig } from './usageTypes.js';
export { loadModelRegistry } from './registry.js';
export type { UsageCallDeps } from './usageRegistry.js';
export { callByUsage, getUsage, listUsages, clearUsageRegistryCache } from './usageRegistry.js';
