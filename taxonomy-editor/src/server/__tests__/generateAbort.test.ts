// @vitest-environment node
//
// t/2510 — /api/ai/generate aborts the provider request on client disconnect.
// Two things to prove without booting the HTTP server:
//   1. The clean-arm guard: a 'close' after normal completion must NOT abort
//      (shouldAbortOnClientClose), while a mid-flight disconnect must.
//   2. The signal is actually honored end-to-end: a pre-aborted signal threaded
//      through generateTextByUsage → generateText → withRetry rejects with
//      AbortError BEFORE any provider fetch (no network, no retry ladder).

import { describe, it, expect } from 'vitest';
import { shouldAbortOnClientClose, isAbortError } from '../routes/ai.js';
import * as ai from '../ai/aiBackends.js';

describe('t/2510 — disconnect-abort clean/failure arms', () => {
  it('aborts only on a mid-flight disconnect (failure arm), never after completion (clean arm)', () => {
    // finished=false, responseEnded=false → client dropped mid-generate → abort
    expect(shouldAbortOnClientClose(false, false)).toBe(true);
    // finished=true → request already settled → no abort (clean arm)
    expect(shouldAbortOnClientClose(true, false)).toBe(false);
    // responseEnded=true → response already written → no abort (clean arm)
    expect(shouldAbortOnClientClose(false, true)).toBe(false);
    expect(shouldAbortOnClientClose(true, true)).toBe(false);
  });
});

describe('t/2510 — the signal is honored through the server generate path', () => {
  const preAborted = () => { const c = new AbortController(); c.abort(); return c.signal; };

  it('generateText rejects with AbortError on a pre-aborted signal (no provider call)', async () => {
    // explicit fake key skips key resolution; withRetry sees signal.aborted and throws
    // AbortError before invoking callProvider — so no network happens.
    await expect(
      ai.generateText('prompt', undefined, undefined, undefined, ['fake-key'], { signal: preAborted() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('generateTextByUsage forwards the signal (pre-aborted → AbortError)', async () => {
    await expect(
      ai.generateTextByUsage('server.chat-response', { prompt: 'hi' }, undefined, undefined, ['fake-key'], preAborted()),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('t/2510 — isAbortError distinguishes cancel from timeout and failure', () => {
  it('true only for AbortError; a per-attempt TimeoutError and generic errors are NOT cancellations', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    const abortErr = new Error('x'); abortErr.name = 'AbortError';
    expect(isAbortError(abortErr)).toBe(true);
    // a timeout is a failure, not a user cancel — must keep the existing error mapping
    expect(isAbortError(new DOMException('Timed out', 'TimeoutError'))).toBe(false);
    expect(isAbortError(new Error('network down'))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false); // a bare string is not an error object
  });
});
