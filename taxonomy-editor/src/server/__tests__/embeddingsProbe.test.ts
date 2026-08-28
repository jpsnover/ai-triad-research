// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3086 — embeddings.json boot probe + cache hit/miss counters.
// Covers: getEmbeddingsCacheStatus (absent/present), computeEmbeddings
// returns { vectors, cacheHits, cacheMisses } with correct counts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted fns ───────────────────────────────────────────────────────────────

const { mockReadFile, mockRecorder, readDataFileMock } = vi.hoisted(() => {
  const mockRecorder = { record: vi.fn() };
  const mockReadFile = vi.fn<[string, string], Promise<string>>();
  const readDataFileMock = vi.fn();
  return { mockReadFile, mockRecorder, readDataFileMock };
});

// ── Fake data ─────────────────────────────────────────────────────────────────

const FAKE_EMBEDDINGS = JSON.stringify({
  model: 'all-MiniLM-L6-v2',
  dimension: 384,
  node_count: 3,
  nodes: {
    'acc-bel-001': { vector: Array(384).fill(0.1) },
    'saf-bel-001': { vector: Array(384).fill(0.2) },
    'skp-bel-001': { vector: Array(384).fill(0.3) },
  },
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => mockRecorder,
  setGlobalRecorder: vi.fn(),
}));

vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  return { ...actual, default: { ...actual, promises: { ...actual.promises, readFile: mockReadFile } } };
});

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

vi.mock('../storage/readDataFile.js', () => ({ readDataFile: readDataFileMock }));
vi.mock('../ai/fsCache.js', () => ({ readFileWithMtime: vi.fn(() => ({ content: '{}', mtimeMs: 1 })) }));
vi.mock('../../../../lib/embeddings/onnxEmbedding.js', () => ({
  warmup: vi.fn(async () => false),
  tryWarmup: vi.fn(async () => false),
  computeEmbedding: vi.fn(async () => []),
  computeEmbeddings: vi.fn(async () => []),
}));
vi.mock('../../../../lib/embeddings/embeddingResolver.js', () => ({
  resolveEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => Array(384).fill(0))),
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

import {
  prewarmEmbeddingsCache,
  _resetEmbeddingsCacheForTest,
  _setPythonAvailableForTest,
  getEmbeddingsCacheStatus,
  computeEmbeddings,
} from '../ai/aiBackends.js';

// ── getEmbeddingsCacheStatus ──────────────────────────────────────────────────

describe('getEmbeddingsCacheStatus (t/3086)', () => {
  beforeEach(() => {
    _resetEmbeddingsCacheForTest();
    _setPythonAvailableForTest(false);
    mockRecorder.record.mockClear();
    readDataFileMock.mockReset();
    vi.restoreAllMocks();
  });

  it('returns absent before any prewarm', () => {
    expect(getEmbeddingsCacheStatus()).toEqual({ present: false, nodeCount: null });
  });

  it('returns absent when file is missing (ENOENT)', async () => {
    readDataFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await prewarmEmbeddingsCache();
    expect(getEmbeddingsCacheStatus()).toEqual({ present: false, nodeCount: null });
  });

  it('returns present with nodeCount after successful load', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    expect(getEmbeddingsCacheStatus()).toEqual({ present: true, nodeCount: 3 });
  });
});

// ── computeEmbeddings hit/miss counters ───────────────────────────────────────

describe('computeEmbeddings cache_hits / cache_misses (t/3086)', () => {
  beforeEach(() => {
    _resetEmbeddingsCacheForTest();
    _setPythonAvailableForTest(false);
    mockRecorder.record.mockClear();
    readDataFileMock.mockReset();
    vi.restoreAllMocks();
  });

  it('all misses when file absent (cacheHits=0)', async () => {
    readDataFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await prewarmEmbeddingsCache();
    const result = await computeEmbeddings(['text1', 'text2'], ['acc-bel-001', 'saf-bel-001']);
    expect(result.cacheHits).toBe(0);
    expect(result.cacheMisses).toBe(2);
    expect(result.vectors).toHaveLength(2);
  });

  it('all hits when every id is in the file', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    const result = await computeEmbeddings(
      ['text1', 'text2'],
      ['acc-bel-001', 'saf-bel-001'],
    );
    expect(result.cacheHits).toBe(2);
    expect(result.cacheMisses).toBe(0);
    expect(result.vectors).toHaveLength(2);
  });

  it('partial hit/miss when only some ids match', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    const result = await computeEmbeddings(
      ['text1', 'text2', 'text3'],
      ['acc-bel-001', 'unknown-id', 'saf-bel-001'],
    );
    expect(result.cacheHits).toBe(2);
    expect(result.cacheMisses).toBe(1);
  });

  it('all misses when no ids provided (text-only batch)', async () => {
    readDataFileMock.mockResolvedValue(Buffer.from(FAKE_EMBEDDINGS));
    await prewarmEmbeddingsCache();
    const result = await computeEmbeddings(['text1', 'text2']);
    expect(result.cacheHits).toBe(0);
    expect(result.cacheMisses).toBe(2);
  });
});
