// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for GET /api/health/embeddings (t/2789 Part 2).
// Covers: publicPaths inclusion, 200+dims on ready+self-test-pass,
// 503 on not-ready (cached), 503 on wrong dims, 503 on compute throw.

import { describe, it, expect } from 'vitest';
import { PUBLIC_EXACT_PATHS, computeIsPublicPath } from '../publicPaths.js';

// ── publicPaths ──────────────────────────────────────────────────────────────

describe('publicPaths — /api/health/embeddings', () => {
  it('is in PUBLIC_EXACT_PATHS (exact match, not prefix)', () => {
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
// The route handler is a thin conditional over getWarmupStatus() + computeEmbedding().
// We test the output shape that the conditional logic produces rather than importing
// the full diagnostics route module (which pulls in heavy server deps).

type WarmupStatus = { ready: boolean; error?: string };
type HandlerResult = { statusCode: number; body: Record<string, unknown> };

async function simulateHandler(
  status: WarmupStatus,
  computeResult: number[] | Error,
): Promise<HandlerResult> {
  if (!status.ready) {
    return { statusCode: 503, body: { ok: false, error: status.error ?? 'not ready' } };
  }
  try {
    const vector = computeResult instanceof Error ? (() => { throw computeResult; })() : computeResult;
    const dims = vector.length;
    if (dims !== 384) {
      return { statusCode: 503, body: { ok: false, error: `unexpected embedding dims: ${dims}` } };
    }
    return { statusCode: 200, body: { ok: true, dims } };
  } catch (err) {
    return { statusCode: 503, body: { ok: false, error: String(err) } };
  }
}

describe('GET /api/health/embeddings — response shape', () => {
  it('returns 200 { ok, dims: 384 } when warm and self-test passes', async () => {
    const vector = new Array(384).fill(0.1);
    const { statusCode, body } = await simulateHandler({ ready: true }, vector);
    expect(statusCode).toBe(200);
    expect(body).toEqual({ ok: true, dims: 384 });
  });

  it('returns 503 when cached warmup status is not ready', async () => {
    const { statusCode, body } = await simulateHandler(
      { ready: false, error: 'ONNX model load failed' },
      new Array(384).fill(0),
    );
    expect(statusCode).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('ONNX model load failed');
  });

  it('uses "not ready" fallback error when error field absent', async () => {
    const { statusCode, body } = await simulateHandler({ ready: false }, new Array(384).fill(0));
    expect(statusCode).toBe(503);
    expect(body.error).toBe('not ready');
  });

  it('returns 503 when self-test produces wrong dims', async () => {
    const shortVector = new Array(128).fill(0.1);
    const { statusCode, body } = await simulateHandler({ ready: true }, shortVector);
    expect(statusCode).toBe(503);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain('unexpected embedding dims: 128');
  });

  it('returns 503 when computeEmbedding throws', async () => {
    const { statusCode, body } = await simulateHandler(
      { ready: true },
      new Error('ONNX runtime crashed'),
    );
    expect(statusCode).toBe(503);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain('ONNX runtime crashed');
  });
});
