// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/4018 — the Electron desktop path (embeddings.ts) must pass the loaded ModelRegistry as
 * `opts.identityRegistry` at both `callProvider` call sites, or the served-identity classifier
 * (lib/ai-client, t/3731 Phase 3) can never warn on a substituted model for desktop calls —
 * it silently classifies `unknown/no-registry` instead. Mirrors
 * embeddings.fixedTemperature.test.ts's scaffold exactly (same mocks, same FAKE_REGISTRY,
 * same fs-spy harness) — only the assertion differs.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import type { ModelRegistry } from '../../../../lib/ai-client/index.js';

// ── Module mocks (hoisted by vitest) ──────────────────────────────────────────

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
    withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    generateViaDeepSeekStream: vi.fn(),
  };
});

const FAKE_REGISTRY: ModelRegistry = {
  backends: [
    { id: 'groq', label: 'Groq' },
    { id: 'claude', label: 'Claude' },
  ],
  models: [
    { id: 'groq-fixed', apiModelId: 'groq-fixed-api', label: 'Fixed Temp Test', backend: 'groq', fixedTemperature: 1 },
    { id: 'groq-plain', apiModelId: 'groq-plain-api', label: 'Plain Test', backend: 'groq' },
  ],
};

const FAKE_FD = 99;
const FAKE_MTIME = 1_700_000_000_000;

import { generateText, generateChatStream } from '../embeddings.js';

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
  vi.clearAllMocks();
  mockCallProvider.mockResolvedValue({ text: 'test response' });
});

const captureOpts = () => mockCallProvider.mock.calls[0]?.[5] as Record<string, unknown> | undefined;

describe('identityRegistry flows through to callProvider (t/4018)', () => {
  it('REGRESSION — generateText: opts.identityRegistry reaches callProvider and matches the loaded registry', async () => {
    await generateText('test prompt', 'groq-fixed');
    const opts = captureOpts();
    expect(opts?.identityRegistry).toBeDefined();
    expect(opts?.identityRegistry).toEqual(FAKE_REGISTRY);
  });

  it('REGRESSION — generateChatStream (non-gemini): opts.identityRegistry reaches callProvider', async () => {
    await generateChatStream('system', [{ role: 'user', content: 'hi' }], vi.fn(), 'groq-plain');
    const opts = captureOpts();
    expect(opts?.identityRegistry).toBeDefined();
    expect(opts?.identityRegistry).toEqual(FAKE_REGISTRY);
  });
});
