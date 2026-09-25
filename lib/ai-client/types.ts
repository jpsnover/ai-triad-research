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
  /** The caller's requested friendlyId (t/3677) — threaded so the response-boundary identity
   *  record can report `{requested, apiModelIdSent, providerReported}`. Optional; absent is fine. */
  requestedModelId?: string;
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

/**
 * Normalized provider finish reason (t/3525). The axis is "is `text` the complete intended
 * output?" — consumers act on this, never on a provider-native token:
 *  - `'stop'`          — complete intended output; the model finished on its own terms
 *                        (includes Claude `stop_sequence` — a requested stop is a normal stop).
 *  - `'max_tokens'`    — TRUNCATED at the output ceiling. Callers MUST NOT parse the partial
 *                        output; the fix is raise maxTokens / shorten the prompt.
 *  - `'content_filter'`— provider policy/safety/recitation stop. Text is incomplete for a reason
 *                        raising maxTokens will NOT fix; the right message is "blocked by policy".
 *  - `'other'`         — tool-stop or a native reason not (yet) recognized by the mapping table.
 *
 * `undefined` (absent) is DISTINCT from `'other'`: absent = the provider reported no reason, or
 * the parse site predates this field; `'other'` = a reason WAS reported but is unmapped. Never
 * fabricate `'stop'` when the native reason is missing. Invariant: if a native token was present,
 * the normalized value is non-undefined (a present-but-unmapped token is `'other'`, never absent).
 */
export type StopReason = 'stop' | 'max_tokens' | 'content_filter' | 'other';

/**
 * Per-call provider diagnostics (t/3566) — captured by `fetchWithDiagnostics` and surfaced on
 * {@link ProviderResult.diagnostics} for the flight recorder. Splits the fetch (time to response
 * headers) from the body read so a hung request is distinguishable from slow generation, and records
 * request/response byte sizes + xAI's free server-timing headers when present.
 *
 * FORENSICS ONLY — same status as `rawStopReason`/`rawResponsePreview`: the flight recorder reads it,
 * NO consumer branches on it. This is why the field is SO-exempt (t/3566#2). THE EXEMPTION LAPSES the
 * moment any code path reads `diagnostics` to make a DECISION (routing, retry, fallback, thresholds):
 * at that point it becomes part of the consumer contract and a Second Opinion is required for the
 * change that introduces the read. Keep it write-only-to-the-recorder.
 */
export interface ProviderCallDiagnostics {
  /** UTF-8 bytes of the serialized request body actually sent. */
  requestBytes: number;
  /** HTTP status of the response (200 on success; error paths throw before a ProviderResult). */
  httpStatus: number;
  /** ms from fetch start until response headers arrived — a hung request shows here. */
  headersMs: number;
  /** ms spent reading the response body after headers — slow generation shows here. */
  bodyReadMs: number;
  /** Provider-reported time-to-first-token (xAI `x-metrics-ttft-ms`); absent when unsupported. */
  ttftMs?: number;
  /** Provider-reported end-to-end time (xAI `x-metrics-e2e-ms`); absent when unsupported. */
  e2eMs?: number;
  /** UTF-8 bytes of the response body read. */
  responseBytes: number;
}

export interface ProviderResult {
  text: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
  estimatedCostUsd?: number;
  /** First 200 chars of raw API response body when content is empty — aids FR diagnosis. */
  rawResponsePreview?: string;
  /** Per-call fetch/read diagnostics (t/3566) — flight-recorder forensics ONLY, not the consumer
   *  contract. See {@link ProviderCallDiagnostics} for the SO-exemption-lapse condition. */
  diagnostics?: ProviderCallDiagnostics;
  /** Gemini URL-context grounding metadata — present when `urlContext` was enabled. */
  urlContextMetadata?: UrlContextMetadata;
  /** Normalized finish reason (t/3525). See {@link StopReason}. Undefined when the provider
   *  reported no native reason (never fabricated). Consumers act on THIS, not `rawStopReason`. */
  stopReason?: StopReason;
  /** Raw provider-native finish token (e.g. Claude `"end_turn"`, Gemini `"SAFETY"`, OpenAI
   *  `"max_output_tokens"`) — flight-recorder forensics ONLY, NOT part of the consumer contract.
   *  Mirrors the `rawResponsePreview` FR-diagnostic convention. The FR `ai.response` event records
   *  this so a future unmapped native reason is diagnosable behind an `'other'` normalization. */
  rawStopReason?: string;
  /** The model id the PROVIDER reported serving (gemini `modelVersion`, claude / OpenAI-compat
   *  response `model`) — t/3677 Phase 1. `undefined` when the provider returns none; NEVER
   *  fabricated (never an echo of the sent id — that would invent the reading it exists to record).
   *  Captured at `callProvider` into the `ai.model_identity` FR event. Phase 1 is log-only: NO
   *  consumer branches on it (the warn-on-divergence classifier is deferred to Phase 2/3, calibrated
   *  on observed data with a registry cross-check — t/3677#5). While nothing branches on it, it is
   *  forensics, like `diagnostics`/`rawStopReason`. */
  providerReportedModel?: string;
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

export type BackendId = 'gemini' | 'claude' | 'groq' | 'openai' | 'azure' | 'ollama' | 'deepseek' | 'zai' | 'moonshot' | 'xai';

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
  xai: true,
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
