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
}

export interface ProviderResult {
  text: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
}

export type RateLimitType = 'RPM' | 'TPM' | 'RPD' | 'unknown';

export interface RetryProgress {
  attempt: number;
  maxRetries: number;
  backoffSeconds: number;
  limitType: RateLimitType;
  limitMessage: string;
}

export type BackendId = 'gemini' | 'claude' | 'groq' | 'openai';

export type FetchFn = typeof globalThis.fetch;
