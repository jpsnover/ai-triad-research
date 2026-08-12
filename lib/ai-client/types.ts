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
  /** Caller-provided AbortSignal to cancel the request and all retry attempts (t/2507). */
  signal?: AbortSignal;
  /** Gemini only: enable URL-context grounding. When set, the provider adds the
   *  `url_context` tool entry so Gemini fetches URLs mentioned in the prompt. */
  urlContext?: boolean;
  /** Gemini only: pre-built multi-turn contents array for chat streaming.
   *  When provided, replaces the default single-turn `[{ parts: [{ text: prompt }] }]`
   *  construction so callers can pass conversation history directly. */
  geminiContents?: GeminiContent[];
}

export interface GeminiContentPart {
  text: string;
}

export interface GeminiContent {
  role: string;
  parts: GeminiContentPart[];
}

export interface UrlContextEntry {
  retrievedUrl: string;
  urlRetrievalStatus: string;
  /** Whether the entry came from the provider's grounding response or was fetched by the app. */
  source?: 'provider' | 'app-fetch';
  /** Whether the retrieved content was truncated before storage. */
  truncated?: boolean;
}

export interface UrlContextMetadata {
  urlMetadata: UrlContextEntry[];
}

export interface ProviderResult {
  text: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
  estimatedCostUsd?: number;
  /** First 200 chars of raw API response body when content is empty — aids FR diagnosis. */
  rawResponsePreview?: string;
  /** Gemini URL-context grounding metadata — present when `urlContext` was enabled. */
  urlContextMetadata?: UrlContextMetadata;
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
