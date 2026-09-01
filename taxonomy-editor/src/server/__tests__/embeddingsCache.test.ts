// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3085 — async embeddings cache hydration.
// Verifies: async load, promise coalescing (hydrate-once), ENOENT→warn (not info),
// and "embeddings.json loaded: N nodes" success signal.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted fns (must precede vi.mock calls — factories run at hoist time) ───

const { mockReadFile, frRecords, mockRecorder, readDataFileMock } = vi.hoisted(() => {
  const frRecords: Array<Record<string, unknown>> = [];
  const mockRecorder = { record: vi.fn((r: Record<string, unknown>) => { frRecords.push(r); }) };
  const mockReadFile = vi.fn<[string, string], Promise<string>>();
  const readDataFileMock = vi.fn();
  return { mockReadFile, frRecords, mockRecorder, readDataFileMock };
});

// ── Fake data ─────────────────────────────────────────────────────────────────

const FAKE_EMBEDDINGS = JSON.stringify({
  model: 'all-MiniLM-L6-v2',
  dimension: 384,
  node_count: 3,
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

vi.mock('../storage/readDataFile.js', () => ({ readDataFile: readDataFileMock }));
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

import { prewarmEmbeddingsCache, _resetEmbeddingsCacheForTest, getEmbeddingsResolution, EMBEDDINGS_RESOLUTION_CANARY } from '../ai/aiBackends.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('embeddingsCache async hydration (t/3085)', () => {
  beforeEach(() => {
    _resetEmbeddingsCacheForTest();
    frRecords.length = 0;
    mockRecorder.record.mockClear();
    mockReadFile.mockReset();
    readDataFileMock.mockReset();
  });

  it('ENOENT → resolves void without throwing', async () => {
    readDataFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(prewarmEmbeddingsCache()).resolves.toBeUndefined();
  });

  it('t/3085: ENOENT is recorded at warn level (not info)', async () => {
    readDataFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await prewarmEmbeddingsCache();
    const enoentRec = frRecords.find(r => typeof r.message === 'string' && r.message.includes('not found'));
    expect(enoentRec).toBeDefined();
    expect(enoentRec!.level).toBe('warn');
  });

  it('success → "embeddings.json loaded: N nodes" signal', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    const loaded = frRecords.find(r => typeof r.message === 'string' && r.message.includes('embeddings.json loaded'));
    expect(loaded).toBeDefined();
    expect(loaded!.message).toContain('3 nodes');
  });

  it('t/3085 hydrate-once: concurrent calls share one in-flight readFile', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await Promise.all([prewarmEmbeddingsCache(), prewarmEmbeddingsCache(), prewarmEmbeddingsCache()]);
    expect(readDataFileMock).toHaveBeenCalledTimes(1);
  });

  it('second sequential call is a cache hit (no second readFile)', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    readDataFileMock.mockClear();
    await prewarmEmbeddingsCache();
    expect(readDataFileMock).not.toHaveBeenCalled();
  });

  it('_resetEmbeddingsCacheForTest clears the cache (next call re-reads)', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    _resetEmbeddingsCacheForTest();
    readDataFileMock.mockClear();
    await prewarmEmbeddingsCache();
    expect(readDataFileMock).toHaveBeenCalledTimes(1);
  });
});

// t/3165 — getEmbeddingsResolution: presence != resolution. Asserts the canary keyed lookup
// hits a REAL EMBEDDING_DIM vector; a present-but-non-resolving cache (canary absent, or its
// vector empty/wrong-dim) → resolves:false. This is the /readyz + deploy-gate resolution core.
const withCanary = (vector: number[]) => JSON.stringify({
  model: 'all-MiniLM-L6-v2', dimension: 384, node_count: 2,
  nodes: { [EMBEDDINGS_RESOLUTION_CANARY]: { vector }, 'saf-beliefs-001': { vector } },
});
const VALID_384 = Array.from({ length: 384 }, (_v, i) => (i % 7) * 0.01 + 0.001); // non-zero, 384-dim

describe('getEmbeddingsResolution (t/3165)', () => {
  beforeEach(() => { _resetEmbeddingsCacheForTest(); readDataFileMock.mockReset(); });

  it('resolves:true when the canary node has a real 384-dim non-zero vector', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(withCanary(VALID_384)));
    await prewarmEmbeddingsCache();
    const r = getEmbeddingsResolution();
    expect(r.present).toBe(true);
    expect(r.resolves).toBe(true);
    expect(r.canaryId).toBe(EMBEDDINGS_RESOLUTION_CANARY);
  });

  it('resolves:false when the canary is ABSENT though the cache is loaded (stale/wrong corpus)', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(JSON.stringify({
      model: 'x', dimension: 384, node_count: 1, nodes: { 'some-other-001': { vector: VALID_384 } },
    })));
    await prewarmEmbeddingsCache();
    const r = getEmbeddingsResolution();
    expect(r.present).toBe(true);       // cache loaded (nodeCount>0)
    expect(r.nodeCount).toBe(1);
    expect(r.resolves).toBe(false);     // but the expected canary doesn't resolve
  });

  it('resolves:false when the canary vector is the wrong dimension', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(withCanary([0.1, 0.2, 0.3])));
    await prewarmEmbeddingsCache();
    expect(getEmbeddingsResolution().resolves).toBe(false);
  });

  it('resolves:false + present:false when the cache never loaded', () => {
    const r = getEmbeddingsResolution();
    expect(r.present).toBe(false);
    expect(r.resolves).toBe(false);
  });
});
