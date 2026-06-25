// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * In-memory round-robin key rotator (t/835, part of t/833).
 *
 * BYOK users can register multiple API keys per backend to multiply their
 * effective rate-limit quota. This module hands out keys round-robin and skips
 * keys that recently hit a 429 until their cooldown expires.
 *
 * State is per-process and intentionally not persisted: rate-limit windows are
 * short-lived, and a restart simply re-probes. Keyed by backend; the rotation
 * counter and cooldowns survive across requests within a process.
 */

/** Per-backend round-robin cursor → next index to consider. */
const counters = new Map<string, number>();

/** `${backend}:${index}` → epoch-ms when the cooldown expires. */
const cooldowns = new Map<string, number>();

function cooldownKey(backend: string, index: number): string {
  return `${backend}:${index}`;
}

/** Whether the key at `index` for `backend` is currently in a 429 cooldown.
 *  Expired entries are cleared lazily on read. */
export function isRateLimited(backend: string, index: number): boolean {
  const k = cooldownKey(backend, index);
  const until = cooldowns.get(k);
  if (until === undefined) return false;
  if (until <= Date.now()) { cooldowns.delete(k); return false; }
  return true;
}

/** Mark the key at `index` rate-limited for `retryAfterMs` (clamped to ≥0). */
export function markRateLimited(backend: string, index: number, retryAfterMs: number): void {
  cooldowns.set(cooldownKey(backend, index), Date.now() + Math.max(0, retryAfterMs));
}

/** Drop every expired cooldown entry. Cheap to call per-request. */
export function clearExpiredLimits(): void {
  const now = Date.now();
  for (const [k, until] of cooldowns) {
    if (until <= now) cooldowns.delete(k);
  }
}

/**
 * Pick the next key for `backend` from `keys`, round-robin, skipping any in
 * cooldown. Returns null only for an empty list. If every key is rate-limited,
 * returns the one whose cooldown expires soonest (best chance of success).
 * The internal cursor advances so sequential calls distribute evenly.
 */
export function getNextKey(backend: string, keys: string[]): { key: string; index: number } | null {
  if (keys.length === 0) return null;
  clearExpiredLimits();
  const n = keys.length;
  const start = (counters.get(backend) ?? 0) % n;

  for (let i = 0; i < n; i++) {
    const index = (start + i) % n;
    if (!isRateLimited(backend, index)) {
      counters.set(backend, index + 1);
      return { key: keys[index], index };
    }
  }

  // All rate-limited → pick the soonest-to-recover key.
  let best = 0;
  let bestUntil = Infinity;
  for (let index = 0; index < n; index++) {
    const until = cooldowns.get(cooldownKey(backend, index)) ?? 0;
    if (until < bestUntil) { bestUntil = until; best = index; }
  }
  counters.set(backend, best + 1);
  return { key: keys[best], index: best };
}

/** Test-only: reset all in-memory rotation state. */
export function _resetRotatorState(): void {
  counters.clear();
  cooldowns.clear();
}
