// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3085 — async embeddings cache hydration.
// Verifies: async load, promise coalescing (hydrate-once), ENOENT→warn (not info),
// and "embeddings.json loaded: N nodes" success signal.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted fns (must precede vi.mock calls — factories run at hoist time) ───

const { mockReadFile, frRecords, mockRecorder } = vi.hoisted(() => {
  const frRecords: Array<Record<string, unknown>> = [];
  const mockRecorder = { record: vi.fn((r: Record<string, unknown>) => { frRecords.push(r); }) };
  const mockReadFile = vi.fn<[string], Promise<Buffer>>();
  return { mockReadFile, frRecords, mockRecorder };
});

// ── Fake data ─────────────────────────────────────────────────────────────────

const FAKE_EMBEDDINGS = JSON.stringify({
  model: 'all-MiniLM-L6-v2',
  dimension: 384,
  node_count: 1000,
  nodes: { 'acc-bel-001': {}, 'saf-bel-001': {}, 'skp-bel-001': {} },
});

// ── FR record capture ─────────────────────────────────────────────────────────

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => mockRecorder,
  setGlobalRecorder: vi.fn(),
}));

// ── fs mock: default ENOENT, overridable per test ─────────────────────────────

vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  return { ...actual, default: { ...actual, promises: { ...actual.promises, readFile: mockReadFile } } };
});

// readDataFile imports 'fs/promises' directly; mock it so the large-file read path is intercepted.
vi.mock('fs/promises', async (importActual) => {
  const actual = await importActual<typeof import('fs/promises')>();
  return { ...actual, default: { ...actual, readFile: mockReadFile } };
});

// ── config mock ───────────────────────────────────────────────────────────────

vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return {
    ...actual,
    resolveDataPath: vi.fn(() => '/fake/data/taxonomy/Origin'),
    getProjectRoot: vi.fn(() => '/fake-root'),
    getApiKey: vi.fn(async () => 'fake-key'),
    getApiKeys: vi.fn(async () => ['fake-key']),
  };
});

// ── Remaining heavy mocks (prevent ONNX / Python init at import time) ─────────

vi.mock('../ai/fsCache.js', () => ({ readFileWithMtime: vi.fn(() => ({ content: '{}', mtimeMs: 1 })) }));
vi.mock('../../../../lib/embeddings/onnxEmbedding.js', () => ({
  warmup: vi.fn(async () => false),
  tryWarmup: vi.fn(async () => false),
  computeEmbedding: vi.fn(async () => []),
  computeEmbeddings: vi.fn(async () => []),
}));
vi.mock('../../../../lib/embeddings/embeddingResolver.js', () => ({
  resolveEmbeddings: vi.fn(async () => []),
}));
vi.mock('../../../../lib/search/tavily.js', () => ({
  tavilySearch: vi.fn(),
  buildSearchAugmentedPrompt: vi.fn(),
}));
vi.mock('../../../../lib/ai-client/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/ai-client/index.js')>();
  return { ...actual, callProvider: vi.fn(), withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) };
});

// ── Imports after mocks ───────────────────────────────────────────────────────

import { prewarmEmbeddingsCache, _resetEmbeddingsCacheForTest } from '../ai/aiBackends.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('embeddingsCache async hydration (t/3085)', () => {
  beforeEach(() => {
    _resetEmbeddingsCacheForTest();
    frRecords.length = 0;
    mockRecorder.record.mockClear();
    mockReadFile.mockReset();
  });

  it('ENOENT → resolves void without throwing', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);
    await expect(prewarmEmbeddingsCache()).resolves.toBeUndefined();
  });

  it('t/3085: ENOENT is recorded at warn level (not info)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);
    await prewarmEmbeddingsCache();
    const enoentRec = frRecords.find(r => typeof r.message === 'string' && r.message.includes('unavailable'));
    expect(enoentRec).toBeDefined();
    expect(enoentRec!.level).toBe('warn');
  });

  it('success → "embeddings.json loaded: N nodes" signal', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    const loaded = frRecords.find(r => typeof r.message === 'string' && r.message.includes('embeddings.json loaded'));
    expect(loaded).toBeDefined();
    expect(loaded!.message).toContain('3 nodes');
  });

  it('t/3085 hydrate-once: concurrent calls share one in-flight readFile', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await Promise.all([prewarmEmbeddingsCache(), prewarmEmbeddingsCache(), prewarmEmbeddingsCache()]);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('second sequential call is a cache hit (no second readFile)', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    mockReadFile.mockClear();
    await prewarmEmbeddingsCache();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('_resetEmbeddingsCacheForTest clears the cache (next call re-reads)', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    _resetEmbeddingsCacheForTest();
    mockReadFile.mockClear();
    await prewarmEmbeddingsCache();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});
