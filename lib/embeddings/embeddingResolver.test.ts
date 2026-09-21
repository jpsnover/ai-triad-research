// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/3538 (e/134 #3): fallback-exhaustion must fail with an ActionableError, not a bare Error, so the
// upstream catch/triage can't misattribute it (e.g. "ONNX init failure"). Both arms: normal resolution
// (cache hit + fallback compute) returns vectors; exhaustion throws a well-formed ActionableError.
import { describe, it, expect } from 'vitest';
import { resolveEmbeddings, type EmbeddingFallback } from './embeddingResolver.js';
import { ActionableError } from '../debate/errors.js';
import type { EmbeddingsFile } from '../electron-shared/embeddingIO.js';

const vec = (n: number): number[] => [n, n, n];
const localFile = (entries: Record<string, number[]>): EmbeddingsFile =>
  ({ nodes: Object.fromEntries(Object.entries(entries).map(([id, v]) => [id, { vector: v }])) } as unknown as EmbeddingsFile);

describe('resolveEmbeddings — normal resolution', () => {
  it('returns cached vectors from localData without calling any fallback', async () => {
    let called = 0;
    const chain: EmbeddingFallback[] = [{ name: 'onnx', compute: async () => { called++; return []; } }];
    const out = await resolveEmbeddings(['a', 'b'], ['id-a', 'id-b'], localFile({ 'id-a': vec(1), 'id-b': vec(2) }), chain);
    expect(out).toEqual([vec(1), vec(2)]);
    expect(called).toBe(0); // fully served from cache — no fallback invoked
  });

  it('computes missing entries via the fallback chain and splices them into the cached results', async () => {
    const chain: EmbeddingFallback[] = [{ name: 'onnx', compute: async (texts) => texts.map((_, i) => vec(100 + i)) }];
    // id-a cached; id-b missing → computed by the fallback.
    const out = await resolveEmbeddings(['a', 'b'], ['id-a', 'id-b'], localFile({ 'id-a': vec(1) }), chain);
    expect(out[0]).toEqual(vec(1));       // cached
    expect(out[1]).toEqual(vec(100));     // computed
  });

  it('falls through a failing backend to the next one that succeeds', async () => {
    const chain: EmbeddingFallback[] = [
      { name: 'onnx', compute: async () => { throw new Error('onnx boom'); } },
      { name: 'python', compute: async (texts) => texts.map(() => vec(7)) },
    ];
    const out = await resolveEmbeddings(['a'], undefined, null, chain);
    expect(out).toEqual([vec(7)]); // second backend served it
  });
});

describe('resolveEmbeddings — fallback exhaustion (t/3538)', () => {
  const failingChain: EmbeddingFallback[] = [
    { name: 'onnx', compute: async () => { throw new Error('onnx down'); } },
    { name: 'python', compute: async () => { throw new Error('python missing'); } },
  ];

  it('throws an ActionableError (not a bare Error) naming the tried chain', async () => {
    const err = await resolveEmbeddings(['a'], undefined, null, failingChain).then(
      () => { throw new Error('expected resolveEmbeddings to throw'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ActionableError);
    const ae = err as ActionableError;
    expect(ae.problem).toContain('All embedding fallbacks failed');
    expect(ae.problem).toContain('onnx, python');           // the tried chain, in order
    expect(ae.location).toContain('embeddingResolver.ts');
    expect(ae.nextSteps.join(' ')).toMatch(/ai\.fallback/); // points triage at the per-backend WARNs
    // Rendered message uses the ActionableError labels (root AGENTS.md: assert on rendered labels).
    expect(ae.message).toContain('Error:');   // renders `problem`
    expect(ae.message).toContain('Resolve:'); // renders `nextSteps`
  });

  it('handles an empty fallback chain (no members) with the same ActionableError, not a crash', async () => {
    const err = await resolveEmbeddings(['a'], undefined, null, []).then(
      () => { throw new Error('expected resolveEmbeddings to throw'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ActionableError);
    expect((err as ActionableError).problem).toContain('(empty chain)');
  });
});
