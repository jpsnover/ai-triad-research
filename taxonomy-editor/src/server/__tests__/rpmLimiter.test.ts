// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach } from 'vitest';
import { RpmLimiter, getLimiter, resetLimiters } from '../ai/rpmLimiter.js';

// Use rpm=3 so intervalMs=20_000 and burstMs=40_000 — keeps expected values legible.
const RPM = 3;
const INTERVAL_MS = 60_000 / RPM; // 20_000

// Tests call reserve(now) directly — no setTimeout, no real wall-clock elapsed-ms assertions.
// This satisfies TL condition #2 (Guard Testability): the pacing predicate is tested
// synchronously and cannot flake on CI timing. acquire() is a thin wrapper and is not
// tested for real wait durations (that would be a CI latency oracle).

describe('RpmLimiter.reserve() — synchronous GCRA scheduling (t/3052)', () => {
  let limiter: RpmLimiter;

  beforeEach(() => {
    // nowMs=0 makes arithmetic exact; interval and burstMs are all multiples of 20_000.
    limiter = new RpmLimiter(RPM, /* nowMs= */ 0);
  });

  it('burst arm: first rpm calls all return ≤ 0 (no pacing)', () => {
    for (let i = 0; i < RPM; i++) {
      expect(limiter.reserve(0)).toBeLessThanOrEqual(0);
    }
  });

  it('pace arm (N+K concurrent): over-cap calls have strictly monotonic positive waits', () => {
    // Exhaust the burst
    for (let i = 0; i < RPM; i++) limiter.reserve(0);

    // Collect K over-cap wait values (all at now=0, simulating concurrent callers)
    const K = 5;
    const waits: number[] = [];
    for (let k = 1; k <= K; k++) {
      waits.push(limiter.reserve(0));
    }

    // k-th over-cap caller waits exactly k × intervalMs
    for (let k = 0; k < K; k++) {
      expect(waits[k]).toBe((k + 1) * INTERVAL_MS);
    }

    // Strictly monotone: each wait > the previous (no batch-release)
    for (let k = 1; k < K; k++) {
      expect(waits[k]).toBeGreaterThan(waits[k - 1]);
    }
  });

  it('idle refill: after burstMs idle, burst capacity refills and all rpm calls pass', () => {
    // Exhaust burst at now=0; nextAllowed lands at 1×INTERVAL_MS after the 3rd caller.
    for (let i = 0; i < RPM; i++) limiter.reserve(0);

    // Advance to 3×INTERVAL_MS (2×INTERVAL_MS idle past the last slot → refills burst).
    const idleNow = 3 * INTERVAL_MS; // 60_000
    for (let i = 0; i < RPM; i++) {
      expect(limiter.reserve(idleNow)).toBeLessThanOrEqual(0);
    }
  });

  it('getLimiter: same key returns the same instance', () => {
    resetLimiters();
    const a = getLimiter('fake-api-key-gemini-1', RPM);
    const b = getLimiter('fake-api-key-gemini-1', RPM);
    expect(a).toBe(b);
  });

  it('getLimiter: different keys return different instances', () => {
    resetLimiters();
    const a = getLimiter('fake-api-key-gemini-1', RPM);
    const b = getLimiter('fake-api-key-groq-1', 30);
    expect(a).not.toBe(b);
  });

  it('resetLimiters: clears the singleton map so getLimiter returns a fresh instance', () => {
    resetLimiters();
    const a = getLimiter('fake-api-key-gemini-1', RPM);
    resetLimiters();
    const b = getLimiter('fake-api-key-gemini-1', RPM);
    expect(a).not.toBe(b);
  });

  it('acquire() resolves immediately when no pacing needed', async () => {
    const fresh = new RpmLimiter(RPM, Date.now());
    // Should resolve without any setTimeout delay (burst arm)
    await expect(fresh.acquire()).resolves.toBeUndefined();
  });
});
