// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/3525 — the single normalization site (SO condition: "the mapping IS the feature"). Both arms
// per bucket, the absent-vs-'other' distinction, and the pairing invariant the FR forensics rely on.
import { describe, it, expect } from 'vitest';
import { normalizeStopReason } from './stopReason.js';
import type { StopReason } from '../types.js';

describe('normalizeStopReason — bucketing', () => {
  const cases: [string, StopReason][] = [
    // truncated at ceiling
    ['max_tokens', 'max_tokens'],        // Claude
    ['length', 'max_tokens'],            // chat completions
    ['MAX_TOKENS', 'max_tokens'],        // Gemini (case-insensitive)
    ['max_output_tokens', 'max_tokens'], // OpenAI Responses API
    // complete intended output
    ['end_turn', 'stop'],                // Claude
    ['stop_sequence', 'stop'],           // Claude — a REQUESTED stop is a normal completion
    ['stop', 'stop'],                    // chat completions
    ['STOP', 'stop'],                    // Gemini
    ['completed', 'stop'],               // OpenAI Responses API status
    // provider policy / safety
    ['SAFETY', 'content_filter'],        // Gemini
    ['RECITATION', 'content_filter'],    // Gemini
    ['content_filter', 'content_filter'],// OpenAI-compatible
    ['PROHIBITED_CONTENT', 'content_filter'],
    // tool / function stop
    ['tool_calls', 'other'],             // chat completions
    ['tool_use', 'other'],               // Claude
  ];
  for (const [raw, expected] of cases) {
    it(`maps "${raw}" → '${expected}'`, () => {
      expect(normalizeStopReason(raw)).toBe(expected);
    });
  }
});

describe('normalizeStopReason — absent vs. other', () => {
  it('returns undefined for null/undefined (provider reported NO reason — never fabricated)', () => {
    expect(normalizeStopReason(null)).toBeUndefined();
    expect(normalizeStopReason(undefined)).toBeUndefined();
  });

  it('returns undefined for empty / whitespace-only raw', () => {
    expect(normalizeStopReason('')).toBeUndefined();
    expect(normalizeStopReason('   ')).toBeUndefined();
  });

  it("maps a present-but-unrecognized native token to 'other' (NOT undefined, NEVER throws)", () => {
    expect(normalizeStopReason('some_future_reason')).toBe('other');
    expect(normalizeStopReason('MALFORMED_FUNCTION_CALL')).toBe('other');
  });

  it('is tolerant of surrounding whitespace on a real token', () => {
    expect(normalizeStopReason('  length  ')).toBe('max_tokens');
  });
});

describe('normalizeStopReason — pairing invariant (SO e/175#4)', () => {
  // The invariant the FR forensics depend on: any NON-EMPTY raw token normalizes to a non-undefined
  // value. `rawStopReason` set + `stopReason` undefined could then only be a caller bug, never a
  // mapping gap. This asserts it holds for both known and arbitrary unknown tokens.
  const raws = ['max_tokens', 'end_turn', 'SAFETY', 'tool_calls', 'x', 'brand_new_provider_reason', '¿?'];
  for (const raw of raws) {
    it(`"${raw}" (present) → non-undefined normalized value`, () => {
      expect(normalizeStopReason(raw)).not.toBeUndefined();
    });
  }
});
