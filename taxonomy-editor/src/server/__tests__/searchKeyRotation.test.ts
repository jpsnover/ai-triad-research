// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3175 — generateTextWithSearch must route the Gemini grounded-search provider call
// through callWithKeyRotation + withRetry (parity with generateText), NOT hammer key[0].
// Before the fix, a debate round's search bursts exhausted ONE free-tier key → 429 while
// the rest of the pool sat idle. Both arms: 429-on-first-key rotates+recovers; a fully
// exhausted pool surfaces the 429 (for outer withRetry backoff); healthy search unchanged.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGroundedSearch } = vi.hoisted(() => ({ mockGroundedSearch: vi.fn() }));

// Real callWithKeyRotation (from keyRotator.js) — that's the mechanism under test. Mock only
// the provider call it invokes (geminiGroundedSearch) + keep withRetry a passthrough so a
// fully-429'd pool surfaces synchronously instead of sleeping through real backoff.
vi.mock('../../../../lib/ai-client/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/ai-client/index.js')>();
  return {
    ...actual,
    geminiGroundedSearch: mockGroundedSearch,
    withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()), // one pass — no real backoff sleeps
  };
});

// Heavy-dep silencers (prevent ONNX / Python / data init at import time).
vi.mock('../storage/readDataFile.js', () => ({ readDataFile: vi.fn(async () => Buffer.from('{}')) }));
vi.mock('../ai/fsCache.js', () => ({ readFileWithMtime: vi.fn(() => ({ content: '{}', mtimeMs: 1 })) }));
vi.mock('../../../../lib/embeddings/onnxEmbedding.js', () => ({
  warmup: vi.fn(async () => false), tryWarmup: vi.fn(async () => false),
  computeEmbedding: vi.fn(async () => []), computeEmbeddings: vi.fn(async () => []),
}));
vi.mock('../../../../lib/embeddings/embeddingResolver.js', () => ({ resolveEmbeddings: vi.fn(async () => []) }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }), setGlobalRecorder: vi.fn() }));
vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return { ...actual, getApiKey: vi.fn(async () => 'k1'), getProjectRoot: vi.fn(() => '/fake') };
});

import { generateTextWithSearch } from '../ai/aiBackends.js';
import { resetRotator } from '../ai/keyRotator.js';

const mk429 = () => Object.assign(new Error('429 Too Many Requests'), { status: 429 });
const POOL = ['k1', 'k2', 'k3'];

describe('generateTextWithSearch key rotation (t/3175)', () => {
  beforeEach(() => {
    resetRotator();
    mockGroundedSearch.mockReset();
    process.env.FREE_TIER_GEMINI_KEY = POOL.join(','); // makes the pool "all free" → rotation engages
  });
  afterEach(() => { delete process.env.FREE_TIER_GEMINI_KEY; });

  it('429 on the first key → ROTATES to the next and recovers (no surfaced failure)', async () => {
    const seen: string[] = [];
    mockGroundedSearch.mockImplementation(async (_fetch: unknown, _p: string, _m: string, key: string) => {
      seen.push(key);
      if (seen.length === 1) throw mk429();          // first key exhausted
      return { text: 'grounded answer', citations: [] };
    });
    const res = await generateTextWithSearch('verify this claim', 'gemini-3.5-flash-lite', POOL);
    expect(res.text).toBe('grounded answer');
    expect(seen.length).toBe(2);                     // rotated to a second key
    expect(seen[0]).not.toBe(seen[1]);               // a DIFFERENT key, not a retry on the same one
  });

  it('every key 429s → surfaces the 429 (so outer withRetry can back off), tried each key once', async () => {
    mockGroundedSearch.mockRejectedValue(mk429());
    await expect(generateTextWithSearch('claim', 'gemini-3.5-flash-lite', POOL)).rejects.toMatchObject({ status: 429 });
    expect(mockGroundedSearch).toHaveBeenCalledTimes(POOL.length); // rotated through the whole pool
  });

  it('healthy search returns text + citations unchanged (regression)', async () => {
    mockGroundedSearch.mockResolvedValue({ text: 'ok', citations: [{ uri: 'u', title: 't', segments: [] }] });
    const res = await generateTextWithSearch('claim', 'gemini-3.5-flash-lite', POOL);
    expect(res.text).toBe('ok');
    expect(res.citations).toEqual([{ uri: 'u', title: 't', segments: [] }]);
    expect(mockGroundedSearch).toHaveBeenCalledTimes(1);
  });
});
