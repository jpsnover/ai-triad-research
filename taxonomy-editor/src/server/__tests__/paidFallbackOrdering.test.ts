// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3111 — generateWithPaidFallback ordering + paid-fired signal.
// Verifies the free-pool-primary / paid-overflow shape (t/948): the free pool (explicitKey)
// is ALWAYS tried first; the paid key is reached ONLY on a free-tier 429, and never enters
// the primary call. Also asserts the `ai.fallback` "paid fired" signal.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGenerateTextByUsage, mockIs429, mockGetPaidKey, frRecords, mockRecorder } = vi.hoisted(() => {
  const frRecords: Array<Record<string, unknown>> = [];
  return {
    mockGenerateTextByUsage: vi.fn(),
    mockIs429: vi.fn(),
    mockGetPaidKey: vi.fn(),
    frRecords,
    mockRecorder: { record: vi.fn((r: Record<string, unknown>) => { frRecords.push(r); }) },
  };
});

vi.mock('../ai/aiBackends.js', () => ({
  generateTextByUsage: mockGenerateTextByUsage,
  is429Error: mockIs429,
  generateText: vi.fn(),
}));

vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return { ...actual, getPaidGeminiFallbackKey: mockGetPaidKey };
});

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => mockRecorder,
  setGlobalRecorder: vi.fn(),
}));

import { generateWithPaidFallback } from '../routes/ai.js';

const CTX = { isFree: true, backend: 'gemini' as const, requestModel: 'gemini-3.5-flash-lite', t0: 0 };

describe('generateWithPaidFallback — free-primary / paid-overflow ordering (t/3111)', () => {
  beforeEach(() => {
    frRecords.length = 0;
    mockGenerateTextByUsage.mockReset();
    mockIs429.mockReset();
    mockGetPaidKey.mockReset();
    mockRecorder.record.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('free pool succeeds → returns result, paid key never consulted (no fallback)', async () => {
    mockGenerateTextByUsage.mockResolvedValueOnce({ text: 'ok' });
    const out = await generateWithPaidFallback('p', {}, ['free1', 'free2'], CTX);
    expect(out).toEqual({ text: 'ok' });
    expect(mockGetPaidKey).not.toHaveBeenCalled();          // paid never reached on success
    expect(mockGenerateTextByUsage).toHaveBeenCalledTimes(1);
    // First (only) call used the FREE pool key, not a paid key.
    expect(mockGenerateTextByUsage.mock.calls[0][4]).toEqual(['free1', 'free2']);
    expect(frRecords.some(r => r.type === 'ai.fallback')).toBe(false);
  });

  it('non-429 error → rethrows, paid fallback NOT triggered (ordering: paid only on 429)', async () => {
    const err = new Error('boom');
    mockGenerateTextByUsage.mockRejectedValueOnce(err);
    mockIs429.mockReturnValue(false);
    await expect(generateWithPaidFallback('p', {}, ['free1'], CTX)).rejects.toThrow('boom');
    expect(mockGetPaidKey).not.toHaveBeenCalled();
    expect(mockGenerateTextByUsage).toHaveBeenCalledTimes(1);
  });

  it('free-tier 429 but no paid key configured → rethrows original 429 (no fallback)', async () => {
    const err = Object.assign(new Error('429'), { status: 429 });
    mockGenerateTextByUsage.mockRejectedValueOnce(err);
    mockIs429.mockReturnValue(true);
    mockGetPaidKey.mockResolvedValue(null);
    await expect(generateWithPaidFallback('p', {}, ['free1'], CTX)).rejects.toThrow('429');
    expect(mockGenerateTextByUsage).toHaveBeenCalledTimes(1); // no paid retry
  });

  it('free-tier 429 + paid key → paid fallback fires ONCE with the paid key + records the signal', async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error('429'), { status: 429 });
    mockGenerateTextByUsage
      .mockRejectedValueOnce(err)                 // free pool exhausts
      .mockResolvedValueOnce({ text: 'paid-ok' }); // paid retry succeeds
    mockIs429.mockReturnValue(true);
    mockGetPaidKey.mockResolvedValue('paid-key');

    const p = generateWithPaidFallback('p', {}, ['free1', 'free2'], CTX);
    await vi.advanceTimersByTimeAsync(3000); // the deliberate 3s throttle
    const out = await p;

    expect(out).toEqual({ text: 'paid-ok' });
    expect(mockGenerateTextByUsage).toHaveBeenCalledTimes(2);
    // Ordering: call 1 = FREE pool; call 2 = PAID key (paid never in the primary/rotation).
    expect(mockGenerateTextByUsage.mock.calls[0][4]).toEqual(['free1', 'free2']);
    expect(mockGenerateTextByUsage.mock.calls[0][0]).toBe('server.chat-response');
    expect(mockGenerateTextByUsage.mock.calls[1][4]).toBe('paid-key');
    expect(mockGenerateTextByUsage.mock.calls[1][0]).toBe('server.chat-response:paid-fallback');
    // Paid-fired signal recorded.
    const fired = frRecords.find(r => r.type === 'ai.fallback');
    expect(fired).toBeDefined();
    expect((fired!.data as Record<string, unknown>).fallback).toBe('paid');
  });
});
