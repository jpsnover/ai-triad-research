// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  id: string; // provider-assigned call ID
}

export interface ToolResult {
  id: string;
  content: string; // JSON-serialized result
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  responseSchema?: Record<string, unknown>;
  systemMessage?: string;
  tools?: ToolDefinition[];
  /** Task purpose for tiered model routing (e.g., 'summarization', 'draft'). */
  purpose?: string;
  /** Maximum accumulated cost (USD) before subsequent calls throw a budget-exceeded error. */
  maxCostUsd?: number;
  /** Provider MUST send exactly this temperature, overriding `temperature`. Set from the
   *  registry (ModelEntry.fixedTemperature) for reasoning models that reject arbitrary
   *  values, e.g. moonshot kimi-k3 which only accepts 1 (t/2068). */
  fixedTemperature?: number;
}

export interface ProviderResult {
  text: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
  estimatedCostUsd?: number;
  /** First 200 chars of raw API response body when content is empty — aids FR diagnosis. */
  rawResponsePreview?: string;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
}

export type RateLimitType = 'RPM' | 'TPM' | 'RPD' | 'unknown';

export interface RateLimitHeaders {
  retryAfterSeconds?: number;
  remaining?: number;
  resetAtEpochSeconds?: number;
}

export interface RetryProgress {
  attempt: number;
  maxRetries: number;
  backoffSeconds: number;
  limitType: RateLimitType;
  limitMessage: string;
  rateLimitHeaders?: RateLimitHeaders;
}

export type BackendId = 'gemini' | 'claude' | 'groq' | 'openai' | 'azure' | 'ollama' | 'deepseek' | 'zai' | 'moonshot';

/** Superset of BackendId that includes non-generation backends needing API key management (e.g. tavily for search). */
export type ApiKeyBackend = BackendId | 'tavily';

/**
 * Exhaustive map of every API-key backend. `Record<ApiKeyBackend, true>` forces
 * every union member to be present, so adding a backend to `BackendId`/`ApiKeyBackend`
 * without adding it here is a COMPILE ERROR — not a silent omission. This is the
 * source of truth; do not hand-maintain parallel backend arrays (t/1956).
 */
const ALL_API_KEY_BACKENDS_MAP: Record<ApiKeyBackend, true> = {
  gemini: true,
  claude: true,
  groq: true,
  openai: true,
  azure: true,
  ollama: true,
  deepseek: true,
  zai: true,
  moonshot: true,
  tavily: true,
};

/** Canonical, exhaustive list of all API-key backends. Derived from {@link ALL_API_KEY_BACKENDS_MAP}. */
export const ALL_API_KEY_BACKENDS = Object.keys(ALL_API_KEY_BACKENDS_MAP) as ApiKeyBackend[];

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
}

export type FetchFn = typeof globalThis.fetch;
