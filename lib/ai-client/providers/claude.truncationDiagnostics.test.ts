// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/4118: a truncated Claude response must let a flight-recorder reader tell THINKING EXHAUSTION apart
// from a LONG ANSWER without byte arithmetic. The fields ride `diagnostics`, the field that crosses IPC
// to the desktop bridge's ai.response event (t/3569) and that the CLI's ai.response already records.

import { describe, it, expect } from 'vitest';
import { generateViaClaude, claudeOutputDiagnostics } from './claude.js';
import type { FetchFn } from '../types.js';

let sentBody: { max_tokens?: number } = {};
function claudeReturning(body: unknown): FetchFn {
  return (async (_url: string, init?: { body?: unknown }) => {
    sentBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body), body: null } as unknown as Response;
  }) as unknown as FetchFn;
}
const OPTS = { timeoutMs: 30_000, maxTokens: 8192 };

describe('Claude output-budget diagnostics (t/4118)', () => {
  it('ACCEPTANCE: a response truncated by thinking says so, with the numbers, no arithmetic needed', async () => {
    const thinking = 'x'.repeat(21_855);
    const r = await generateViaClaude(claudeReturning({
      content: [{ type: 'thinking', thinking, signature: 'sig' }, { type: 'text', text: 'y'.repeat(7_619) }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 9000, output_tokens: 8192 },
    }), 'p', 'claude-haiku-5-5', 'k', OPTS);

    expect(r.stopReason).toBe('max_tokens'); // still returned, not thrown, so diagnostics reach the FR
    expect(r.diagnostics).toMatchObject({
      rawStopReason: 'max_tokens',
      maxTokensSent: 8192,
      outputTokens: 8192,
      thinkingBlocks: 1,
      thinkingBytes: 21_855,
      thinkingByteShare: 0.74,
    });
    expect(r.diagnostics?.truncationCause).toMatch(/^Thinking exhausted the output budget: 8192 of max_tokens 8192 output tokens used; thinking was 74%/);
    expect(sentBody.max_tokens).toBe(8192); // maxTokensSent is what was actually sent
    expect(r.diagnostics?.requestBytes).toBeGreaterThan(0); // the fetch diagnostics are kept, not replaced
  });

  it('a long answer that hits the limit is named as a long answer, not as thinking', async () => {
    const r = await generateViaClaude(claudeReturning({
      content: [{ type: 'text', text: 'y'.repeat(30_000) }],
      stop_reason: 'max_tokens',
      usage: { output_tokens: 8192 },
    }), 'p', 'claude-sonnet-4-6', 'k', OPTS);
    expect(r.diagnostics).toMatchObject({ thinkingBlocks: 0, thinkingBytes: 0, thinkingByteShare: 0 });
    expect(r.diagnostics?.truncationCause).toMatch(/^A long answer exhausted the output budget/);
  });

  it('a normal reply carries the budget numbers but no truncationCause', async () => {
    const r = await generateViaClaude(claudeReturning({
      content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { output_tokens: 3 },
    }), 'p', 'claude-haiku-4-5', 'k', OPTS);
    expect(r.diagnostics).toMatchObject({ rawStopReason: 'end_turn', maxTokensSent: 8192, outputTokens: 3, thinkingBlocks: 0 });
    expect(r.diagnostics?.truncationCause).toBeUndefined();
  });

  it('redacted_thinking blocks count as thinking (their data payload is measured)', () => {
    const d = claudeOutputDiagnostics(
      [{ type: 'redacted_thinking', data: 'z'.repeat(900) }, { type: 'thinking', thinking: 'a'.repeat(100) }, { type: 'text' }],
      'b'.repeat(1000), 4000, 'max_tokens', 4000,
    );
    expect(d).toMatchObject({ thinkingBlocks: 2, thinkingBytes: 1000, thinkingByteShare: 0.5 });
    expect(d.truncationCause).toMatch(/^Thinking exhausted/); // 0.5 counts as thinking-dominated
  });

  it('the default max_tokens (no opts.maxTokens) is what gets recorded', async () => {
    const r = await generateViaClaude(claudeReturning({
      content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: {},
    }), 'p', 'claude-haiku-4-5', 'k', { timeoutMs: 30_000 });
    expect(r.diagnostics?.maxTokensSent).toBe(sentBody.max_tokens);
    expect(r.diagnostics?.outputTokens).toBeUndefined(); // not reported, never fabricated
  });
});
