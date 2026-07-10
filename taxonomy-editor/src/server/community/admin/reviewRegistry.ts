// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Server-side registry + aggregation for the unified admin review panel (t/646).
 *
 * Domains (calibration, community, taxonomy) register a {@link ReviewDomainHandler}
 * at startup. The shared admin endpoints in `server.ts` delegate here:
 *   - `GET  /api/admin/review/queue` → {@link getReviewQueue}
 *   - `GET  /api/admin/review/stats` → {@link getReviewStats}
 *   - `POST /api/admin/review/action` → {@link executeReviewAction}
 *
 * Admin gating uses the existing `isAdmin()` from `community.ts` (reuse, not
 * duplicate) via {@link requireAdmin}.
 */

import type http from 'http';
import { ActionableError } from '../../../../../lib/debate/errors.js';
import { getGlobalRecorder } from '../../../../../lib/flight-recorder/index.js';
import { isAdmin } from '../community.js';
import { getStorageUserId } from '../../security/userContext.js';
import type { ReviewAction, ReviewDomainHandler, ReviewItem, ReviewStats } from './types.js';

// ── Handler registry ──

const handlers = new Map<string, ReviewDomainHandler>();

/** Register a domain handler. A later registration for the same domain replaces
 *  the earlier one (idempotent on re-import during dev/HMR). */
export function registerReviewHandler(handler: ReviewDomainHandler): void {
  handlers.set(handler.domain, handler);
}

/** Look up a handler by domain key, or undefined if none is registered. */
export function getReviewHandler(domain: string): ReviewDomainHandler | undefined {
  return handlers.get(domain);
}

/** All registered handlers, in registration order. */
export function listReviewHandlers(): ReviewDomainHandler[] {
  return [...handlers.values()];
}

/** Remove all handlers and cached results — test isolation only. */
export function clearReviewHandlers(): void {
  handlers.clear();
  clearReviewCache();
}

// ── Admin middleware ──

/**
 * Gate a request to admins. Writes a 403 and returns false for non-admins;
 * returns true (no response written) for admins. Reuses `isAdmin()` so the
 * `ADMIN_USERS` policy lives in one place.
 *
 * Usage in a route handler:
 *   if (!requireAdmin(res)) return;
 */
export function requireAdmin(res: http.ServerResponse): boolean {
  if (isAdmin()) return true;
  // Record the rejected admin attempt — useful for spotting probing / misconfig.
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'admin-review',
    level: 'warn',
    message: `Admin route rejected for non-admin user "${getStorageUserId()}"`,
  });
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Forbidden' }));
  return false;
}

// ── Cache ──

interface CacheEntry<T> { value: T; expiresAt: number }
const CACHE_TTL_MS = 60_000;
const statsCache = new Map<string, CacheEntry<ReviewStats>>();
const queueCache = new Map<string, CacheEntry<ReviewItem[]>>();

function cacheKey(userId?: string): string { return userId ?? '__none__'; }

/** Clear cached review data — test isolation or after handler registration changes. */
export function clearReviewCache(): void {
  statsCache.clear();
  queueCache.clear();
}

// ── Aggregation ──

/**
 * Aggregate pending review groups across all registered handlers, newest first.
 * Handlers run in parallel via Promise.allSettled — a rejected handler is
 * recorded and skipped (one failing domain must not blank the entire queue).
 * Results are cached for 60s per userId.
 */
export async function getReviewQueue(userId?: string): Promise<ReviewItem[]> {
  const key = cacheKey(userId);
  const cached = queueCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const handlerList = [...handlers.values()];
  const results = await Promise.allSettled(
    handlerList.map(h => h.getPendingItems(userId)),
  );
  const all: ReviewItem[] = [];
  const failedDomains: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      all.push(...r.value);
    } else {
      failedDomains.push(handlerList[i].domain);
    }
  }
  if (failedDomains.length) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'admin-review',
      level: 'warn',
      message: `getReviewQueue: ${failedDomains.length} handler(s) failed [${failedDomains.join(', ')}]`,
    });
  }
  all.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  queueCache.set(key, { value: all, expiresAt: Date.now() + CACHE_TTL_MS });
  return all;
}

/**
 * Per-domain badge counts (number of review groups per domain) plus the total.
 * Handlers run in parallel; failing handlers report 0 for their domain.
 * Results are cached for 60s per userId.
 */
export async function getReviewStats(userId?: string): Promise<ReviewStats> {
  const key = cacheKey(userId);
  const cached = statsCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const handlerList = [...handlers.values()];
  const results = await Promise.allSettled(
    handlerList.map(h => h.getPendingItems(userId)),
  );
  const byDomain: Record<string, number> = {};
  let total = 0;
  const failedDomains: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const domain = handlerList[i].domain;
    if (r.status === 'fulfilled') {
      byDomain[domain] = r.value.length;
      total += r.value.length;
    } else {
      failedDomains.push(domain);
      byDomain[domain] = 0;
    }
  }
  if (failedDomains.length) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'admin-review',
      level: 'warn',
      message: `getReviewStats: ${failedDomains.length} handler(s) failed [${failedDomains.join(', ')}]`,
    });
  }
  const stats: ReviewStats = { total, byDomain };
  statsCache.set(key, { value: stats, expiresAt: Date.now() + CACHE_TTL_MS });
  return stats;
}

/**
 * Fetch the domain-specific detail payload for a review group's right-pane viewer.
 * The owning domain is taken from the `domain:` prefix of the group id (the
 * `${domain}:${submitter}` convention from {@link ReviewItem.id}). Throws an
 * {@link ActionableError} when the domain can't be resolved to a handler.
 */
export async function getReviewDetail(groupId: string): Promise<unknown> {
  const domain = groupId.includes(':') ? groupId.slice(0, groupId.indexOf(':')) : groupId;
  const handler = handlers.get(domain);
  if (!handler) {
    throw new ActionableError({
      goal: `Load review detail for group "${groupId}"`,
      problem: `Could not resolve domain "${domain}" from the group id to a registered handler.`,
      location: 'server/admin/reviewRegistry.ts → getReviewDetail',
      nextSteps: [
        'Use a group id of the form "{domain}:{submitter}"',
        `Registered domains: ${[...handlers.keys()].join(', ') || '(none)'}`,
      ],
    });
  }
  return handler.getDetailForViewer(groupId);
}

/**
 * Route a promote/reject decision to the owning domain handler. Throws an
 * {@link ActionableError} if no handler is registered for the action's domain.
 */
export async function executeReviewAction(action: ReviewAction): Promise<void> {
  const handler = handlers.get(action.domain);
  if (!handler) {
    throw new ActionableError({
      goal: `Execute admin review action for domain "${action.domain}"`,
      problem: `No review handler is registered for domain "${action.domain}".`,
      location: 'server/admin/reviewRegistry.ts → executeReviewAction',
      nextSteps: [
        'Verify the domain string matches a registered handler',
        `Registered domains: ${[...handlers.keys()].join(', ') || '(none)'}`,
      ],
    });
  }
  try {
    await handler.executeAction(action);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'admin-review',
      level: 'error',
      message: `Review handler "${handler.domain}" failed during executeAction:${action.action}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    throw err;
  }
}
