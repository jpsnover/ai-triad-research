// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1154 (admin error dashboard, Ticket A): pure aggregation helpers for the
// admin error endpoints. Kept out of server.ts so they're unit-testable.

export interface ErrorEntry {
  id: string;
  timestamp: string;
  userId?: string;
  error?: { name?: string; message?: string; stack?: string;[k: string]: unknown };
  context?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface TopError {
  groupKey: string;
  name: string;
  message: string;
  count: number;
  lastSeen: string;
  affectedUsers: number;
}

export interface ErrorSummary {
  total: number;
  today: number;
  last7d: number;
  last30d: number;
  topErrors: TopError[];
  byDay: Array<{ date: string; count: number }>;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g;
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const NUMERIC_ID_RE = /\b\d{4,}\b/g;

/**
 * Collapse the variable parts of an error message so variant errors group into
 * one bucket: UUIDs, ISO-8601 timestamps, long hex runs (>16 chars) and bare
 * numeric IDs (4+ digits) become stable placeholders. Order matters — UUIDs and
 * timestamps are stripped before the broader hex/numeric passes so they win.
 */
export function normalizeMessage(msg: string): string {
  return String(msg ?? '')
    .replace(UUID_RE, '{uuid}')
    .replace(ISO_TS_RE, '{ts}')
    .replace(LONG_HEX_RE, '{hex}')
    .replace(NUMERIC_ID_RE, '{n}')
    .trim();
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 86_400_000;

interface ErrorGroup { name: string; message: string; count: number; lastSeen: string; users: Set<string> }
interface ErrorAccum { today: number; last7d: number; last30d: number; groups: Map<string, ErrorGroup>; byDayMap: Map<string, number> }

/**
 * Fold one error entry into the running accumulator: window counters, the
 * name::normalized-message group, and the trailing-30-day byDay bucket. Entries
 * with an unparseable timestamp are skipped (mirrors the original `continue`).
 */
function accumulateErrorEntry(acc: ErrorAccum, e: ErrorEntry, now: number, todayStart: number): void {
  const ts = Date.parse(String(e.timestamp));
  if (Number.isNaN(ts)) return;

  if (ts >= todayStart) acc.today++;
  if (now - ts <= 7 * DAY_MS) acc.last7d++;
  const within30 = now - ts <= 30 * DAY_MS;
  if (within30) acc.last30d++;

  const name = String(e.error?.name ?? 'Error');
  const message = normalizeMessage(String(e.error?.message ?? ''));
  const groupKey = `${name}::${message}`;
  let g = acc.groups.get(groupKey);
  if (!g) { g = { name, message, count: 0, lastSeen: String(e.timestamp), users: new Set() }; acc.groups.set(groupKey, g); }
  g.count++;
  if (String(e.timestamp) > g.lastSeen) g.lastSeen = String(e.timestamp);
  if (e.userId) g.users.add(String(e.userId));

  if (within30) {
    const date = new Date(ts).toISOString().slice(0, 10);
    acc.byDayMap.set(date, (acc.byDayMap.get(date) ?? 0) + 1);
  }
}

/**
 * Aggregate error entries into the admin summary. Pure (takes `now`) so it's
 * deterministic under test. `today` is calendar-day (UTC midnight); last7d/30d
 * are rolling windows; byDay covers the trailing 30 days.
 */
export function summarizeErrors(entries: ErrorEntry[], now: number = Date.now()): ErrorSummary {
  const todayStart = startOfUtcDay(now);
  const acc: ErrorAccum = { today: 0, last7d: 0, last30d: 0, groups: new Map(), byDayMap: new Map() };

  for (const e of entries) accumulateErrorEntry(acc, e, now, todayStart);

  const topErrors: TopError[] = [...acc.groups.entries()]
    .map(([groupKey, g]) => ({ groupKey, name: g.name, message: g.message, count: g.count, lastSeen: g.lastSeen, affectedUsers: g.users.size }))
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));

  const byDay = [...acc.byDayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { total: entries.length, today: acc.today, last7d: acc.last7d, last30d: acc.last30d, topErrors, byDay };
}

// ── 30s summary cache (proxyTiers.ts pattern) ──────────────────────────────
const SUMMARY_TTL_MS = 30_000;
let _cache: { value: ErrorSummary; at: number } | null = null;

/** Cached summary: recomputes only when the cached value is older than 30s. */
export async function getErrorSummaryCached(
  load: () => Promise<ErrorEntry[]>,
  now: number = Date.now(),
): Promise<ErrorSummary> {
  if (_cache && now - _cache.at < SUMMARY_TTL_MS) return _cache.value;
  const value = summarizeErrors(await load(), now);
  _cache = { value, at: now };
  return value;
}

/** Test hook: clear the summary cache. */
export function _resetErrorSummaryCache(): void { _cache = null; }
