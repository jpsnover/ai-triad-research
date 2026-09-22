// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { fetchWithDiagnostics, readMetricsHeaders, utf8ByteLength } from './instrumentation.js';
import type { FetchFn } from './types.js';

describe('utf8ByteLength', () => {
  it('counts ASCII bytes 1:1', () => {
    expect(utf8ByteLength('hello')).toBe(5);
    expect(utf8ByteLength('')).toBe(0);
  });

  it('counts multi-byte UTF-8 by BYTES, not code units — the point of the number', () => {
    expect(utf8ByteLength('€')).toBe(3);       // 3-byte code point
    expect(utf8ByteLength('🚀')).toBe(4);       // 4-byte (surrogate pair is 2 JS units)
    expect(utf8ByteLength('café')).toBe(5);     // 3 ASCII + é (2 bytes)
  });
});

describe('readMetricsHeaders', () => {
  it('lifts numeric xAI server-timing headers when present', () => {
    const h = new Headers({ 'x-metrics-ttft-ms': '812', 'x-metrics-e2e-ms': '45000' });
    expect(readMetricsHeaders(h)).toEqual({ ttftMs: 812, e2eMs: 45000 });
  });

  it('returns undefined per-field when the header is absent (most providers)', () => {
    expect(readMetricsHeaders(new Headers())).toEqual({ ttftMs: undefined, e2eMs: undefined });
  });

  it('treats a non-numeric header as absent rather than surfacing NaN', () => {
    const h = new Headers({ 'x-metrics-ttft-ms': 'n/a' });
    expect(readMetricsHeaders(h).ttftMs).toBeUndefined();
  });
});

describe('fetchWithDiagnostics', () => {
  const OK_BODY = JSON.stringify({ choices: [{ message: { content: 'hi' } }] });

  function stubFetch(body: string, init?: { status?: number; headers?: Record<string, string> }): FetchFn {
    return (async () =>
      new Response(body, { status: init?.status ?? 200, headers: init?.headers })) as unknown as FetchFn;
  }

  it('captures request/response byte sizes, status, and the timing split', async () => {
    const reqBody = JSON.stringify({ model: 'x', prompt: 'p' });
    const { response, bodyText, diagnostics } = await fetchWithDiagnostics(
      stubFetch(OK_BODY),
      'https://example.test/v1',
      { method: 'POST', body: reqBody },
      5_000,
      'test read',
    );
    expect(response.status).toBe(200);
    expect(bodyText).toBe(OK_BODY);
    expect(diagnostics.requestBytes).toBe(utf8ByteLength(reqBody));
    expect(diagnostics.responseBytes).toBe(utf8ByteLength(OK_BODY));
    expect(diagnostics.httpStatus).toBe(200);
    expect(diagnostics.headersMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.bodyReadMs).toBeGreaterThanOrEqual(0);
  });

  it('surfaces xAI ttft/e2e headers into diagnostics when present', async () => {
    const { diagnostics } = await fetchWithDiagnostics(
      stubFetch(OK_BODY, { headers: { 'x-metrics-ttft-ms': '812', 'x-metrics-e2e-ms': '45000' } }),
      'https://api.x.ai/v1/chat/completions',
      { method: 'POST', body: '{}' },
      5_000,
      'xai read',
    );
    expect(diagnostics.ttftMs).toBe(812);
    expect(diagnostics.e2eMs).toBe(45000);
  });

  it('omits ttft/e2e (not NaN, not 0) when the provider sends no timing headers', async () => {
    const { diagnostics } = await fetchWithDiagnostics(
      stubFetch(OK_BODY),
      'https://api.groq.com/v1',
      { method: 'POST', body: '{}' },
      5_000,
      'groq read',
    );
    expect('ttftMs' in diagnostics).toBe(false);
    expect('e2eMs' in diagnostics).toBe(false);
  });

  it('records requestBytes 0 when the body is not a string', async () => {
    const { diagnostics } = await fetchWithDiagnostics(
      stubFetch(OK_BODY),
      'https://example.test/v1',
      { method: 'GET' },
      5_000,
      'no-body read',
    );
    expect(diagnostics.requestBytes).toBe(0);
  });

  it('records the actual (error) HTTP status on a response that arrived', async () => {
    const { diagnostics } = await fetchWithDiagnostics(
      stubFetch('{"error":"boom"}', { status: 500 }),
      'https://example.test/v1',
      { method: 'POST', body: '{}' },
      5_000,
      'err read',
    );
    expect(diagnostics.httpStatus).toBe(500);
  });

  it('propagates an AbortError (per-attempt timeout) unchanged — no diagnostics on the throw path', async () => {
    const aborting: FetchFn = (async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    }) as unknown as FetchFn;
    await expect(
      fetchWithDiagnostics(aborting, 'https://example.test/v1', { method: 'POST', body: '{}' }, 5_000, 'read'),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
