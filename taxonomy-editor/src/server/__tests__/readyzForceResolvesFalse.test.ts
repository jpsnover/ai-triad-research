// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3192 — the READYZ_FORCE_RESOLVES_FALSE test knob: force getEmbeddingsResolution().resolves=false
// so /readyz returns 503 warming, letting DevOps exercise the deploy warm-gate's FIRE arm against a
// real staging revision without an actually-broken cache. Gated to NODE_ENV!=='production' (inert in
// prod so it can never force a false-negative /readyz there).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { readData } = vi.hoisted(() => ({ readData: vi.fn() }));
vi.mock('../storage/readDataFile.js', () => ({ readDataFile: readData }));
vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('../../../../lib/embeddings/onnxEmbedding.js', () => ({
  tryWarmup: vi.fn(async () => false), warmup: vi.fn(async () => false),
  computeEmbedding: vi.fn(async () => []), computeEmbeddings: vi.fn(async () => []),
}));

import {
  getEmbeddingsResolution,
  prewarmEmbeddingsCache,
  _resetEmbeddingsCacheForTest,
  EMBEDDINGS_RESOLUTION_CANARY,
} from '../ai/aiBackends.js';

// A cache whose canary id resolves to a real 384-dim non-zero vector → resolves:true absent the knob.
const validFile = JSON.stringify({
  model: 'all-MiniLM-L6-v2', dimension: 384, node_count: 1,
  nodes: { [EMBEDDINGS_RESOLUTION_CANARY]: { vector: new Array(384).fill(0.1) } },
});

const ORIG_NODE_ENV = process.env.NODE_ENV;

describe('READYZ_FORCE_RESOLVES_FALSE knob (t/3192)', () => {
  beforeEach(async () => {
    readData.mockReset();
    readData.mockResolvedValue(Buffer.from(validFile));
    _resetEmbeddingsCacheForTest();
    await prewarmEmbeddingsCache(); // load the resolving cache
    delete process.env.READYZ_FORCE_RESOLVES_FALSE;
    process.env.NODE_ENV = 'test'; // non-production
  });
  afterEach(() => {
    delete process.env.READYZ_FORCE_RESOLVES_FALSE;
    process.env.NODE_ENV = ORIG_NODE_ENV;
  });

  it('baseline (no knob): a resolving cache reports resolves:true', () => {
    const r = getEmbeddingsResolution();
    expect(r).toMatchObject({ present: true, nodeCount: 1, resolves: true, canaryId: EMBEDDINGS_RESOLUTION_CANARY });
  });

  it('knob ON + non-production: forces resolves:false despite the resolving cache', () => {
    process.env.READYZ_FORCE_RESOLVES_FALSE = '1';
    const r = getEmbeddingsResolution();
    expect(r.resolves).toBe(false);
    expect(r.present).toBe(true); // presence unchanged — only the resolve verdict is forced
    expect(r.nodeCount).toBe(1);
  });

  it('knob ON + NODE_ENV=production: INERT — resolves stays true (no prod false-negative)', () => {
    process.env.NODE_ENV = 'production';
    process.env.READYZ_FORCE_RESOLVES_FALSE = '1';
    expect(getEmbeddingsResolution().resolves).toBe(true);
  });

  it('knob value other than "1" is ignored', () => {
    process.env.READYZ_FORCE_RESOLVES_FALSE = 'true'; // only exactly "1" enables
    expect(getEmbeddingsResolution().resolves).toBe(true);
  });
});
