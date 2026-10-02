// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { generateViaMoonshot, MOONSHOT_DEFAULT_MAX_TOKENS } from './moonshot.js';
import type { GenerateOptions } from '../types.js';

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

const OK = { choices: [{ message: { content: 'hi' } }], usage: { total_tokens: 3 } };
const opts = (o: Partial<GenerateOptions> = {}): GenerateOptions => ({ timeoutMs: 30_000, ...o });
const bodyOf = (fetchFn: ReturnType<typeof vi.fn>) => JSON.parse(fetchFn.mock.calls[0][1].body);

describe('generateViaMoonshot — 400 temperature-error next steps (t/2069)', () => {
  it('surfaces fixedTemperature guidance when the 400 body mentions temperature', async () => {
    const body = { error: { message: 'invalid temperature: only 1 is allowed for this model' } };
    const fetchFn = mockFetch(400, body);
    await expect(generateViaMoonshot(fetchFn, 'p', 'kimi-k3', 'key', opts())).rejects.toMatchObject({
      nextSteps: expect.arrayContaining([expect.stringContaining('fixedTemperature')]),
    });
  });

  it('falls back to generic next steps for non-temperature 400s', async () => {
    const fetchFn = mockFetch(400, { error: { message: 'invalid api key' } });
    await expect(generateViaMoonshot(fetchFn, 'p', 'kimi-k3', 'key', opts())).rejects.toMatchObject({
      nextSteps: expect.arrayContaining([expect.stringContaining('API key')]),
    });
  });
});

describe('generateViaMoonshot — temperature enforcement (t/2068)', () => {
  it('sends fixedTemperature verbatim, overriding a caller temperature (kimi-k3 needs exactly 1)', async () => {
    const fetchFn = mockFetch(200, OK);
    await generateViaMoonshot(fetchFn, 'p', 'kimi-k3', 'key', opts({ temperature: 0.7, fixedTemperature: 1 }));
    expect(bodyOf(fetchFn).temperature).toBe(1); // NOT 0.7 — the constraint wins
  });

  it('uses the caller temperature when no fixedTemperature is set', async () => {
    const fetchFn = mockFetch(200, OK);
    await generateViaMoonshot(fetchFn, 'p', 'moonshot-other', 'key', opts({ temperature: 0.3 }));
    expect(bodyOf(fetchFn).temperature).toBe(0.3);
  });

  it('defaults to 0.7 when neither fixedTemperature nor temperature is set', async () => {
    const fetchFn = mockFetch(200, OK);
    await generateViaMoonshot(fetchFn, 'p', 'moonshot-other', 'key', opts());
    expect(bodyOf(fetchFn).temperature).toBe(0.7);
  });
});

describe('generateViaMoonshot — reasoning budget (2026-10-02 kimi-k3 dump)', () => {
  const exhausted = {
    choices: [{ message: { content: '', reasoning_content: 'Let me analyze the order...' }, finish_reason: 'length' }],
    usage: { completion_tokens: 32000 },
  };

  it('default max_tokens is the 32k clampMaxTokens ceiling', async () => {
    const fetchFn = mockFetch(200, OK);
    await generateViaMoonshot(fetchFn, 'p', 'kimi-k3', 'key', opts());
    expect(bodyOf(fetchFn).max_tokens).toBe(MOONSHOT_DEFAULT_MAX_TOKENS);
    expect(MOONSHOT_DEFAULT_MAX_TOKENS).toBe(32_000);
  });

  it('caller maxTokens is honoured', async () => {
    const fetchFn = mockFetch(200, OK);
    await generateViaMoonshot(fetchFn, 'p', 'kimi-k3', 'key', opts({ maxTokens: 4000 }));
    expect(bodyOf(fetchFn).max_tokens).toBe(4000);
  });

  it('names reasoning exhaustion when 0 output chars + finish_reason length + reasoning_content', async () => {
    const fetchFn = mockFetch(200, exhausted);
    await expect(generateViaMoonshot(fetchFn, 'p', 'kimi-k3', 'key', opts())).rejects.toMatchObject({
      problem: expect.stringContaining('exhausted token budget on reasoning_content'),
    });
  });

  it('plain truncation without reasoning_content is NOT relabelled — returns max_tokens stopReason', async () => {
    const fetchFn = mockFetch(200, { choices: [{ message: { content: '{"partial":' }, finish_reason: 'length' }] });
    const r = await generateViaMoonshot(fetchFn, 'p', 'kimi-k3', 'key', opts());
    expect(r.stopReason).toBe('max_tokens');
    expect(r.text).toBe('{"partial":');
  });
});
