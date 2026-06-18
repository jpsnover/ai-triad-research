// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared types for the unified admin review panel (design: t/645#1).
 *
 * Three consumers code against these contracts:
 *   - the calibration domain handler (t/647),
 *   - the community domain handler (t/650),
 *   - the admin panel UI (t/648).
 *
 * The server-side registry (`reviewRegistry.ts`) aggregates `getPendingItems()`
 * across all registered handlers and routes `ReviewAction`s back to the owning
 * domain. New reviewable domains can be added later by registering a handler —
 * no change to the admin panel or these endpoints is required.
 */

/** Known reviewable domains. New domains may register beyond this set — handlers
 *  key off the runtime `domain` string, so this union is documentation, not a hard
 *  limit. UIs that switch on domain should handle the default case. */
export type ReviewDomain = 'calibration' | 'community' | 'taxonomy';

/**
 * One row in the unified review queue — a single user's pending submissions in a
 * single domain ("a review group"). The right-pane diff viewer is fetched
 * separately via `getDetailForViewer(id)`.
 */
export interface ReviewItem {
  /** Stable group id, unique across domains. Convention: `${domain}:${submitter}`
   *  (or a finer-grained id when a domain groups differently). Passed back as
   *  `ReviewAction.groupId` and to `getDetailForViewer`. */
  id: string;
  /** Owning domain — matches the handler's `domain`. See {@link ReviewDomain}. */
  domain: string;
  /** Submitter storage user id (the raw key used in storage paths). */
  submitter: string;
  /** Human-readable submitter name for display. */
  submitterDisplay: string;
  /** ISO-8601 timestamp of the oldest pending item in the group. */
  submittedAt: string;
  /** Short human summary, e.g. "5 debate metrics" or "1 chat: AI Safety Discussion". */
  summary: string;
  /** Number of individual entries in the group (for the count chip). */
  itemCount: number;
  /** Whether an admin has opened this group before. */
  status: 'pending' | 'viewed';
}

/**
 * An admin's promote/reject decision on entries within a review group.
 *
 * Extends the t/645#1 sketch with `domain` (and `groupId`) so the shared
 * `POST /api/admin/review/action` endpoint can route to the owning handler
 * without a separate lookup.
 */
export interface ReviewAction {
  /** Domain that owns the targeted entries — used to route to the handler. */
  domain: string;
  /** The review group these entries belong to (matches {@link ReviewItem.id}). */
  groupId: string;
  /** Whether to promote into the canonical dataset or reject. */
  action: 'promote' | 'reject';
  /** Which entries within the group are affected (cherry-pick). */
  itemIds: string[];
  /** Required when `action === 'reject'`. */
  reason?: string;
  /** Edit-on-promote field overrides (domain-specific). */
  edits?: Record<string, unknown>;
  /** Free-form admin notes, recorded in the audit trail. */
  notes?: string;
}

/**
 * Per-domain badge counts for the admin header and the queue filter dropdown.
 * `byDomain` counts review groups (queue rows) per domain; `total` is their sum.
 */
export interface ReviewStats {
  total: number;
  byDomain: Record<string, number>;
}

/**
 * A reviewable domain plugs into the admin panel by implementing this interface
 * and calling `registerReviewHandler()` at server startup.
 */
export interface ReviewDomainHandler {
  /** Unique domain key (e.g. 'calibration'). Used for registry lookup + routing. */
  domain: string;
  /** Pending review groups, optionally filtered to a single submitter. */
  getPendingItems(userId?: string): Promise<ReviewItem[]>;
  /** Domain-specific detail payload for the right-pane diff viewer. */
  getDetailForViewer(groupId: string): Promise<unknown>;
  /** Apply a promote/reject decision. Must be idempotent-safe and audit-logged. */
  executeAction(action: ReviewAction): Promise<void>;
}
