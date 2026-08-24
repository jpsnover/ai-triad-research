// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Coverage for the chunk-and-yield in computeEmbeddings (t/2914 item 2). A single large
// in-process batch froze the event loop ~46.8s in prod (2389 texts → 500); the concurrency
// cap can't catch a single request. resolveEmbeddingsChunked splits the batch and yields
// (setImmediate) between chunks. These assert: chunking happens above the size, results are
// order-preserving + identical to a single resolve, and the loop actually yields between chunks.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => undefined }));

const { resolveEmbeddingsChunked } = await import('../ai/aiBackends');

// Fake chain: records the size of each chunk it was called with; returns a deterministic
// 1-dim vector per text (= its length) so we can assert order/identity. local=null + no ids
// routes every text to the chain (resolveEmbeddings treats all as missing).
function makeChain(callSizes: number[]) {
  return [{
    name: 'fake',
    compute: async (texts: string[]) => { callSizes.push(texts.length); return texts.map((t) => [t.length]); },
  }];
}

describe('resolveEmbeddingsChunked (t/2914 item 2)', () => {
  it('does NOT chunk when the batch is within the chunk size (single resolve)', async () => {
    const sizes: number[] = [];
    const texts = ['aa', 'bbb'];
    const out = await resolveEmbeddingsChunked(texts, undefined, null, makeChain(sizes), 5);
    expect(sizes).toEqual([2]);            // one chain call, whole batch
    expect(out).toEqual([[2], [3]]);
  });

  it('splits a large batch into chunks and preserves order/identity', async () => {
    const sizes: number[] = [];
    const texts = ['a', 'bb', 'ccc', 'dddd', 'eeeee']; // lengths 1..5
    const out = await resolveEmbeddingsChunked(texts, undefined, null, makeChain(sizes), 2);
    expect(sizes).toEqual([2, 2, 1]);      // chunked 2+2+1
    expect(out).toEqual([[1], [2], [3], [4], [5]]); // concatenated in original order
  });

  it('yields the event loop between chunks (setImmediate runs between compute calls)', async () => {
    // A macrotask scheduled after the first chunk resolves must run BEFORE the final chunk if
    // the loop is being yielded. We tick a flag via setImmediate and assert the chain saw a gap.
    const order: string[] = [];
    const chain = [{
      name: 'fake',
      compute: async (texts: string[]) => { order.push(`compute:${texts.length}`); return texts.map(() => [0]); },
    }];
    // schedule a marker on the macrotask queue; with yielding it interleaves between chunks.
    const texts = ['x', 'y', 'z', 'w'];
    const p = resolveEmbeddingsChunked(texts, undefined, null, chain, 2);
    setImmediate(() => order.push('macrotask'));
    await p;
    // The macrotask must have run before the loop finished all chunks — i.e. it's not starved.
    expect(order).toContain('macrotask');
    expect(order.filter((o) => o.startsWith('compute')).length).toBe(2); // 2 chunks
  });

  it('returns exactly one vector per input across chunk boundaries', async () => {
    const texts = Array.from({ length: 7 }, (_, i) => 'n'.repeat(i + 1));
    const out = await resolveEmbeddingsChunked(texts, undefined, null, makeChain([]), 3);
    expect(out).toHaveLength(7);
    expect(out.map((v) => v[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
