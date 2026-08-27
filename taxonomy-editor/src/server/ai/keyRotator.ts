// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// NOTE: in-process rotator — per replica. Correct while maxReplicas=1 (t/3046).
// If replicas scale beyond 1, the effective per-key call rate becomes N×actual
// and this must be replaced with a shared counter (Redis / Durable Object).

import { getLimiter } from './rpmLimiter.js';
import { is429Error, retryAfterMs } from './providerErrors.js';
import { FREE_TIER_RPM_PER_KEY } from './proxyTiers.js';

const _cursors = new Map<string, number>();   // backend → next-cursor index
const _cooldowns = new Map<string, number>();  // full api key → cooldown expiry ms

// Round-robin across keys, skipping any in their 429 cooldown window.
// No within-call rotation — a single callWithKeyRotation picks one key and uses
// it for the duration of that call; rotation applies across successive calls (v1).
function nextKey(backend: string, keys: string[]): string {
  const base = _cursors.get(backend) ?? 0;
  const N = keys.length;
  const now = Date.now();
  for (let i = 0; i < N; i++) {
    const k = keys[(base + i) % N];
    const exp = _cooldowns.get(k);
    if (!exp || now >= exp) {
      _cursors.set(backend, (base + i + 1) % N);
      return k;
    }
  }
  // All keys cooled — fall through to base-slot key; outer withRetry handles the 429.
  _cursors.set(backend, (base + 1) % N);
  return keys[base % N];
}

function markKeyCooled(key: string, delayMs: number): void {
  _cooldowns.set(key, Date.now() + delayMs);
}

/**
 * Select the next available key (round-robin, 429-cooldown-aware), optionally
 * pace it via a per-key GCRA bucket at FREE_TIER_RPM_PER_KEY RPM, call fn(key),
 * and on 429 mark the key cooled so subsequent calls skip it until Retry-After.
 *
 * isServerFreeTier=false bypasses pacing — used for paid/BYOK paths that carry
 * their own key and don't share the free pool.
 */
export async function callWithKeyRotation<T>(
  backend: string,
  keys: string[],
  isServerFreeTier: boolean,
  fn: (key: string) => Promise<T>,
): Promise<T> {
  const key = nextKey(backend, keys);
  if (isServerFreeTier) {
    await getLimiter(key, FREE_TIER_RPM_PER_KEY).acquire();
  }
  try {
    return await fn(key);
  } catch (err) {
    if (is429Error(err)) markKeyCooled(key, retryAfterMs(err));
    throw err;
  }
}

/** Reset all rotator state — for test isolation only. */
export function resetRotator(): void {
  _cursors.clear();
  _cooldowns.clear();
}
