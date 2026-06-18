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
import { ActionableError } from '../../../../lib/debate/errors.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { isAdmin } from '../community.js';
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

/** Remove all handlers — test isolation only. */
export function clearReviewHandlers(): void {
  handlers.clear();
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
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Forbidden' }));
  return false;
}

// ── Aggregation ──

function recordHandlerError(domain: string, op: string, err: unknown): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'admin-review',
    level: 'error',
    message: `Review handler "${domain}" failed during ${op}`,
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

/**
 * Aggregate pending review groups across all registered handlers, newest first.
 * A single handler throwing is recorded and skipped — one failing domain must not
 * blank the entire queue.
 */
export async function getReviewQueue(userId?: string): Promise<ReviewItem[]> {
  const all: ReviewItem[] = [];
  for (const handler of handlers.values()) {
    try {
      all.push(...await handler.getPendingItems(userId));
    } catch (err) {
      recordHandlerError(handler.domain, 'getPendingItems', err);
    }
  }
  all.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return all;
}

/**
 * Per-domain badge counts (number of review groups per domain) plus the total.
 * Failing handlers report 0 for their domain rather than failing the whole call.
 */
export async function getReviewStats(userId?: string): Promise<ReviewStats> {
  const byDomain: Record<string, number> = {};
  let total = 0;
  for (const handler of handlers.values()) {
    try {
      const items = await handler.getPendingItems(userId);
      byDomain[handler.domain] = items.length;
      total += items.length;
    } catch (err) {
      recordHandlerError(handler.domain, 'getPendingItems', err);
      byDomain[handler.domain] = 0;
    }
  }
  return { total, byDomain };
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
  await handler.executeAction(action);
}
