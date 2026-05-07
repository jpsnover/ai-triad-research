// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Analytics storage and query layer.
 * Events are stored as daily NDJSON files at /data/analytics/YYYY-MM-DD.ndjson.
 */

import fs from 'fs';
import path from 'path';

export interface AnalyticsEvent {
  user: string;
  session_id: string;
  timestamp: string;
  event_type: string;
  category: string;
  detail: Record<string, unknown>;
  duration_ms?: number;
}

interface UserSummary {
  user: string;
  lastActive: string;
  sessions: number;
  events: number;
  topCategory: string;
}

interface DailySummary {
  date: string;
  events: number;
  users: number;
  sessions: number;
}

export interface QueryResult {
  summary: {
    activeUsers: number;
    sessions: number;
    totalEvents: number;
    avgSessionDurationMs: number;
  };
  daily: DailySummary[];
  featureUsage: Record<string, number>;
  users: UserSummary[];
}

let analyticsDir = '';

export function initAnalytics(dataRoot: string): void {
  analyticsDir = path.join(dataRoot, 'analytics');
  fs.mkdirSync(analyticsDir, { recursive: true });
  pruneOldFiles();
}

/** Append a batch of events to today's NDJSON file. */
export function appendEvents(events: AnalyticsEvent[]): void {
  if (!analyticsDir || events.length === 0) return;

  // Group by date to handle edge cases (events spanning midnight)
  const byDate = new Map<string, string[]>();
  for (const evt of events) {
    const date = evt.timestamp.slice(0, 10); // YYYY-MM-DD
    const lines = byDate.get(date) || [];
    lines.push(JSON.stringify(evt));
    byDate.set(date, lines);
  }

  for (const [date, lines] of byDate) {
    const filePath = path.join(analyticsDir, `${date}.ndjson`);
    fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  }
}

/** Read all events in a date range (inclusive). */
function readEvents(from: string, to: string): AnalyticsEvent[] {
  if (!analyticsDir) return [];

  const events: AnalyticsEvent[] = [];
  const start = new Date(from);
  const end = new Date(to);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const filePath = path.join(analyticsDir, `${date}.ndjson`);
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as AnalyticsEvent);
      } catch { /* skip malformed lines */ }
    }
  }

  return events;
}

/** Query aggregated analytics for a date range. */
export function queryAggregated(from: string, to: string): QueryResult {
  const events = readEvents(from, to);

  const userSet = new Set<string>();
  const sessionSet = new Set<string>();
  const featureUsage: Record<string, number> = {};
  const dailyMap = new Map<string, { events: number; users: Set<string>; sessions: Set<string> }>();
  const userMap = new Map<string, { lastActive: string; sessions: Set<string>; events: number; categories: Record<string, number> }>();
  const sessionTimes = new Map<string, { first: number; last: number }>();

  for (const evt of events) {
    userSet.add(evt.user);
    sessionSet.add(evt.session_id);

    // Feature usage
    featureUsage[evt.category] = (featureUsage[evt.category] || 0) + 1;

    // Daily
    const date = evt.timestamp.slice(0, 10);
    let daily = dailyMap.get(date);
    if (!daily) { daily = { events: 0, users: new Set(), sessions: new Set() }; dailyMap.set(date, daily); }
    daily.events++;
    daily.users.add(evt.user);
    daily.sessions.add(evt.session_id);

    // Per-user
    let u = userMap.get(evt.user);
    if (!u) { u = { lastActive: evt.timestamp, sessions: new Set(), events: 0, categories: {} }; userMap.set(evt.user, u); }
    if (evt.timestamp > u.lastActive) u.lastActive = evt.timestamp;
    u.sessions.add(evt.session_id);
    u.events++;
    u.categories[evt.category] = (u.categories[evt.category] || 0) + 1;

    // Session duration tracking
    const ts = new Date(evt.timestamp).getTime();
    let sess = sessionTimes.get(evt.session_id);
    if (!sess) { sess = { first: ts, last: ts }; sessionTimes.set(evt.session_id, sess); }
    if (ts < sess.first) sess.first = ts;
    if (ts > sess.last) sess.last = ts;
  }

  // Avg session duration
  let totalDuration = 0;
  let sessionCount = 0;
  for (const sess of sessionTimes.values()) {
    const dur = sess.last - sess.first;
    if (dur > 0) { totalDuration += dur; sessionCount++; }
  }
  const avgSessionDurationMs = sessionCount > 0 ? Math.round(totalDuration / sessionCount) : 0;

  // Daily array sorted by date
  const daily: DailySummary[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, events: d.events, users: d.users.size, sessions: d.sessions.size }));

  // Users array sorted by last active desc
  const users: UserSummary[] = Array.from(userMap.entries())
    .map(([user, u]) => {
      const topCategory = Object.entries(u.categories).sort(([, a], [, b]) => b - a)[0]?.[0] || '';
      return { user, lastActive: u.lastActive, sessions: u.sessions.size, events: u.events, topCategory };
    })
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  return {
    summary: {
      activeUsers: userSet.size,
      sessions: sessionSet.size,
      totalEvents: events.length,
      avgSessionDurationMs,
    },
    daily,
    featureUsage,
    users,
  };
}

/** Query raw events for a specific user and/or session. */
export function queryRawEvents(from: string, to: string, user?: string, sessionId?: string): AnalyticsEvent[] {
  const events = readEvents(from, to);
  return events.filter(e =>
    (!user || e.user === user) && (!sessionId || e.session_id === sessionId)
  );
}

/** Remove NDJSON files older than 90 days. */
function pruneOldFiles(): void {
  if (!analyticsDir) return;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const files = fs.readdirSync(analyticsDir).filter(f => f.endsWith('.ndjson'));
    for (const f of files) {
      const date = f.replace('.ndjson', '');
      if (date < cutoffStr) {
        fs.unlinkSync(path.join(analyticsDir, f));
      }
    }
  } catch { /* best-effort cleanup */ }
}
