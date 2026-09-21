// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Single normalization site (t/3525, SO-conditioned e/175#2): every provider adapter maps its
// native finish/stop token through THIS one tested function rather than an inline per-adapter
// switch — ten hand-rolled switches with different native vocabularies would drift. Keeping it in
// one place means one place to test and one place to extend when a provider ships a new reason.
import type { StopReason } from '../types.js';

// Native tokens → normalized bucket, matched case-insensitively. The per-provider native
// vocabularies are DISJOINT under case-folding (Claude/OpenAI are snake_case, Gemini is
// SHOUT_CASE, and no token means opposite things across providers), so a provider-agnostic
// table is unambiguous. If a future provider introduces a colliding token, thread the provider
// id in and branch here — not before (an unused param today is just noise).
const TABLE: Record<string, StopReason> = {
  // ── truncated at the output ceiling ──
  max_tokens: 'max_tokens',          // Claude
  length: 'max_tokens',              // OpenAI-compatible chat completions
  model_length: 'max_tokens',        // some OpenAI-compatible servers (vLLM/ollama)
  max_output_tokens: 'max_tokens',   // OpenAI Responses API (incomplete_details.reason)
  // ── complete intended output ──
  end_turn: 'stop',                  // Claude
  stop_sequence: 'stop',             // Claude — a REQUESTED stop is a normal completion
  stop: 'stop',                      // chat completions / Gemini "STOP"
  completed: 'stop',                 // OpenAI Responses API (status, when not truncated)
  // ── provider policy / safety / recitation ──
  content_filter: 'content_filter',  // OpenAI-compatible
  safety: 'content_filter',          // Gemini
  recitation: 'content_filter',      // Gemini
  blocklist: 'content_filter',       // Gemini
  prohibited_content: 'content_filter', // Gemini
  spii: 'content_filter',            // Gemini (sensitive personally identifiable info)
  image_safety: 'content_filter',    // Gemini
  // ── tool / function stop (a normal stop, but not "text complete") ──
  tool_calls: 'other',               // chat completions
  tool_use: 'other',                 // Claude
  function_call: 'other',            // legacy chat completions
};

/**
 * Normalize a provider-native finish/stop token to the shared {@link StopReason} enum.
 *
 * Contract (t/3525):
 *  - `null`/`undefined`/empty/whitespace-only raw → `undefined` (provider reported NO reason;
 *    never fabricate a value).
 *  - a recognized native token → its bucket.
 *  - a present-but-unrecognized token → `'other'` (NEVER throws, NEVER `undefined`).
 *
 * The last rule is the pairing invariant the FR forensics rely on: whenever `rawStopReason` is
 * set, this returns a non-undefined value, so `rawStopReason` set + `stopReason` undefined can
 * only mean a bug in the caller (raw captured but normalizer bypassed) — never a mapping gap.
 */
export function normalizeStopReason(raw: string | null | undefined): StopReason | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  return TABLE[trimmed.toLowerCase()] ?? 'other';
}
