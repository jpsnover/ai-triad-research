// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Analytics storage and query layer.
 *
 * Two backends — filesystem (Electron / local dev) and Azure Append Blob
 * (container deployments). The backend is chosen at init time based on
 * whether blob config is provided.
 *
 * Events are stored as daily NDJSON files: `YYYY-MM-DD.ndjson`.
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../runtimeConfig.js';

// ── Types ──

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

/** Summed AI usage/cost for one model (t/892). */
export interface AiCostBucket {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** Summed AI usage/cost across all `ai.call` events, with a per-model breakdown. */
export interface AiCostSummary extends AiCostBucket {
  byModel: Record<string, AiCostBucket>;
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
  /** Counts keyed by event_type (t/891 debate.complete/abandon, t/893 funnel). */
  eventTypes: Record<string, number>;
  /** Summed AI usage/cost from `ai.call` detail (t/892). */
  aiCost: AiCostSummary;
}

// ── Backend abstraction ──

export interface AnalyticsBackend {
  append(date: string, lines: string[]): Promise<void>;
  readLines(date: string): Promise<string[]>;
  listDates(): Promise<string[]>;
  prune(cutoffDate: string): Promise<void>;
}

export interface AnalyticsBlobConfig {
  accountUrl: string;
  container: string;
  /** Test seam: inject a pre-built BlobServiceClient. */
  serviceClient?: unknown;
}

// ── Filesystem backend ──

class FsAnalyticsBackend implements AnalyticsBackend {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  async append(date: string, lines: string[]): Promise<void> {
    const filePath = path.join(this.dir, `${date}.ndjson`);
    fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  }

  async readLines(date: string): Promise<string[]> {
    const filePath = path.join(this.dir, `${date}.ndjson`);
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  }

  async listDates(): Promise<string[]> {
    try {
      return fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.ndjson'))
        .map(f => f.replace('.ndjson', ''));
    } catch { /* telemetry — silent by design */ return []; }
  }

  async prune(cutoffDate: string): Promise<void> {
    try {
      const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.ndjson'));
      for (const f of files) {
        const date = f.replace('.ndjson', '');
        if (date < cutoffDate) {
          fs.unlinkSync(path.join(this.dir, f));
        }
      }
    } catch { /* telemetry — silent by design;  best-effort cleanup */ }
  }
}

// ── Module state ──

let backend: AnalyticsBackend | null = null;

function cutoffStr(): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - getConfig().analytics.retentionDays);
  return cutoff.toISOString().slice(0, 10);
}

// ── Public API ──

export async function initAnalytics(dataRoot: string, blobConfig?: AnalyticsBlobConfig): Promise<void> {
  if (blobConfig?.accountUrl) {
    const { BlobAnalyticsBackend } = await import('../storage/analyticsBlob.js');
    backend = new BlobAnalyticsBackend({
      accountUrl: blobConfig.accountUrl,
      container: blobConfig.container,
      serviceClient: blobConfig.serviceClient as import('@azure/storage-blob').BlobServiceClient | undefined,
    });
  } else {
    backend = new FsAnalyticsBackend(path.join(dataRoot, 'analytics'));
  }
  await backend.prune(cutoffStr());
}

/** Append a batch of events. Fire-and-forget safe — errors are recorded, not thrown. */
export async function appendEvents(events: AnalyticsEvent[]): Promise<void> {
  if (!backend || events.length === 0) return;

  const byDate = new Map<string, string[]>();
  for (const evt of events) {
    const date = evt.timestamp.slice(0, 10);
    const lines = byDate.get(date) || [];
    lines.push(JSON.stringify(evt));
    byDate.set(date, lines);
  }

  for (const [date, lines] of byDate) {
    await backend.append(date, lines);
  }
}

/** Read all events in a date range (inclusive). */
async function readEvents(from: string, to: string): Promise<AnalyticsEvent[]> {
  if (!backend) return [];

  const events: AnalyticsEvent[] = [];
  const start = new Date(from);
  const end = new Date(to);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const lines = await backend.readLines(date);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as AnalyticsEvent);
      } catch { /* telemetry — silent by design;  skip malformed lines */ }
    }
  }

  return events;
}

