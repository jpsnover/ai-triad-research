// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import type { ModelRegistry } from '../../../../lib/ai-client/index.js';

// ── Module mocks (hoisted by vitest) ──────────────────────────────────────────

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp/test-app') },
}));

// PROJECT_ROOT provided statically; findModelsConfig picks candidates[0] = '/fake/root/ai-models.json'
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

// Keep buildModelEntryMap + resolveBackend real; mock callProvider + withRetry
// vi.hoisted ensures mockCallProvider is available inside the hoisted vi.mock factory
const mockCallProvider = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/ai-client/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/ai-client/index.js')>();
  return {
    ...actual,
    callProvider: mockCallProvider,
    // withRetry: just invoke the thunk — tests assert on callProvider, not retry logic
    withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    generateViaDeepSeekStream: vi.fn(),
  };
});

// ── Fake registry ──────────────────────────────────────────────────────────────
// Three explicit entries cover all 4 AC test cases:
//   'groq-fixed'      — groq backend, fixedTemperature: 1 (cases 1 + 3)
//   'groq-plain'      — groq backend, no fixedTemperature (case 2)
//   'claude-sonnet-3' — triggers alias synthesis → 'claude-sonnet-latest' (case 4)
//
// parseVersionedModelId only handles gemini-X.Y-* and claude-*-N patterns;
// moonshot-kimi-k3 is NOT parsed by it, so we use claude-sonnet-3 (family:
// 'claude-sonnet', version: 3) to exercise the alias path that IS load-bearing.
const FAKE_REGISTRY: ModelRegistry = {
  backends: [
    { id: 'groq', label: 'Groq' },
    { id: 'claude', label: 'Claude' },
  ],
  models: [
    { id: 'groq-fixed', apiModelId: 'groq-fixed-api', label: 'Fixed Temp Test', backend: 'groq', fixedTemperature: 1 },
    { id: 'groq-plain', apiModelId: 'groq-plain-api', label: 'Plain Test', backend: 'groq' },
    // claude-sonnet-3 → family 'claude-sonnet', version 3 → synthesized alias 'claude-sonnet-latest'
    { id: 'claude-sonnet-3', apiModelId: 'claude-sonnet-3-fake', label: 'Sonnet 3 Test', backend: 'claude', fixedTemperature: 1 },
  ],
};

// Sentinel fd — intercepted by all fs spies below
const FAKE_FD = 99;
const FAKE_MTIME = 1_700_000_000_000;

// ── Module under test (imported AFTER mocks) ───────────────────────────────────
import { generateText, generateChatStream } from '../embeddings.js';

// ── fs spies: intercept ai-models.json reads in resolveModelEntry ─────────────
// existsSync → false: findModelsConfig falls through to candidates[0] ('/fake/root/ai-models.json')
// openSync → FAKE_FD; readFileSync(FAKE_FD) → fake registry JSON; closeSync → no-op
// The cache loads on the first call and stays warm (mtime unchanged across calls).
beforeAll(() => {
  vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  vi.spyOn(fs, 'openSync').mockReturnValue(FAKE_FD as ReturnType<typeof fs.openSync>);
  vi.spyOn(fs, 'fstatSync').mockReturnValue({ mtimeMs: FAKE_MTIME } as unknown as fs.Stats);
  vi.spyOn(fs, 'readFileSync').mockImplementation(
    ((fdOrPath: unknown) =>
      fdOrPath === FAKE_FD ? JSON.stringify(FAKE_REGISTRY) : '') as typeof fs.readFileSync,
  );
  vi.spyOn(fs, 'closeSync').mockImplementation((() => {}) as typeof fs.closeSync);

  mockCallProvider.mockResolvedValue({ text: 'test response' });
});

beforeEach(() => {
  // Clear call history only (implementations preserved — vi.clearAllMocks does not remove them)
  vi.clearAllMocks();
  mockCallProvider.mockResolvedValue({ text: 'test response' });
});

// opts is always the 6th arg to callProvider(electronFetch, backend, prompt, resolvedModel, apiKey, opts)
const captureOpts = () => mockCallProvider.mock.calls[0]?.[5] as Record<string, unknown> | undefined;

describe('fixedTemperature flows through to callProvider', () => {
  it('case 1 — generateText: fixedTemperature: 1 reaches opts when entry has it', async () => {
    await generateText('test prompt', 'groq-fixed');
    const opts = captureOpts();
    expect(opts?.fixedTemperature).toBe(1);
  });

  it('case 2 — generateText: fixedTemperature absent from opts when entry lacks it', async () => {
    await generateText('test prompt', 'groq-plain');
    const opts = captureOpts();
    expect(opts?.fixedTemperature).toBeUndefined();
  });

  it('case 3 — generateChatStream: fixedTemperature: 1 reaches opts for non-gemini backend', async () => {
    await generateChatStream('system', [{ role: 'user', content: 'hi' }], vi.fn(), 'groq-fixed');
    const opts = captureOpts();
    expect(opts?.fixedTemperature).toBe(1);
  });

  it('case 4 — -latest alias: claude-sonnet-latest resolves fixedTemperature from claude-sonnet-3', async () => {
    // buildModelEntryMap synthesizes 'claude-sonnet-latest' pointing at 'claude-sonnet-3'
    // (highest versioned member of the claude-sonnet family, per parseVersionedModelId).
    // Consumer proof: entryMap['claude-sonnet-latest'] carries fixedTemperature: 1 from the source entry.
    await generateText('test prompt', 'claude-sonnet-latest');
    const opts = captureOpts();
    expect(opts?.fixedTemperature).toBe(1);
  });
});
