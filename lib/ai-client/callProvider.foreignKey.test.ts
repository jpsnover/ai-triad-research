// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/4105 SO cond 5: `callProvider` is the one chokepoint every provider send passes, so the foreign-key guard
// lives there. A key that is another backend's named variable is refused BEFORE any request is made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FetchFn } from './types.js';
import { callProvider } from './client.js';

const VARS = ['GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
});
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('callProvider foreign-key guard (t/4105 C5, t/4087 parity)', () => {
  it("refuses another backend's credential before any fetch, naming the variable, never the key", async () => {
    process.env.GROQ_API_KEY = 'groq-placeholder';
    const fetchFn = vi.fn() as unknown as FetchFn;
    const err = await callProvider(fetchFn, 'claude', 'p', 'claude-haiku-4-5', 'groq-placeholder', { timeoutMs: 30_000 })
      .then(() => undefined, (e: unknown) => e as Error);
    expect(err).toBeDefined();
    expect(String(err)).toMatch(/value of GROQ_API_KEY/);
    expect(String(err)).not.toContain('groq-placeholder');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends the backend's own key", async () => {
    process.env.ANTHROPIC_API_KEY = 'claude-placeholder';
    const fetchFn = vi.fn(async () => ({
      ok: true, status: 200, body: null,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: {} }),
    } as unknown as Response)) as unknown as FetchFn;
    const r = await callProvider(fetchFn, 'claude', 'p', 'claude-haiku-4-5', 'claude-placeholder', { timeoutMs: 30_000 });
    expect(r.text).toBe('hi');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
