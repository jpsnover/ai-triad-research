// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2904 — embedding-load instrumentation. Unit tests for the in-flight counter
// and the load snapshot. The counter is the same one the t/2905 concurrency cap
// will read, so its increment/decrement/floor invariants are load-bearing.

import { describe, it, expect, afterEach } from 'vitest';
import {
  beginEmbeddingCompute,
  endEmbeddingCompute,
  inFlightEmbeddingComputes,
  embeddingLoadSnapshot,
  embeddingLoadShedMode,
  evaluateEmbeddingLoadShed,
} from '../embeddingsLoad.js';

describe('embeddingsLoad (t/2904)', () => {
  it('in-flight counter increments and decrements relative to its base', () => {
    const base = inFlightEmbeddingComputes();
    beginEmbeddingCompute();
    beginEmbeddingCompute();
    expect(inFlightEmbeddingComputes()).toBe(base + 2);
    endEmbeddingCompute();
    expect(inFlightEmbeddingComputes()).toBe(base + 1);
    endEmbeddingCompute();
    expect(inFlightEmbeddingComputes()).toBe(base);
  });

  it('endEmbeddingCompute never drops the counter below zero', () => {
    while (inFlightEmbeddingComputes() > 0) endEmbeddingCompute();
    endEmbeddingCompute();
    endEmbeddingCompute();
    expect(inFlightEmbeddingComputes()).toBe(0);
  });

  it('snapshot returns a finite, non-negative number for every field', () => {
    const snap = embeddingLoadSnapshot();
    for (const [key, value] of Object.entries(snap)) {
      expect(Number.isFinite(value), `${key} must be finite`).toBe(true);
      expect(value, `${key} must be >= 0`).toBeGreaterThanOrEqual(0);
    }
    // heap_size_limit is always a positive V8 constant.
    expect(snap.heap_limit_mb).toBeGreaterThan(0);
  });

  it('snapshot reflects the current in-flight count', () => {
    while (inFlightEmbeddingComputes() > 0) endEmbeddingCompute();
    beginEmbeddingCompute();
    try {
      expect(embeddingLoadSnapshot().in_flight_embedding_computes).toBe(1);
    } finally {
      endEmbeddingCompute();
    }
  });
});

describe('embeddingsLoad load-shed (t/2905)', () => {
  const ENV_KEYS = ['EMBEDDINGS_LOAD_SHED_MODE', 'EMBEDDINGS_MAX_CONCURRENT', 'EMBEDDINGS_LOOP_SHED_MS', 'EMBEDDINGS_RETRY_AFTER_MS'];

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    while (inFlightEmbeddingComputes() > 0) endEmbeddingCompute();
  });

  it('mode defaults to warn (warn-first Gate Promotion)', () => {
    expect(embeddingLoadShedMode()).toBe('warn');
  });

  it('mode reads EMBEDDINGS_LOAD_SHED_MODE (block|off, case-insensitive), else warn', () => {
    process.env.EMBEDDINGS_LOAD_SHED_MODE = 'block';    expect(embeddingLoadShedMode()).toBe('block');
    process.env.EMBEDDINGS_LOAD_SHED_MODE = 'OFF';      expect(embeddingLoadShedMode()).toBe('off');
    process.env.EMBEDDINGS_LOAD_SHED_MODE = 'nonsense'; expect(embeddingLoadShedMode()).toBe('warn');
  });

  it('BLOCK arm: at the concurrency cap → shed, mode=block, reason=concurrency', () => {
    process.env.EMBEDDINGS_LOAD_SHED_MODE = 'block';
    process.env.EMBEDDINGS_MAX_CONCURRENT = '2';
    while (inFlightEmbeddingComputes() > 0) endEmbeddingCompute();
    beginEmbeddingCompute();
    beginEmbeddingCompute(); // in-flight = 2 = cap
    const d = evaluateEmbeddingLoadShed();
    expect(d.shed).toBe(true);
    expect(d.mode).toBe('block');
    expect(d.reason).toBe('concurrency');
    expect(d.retryAfterMs).toBeGreaterThan(0);
  });

  it('WARN arm: at the cap → shed=true but mode=warn (route warns + proceeds)', () => {
    process.env.EMBEDDINGS_MAX_CONCURRENT = '2'; // mode defaults warn
    while (inFlightEmbeddingComputes() > 0) endEmbeddingCompute();
    beginEmbeddingCompute();
    beginEmbeddingCompute();
    const d = evaluateEmbeddingLoadShed();
    expect(d.shed).toBe(true);
    expect(d.mode).toBe('warn');
  });

  it('PASS arm: under the cap (loop signal disabled) → no shed, no reason', () => {
    process.env.EMBEDDINGS_LOAD_SHED_MODE = 'block';
    process.env.EMBEDDINGS_MAX_CONCURRENT = '3';
    process.env.EMBEDDINGS_LOOP_SHED_MS = '100000'; // rule out an incidental loop-delay trip
    while (inFlightEmbeddingComputes() > 0) endEmbeddingCompute();
    beginEmbeddingCompute(); // in-flight = 1 < cap 3
    const d = evaluateEmbeddingLoadShed();
    expect(d.shed).toBe(false);
    expect(d.reason).toBeUndefined();
  });

  it('OFF mode never sheds even over the cap', () => {
    process.env.EMBEDDINGS_LOAD_SHED_MODE = 'off';
    process.env.EMBEDDINGS_MAX_CONCURRENT = '1';
    while (inFlightEmbeddingComputes() > 0) endEmbeddingCompute();
    beginEmbeddingCompute();
    beginEmbeddingCompute(); // in-flight = 2 > cap 1
    expect(evaluateEmbeddingLoadShed().shed).toBe(false);
  });
});
