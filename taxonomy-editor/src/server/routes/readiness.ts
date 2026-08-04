// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2059: /healthz readiness diagnosis. When the taxonomy data isn't available,
// a bare 503 cannot tell a normal cold-start warm-up apart from a *permanent*
// data-load failure — that ambiguity is exactly what turned the t/2047 incident
// into a multi-agent log hunt ("app inits fully, no exception, readiness 503"
// gives a responder nothing to act on). This classifies the not-ready state so
// both the /healthz body and the server log name it:
//   - 'warming' : startup grace, data load in progress → 503 is expected.
//   - 'failed'  : data load has permanently failed → 503 with the underlying cause.
//
// The 503 status itself is unchanged (readiness semantics preserved) — this is
// purely diagnostic content. Deploy probes (ACA) key on the status CODE, not the
// body, so adding these fields is backward-compatible.

import type { ServerCtx } from './context.js';

/**
 * Startup grace window (seconds). A GitHub cold-start data load (a repo-tree
 * fetch + conflicts warm) completes in well under this; past it, an unavailable
 * dataset is treated as a permanent failure rather than a still-loading warm-up.
 */
export const DATA_LOAD_GRACE_S = 60;

export interface ReadinessState {
  state: 'warming' | 'failed';
  reason: string;
}

// Structural view of the optional data-load status the storage backend may
// expose (Server Storage, t/2053: `getDataLoadStatus()`). Feature-detected so
// /healthz names a cause whether or not that method is present on the running
// backend — no hard build/runtime dependency on t/2053 landing first.
interface DataLoadStatusProvider {
  getDataLoadStatus?: () => { status: 'loading' | 'ready' | 'failed'; error?: string };
}

/**
 * Classify a not-ready (`isDataAvailable() === false`) /healthz result as either
 * a normal warm-up or a permanent failure, and name the cause. Pure: `uptimeS`
 * (seconds since process start, e.g. `process.uptime()`) is injected so callers
 * and tests control the grace clock deterministically.
 */
export function classifyDataUnavailable(ctx: ServerCtx, uptimeS: number): ReadinessState {
  const backend = ctx.getGithubBackend();

  // 1. Richest signal, when the backend exposes it (t/2053): its own data-load
  //    status carries the concrete transport cause.
  const provider = backend as unknown as DataLoadStatusProvider | null;
  const status = typeof provider?.getDataLoadStatus === 'function' ? provider.getDataLoadStatus() : null;
  if (status?.status === 'failed') {
    return { state: 'failed', reason: `data-load failed: ${status.error ?? 'unknown cause'}` };
  }

  // 2. Transport circuit open ⇒ the GitHub data load is systematically failing.
  if (backend && backend.getCircuitState() === 'open') {
    return { state: 'failed', reason: 'data-load failed: github-api circuit open' };
  }

  // 3. No definitive failure signal: within the grace window this is a normal
  //    cold-start warm-up; past it, an indefinite 503 is a permanent failure.
  if (uptimeS <= DATA_LOAD_GRACE_S) {
    return { state: 'warming', reason: `data load in progress (uptime ${Math.round(uptimeS)}s)` };
  }
  return {
    state: 'failed',
    reason: `data-load failed: taxonomy data still unavailable after ${Math.round(uptimeS)}s (grace ${DATA_LOAD_GRACE_S}s exhausted)`,
  };
}
