// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2059: /healthz must render a permanently-failed data load distinctly from a
// normal cold-start warm-up (not a silent bare 503). These assert the two states
// render distinctly and that `failed` carries the underlying cause.

import { describe, it, expect } from 'vitest';
import { classifyDataUnavailable, DATA_LOAD_GRACE_S } from '../routes/readiness.js';
import type { ServerCtx } from '../routes/context.js';

function makeCtx(backend: unknown): ServerCtx {
  return { getGithubBackend: () => backend } as unknown as ServerCtx;
}

describe('classifyDataUnavailable (t/2059 — /healthz warming vs failed)', () => {
  it('within grace, no failure signal → warming', () => {
    const r = classifyDataUnavailable(makeCtx(null), 5);
    expect(r.state).toBe('warming');
    expect(r.reason).toMatch(/in progress/);
  });

  it('past grace with no data → failed, names grace exhaustion', () => {
    const r = classifyDataUnavailable(makeCtx(null), DATA_LOAD_GRACE_S + 1);
    expect(r.state).toBe('failed');
    expect(r.reason).toMatch(/grace .*exhausted/);
  });

  it('github circuit open → failed even within the grace window', () => {
    const backend = { getCircuitState: () => 'open' };
    const r = classifyDataUnavailable(makeCtx(backend), 1);
    expect(r.state).toBe('failed');
    expect(r.reason).toMatch(/circuit open/);
  });

  it('backend getDataLoadStatus=failed → failed, surfaces the concrete cause (t/2053)', () => {
    const backend = {
      getCircuitState: () => 'closed',
      getDataLoadStatus: () => ({ status: 'failed' as const, error: 'fetch failed: ECONNRESET' }),
    };
    const r = classifyDataUnavailable(makeCtx(backend), 1);
    expect(r.state).toBe('failed');
    expect(r.reason).toContain('ECONNRESET');
  });

  it('backend without getDataLoadStatus still classifies (feature-detected, no hard dep on t/2053)', () => {
    const backend = { getCircuitState: () => 'closed' }; // no getDataLoadStatus method
    const warming = classifyDataUnavailable(makeCtx(backend), 2);
    const failed = classifyDataUnavailable(makeCtx(backend), DATA_LOAD_GRACE_S + 5);
    expect(warming.state).toBe('warming');
    expect(failed.state).toBe('failed');
  });

  it('warming and failed render distinct states AND distinct reasons', () => {
    const warming = classifyDataUnavailable(makeCtx(null), 1);
    const failed = classifyDataUnavailable(makeCtx(null), DATA_LOAD_GRACE_S + 30);
    expect(warming.state).not.toBe(failed.state);
    expect(warming.reason).not.toBe(failed.reason);
  });
});
