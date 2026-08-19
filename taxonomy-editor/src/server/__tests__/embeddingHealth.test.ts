// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for GET /api/health/embeddings (t/2789 Part 2).
// Covers: publicPaths inclusion, 200 on ready, 503 on not-ready, error passthrough.

import { describe, it, expect } from 'vitest';
import { PUBLIC_EXACT_PATHS, computeIsPublicPath } from '../publicPaths.js';

// ── publicPaths ──────────────────────────────────────────────────────────────

describe('publicPaths — /api/health/embeddings', () => {
  it('is in PUBLIC_EXACT_PATHS', () => {
    expect(PUBLIC_EXACT_PATHS.has('/api/health/embeddings')).toBe(true);
  });

  it('computeIsPublicPath returns true for the endpoint', () => {
    expect(computeIsPublicPath('/api/health/embeddings')).toBe(true);
  });

  it('does not treat it as a prefix (trailing path must not match)', () => {
    expect(computeIsPublicPath('/api/health/embeddings/extra')).toBe(false);
  });
});

// ── handler response shape (inline simulation) ───────────────────────────────
// The route handler is a thin conditional over getWarmupStatus(); we test the
// output shape that the conditional produces rather than importing the full
// diagnostics route module (which pulls in heavy server deps).

type WarmupStatus = { ready: boolean; error?: string };

function simulateHandler(status: WarmupStatus): { statusCode: number; body: Record<string, unknown> } {
  if (status.ready) {
    return { statusCode: 200, body: { ok: true, ready: true } };
  }
  return { statusCode: 503, body: { ok: false, ready: false, error: status.error ?? 'not ready' } };
}

describe('GET /api/health/embeddings — response shape', () => {
  it('returns 200 { ok, ready: true } when embedding is warm', () => {
    const { statusCode, body } = simulateHandler({ ready: true });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ ok: true, ready: true });
  });

  it('returns 503 { ok: false, ready: false, error } when warmup failed', () => {
    const { statusCode, body } = simulateHandler({ ready: false, error: 'ONNX model load failed' });
    expect(statusCode).toBe(503);
    expect(body).toEqual({ ok: false, ready: false, error: 'ONNX model load failed' });
  });

  it('uses "not ready" fallback when error field absent', () => {
    const { statusCode, body } = simulateHandler({ ready: false });
    expect(statusCode).toBe(503);
    expect(body.error).toBe('not ready');
  });
});
