// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

// t/2060 slice-1 unit coverage for the CPU-fallback path. The real-DML-host hard gate
// (335/350/350-node batches, zero 8007000E) proves the chunking path on actual hardware;
// this mock proves the branch the real run doesn't hit — a GPU-EP OOM mid-inference must
// recreate the session on CPU and retry to success.
//
// onnxruntime-node is loaded via `createRequire(import.meta.url)('onnxruntime-node')`, which
// vitest's `vi.mock('onnxruntime-node')` does NOT intercept (it bypasses the ESM registry).
// So we mock `module` and proxy `createRequire` to return a fake ORT only for that specifier
// — all other requires pass through. A temp minimal model dir keeps init() CI-portable.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => {
  const HIDDEN = 384;
  const SEQ = 256;
  const createEPs: string[][] = []; // executionProviders per InferenceSession.create
  const runBatches: number[] = [];  // dims[0] per run — chunk-size assertion
  class Tensor {
    constructor(public type: string, public data: unknown, public dims: number[]) {}
  }
  const makeSession = (oom: boolean) => ({
    async run(feeds: Record<string, { dims: number[] }>) {
      const batch = feeds.input_ids.dims[0];
      runBatches.push(batch);
      if (oom) throw new Error('Non-succeeded return code from onnxruntime: 8007000E : E_OUTOFMEMORY');
      return { last_hidden_state: { data: new Float32Array(batch * SEQ * HIDDEN).fill(0.1), dims: [batch, SEQ, HIDDEN] } };
    },
    async release() { /* no-op */ },
  });
  const fakeOrt = {
    InferenceSession: {
      async create(_p: string, opts: { executionProviders: string[] }) {
        createEPs.push(opts.executionProviders);
        const cpuOnly = opts.executionProviders.length === 1 && opts.executionProviders[0] === 'cpu';
        return makeSession(!cpuOnly); // GPU (dml/openvino) session OOMs; cpu-only session succeeds
      },
    },
    Tensor,
    listSupportedBackends: () => [{ name: 'cpu', bundled: true }, { name: 'dml', bundled: true }],
  };
  return { createEPs, runBatches, fakeOrt };
});

vi.mock('module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('module')>();
  return {
    ...actual,
    createRequire: (url: string) => {
      const real = actual.createRequire(url);
      return new Proxy(real, {
        apply(target, thisArg, args: [string]) {
          return args[0] === 'onnxruntime-node' ? h.fakeOrt : Reflect.apply(target, thisArg, args);
        },
      });
    },
  };
});

import { computeEmbeddings, getExecutionProvider, dispose } from './onnxEmbedding.js';

describe('onnxEmbedding — chunking + GPU→CPU OOM fallback (t/2060)', () => {
  let modelDir: string;

  beforeEach(() => {
    h.createEPs.length = 0;
    h.runBatches.length = 0;
    modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onnx-mock-'));
    const vocab = { '[PAD]': 0, '[UNK]': 100, '[CLS]': 101, '[SEP]': 102, 'ai': 1, 'policy': 2, 'node': 3 };
    fs.writeFileSync(path.join(modelDir, 'tokenizer.json'), JSON.stringify({ model: { vocab } }));
    fs.writeFileSync(path.join(modelDir, 'tokenizer_config.json'), '{}');
    fs.writeFileSync(path.join(modelDir, 'model.onnx'), ''); // fake ORT ignores the path
    process.env.AI_TRIAD_ONNX_MODEL_DIR = modelDir;
  });

  afterEach(async () => {
    await dispose();
    delete process.env.AI_TRIAD_ONNX_MODEL_DIR;
    fs.rmSync(modelDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('chunks the batch (≤32) and falls back GPU→CPU on an 8007000E, retrying to success', async () => {
    const texts = Array.from({ length: 40 }, (_, i) => `node ${i} ai policy`);

    const vecs = await computeEmbeddings(texts);

    // Operation SUCCEEDS despite the GPU OOM — all results, in order.
    expect(vecs).toHaveLength(40);
    expect(vecs[0]).toHaveLength(384);

    // EP flipped to CPU (pinned) after the OOM.
    expect(getExecutionProvider()).toBe('cpu');

    // Recreate happened: initial create was a non-CPU EP; a later create is cpu-only.
    expect(h.createEPs[0]).toContain('dml');
    expect(h.createEPs.some((eps) => eps.length === 1 && eps[0] === 'cpu')).toBe(true);

    // Every session.run was a bounded chunk (≤ CHUNK_SIZE=32), never the whole 40-batch.
    expect(Math.max(...h.runBatches)).toBeLessThanOrEqual(32);
  });
});
