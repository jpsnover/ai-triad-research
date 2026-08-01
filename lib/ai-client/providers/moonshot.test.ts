// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { generateViaMoonshot } from './moonshot.js';
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