/** Query aggregated analytics for a date range. */
export async function queryAggregated(from: string, to: string): Promise<QueryResult> {
  const events = await readEvents(from, to);

  const userSet = new Set<string>();
  const sessionSet = new Set<string>();
  const featureUsage: Record<string, number> = {};
  const eventTypes: Record<string, number> = {};
  const aiCost: AiCostSummary = { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, byModel: {} };
  const dailyMap = new Map<string, { events: number; users: Set<string>; sessions: Set<string> }>();
  const userMap = new Map<string, { lastActive: string; sessions: Set<string>; events: number; categories: Record<string, number> }>();
  const sessionTimes = new Map<string, { first: number; last: number }>();

  for (const evt of events) {
    userSet.add(evt.user);
    sessionSet.add(evt.session_id);

    featureUsage[evt.category] = (featureUsage[evt.category] || 0) + 1;
    eventTypes[evt.event_type] = (eventTypes[evt.event_type] || 0) + 1;

    // t/892: sum AI usage/cost from ai.call detail (one pass, additive).
    if (evt.event_type === 'ai.call') {
      const d = evt.detail || {};
      const tokensIn = Number(d.tokens_in) || 0;
      const tokensOut = Number(d.tokens_out) || 0;
      const costUsd = Number(d.estimated_cost_usd) || 0;
      const model = typeof d.model === 'string' && d.model ? d.model : 'unknown';
      aiCost.calls++; aiCost.tokensIn += tokensIn; aiCost.tokensOut += tokensOut; aiCost.costUsd += costUsd;
      let m = aiCost.byModel[model];
      if (!m) { m = { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }; aiCost.byModel[model] = m; }
      m.calls++; m.tokensIn += tokensIn; m.tokensOut += tokensOut; m.costUsd += costUsd;
    }

    const date = evt.timestamp.slice(0, 10);
    let daily = dailyMap.get(date);
    if (!daily) { daily = { events: 0, users: new Set(), sessions: new Set() }; dailyMap.set(date, daily); }
    daily.events++;
    daily.users.add(evt.user);
    daily.sessions.add(evt.session_id);

    let u = userMap.get(evt.user);
    if (!u) { u = { lastActive: evt.timestamp, sessions: new Set(), events: 0, categories: {} }; userMap.set(evt.user, u); }
    if (evt.timestamp > u.lastActive) u.lastActive = evt.timestamp;
    u.sessions.add(evt.session_id);
    u.events++;
    u.categories[evt.category] = (u.categories[evt.category] || 0) + 1;

    const ts = new Date(evt.timestamp).getTime();
    let sess = sessionTimes.get(evt.session_id);
    if (!sess) { sess = { first: ts, last: ts }; sessionTimes.set(evt.session_id, sess); }
    if (ts < sess.first) sess.first = ts;
    if (ts > sess.last) sess.last = ts;
  }

  let totalDuration = 0;
  let sessionCount = 0;
  for (const sess of sessionTimes.values()) {
    const dur = sess.last - sess.first;
    if (dur > 0) { totalDuration += dur; sessionCount++; }
  }
  const avgSessionDurationMs = sessionCount > 0 ? Math.round(totalDuration / sessionCount) : 0;

  const daily: DailySummary[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, events: d.events, users: d.users.size, sessions: d.sessions.size }));

  const users: UserSummary[] = Array.from(userMap.entries())
    .map(([user, u]) => {
      const topCategory = Object.entries(u.categories).sort(([, a], [, b]) => b - a)[0]?.[0] || '';
      return { user, lastActive: u.lastActive, sessions: u.sessions.size, events: u.events, topCategory };
    })
    .sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  // Round summed costs to 6 dp to avoid floating-point accumulation noise.
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  aiCost.costUsd = round6(aiCost.costUsd);
  for (const m of Object.values(aiCost.byModel)) m.costUsd = round6(m.costUsd);

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
    eventTypes,
    aiCost,
  };
}

/** Query raw events for a specific user and/or session. */
export async function queryRawEvents(from: string, to: string, user?: string, sessionId?: string): Promise<AnalyticsEvent[]> {
  const events = await readEvents(from, to);
  return events.filter(e =>
    (!user || e.user === user) && (!sessionId || e.session_id === sessionId)
  );
}
