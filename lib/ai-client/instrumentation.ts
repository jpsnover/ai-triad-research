// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3566 — provider-call instrumentation. Before this, a provider fetch emitted NOTHING between
// "request sent" and "timeout fired", so a 300s timeout was indistinguishable between "never
// reached the API", "accepted but never answered", and "answered slowly" (the grok-4.7 opening-brief
// dead end). This helper captures request/response byte sizes and splits the fetch (time to response
// headers) from the body read, so a hung request reads differently from slow generation, and lifts
// xAI's free server-timing headers when present.
//
// FORENSICS ONLY: the diagnostics ride ProviderResult.diagnostics purely for the flight recorder —
// no consumer branches on them (SO-exempt per t/3566#2, on exactly that condition). See the lapse
// note on ProviderCallDiagnostics in types.ts.

import { withTimeout } from './retry.js';
import type { FetchFn, ProviderCallDiagnostics } from './types.js';

/**
 * xAI-style server-timing headers, when the provider sends them. `x-metrics-ttft-ms` (time to first
 * token) and `x-metrics-e2e-ms` (end-to-end) are confirmed present on xAI responses (t/3566); other
 * providers omit them, so each field is independently optional. A non-numeric header is treated as
 * absent rather than surfaced as NaN.
 */
export function readMetricsHeaders(headers: Headers): { ttftMs?: number; e2eMs?: number } {
  const num = (name: string): number | undefined => {
    // Null-safe against non-spec fetch doubles that omit `headers` (a real Response always has it).
    const raw = headers?.get?.(name);
    if (raw == null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return { ttftMs: num('x-metrics-ttft-ms'), e2eMs: num('x-metrics-e2e-ms') };
}

/** UTF-8 byte length. Uses TextEncoder (universal across Node / Electron-main / browser) rather than
 *  Buffer, so this stays portable if a provider is ever exercised outside a Node context. */
export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Fetch + read-body wrapper that captures {@link ProviderCallDiagnostics}. Times the fetch (headers
 * arrival) separately from the body read so "hung" is distinguishable from "slow generation", records
 * request/response byte sizes, and lifts the xAI server-timing headers via {@link readMetricsHeaders}.
 *
 * Behaviourally transparent: it performs exactly the `fetchFn(url, init)` + `withTimeout(text())` the
 * providers did inline, and an AbortError (per-attempt timeout) propagates UNCHANGED — the timeout
 * path deliberately yields no diagnostics here (there is no response), and is covered instead by the
 * `promptBytes` recorded on the `ai.request` event before the call.
 */
export async function fetchWithDiagnostics(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  readTimeoutMs: number,
  readLabel: string,
): Promise<{ response: Response; bodyText: string; diagnostics: ProviderCallDiagnostics }> {
  const requestBytes = typeof init.body === 'string' ? utf8ByteLength(init.body) : 0;
  const t0 = performance.now();
  const response = await fetchFn(url, init);
  const headersMs = performance.now() - t0;
  const bodyText = await withTimeout(response.text(), readTimeoutMs, readLabel);
  const bodyReadMs = performance.now() - t0 - headersMs;
  const { ttftMs, e2eMs } = readMetricsHeaders(response.headers);
  return {
    response,
    bodyText,
    diagnostics: {
      requestBytes,
      httpStatus: response.status,
      headersMs: Math.round(headersMs),
      bodyReadMs: Math.round(bodyReadMs),
      ...(ttftMs != null ? { ttftMs } : {}),
      ...(e2eMs != null ? { e2eMs } : {}),
      responseBytes: utf8ByteLength(bodyText),
    },
  };
}
