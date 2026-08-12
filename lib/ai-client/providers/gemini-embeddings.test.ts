// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { callGeminiBatchEmbed } from './gemini-embeddings.js';

const FAST_RETRY = { maxRetries: 1, strategy: 'exponential' as const, maxBackoffS: 0 };

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

describe('callGeminiBatchEmbed', () => {
  it('returns embeddings from successful response', async () => {
    const fetchFn = mockFetch(200, {
      embeddings: [
        { values: [0.1, 0.2, 0.3] },
        { values: [0.4, 0.5, 0.6] },
      ],
    });

    const result = await callGeminiBatchEmbed(fetchFn, ['hello', 'world'], 'RETRIEVAL_DOCUMENT', 'test-key', FAST_RETRY);

    expect(result).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('passes AbortSignal to fetch for socket-level timeout', async () => {
    const fetchFn = mockFetch(200, {
      embeddings: [{ values: [1, 2, 3] }],
    });

    await callGeminiBatchEmbed(fetchFn, ['test'], 'RETRIEVAL_QUERY', 'key', FAST_RETRY, 5000);

    const [, init] = fetchFn.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses per-attempt signal (fresh signal on each retry)', async () => {
    let callCount = 0;
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 503,
          text: () => Promise.resolve('Service unavailable'),
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve('{}'),
        json: () => Promise.resolve({ embeddings: [{ values: [1] }] }),
      });
    });

    const retryConfig = { maxRetries: 2, strategy: 'exponential' as const, maxBackoffS: 0 };
    await callGeminiBatchEmbed(fetchFn, ['test'], 'RETRIEVAL_QUERY', 'key', retryConfig, 30_000);

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('throws on 429 rate limit', async () => {
    const fetchFn = mockFetch(429, 'Rate limited');

    await expect(callGeminiBatchEmbed(fetchFn, ['test'], 'RETRIEVAL_QUERY', 'key', FAST_RETRY))
      .rejects.toThrow('429');
  });

  it('throws on non-ok response with body excerpt', async () => {
    const fetchFn = mockFetch(400, 'Bad request details here');

    await expect(callGeminiBatchEmbed(fetchFn, ['test'], 'RETRIEVAL_QUERY', 'key', FAST_RETRY))
      .rejects.toThrow('400');
  });

  it('constructs correct URL and sends key in x-goog-api-key header (t/2535)', async () => {
    const fetchFn = mockFetch(200, { embeddings: [{ values: [1] }] });

    await callGeminiBatchEmbed(fetchFn, ['test'], 'RETRIEVAL_QUERY', 'my-api-key', FAST_RETRY);

    const url = fetchFn.mock.calls[0][0] as string;
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(url).toContain('gemini-embedding-001:batchEmbedContents');
    expect(url).not.toContain('key=');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('my-api-key');
  });

  it('sends correct request body with taskType and model', async () => {
    const fetchFn = mockFetch(200, { embeddings: [{ values: [1] }] });

    await callGeminiBatchEmbed(fetchFn, ['hello'], 'SEMANTIC_SIMILARITY', 'key', FAST_RETRY);

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].taskType).toBe('SEMANTIC_SIMILARITY');
    expect(body.requests[0].model).toBe('models/gemini-embedding-001');
    expect(body.requests[0].content.parts[0].text).toBe('hello');
  });
});
