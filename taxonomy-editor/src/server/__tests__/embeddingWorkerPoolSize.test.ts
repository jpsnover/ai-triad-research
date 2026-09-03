// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3211 — getEmbeddingWorkerPoolSize: parse EMBEDDING_WORKER_POOL_SIZE, DEFAULT 1 (inert). The RAW
// value is passed to Shared Lib's configureEmbeddingWorkerPool, which self-clamps — so this getter
// only needs to yield a sane positive integer (>=1), defaulting to 1 on unset/invalid input.

import { describe, it, expect, afterEach } from 'vitest';
import { getEmbeddingWorkerPoolSize } from '../config.js';

const prior = process.env.EMBEDDING_WORKER_POOL_SIZE;
afterEach(() => {
  if (prior === undefined) delete process.env.EMBEDDING_WORKER_POOL_SIZE;
  else process.env.EMBEDDING_WORKER_POOL_SIZE = prior;
});

describe('getEmbeddingWorkerPoolSize (t/3211)', () => {
  it('defaults to 1 when unset (inert — today\'s single-worker behavior)', () => {
    delete process.env.EMBEDDING_WORKER_POOL_SIZE;
    expect(getEmbeddingWorkerPoolSize()).toBe(1);
  });

  it('parses a valid positive integer verbatim (raw — the lib self-clamps)', () => {
    process.env.EMBEDDING_WORKER_POOL_SIZE = '2';
    expect(getEmbeddingWorkerPoolSize()).toBe(2);
    process.env.EMBEDDING_WORKER_POOL_SIZE = '8'; // over-set is fine — configureEmbeddingWorkerPool clamps
    expect(getEmbeddingWorkerPoolSize()).toBe(8);
  });

  it('falls back to 1 on invalid/non-positive input (never 0 or negative)', () => {
    for (const v of ['0', '-3', 'abc', '', '  ', '1.5']) {
      process.env.EMBEDDING_WORKER_POOL_SIZE = v;
      const got = getEmbeddingWorkerPoolSize();
      expect(got, `"${v}" → >=1`).toBeGreaterThanOrEqual(1);
    }
    process.env.EMBEDDING_WORKER_POOL_SIZE = '0';
    expect(getEmbeddingWorkerPoolSize()).toBe(1);
  });
});
