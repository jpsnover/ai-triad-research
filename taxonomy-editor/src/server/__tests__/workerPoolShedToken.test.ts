// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3373 — the clean worker-pool-shed stdout token (deliverable 1). The subtle bug this locks out:
// resolveEmbeddings SWALLOWS each fallback's error and re-throws a generic 'All embedding fallbacks
// failed', so the shed's ActionableError.code is GONE by computeEmbeddings' catch — a discrimination
// check there would silently never fire (dead code). The token is therefore emitted at the offload
// boundary via logWorkerPoolShedIfApplicable, exercised here directly with the REAL
// isWorkerPoolShedError guard so a future change to the code contract fails loudly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiWarn, mockRecorder } = vi.hoisted(() => ({ apiWarn: vi.fn(), mockRecorder: { record: vi.fn() } }));

// ── Mocks: just enough for aiBackends.ts to import; offThreadEmbedding stays REAL (pure guard) ──
vi.mock('../../../../lib/flight-recorder/index.js', () => ({
  getGlobalRecorder: () => mockRecorder, setGlobalRecorder: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  log: {
    api: { info: vi.fn(), warn: apiWarn, error: vi.fn(), debug: vi.fn() },
    server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    fr: { info: vi.fn(), warn: vi.fn() },
  },
  getRequestContext: vi.fn(() => ({})),
  getRequestId: vi.fn(() => 'req-test'),
  LOG_MAX_LINE_BYTES: 65536,
}));
vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return {
    ...actual,
    getApiKey: vi.fn(async () => 'fake-key'),
    getApiKeys: vi.fn(async () => ['fake-key']),
    getProjectRoot: vi.fn(() => '/fake-root'),
    resolveDataPath: vi.fn(() => '/fake/data'),
  };
});
vi.mock('../../../../lib/embeddings/onnxEmbedding.js', () => ({
  warmup: vi.fn(async () => false), tryWarmup: vi.fn(async () => false),
  computeEmbedding: vi.fn(async () => []), computeEmbeddings: vi.fn(async () => []),
}));
vi.mock('../../../../lib/search/tavily.js', () => ({ tavilySearch: vi.fn(), buildSearchAugmentedPrompt: vi.fn() }));
vi.mock('../../../../lib/ai-client/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../lib/ai-client/index.js')>();
  return { ...actual, callProvider: vi.fn(), withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()) };
});

// ── Imports after mocks ──────────────────────────────────────────────────────
import { logWorkerPoolShedIfApplicable } from '../ai/aiBackends.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { WORKER_POOL_SHED_CODE } from '../../../../lib/embeddings/offThreadEmbedding.js';

/** A genuine stamped shed error, exactly as offThreadEmbedding's markShed() produces. */
function makeShedError(): ActionableError {
  const err = new ActionableError({
    goal: 'Compute embeddings off the main thread', problem: 'shed: queue full',
    location: 'test', nextSteps: ['retry'],
  });
  (err as ActionableError & { code: string }).code = WORKER_POOL_SHED_CODE;
  return err;
}

describe('logWorkerPoolShedIfApplicable (t/3373 deliverable 1)', () => {
  beforeEach(() => { apiWarn.mockClear(); });

  it('emits the clean stdout token for a genuine worker-pool shed', () => {
    logWorkerPoolShedIfApplicable(makeShedError(), { requester: 'embeddings-compute', inputCount: 42 });
    expect(apiWarn).toHaveBeenCalledTimes(1);
    const [fields, message] = apiWarn.mock.calls[0];
    expect(message).toBe('embeddings worker-pool shed');
    // component:'api' is the DevOps-matched Log-Analytics sink — must NOT be overridden away.
    expect(fields).toMatchObject({ component: 'api', requester: 'embeddings-compute', inputCount: 42 });
    // Carries the poolStats snapshot so the alert has depth/cap context.
    expect(fields).toHaveProperty('queueDepth');
    expect(fields).toHaveProperty('cap');
    expect(fields).toHaveProperty('liveSlots');
  });

  it('stays SILENT for a generic error (the resolveEmbeddings re-throw shape) — no false token', () => {
    logWorkerPoolShedIfApplicable(new Error('All embedding fallbacks failed (tried: onnx-batch-worker)'),
      { requester: 'embeddings-compute', inputCount: 42 });
    expect(apiWarn).not.toHaveBeenCalled();
  });

  it('stays SILENT for a non-shed ActionableError (e.g. a timeout) — code discriminates, not the class', () => {
    const timeout = new ActionableError({ goal: 'g', problem: 'timed out', location: 'l', nextSteps: ['n'] });
    logWorkerPoolShedIfApplicable(timeout, { requester: 'x', inputCount: 1 });
    expect(apiWarn).not.toHaveBeenCalled();
  });
});
