// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3175 — generateWithSearch paid-overflow arm (route level). Mirrors generateWithPaidFallback
// (t/3111): the free pool (explicitKey) is tried first via generateTextWithSearchByUsage; the
// paid key is reached ONLY on a free-tier 429 with the pool exhausted, exactly once, on the
// 'server.search:paid-fallback' usage — never in the primary call. No-op unless a paid key
// exists (GEMINI_PAID_KEY / t/3143). Uses fake timers for the deliberate 3s throttle.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSearchByUsage, mockIs429, mockGetPaidKey, frRecords, mockRecorder } = vi.hoisted(() => {
  const frRecords: Array<Record<string, unknown>> = [];
  return {
    mockSearchByUsage: vi.fn(),
    mockIs429: vi.fn(),
    mockGetPaidKey: vi.fn(),
    frRecords,
    mockRecorder: { record: vi.fn((r: Record<string, unknown>) => { frRecords.push(r); }) },
  };
});

vi.mock('../ai/aiBackends.js', () => ({
  generateTextWithSearchByUsage: mockSearchByUsage,
  is429Error: mockIs429,
  generateText: vi.fn(),
  generateTextByUsage: vi.fn(),
}));

vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return { ...actual, getPaidGeminiFallbackKey: mockGetPaidKey };
});

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => mockRecorder,
  setGlobalRecorder: vi.fn(),
}));

import { generateWithSearch } from '../routes/ai.js';

const CTX = { isFree: true, backend: 'gemini' as const, requestModel: 'gemini-3.5-flash-lite', t0: 0 };

describe('generateWithSearch — paid-overflow arm (t/3175)', () => {
  beforeEach(() => {
    frRecords.length = 0;
    mockSearchByUsage.mockReset();
    mockIs429.mockReset();
    mockGetPaidKey.mockReset();
    mockRecorder.record.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('free pool succeeds → returns result, paid key never consulted (no fallback)', async () => {
    mockSearchByUsage.mockResolvedValueOnce({ text: 'ok', citations: [] });
    const out = await generateWithSearch('claim', undefined, ['free1', 'free2'], CTX);
    expect(out.text).toBe('ok');
    expect(mockGetPaidKey).not.toHaveBeenCalled();
    expect(mockSearchByUsage).toHaveBeenCalledTimes(1);
    // primary call used the FREE pool key, on the base usage
    expect(mockSearchByUsage.mock.calls[0][0]).toBe('server.search');
    expect(mockSearchByUsage.mock.calls[0][3]).toEqual(['free1', 'free2']);
    expect(frRecords.some(r => r.type === 'ai.fallback')).toBe(false);
  });

  it('non-429 error → rethrows, paid NOT consulted (overflow only on 429)', async () => {
    mockSearchByUsage.mockRejectedValueOnce(new Error('boom'));
    mockIs429.mockReturnValue(false);
    await expect(generateWithSearch('claim', undefined, ['free1'], CTX)).rejects.toThrow('boom');
    expect(mockGetPaidKey).not.toHaveBeenCalled();
    expect(mockSearchByUsage).toHaveBeenCalledTimes(1);
  });

  it('free-tier 429 but no paid key configured → rethrows the original 429 (no-op until t/3143)', async () => {
    const err = Object.assign(new Error('429'), { status: 429 });
    mockSearchByUsage.mockRejectedValueOnce(err);
    mockIs429.mockReturnValue(true);
    mockGetPaidKey.mockResolvedValue(null);
    await expect(generateWithSearch('claim', undefined, ['free1'], CTX)).rejects.toThrow('429');
    expect(mockSearchByUsage).toHaveBeenCalledTimes(1); // no paid retry
  });

  it('non-free tier + 429 → does NOT reach the paid key (paid is a free-tier overflow only)', async () => {
    const err = Object.assign(new Error('429'), { status: 429 });
    mockSearchByUsage.mockRejectedValueOnce(err);
    mockIs429.mockReturnValue(true);
    await expect(generateWithSearch('claim', undefined, ['byok'], { ...CTX, isFree: false })).rejects.toThrow('429');
    expect(mockGetPaidKey).not.toHaveBeenCalled();
  });

  it('free-tier 429 + paid key → paid fallback fires ONCE with the paid key on the paid-fallback usage + records the signal', async () => {
    vi.useFakeTimers();
    const err = Object.assign(new Error('429'), { status: 429 });
    mockSearchByUsage
      .mockRejectedValueOnce(err)                           // free pool exhausted
      .mockResolvedValueOnce({ text: 'paid-ok', citations: [] }); // paid retry succeeds
    mockIs429.mockReturnValue(true);
    mockGetPaidKey.mockResolvedValue('paid-key');

    const p = generateWithSearch('claim', undefined, ['free1', 'free2'], CTX);
    await vi.advanceTimersByTimeAsync(3000); // the deliberate 3s throttle
    const out = await p;

    expect(out.text).toBe('paid-ok');
    expect(mockSearchByUsage).toHaveBeenCalledTimes(2);
    // call 1 = FREE pool on base usage; call 2 = PAID key on the paid-fallback usage
    expect(mockSearchByUsage.mock.calls[0][0]).toBe('server.search');
    expect(mockSearchByUsage.mock.calls[0][3]).toEqual(['free1', 'free2']);
    expect(mockSearchByUsage.mock.calls[1][0]).toBe('server.search:paid-fallback');
    expect(mockSearchByUsage.mock.calls[1][3]).toBe('paid-key'); // paid key never in the free pool array
    const fired = frRecords.find(r => r.type === 'ai.fallback');
    expect(fired).toBeDefined();
    expect((fired!.data as Record<string, unknown>).fallback).toBe('paid');
  });
});
