// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2904 — embedding-load instrumentation. Unit tests for the in-flight counter
// and the load snapshot. The counter is the same one the t/2905 concurrency cap
// will read, so its increment/decrement/floor invariants are load-bearing.

import { describe, it, expect } from 'vitest';
import {
  beginEmbeddingCompute,
  endEmbeddingCompute,
  inFlightEmbeddingComputes,
  embeddingLoadSnapshot,
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
