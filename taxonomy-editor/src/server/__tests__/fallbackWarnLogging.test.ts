// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3176 (Fallback-Path Logging) — assert each of the 4 back-filled silent fallbacks in
// aiBackends.ts now emits a WARN on its fallback branch (per docs/error-handling.md). Audit: t/3169#1.
//   Finding 1: updateNodeEmbeddings — embeddings file unreadable → EMPTY baseline (data-losing).
//   Finding 2: generateText — no API key for a chain entry → skip to next fallback (was FR-info-only).
//   Finding 3: generateTextWithSearch — no Tavily key → plain generation (search omitted).
//   Finding 4: isPythonEmbeddingAvailable — Python venv absent → API/ONNX only (was log.server.info).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

const { apiWarn, serverWarn, onnxCompute, readData, execFileMock } = vi.hoisted(() => ({
  apiWarn: vi.fn(), serverWarn: vi.fn(), onnxCompute: vi.fn(), readData: vi.fn(),
  execFileMock: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  log: {
    api: { info: vi.fn(), warn: apiWarn, error: vi.fn(), debug: vi.fn() },
    server: { info: vi.fn(), warn: serverWarn, error: vi.fn(), debug: vi.fn() },
  },
  getRequestId: () => 'req-test',
  LOG_MAX_LINE_BYTES: 65536,
}));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('../../../../lib/embeddings/onnxEmbedding.js', () => ({
  tryWarmup: vi.fn(async () => true), warmup: vi.fn(async () => true),
  computeEmbedding: vi.fn(async () => new Array(384).fill(0)),
  computeEmbeddings: onnxCompute,
}));
vi.mock('../storage/readDataFile.js', () => ({ readDataFile: readData }));
// Keep real config EXCEPT the key lookups (so ai-models.json still loads for model resolution).
vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return {
    ...actual,
    getApiKey: vi.fn(async (b: string) => (b === 'tavily' ? null : null)),
    getApiKeys: vi.fn(async () => [] as string[]),
  };
});

import {
  generateText,
  generateTextWithSearch,
  updateNodeEmbeddings,
  computeEmbeddings,
  _setPythonAvailableForTest,
  _resetPythonAvailableForTest,
  _resetEmbeddingsCacheForTest,
} from '../ai/aiBackends.js';

beforeEach(() => {
  apiWarn.mockReset(); serverWarn.mockReset(); onnxCompute.mockReset(); readData.mockReset();
  execFileMock.mockReset();
  onnxCompute.mockImplementation(async (t: string[]) => t.map(() => new Array(384).fill(0.1)));
  _resetEmbeddingsCacheForTest();
});

const warnMsgs = (spy: typeof apiWarn) => spy.mock.calls.map(c => String(c[c.length - 1]));

describe('t/3176 — Fallback-Path Logging WARNs in aiBackends.ts', () => {
  it('Finding 3: generateTextWithSearch with no Tavily key WARNs + degrades to plain generation', async () => {
    // non-gemini backend → the Tavily branch; getApiKey('tavily') mocked null → fall-through.
    // getApiKeys → [] would make plain generateText throw, but the WARN fires BEFORE that call.
    await generateTextWithSearch('some prompt', 'claude-3-5-haiku', undefined).catch(() => { /* expected: no key downstream */ });
    expect(warnMsgs(apiWarn).some(m => /no Tavily key — falling back to plain generation/.test(m))).toBe(true);
  });

  it('Finding 2: generateText WARNs when a fallback-chain entry has no API key', async () => {
    // All backends keyless → every chain entry is skipped; the WARN fires on each non-last skip
    // before the final throwNoApiKeyError. (Uses a model whose registry chain has ≥2 entries.)
    await generateText('p', 'gemini-3.5-flash-lite').catch(() => { /* expected: no key anywhere */ });
    // If the resolved model has a multi-entry fallback chain, the skip-WARN fired at least once.
    // (Assertion is tolerant: a single-entry chain throws without a skip — see PR note.)
    const fired = warnMsgs(apiWarn).some(m => /no API key for backend — skipping to next fallback/.test(m));
    expect(fired).toBe(true);
  });

  it('Finding 4: isPythonEmbeddingAvailable WARNs (server) when the Python probe fails', async () => {
    _resetPythonAvailableForTest();
    // The probe execFile('python','-c import sentence_transformers') → error → _pythonAvailable=false.
    execFileMock.mockImplementation((_f: string, _a: string[], _o: unknown, cb?: (e: Error | null) => void) => {
      if (typeof cb === 'function') cb(new Error('ModuleNotFoundError: sentence_transformers'));
    });
    await computeEmbeddings(['x']); // triggers the probe; ONNX (mocked) then computes
    expect(warnMsgs(serverWarn).some(m => /Python sentence-transformers unavailable/.test(m))).toBe(true);
  });

  it('Finding 1: updateNodeEmbeddings WARNs when the embeddings file is unreadable (empty baseline)', async () => {
    _setPythonAvailableForTest(false); // encodeBatch → ONNX (mocked), not Python
    readData.mockRejectedValue(new Error('ENOENT: embeddings.json missing'));
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined); // don't touch disk
    await updateNodeEmbeddings([{ id: 'acc-x-1', text: 'hello', pov: 'acc' }]);
    expect(warnMsgs(apiWarn).some(m => /unreadable — continuing with an EMPTY baseline/.test(m))).toBe(true);
    vi.restoreAllMocks();
  });
});
