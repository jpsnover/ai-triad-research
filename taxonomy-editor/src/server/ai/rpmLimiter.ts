// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// NOTE: this is an in-process limiter — it enforces RPM per replica.
// Correct while maxReplicas=1 (current ACA config, per t/3046).
// If replicas scale beyond 1, the effective limit becomes N×RPM and
// this must be replaced with a shared counter (Redis / Durable Object).

export class RpmLimiter {
  // Burst is intentional: the first idle window can serve up to ~(2·rpm−1) calls
  // before steady-state pacing kicks in. This lets a single debate's ~12 opening
  // calls burst through a 15-RPM Gemini cap instead of dribbling over 44s.
  // Sustained concurrent overload is paced to rpm/min after the burst. A strict
  // rolling-window provider can still 429 the initial burst under multi-user
  // cold-start; withRetry covers that residual.
  private nextAllowed: number;
  private readonly intervalMs: number;
  private readonly burstMs: number;

  constructor(rpm: number, nowMs: number = Date.now()) {
    this.intervalMs = 60_000 / rpm;
    this.burstMs = (rpm - 1) * this.intervalMs;
    this.nextAllowed = nowMs - this.burstMs; // allow initial burst
  }

  /**
   * Pure scheduling computation — returns waitMs (may be ≤ 0 → no wait).
   * Accepts `now` as a param so callers can unit-test monotonic pacing synchronously
   * without real wall-clock sleeps (Guard Testability, t/3052 TL condition #2).
   *
   * GCRA: each caller atomically advances `nextAllowed` by `intervalMs`, claiming
   * a unique future slot. No lock or queue needed — single-threaded JS ensures the
   * read-compute-write is never interleaved between concurrent `reserve()` calls.
   */
  reserve(now: number): number {
    // Clamp to (now − burstMs) so idle time refills burst capacity.
    const slot = Math.max(this.nextAllowed, now - this.burstMs);
    this.nextAllowed = slot + this.intervalMs;
    return slot - now;
  }

  async acquire(): Promise<void> {
    const waitMs = this.reserve(Date.now());
    if (waitMs > 0) await new Promise<void>(r => setTimeout(r, waitMs));
  }
}

const _limiters = new Map<string, RpmLimiter>();

/** Return (or create) the per-key GCRA limiter. `key` is the full API key string. */
export function getLimiter(key: string, rpm: number): RpmLimiter {
  if (!_limiters.has(key)) _limiters.set(key, new RpmLimiter(rpm));
  return _limiters.get(key)!;
}

/** Reset all limiter state — for test isolation only. */
export function resetLimiters(): void {
  _limiters.clear();
}
