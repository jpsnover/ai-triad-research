// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4048 (SO ruling e/275#2/#4, option (a)): desktop's generateText has no fallback chain —
// lib/debate/aiAdapter.ts's createCLIAdapter is the only code that walks registry.fallbackChains,
// and it's CLI-only, never this path (ElectronMain's t/4048#1 trace, verified by Rosetta on
// origin/main at e/275#2). So servedModel is simply the single model this call resolved to,
// DERIVED from the same defaulting as the call (friendlyModel = model || DEFAULT_MODEL), never
// echoed from the raw `model` param. These are the three arms SO accepted in place of the
// "chain's second link answers" test, which doesn't apply to a backend with no chain:
//   1. derived-not-echoed (the one real substitution: model omitted → DEFAULT_MODEL)
//   2. explicit model (servedModel matches both the request and what the provider received)
//   3. retry-exhaustion (rejects — nothing carries a stale servedModel)
// Mock scaffold mirrors embeddings.fixedTemperature.test.ts.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import type { ModelRegistry } from '../../../../lib/ai-client/index.js';

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp/test-app') },
}));

vi.mock('../fileIO.js', () => ({
  PROJECT_ROOT: '/fake/root',
  resolveDataPath: vi.fn(),
}));

vi.mock('../apiKeyStore.js', () => ({
  loadApiKey: vi.fn(() => 'fake-api-key'),
}));

vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: vi.fn(() => null),
  setGlobalRecorder: vi.fn(),
}));

vi.mock('../../../../lib/embeddings/onnxEmbedding.js', () => ({
  tryWarmup: vi.fn(),
  computeEmbedding: vi.fn(),
  computeEmbeddings: vi.fn(),
  getExecutionProvider: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../../../../lib/embeddings/embeddingResolver.js', () => ({
  resolveEmbeddings: vi.fn(),
}));

vi.mock('../../../../lib/electron-shared/embeddingIO.js', () => ({
  createEmbeddingIO: vi.fn(() => ({
    read: vi.fn(),
    write: vi.fn(),
    invalidateCache: vi.fn(),
  })),
}));

vi.mock('../../../../lib/search/tavily.js', () => ({
  tavilySearch: vi.fn(),
  buildSearchAugmentedPrompt: vi.fn(),
}));

const mockCallProvider = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/ai-client/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/ai-client/index.js')>();
  return {
    ...actual,
    callProvider: mockCallProvider,
    withRetry: actual.withRetry, // REAL withRetry — the retry-exhaustion arm needs its retry logic
    generateViaDeepSeekStream: vi.fn(),
  };
});

// DEFAULT_MODEL ('gemini-3.5-flash-lite', lib/ai-client/defaults.ts) must resolve via this
// registry for the derived-not-echoed arm to exercise a real resolution, not a fallback literal.
const FAKE_REGISTRY: ModelRegistry = {
  backends: [
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'groq', label: 'Groq' },
  ],
  models: [
    { id: 'gemini-3.5-flash-lite', apiModelId: 'gemini-3.5-flash-lite-api', label: 'Default', backend: 'gemini' },
    { id: 'groq-explicit', apiModelId: 'groq-explicit-api', label: 'Explicit', backend: 'groq' },
  ],
};

const FAKE_FD = 99;
const FAKE_MTIME = 1_700_000_000_000;

import { generateText } from '../embeddings.js';

beforeAll(() => {
  vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  vi.spyOn(fs, 'openSync').mockReturnValue(FAKE_FD as ReturnType<typeof fs.openSync>);
  vi.spyOn(fs, 'fstatSync').mockReturnValue({ mtimeMs: FAKE_MTIME } as unknown as fs.Stats);
  vi.spyOn(fs, 'readFileSync').mockImplementation(
    ((fdOrPath: unknown) =>
      fdOrPath === FAKE_FD ? JSON.stringify(FAKE_REGISTRY) : '') as typeof fs.readFileSync,
  );
  vi.spyOn(fs, 'closeSync').mockImplementation((() => {}) as typeof fs.closeSync);
});

beforeEach(() => {
  mockCallProvider.mockReset();
  mockCallProvider.mockResolvedValue({ text: 'test response' });
});

// opts is always the 6th arg to callProvider(electronFetch, backend, prompt, resolvedModel, apiKey, opts)
const providerModelArg = () => mockCallProvider.mock.calls[0]?.[3] as string | undefined;

describe('servedModel (t/4048, SO e/275#2/#4)', () => {
  it('derived, not echoed: model omitted → servedModel is DEFAULT_MODEL, the registry id actually called', async () => {
    const result = await generateText('test prompt'); // model omitted entirely

    expect(result.servedModel).toBe('gemini-3.5-flash-lite');
    // The provider was actually called with the resolved API id for that SAME registry entry —
    // proves servedModel wasn't fabricated independently of what the call did.
    expect(providerModelArg()).toBe('gemini-3.5-flash-lite-api');
  });

  it('explicit model: servedModel equals the requested registry id and what the provider received', async () => {
    const result = await generateText('test prompt', 'groq-explicit');

    expect(result.servedModel).toBe('groq-explicit');
    expect(providerModelArg()).toBe('groq-explicit-api');
  });

  it('retry exhaustion: the call rejects, and there is no result to carry a stale servedModel', async () => {
    mockCallProvider.mockRejectedValue(new Error('503 Service Unavailable'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pending = expect(generateText('test prompt', 'groq-explicit')).rejects.toThrow();
      // SERVER_RETRY_CONFIG: 5 attempts, exponential backoff capped at 30s — fast-forward well
      // past the real-time total so this doesn't wait on actual sleeps.
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(30_000);
      }
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});
