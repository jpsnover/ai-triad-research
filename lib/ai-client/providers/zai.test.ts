// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// Z.AI reasoning-budget handling: GLM bills reasoning_content against max_tokens, so a debate brief
// could reason to the cap and return 0 output chars (2026-10-02 dump). Both arms of each decision
// (reasoning default/low, retry taken/not taken) are asserted on the wire body.
import { describe, it, expect } from 'vitest';
import type { FetchFn } from '../types.js';
import { generateViaZai, ZAI_DEFAULT_MAX_TOKENS } from './zai.js';

interface Sent { thinking?: unknown; reasoning_effort?: string; max_tokens?: number }

const ok = { choices: [{ message: { content: 'brief' }, finish_reason: 'stop' }], usage: { completion_tokens: 5 } };
const exhausted = { choices: [{ message: { content: '', reasoning_content: 'Let me analyze...' }, finish_reason: 'length' }], usage: { completion_tokens: 32000 } };

function scriptedFetch(bodies: unknown[]): { fetchFn: FetchFn; sent: Sent[] } {
  const sent: Sent[] = [];
  let i = 0;
  const fetchFn: FetchFn = async (_url, init) => {
    sent.push(JSON.parse(String((init as RequestInit).body)));
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return { ok: true, status: 200, text: async () => JSON.stringify(body), body: null } as unknown as Response;
  };
  return { fetchFn, sent };
}

describe('generateViaZai — reasoning budget', () => {
  it('free-text call: provider-default reasoning (no control sent), default max_tokens is the 32k ceiling', async () => {
    const { fetchFn, sent } = scriptedFetch([ok]);
    const r = await generateViaZai(fetchFn, 'p', 'glm-5.3', 'k', { timeoutMs: 5000 });
    expect(r.text).toBe('brief');
    expect(sent).toHaveLength(1);
    expect(sent[0].reasoning_effort).toBeUndefined();
    expect(sent[0].thinking).toBeUndefined(); // glm-5.3 rejects thinking:disabled (1210) — never sent
    expect(sent[0].max_tokens).toBe(ZAI_DEFAULT_MAX_TOKENS);
    expect(ZAI_DEFAULT_MAX_TOKENS).toBe(32_000);
  });

  it('caller maxTokens is honoured', async () => {
    const { fetchFn, sent } = scriptedFetch([ok]);
    await generateViaZai(fetchFn, 'p', 'glm-5.3', 'k', { timeoutMs: 5000, maxTokens: 2048 });
    expect(sent[0].max_tokens).toBe(2048);
  });

  it('structured call (jsonMode / responseSchema): reasoning_effort low', async () => {
    for (const opts of [{ jsonMode: true }, { responseSchema: { type: 'object' } }]) {
      const { fetchFn, sent } = scriptedFetch([ok]);
      await generateViaZai(fetchFn, 'p', 'glm-5.3', 'k', { timeoutMs: 5000, ...opts });
      expect(sent[0].reasoning_effort).toBe('low');
      expect(sent[0].thinking).toBeUndefined();
    }
  });

  it('reasoning exhausts the budget → retries once with reasoning_effort low and returns its text', async () => {
    const { fetchFn, sent } = scriptedFetch([exhausted, ok]);
    const r = await generateViaZai(fetchFn, 'p', 'glm-5.3', 'k', { timeoutMs: 5000 });
    expect(r.text).toBe('brief');
    expect(sent.map(s => s.reasoning_effort)).toEqual([undefined, 'low']);
  });

  it('retry also exhausted → throws the actionable error naming budget and reasoning mode', async () => {
    const { fetchFn, sent } = scriptedFetch([exhausted, exhausted]);
    await expect(generateViaZai(fetchFn, 'p', 'glm-5.3', 'k', { timeoutMs: 5000 }))
      .rejects.toThrow(/max_tokens: 32000, reasoning: low/);
    expect(sent).toHaveLength(2);
  });

  it('structured call that exhausts the budget is NOT retried (reasoning was already low)', async () => {
    const { fetchFn, sent } = scriptedFetch([exhausted]);
    await expect(generateViaZai(fetchFn, 'p', 'glm-5.3', 'k', { timeoutMs: 5000, jsonMode: true }))
      .rejects.toThrow(/exhausted token budget/);
    expect(sent).toHaveLength(1);
  });
});
