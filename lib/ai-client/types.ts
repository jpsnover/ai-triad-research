// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  responseSchema?: Record<string, unknown>;
}

export interface ProviderResult {
  text: string;
  usage?: TokenUsage;
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
