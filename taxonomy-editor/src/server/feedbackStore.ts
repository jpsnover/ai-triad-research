import fs from 'fs';
import path from 'path';

/**
 * Server-side feedback storage helpers for the admin feedback API.
 *
 * Feedback entries are stored as individual JSON files under
 * `<dataRoot>/admin/feedback/feedback-<ts>-<id8>.json` (written by the
 * POST /api/admin/feedback intake route). This module reads, filters, and
 * paginates them for the admin GET endpoint. Kept pure (filesystem in, plain
 * data out) so it can be unit-tested without booting the HTTP server.
 */

export const FEEDBACK_CATEGORIES = ['bug', 'feature_request', 'confusing', 'general'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export interface FeedbackQuery {
  limit?: number;
  offset?: number;
  category?: string | null;
  rating?: string | null;
}

export interface FeedbackPage {
  items: Record<string, unknown>[];
  total: number;
  hasMore: boolean;
  /** Files that could not be parsed; the caller records these to the flight recorder. */
  skipped: string[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Read, filter, sort (newest-first), and paginate feedback entries.
 *
 * - Entries written before the `category` field default to "general" (backwards-compatible).
 * - `limit` is clamped to [1, 200] (default 50); `offset` is clamped to >= 0 (default 0).
 * - A missing feedback directory is treated as empty (not an error) — it does not
 *   exist until the first feedback is stored.
 */
export function listFeedback(feedbackDir: string, q: FeedbackQuery = {}): FeedbackPage {
  const limit = Number.isFinite(q.limit) ? Math.min(Math.max(q.limit as number, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(q.offset) ? Math.max(q.offset as number, 0) : 0;

  let files: string[] = [];
  try {
    files = fs.readdirSync(feedbackDir).filter(f => f.startsWith('feedback-') && f.endsWith('.json'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const skipped: string[] = [];
  let items: Record<string, unknown>[] = [];
  for (const f of files) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(feedbackDir, f), 'utf-8')) as Record<string, unknown>;
      if (entry.category === undefined || entry.category === null) entry.category = 'general';
      items.push(entry);
    } catch {
      skipped.push(f);
    }
  }

  if (q.category) items = items.filter(e => e.category === q.category);
  if (q.rating) items = items.filter(e => e.rating === q.rating);

  // Newest first. ISO-8601 timestamps sort chronologically under lexicographic compare.
  items.sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));

  const total = items.length;
  const page = items.slice(offset, offset + limit);
  return { items: page, total, hasMore: offset + page.length < total, skipped };
}
