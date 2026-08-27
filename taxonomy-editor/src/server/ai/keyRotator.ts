// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// NOTE: in-process rotator — per replica. Correct while maxReplicas=1 (t/3046).
// If replicas scale beyond 1, the effective per-key call rate becomes N×actual
// and this must be replaced with a shared counter (Redis / Durable Object).

import { createHash } from 'node:crypto';
import { getLimiter } from './rpmLimiter.js';
import { is429Error, retryAfterMs } from './providerErrors.js';
import { FREE_TIER_RPM_PER_KEY, parseFreeTierKeys } from './proxyTiers.js';
import { log } from '../logger.js';

const _cursors = new Map<string, number>();   // backend → next-cursor index
const _cooldowns = new Map<string, number>();  // full api key → cooldown expiry ms

function keyHash(key: string): string {
  // codeql[js/insufficient-password-hash] -- not password storage; partial-key (75%) SHA-256 truncated to 8-char log-safe fingerprint, never stored or verified as a credential.
  return createHash('sha256').update(key.slice(0, Math.floor(key.length * 0.75))).digest('hex').slice(0, 8);
}

// Round-robin across keys, skipping any in their 429 cooldown window.
function nextKey(backend: string, keys: string[]): { key: string; slot: number } {
  const base = _cursors.get(backend) ?? 0;
  const N = keys.length;
  const now = Date.now();
  for (let i = 0; i < N; i++) {
    const slot = (base + i) % N;
    const k = keys[slot];
    const exp = _cooldowns.get(k);
    if (!exp || now >= exp) {
      _cursors.set(backend, (slot + 1) % N);
      return { key: k, slot };
    }
  }
  // All keys cooled — fall through to base-slot key; outer withRetry handles the 429.
  const slot = base % N;
  _cursors.set(backend, (base + 1) % N);
  return { key: keys[slot], slot };
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
 * Rotation and pacing share one discriminator: allFree = every key in `keys` is a
 * free-tier pool member. BYOK/platform callers pass a single non-pool key → allFree
 * is false → they bypass both rotation (cursor untouched) and pacing (no rate limit).
 * This prevents BYOK keys[0] (len=1) from resetting the shared free-tier cursor to 0
 * and skewing round-robin distribution (t/3057).
 *
 * v1 assumption: non-pool callers always pass a single key. If multi-key non-pool
 * callers are ever added, they will always receive keys[0] without rotation — revisit.
 *
 * On 429, the cooled key is marked and the loop immediately tries the next available
 * key (up to keys.length attempts for free-tier). This prevents outer withRetry from
 * burning its 120s minimum backoff against the same exhausted key (t/3062). When all
 * keys are 429'd the last error is rethrown so outer withRetry backs off normally.
 * AbortError bypasses rotation and propagates immediately.
 *
 * Per-caller audit (t/3052 #4, updated t/3061+t/3062): all server paths using the
 * FREE_TIER_GEMINI_KEY pool were audited:
 * - Generate: generateWithPaidFallback, /api/ai/search, /api/ai/generate, chat-stream,
 *   sources.ts, debates.ts, opedAdapter.ts, generateWithSearch → all route here ✓
 * - Embeddings: /api/embeddings/compute + /api/embeddings/query → local ONNX, key=undefined,
 *   bypass pacing (zero Gemini quota); separate embed:<ip> bucket guards CPU-abuse (t/3061) ✓
 * - NLI: /api/nli/classify → passes key pool directly to classifyNli (t/3061 t/1650 restore) ✓
 * - resolveExplicitAiKey (routes/ai.ts + chat.ts): returns full array for callWithKeyRotation ✓
 * - server.ts + meta.ts: pool size diagnostic only, no AI calls ✓
 * BYOK/platform pass a single non-pool key → allFree=false → bypass pacing (no flag to thread).
 */
export async function callWithKeyRotation<T>(
  backend: string,
  keys: string[],
  fn: (key: string) => Promise<T>,
): Promise<T> {
  const pool = freeTierKeySet();
  // keys.length > 0 guard: [].every() is vacuously true; empty keys should fail before here.
  const allFree = keys.length > 0 && keys.every(k => pool.has(k));
  // Free-tier: try each key at most once before letting outer withRetry back off.
  // BYOK: single attempt — no rotation.
  const maxAttempts = allFree ? keys.length : 1;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { key, slot } = allFree ? nextKey(backend, keys) : { key: keys[0], slot: undefined };
    const kh = keyHash(key);
    log.api.debug({ key_hash: kh, key_slot: slot, backend, attempt }, 'keyRotator: selected');
    if (allFree) {
      await getLimiter(key, FREE_TIER_RPM_PER_KEY).acquire();
    }
    try {
      return await fn(key);
    } catch (err) {
      // Abort must never rotate — propagate immediately.
      if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err;
      if (is429Error(err)) {
        const delay = retryAfterMs(err);
        markKeyCooled(key, delay);
        log.api.warn({ key_hash: kh, key_slot: slot, delay_ms: delay, attempt }, 'keyRotator: 429 on key, cooling — trying next');
        lastErr = err;
        continue; // immediately try next key; no sleep
      }
      throw err;
    }
  }
  // All keys 429'd — rethrow so outer withRetry sees the 429 and backs off.
  throw lastErr;
}

/** Reset all rotator state — for test isolation only. */
export function resetRotator(): void {
  _cursors.clear();
  _cooldowns.clear();
}
