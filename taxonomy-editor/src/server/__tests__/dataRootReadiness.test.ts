// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3309 — the cache-once data-root readiness singleton that backs the /readyz gate.
// Verifies the three-state machine (validating → ready | failed) the boot validation block
// drives and the /readyz handler reads. Pure state, no I/O — so this is a fast unit test.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDataRootReadyState,
  setDataRootReady,
  setDataRootFailed,
  __resetDataRootReadinessForTest,
} from '../routes/dataRootReadiness.js';

describe('dataRootReadiness singleton (t/3309)', () => {
  beforeEach(() => __resetDataRootReadinessForTest());

  it("starts 'validating' with no reason (initial state before boot validation resolves)", () => {
    expect(getDataRootReadyState()).toEqual({ state: 'validating' });
  });

  it("setDataRootReady() → 'ready', no reason", () => {
    setDataRootReady();
    expect(getDataRootReadyState()).toEqual({ state: 'ready' });
  });

  it("setDataRootFailed(reason) → 'failed' carrying the cause", () => {
    setDataRootFailed("sentinel 'taxonomy/' present but empty");
    expect(getDataRootReadyState()).toEqual({ state: 'failed', reason: "sentinel 'taxonomy/' present but empty" });
  });

  it('recovers ready → failed → ready (a flapping replica re-caches each transition)', () => {
    setDataRootReady();
    expect(getDataRootReadyState().state).toBe('ready');
    setDataRootFailed('github-api transiently unreachable after 3 attempts');
    expect(getDataRootReadyState().state).toBe('failed');
    setDataRootReady();
    expect(getDataRootReadyState()).toEqual({ state: 'ready' }); // reason cleared on recovery
  });

  it('the getter returns the live cached value (no per-call recomputation)', () => {
    setDataRootFailed('no creds');
    const a = getDataRootReadyState();
    const b = getDataRootReadyState();
    expect(a).toEqual(b);
    expect(a.state).toBe('failed');
  });
});
