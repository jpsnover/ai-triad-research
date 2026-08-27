// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { computeEmbeddingsChunked, EMBEDDINGS_MAX_BATCH } from '../embeddingsBatch';

// A fake `post` that returns one deterministic vector per input text ([index-within-request]),
// and records the batch size + ids of every call so we can assert chunking + ordering.
function makePost() {
  const calls: { texts: string[]; ids?: string[] }[] = [];
  const post = vi.fn(async (_path: string, body?: unknown) => {
    const { texts, ids } = body as { texts: string[]; ids?: string[] };
    calls.push({ texts, ids });
    return { vectors: texts.map((_t, i) => [i]) };
  });
  return { post, calls };
}

describe('computeEmbeddingsChunked', () => {
  it('sends a batch at the cap in a single POST (no behaviour change for small inputs)', async () => {
    const { post, calls } = makePost();
    const texts = Array.from({ length: EMBEDDINGS_MAX_BATCH }, (_v, i) => `t${i}`);
    const res = await computeEmbeddingsChunked(post, texts);
    expect(post).toHaveBeenCalledTimes(1);
    expect(calls[0].texts).toHaveLength(EMBEDDINGS_MAX_BATCH);
    expect(res.vectors).toHaveLength(EMBEDDINGS_MAX_BATCH);
    // idempotent flag preserved on the single-batch path
    expect(post).toHaveBeenCalledWith('/api/embeddings/compute', { texts, ids: undefined }, { idempotent: true });
  });

  it('splits an oversized batch into ceil(n/cap) sequential POSTs, each within the cap', async () => {
    const { post, calls } = makePost();
    const n = 2587; // the incident batch size
    const texts = Array.from({ length: n }, (_v, i) => `t${i}`);
    await computeEmbeddingsChunked(post, texts);
    const expectedChunks = Math.ceil(n / EMBEDDINGS_MAX_BATCH); // 6 at cap 512
    expect(post).toHaveBeenCalledTimes(expectedChunks);
    for (const c of calls) expect(c.texts.length).toBeLessThanOrEqual(EMBEDDINGS_MAX_BATCH);
    // chunk sizes tile the input exactly (5×512 + 27)
    expect(calls.reduce((sum, c) => sum + c.texts.length, 0)).toBe(n);
    expect(calls[calls.length - 1].texts.length).toBe(n % EMBEDDINGS_MAX_BATCH);
  });

  it('concatenates vectors in input order and keeps ids aligned per chunk', async () => {
    // vector value encodes the ORIGINAL global index so we can prove ordering across chunks
    const post = vi.fn(async (_path: string, body?: unknown) => {
      const { texts } = body as { texts: string[] };
      return { vectors: texts.map((t) => [Number(t.slice(1))]) };
    });
    const n = EMBEDDINGS_MAX_BATCH + 5; // 2 chunks
    const texts = Array.from({ length: n }, (_v, i) => `t${i}`);
    const ids = Array.from({ length: n }, (_v, i) => `id${i}`);
    const res = await computeEmbeddingsChunked(post, texts, ids);
    expect(res.vectors).toEqual(Array.from({ length: n }, (_v, i) => [i]));
    // ids sliced in lockstep with texts: 2nd chunk starts at the cap boundary
    const secondCallIds = (post.mock.calls[1][1] as { ids: string[] }).ids;
    expect(secondCallIds[0]).toBe(`id${EMBEDDINGS_MAX_BATCH}`);
  });

  it('is strictly sequential — chunk N+1 starts only after chunk N resolves', async () => {
    const order: string[] = [];
    let active = 0;
    const post = vi.fn(async (_path: string, body?: unknown) => {
      const { texts } = body as { texts: string[] };
      active += 1;
      expect(active).toBe(1); // never two in-flight at once
      order.push(`start:${texts[0]}`);
      await Promise.resolve();
      order.push(`end:${texts[0]}`);
      active -= 1;
      return { vectors: texts.map(() => [0]) };
    });
    const texts = Array.from({ length: EMBEDDINGS_MAX_BATCH * 2 + 1 }, (_v, i) => `t${i}`); // 3 chunks
    await computeEmbeddingsChunked(post, texts);
    // each chunk fully ends before the next begins
    expect(order).toEqual([
      't0', 't0', `t${EMBEDDINGS_MAX_BATCH}`, `t${EMBEDDINGS_MAX_BATCH}`, `t${EMBEDDINGS_MAX_BATCH * 2}`, `t${EMBEDDINGS_MAX_BATCH * 2}`,
    ].flatMap((label, i) => (i % 2 === 0 ? [`start:${label}`] : [`end:${label}`])));
  });
});
