// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// NOTE: in-process rotator — per replica. Correct while maxReplicas=1 (t/3046).
// If replicas scale beyond 1, the effective per-key call rate becomes N×actual
// and this must be replaced with a shared counter (Redis / Durable Object).

import { getLimiter } from './rpmLimiter.js';
import { is429Error, retryAfterMs } from './providerErrors.js';
import { FREE_TIER_RPM_PER_KEY, parseFreeTierKeys } from './proxyTiers.js';
import { log } from '../logger.js';

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

// Lazily-evaluated free-tier key set — reads the env var once per process lifetime.
// Using a function (not a module-level constant) keeps tests that mutate process.env
// working without cache invalidation logic.
function freeTierKeySet(): Set<string> {
  return new Set(parseFreeTierKeys(process.env.FREE_TIER_GEMINI_KEY));
}

/**
 * Select the next available key (round-robin, 429-cooldown-aware), pace it if it
 * belongs to the free-tier pool (detected via parseFreeTierKeys — no flag to
 * thread or forget), call fn(key), and on 429 mark the key cooled until Retry-After.
 *
 * Pacing applies automatically to every caller that uses a free-tier key — paid /
 * BYOK paths carry their own keys and are never in the pool, so they bypass pacing
 * with no per-call configuration.
 *
 * Per-caller audit (t/3052 #4 completeness): primary debate path (generateWithPaidFallback),
 * /api/ai/search, /api/ai/generate, chat-stream, sources evidence-eval (sources.ts),
 * news-report (debates.ts), web op-ed (opedAdapter.ts), and generateWithSearch all
 * route through callWithKeyRotation. Those that pass the FREE_TIER_GEMINI_KEY pool
 * explicitly are paced. Those that pass getApiKeys() keys (BYOK/platform GEMINI_API_KEY)
 * are not in the pool and correctly bypass pacing — no flag to thread or forget.
 */
export async function callWithKeyRotation<T>(
  backend: string,
  keys: string[],
  fn: (key: string) => Promise<T>,
): Promise<T> {
  const key = nextKey(backend, keys);
  if (freeTierKeySet().has(key)) {
    await getLimiter(key, FREE_TIER_RPM_PER_KEY).acquire();
  }
  try {
    return await fn(key);
  } catch (err) {
    if (is429Error(err)) {
      const delay = retryAfterMs(err);
      markKeyCooled(key, delay);
      log.api.warn('keyRotator: 429 on key, cooling for %dms', delay);
    }
    throw err;
  }
}

/** Reset all rotator state — for test isolation only. */
export function resetRotator(): void {
  _cursors.clear();
  _cooldowns.clear();
}
