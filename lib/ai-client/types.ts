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
}

export interface ProviderResult {
  text: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
  estimatedCostUsd?: number;
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

export type BackendId = 'gemini' | 'claude' | 'groq' | 'openai' | 'azure' | 'ollama' | 'deepseek';

/** Superset of BackendId that includes non-generation backends needing API key management (e.g. tavily for search). */
export type ApiKeyBackend = BackendId | 'tavily';

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
}

export type FetchFn = typeof globalThis.fetch;
