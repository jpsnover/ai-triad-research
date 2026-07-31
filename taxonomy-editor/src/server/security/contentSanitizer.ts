// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Server-side content sanitization (t/856, XSS defense-in-depth).
 *
 * The pure sanitize logic — entity-decode canonicalization (t/2030), executable
 * tag / dangerous-scheme neutralization (t/856/t/2027), and the per-string
 * MAX_SANITIZE_INPUT cap (t/2029) — lives in the shared, dependency-light
 * `lib/sanitize/contentSanitizerCore.ts` so the Electron main-process
 * admin-promote path can share ONE copy (t/2035; extracted per TL t/2033#6).
 *
 * This server module is the server-only WRAPPER around that core. It adds the two
 * server-specific concerns the core deliberately excludes:
 *   1. the t/2031 aggregate wall-time DoS budget (AsyncLocalStorage) — a defense
 *      for the PUBLIC HTTP surface against remote event-loop exhaustion; and
 *   2. pino logging (`log.security.warn`) — injected into the core via its `onWarn`
 *      hook for the oversize-input warning, and emitted directly here for the
 *      budget-exhausted warning (which the core never raises — it has no budget).
 */

import { AsyncLocalStorage } from 'async_hooks';
import { performance } from 'perf_hooks';
import { sanitizeText, MAX_SANITIZE_INPUT } from '../../../../lib/sanitize/contentSanitizerCore.js';
import type { SanitizeWarn } from '../../../../lib/sanitize/contentSanitizerCore.js';
import { log } from '../logger.js';

// Re-export the per-string cap so existing boundary tests keep a single source of
// truth via this module (`../security/contentSanitizer.js`).
export { MAX_SANITIZE_INPUT };

// t/2031 — aggregate sanitize-work budget (multi-field DoS amplification).
// sanitizeText is per-CALL capped (t/2029, ~150 ms worst at 32 KiB), but a walk
// that sanitizes many fields — community.ts `stripSensitiveKeys`, `sanitizeDeep` —
// had no cap on field COUNT: ~1,600 crafted 32 KiB fields ≈ ~240 s of synchronous
// event-loop block in one request. `withEndpointTimeout` can't preempt it (a
// setTimeout only fires once the CPU-bound loop yields).
//
// Fix: a WALK-SCOPED wall-time budget. `withSanitizeBudget(fn)` seeds a deadline in
// AsyncLocalStorage for the (synchronous) walk; once past it, `sanitizeUserText`
// drops remaining fields to '' — fail-safe: never stores unsanitized content —
// bounding total STRING-SANITIZE work (the O(n²)-prone part this targets) to
// ~SANITIZE_WALL_BUDGET_MS regardless of field count/size. (The budget is checked at
// string-leaf entry, so pure-structural object/array traversal with no string leaves
// is not clipped by it — but that is O(field-count), already bounded by the request
// body-size limit to low-single-digit seconds, not the O(n²) blow-up this addresses.)
//
// SERVER-ONLY (TL t/2033#6): the budget defends a public HTTP surface. The desktop
// admin-promote path imports the pure core WITHOUT this wrapper — local-admin
// event-loop stalls are self-inflicted and restart-recoverable, not a shared-service
// DoS.
//
// TIME, not bytes (TL e/53#2): legit content is cheap (~1 ms even at 32 KiB — the
// O(n²) fold cost only fires on crafted `<script`-repeat / deep-entity fields), so a
// byte cap tight enough to bound the attack would truncate legit large submissions;
// a wall-time budget can't be reached by legit content yet bounds any crafted
// distribution. ACCEPTED PROPERTY (TL e/53#2): output is therefore timing-dependent —
// the identical submission could truncate under extreme concurrent load. Acceptable
// because it is always FAIL-SAFE (truncated → '' → nothing unsanitized stored) and,
// since legit content finishes in ~ms, only ever bites crafted payloads in practice.
//
// 2000 ms sits far below every applicable request timeout — the community promote
// path (the live caller) has no `withEndpointTimeout`; the server sets no
// `requestTimeout` (Node default ~300 s); other endpoints' `withEndpointTimeout` is
// 35–50 s — so the budget always truncates BEFORE any endpoint timeout fires (TL
// condition, e/53#2).
export const SANITIZE_WALL_BUDGET_MS = 2000;

interface SanitizeBudget { deadline: number; loggedTruncation: boolean; }
const budgetAls = new AsyncLocalStorage<SanitizeBudget>();

/**
 * Run `fn` under a walk-scoped sanitize wall-time budget shared by every
 * `sanitizeUserText` call inside it. Returns `fn`'s result (walks are synchronous).
 *
 * RE-ENTRANT-SAFE (TL Q1, load-bearing, e/53#2): if a budget is already active, run
 * under the EXISTING one — never seed a fresh deadline. This is what lets
 * `sanitizeDeep`'s self-wrap compose inside an outer caller wrap (community.ts's
 * `withSanitizeBudget(() => stripSensitiveKeys(...))`) without resetting the
 * aggregate cap mid-walk — which would reopen the DoS.
 */
export function withSanitizeBudget<T>(fn: () => T): T {
  if (budgetAls.getStore()) return fn(); // already budgeted — compose, don't reseed
  return budgetAls.run({ deadline: performance.now() + SANITIZE_WALL_BUDGET_MS, loggedTruncation: false }, fn);
}

// Injected into the pure core: log the per-string oversize-input truncation via
// pino (never the content — secrets rule). Message + fields kept identical to the
// pre-extraction inline log so server behavior is byte-preserving.
const onWarn: SanitizeWarn = (w) => {
  log.security.warn(
    { originalLength: w.originalLength, cap: w.cap },
    'sanitizeUserText: input exceeded cap — truncated before sanitization',
  );
};

/**
 * Sanitize a single string on the server: the pure core plus the t/2031 aggregate
 * wall-time budget.
 */
export function sanitizeUserText(s: string): string {
  // t/2031 aggregate budget: once the walk-scoped wall-time budget is spent, drop
  // remaining fields to '' (fail-safe — never store unsanitized content). Checked at
  // field ENTRY, so the field that overran runs to completion and only SUBSEQUENT
  // fields are dropped (total overrun ≤ budget + one field's worst ~150 ms). No-op
  // outside a withSanitizeBudget walk (single-field callers, tests) → unchanged.
  const budget = budgetAls.getStore();
  if (budget && performance.now() > budget.deadline) {
    if (!budget.loggedTruncation) {
      budget.loggedTruncation = true; // once per walk — no content (secrets rule)
      try {
        log.security.warn(
          { budgetMs: SANITIZE_WALL_BUDGET_MS },
          'sanitizeUserText: walk sanitize budget exhausted — remaining fields dropped',
        );
      } catch { /* telemetry — silent by design: logging must never break sanitization */ }
    }
    return '';
  }
  return sanitizeText(s, onWarn);
}

/**
 * Recursively sanitize every string in a JSON-like value (arrays/objects).
 *
 * t/2031: the whole walk runs under ONE shared sanitize budget via the self-wrap
 * below, so a deeply-nested / many-field value can't amplify per-field cost without
 * bound. The re-entrant guard in withSanitizeBudget means a caller that already
 * established a budget (community.ts's stripSensitiveKeys wrap) keeps its budget
 * across a nested sanitizeDeep — the two compose instead of reseeding.
 */
export function sanitizeDeep<T>(value: T): T {
  return withSanitizeBudget(() => sanitizeDeepInner(value));
}

function sanitizeDeepInner<T>(value: T): T {
  if (typeof value === 'string') return sanitizeUserText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(sanitizeDeepInner) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeDeepInner(v);
    return out as unknown as T;
  }
  return value;
}
