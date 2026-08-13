// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * useAnalytics — data hook for the usage-hierarchy UI (t/2560, spec §7 of
 * docs/ux/usage-hierarchy-navigation.md). Lifts the engagement fetch that lived
 * inline in EngagementDashboard.tsx into a reusable hook and extends it with the
 * three additions the hierarchy UI (Analysis's UsageHierarchy.tsx, t/2561) needs:
 *
 *   §7.1  scope the aggregate TreeNode to a session (alongside the existing user scope)
 *   §7.2  a per-user `sessions` list riding the engagement response (no 2nd round-trip)
 *   §7.3  a subject-scoped WHO breakdown (?subject=&groupBy=user|session)
 *
 * Web-only admin route (bridgeGet → /api/analytics/engagement); the server strips
 * per-user data for non-admins exactly as it already does for `users`. The server
 * side of §7.1/§7.3 lands in t/2559 in parallel — this hook is built + tested
 * against the spec-fixed shapes with mocks; live-verify after t/2559 merges.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bridgeGet } from '../bridge/web-bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import type { TreeNode } from '../components/analysis/engagementTree';

// ── Contract types (frozen; published at t/2560#1) ───────────────────────────

/** ISO yyyy-mm-dd range; the component derives it from the 7d/30d/90d presets. */
export interface DateRange { from: string; to: string }

/** Daily engagement point (existing shape). */
export interface DailyPoint { date: string; visits: number; engagedVisits: number; engagedMs: number }

/** Per-user leaderboard row (existing shape; admin-only). */
export interface UserRow {
  user: string;
  visits: number;
  engagedVisits: number;
  engagedMs: number;
  topCamp: string;
  lastActive: string;
}

/**
 * Main-tree scope. `session` scope returns the WHOLE aggregate TreeNode recomputed
 * for that session (§7.1) — the client never holds the raw event log to do this.
 */
export type AnalyticsScope =
  | { kind: 'all' }
  | { kind: 'user'; user: string }
  | { kind: 'session'; session: string };

/** §7.2 — per-user session row (id + start + engagedMs + node count). */
export interface SessionRow { id: string; startTime: string; engagedMs: number; nodeCount: number }

/** Engagement response, extended with `sessions` (§7.2). */
export interface EngagementResult {
  aggregate: TreeNode;        // recomputed for the active scope (all | user | session)
  user?: TreeNode;            // present when scope.kind === 'user' (existing)
  daily: DailyPoint[];
  users?: UserRow[];          // admin-only; stripped server-side for non-admins
  sessions?: SessionRow[];    // admin-only; present when scope.kind === 'user' (§7.2)
}

/** §7.3 — subject WHO breakdown grouping. */
export type SubjectGroupBy = 'user' | 'session';

/** §7.3 — one WHO-breakdown row; `key` is a user id or session id per groupBy. */
export interface SubjectBreakdownRow { key: string; engagedMs: number; visits: number }

/** Uniform async envelope so every surface exposes loading / empty / error. */
export interface AsyncState<T> { data: T | null; loading: boolean; error: string | null; isEmpty: boolean }

export interface UseAnalyticsOptions { range: DateRange; scope?: AnalyticsScope }

export interface UseAnalyticsResult {
  /** Main engagement tree, reactive on { range, scope }. */
  engagement: AsyncState<EngagementResult>;
  /** View over engagement.data.sessions — rides the same fetch, mirrors its loading/error; populated only under user scope. */
  sessions: AsyncState<SessionRow[]>;
  /** Subject WHO breakdown; fetched on demand via loadSubjectBreakdown. */
  subject: AsyncState<SubjectBreakdownRow[]>;
  /**
   * Fetch the WHO breakdown for a subject. Signature is stable across contract v2:
   * when the active scope is `user`, the query threads `&user=` automatically so the
   * user-scoped leaf panel gets rows for that user only (t/2560#2, t/2562#2). Callers
   * do not pass the user — it follows the hook's active scope.
   */
  loadSubjectBreakdown: (subjectId: string, groupBy: SubjectGroupBy) => void;
  /** Re-run the main engagement fetch. */
  refetch: () => void;
}

// ── Query builders ───────────────────────────────────────────────────────────

const ENGAGEMENT = '/api/analytics/engagement';

function engagementQuery(from: string, to: string, scope: AnalyticsScope): string {
  const base = `${ENGAGEMENT}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  if (scope.kind === 'user') return `${base}&user=${encodeURIComponent(scope.user)}`;
  if (scope.kind === 'session') return `${base}&session=${encodeURIComponent(scope.session)}`;
  return base;
}

function subjectQuery(subjectId: string, groupBy: SubjectGroupBy, user?: string): string {
  const base = `${ENGAGEMENT}?subject=${encodeURIComponent(subjectId)}&groupBy=${groupBy}`;
  // Contract v2 (t/2560#2, t/2562#2): under user scope the leaf panel shows the
  // by-session breakdown FOR THAT USER, so thread the active user into the WHO query.
  return user ? `${base}&user=${encodeURIComponent(user)}` : base;
}

/** Stable string key for a scope, so effects re-run on semantic change only. */
function scopeKeyOf(scope: AnalyticsScope): string {
  return scope.kind === 'user' ? `user:${scope.user}`
    : scope.kind === 'session' ? `session:${scope.session}`
    : 'all';
}

function recordError(message: string, err: unknown): void {
  getGlobalRecorder()?.record({
    type: 'system.error',
    component: 'use-analytics',
    level: 'error',
    message,
    error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
  });
}

const LOADING = <T,>(): AsyncState<T> => ({ data: null, loading: true, error: null, isEmpty: false });
const IDLE = <T,>(): AsyncState<T> => ({ data: null, loading: false, error: null, isEmpty: false });

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalytics({ range, scope = { kind: 'all' } }: UseAnalyticsOptions): UseAnalyticsResult {
  const { from, to } = range;
  const scopeKey = scopeKeyOf(scope);

  const [engagement, setEngagement] = useState<AsyncState<EngagementResult>>(LOADING);
  const [subject, setSubject] = useState<AsyncState<SubjectBreakdownRow[]>>(IDLE);

  // Monotonic request ids: a response is applied only if it is the latest in flight
  // for its surface, so a rapid scope/subject switch can never apply a stale result.
  const engReq = useRef(0);
  const subjReq = useRef(0);

  // Current scope, read at loadSubjectBreakdown call time so the WHO query threads the
  // active user (contract v2) without re-creating the stable callback on every scope change.
  const scopeRef = useRef<AnalyticsScope>(scope);
  scopeRef.current = scope;

  const runEngagement = useCallback(() => {
    const id = ++engReq.current;
    setEngagement(LOADING);
    bridgeGet<EngagementResult>(engagementQuery(from, to, scope))
      .then(d => {
        if (id !== engReq.current) return;
        setEngagement({ data: d, loading: false, error: null, isEmpty: (d.aggregate?.visits ?? 0) === 0 });
      })
      .catch(err => {
        if (id !== engReq.current) return;
        recordError('Engagement query failed', err);
        setEngagement({ data: null, loading: false, error: String(err), isEmpty: false });
      });
    // Deps are the primitives from/to/scopeKey — scopeKey encodes every scope field,
    // so a semantic scope change re-runs the fetch without depending on the object identity.
  }, [from, to, scopeKey]);

  useEffect(() => { runEngagement(); }, [runEngagement]);

  const loadSubjectBreakdown = useCallback((subjectId: string, groupBy: SubjectGroupBy) => {
    const id = ++subjReq.current;
    setSubject(LOADING);
    const activeScope = scopeRef.current;
    const userFilter = activeScope.kind === 'user' ? activeScope.user : undefined;
    bridgeGet<SubjectBreakdownRow[]>(subjectQuery(subjectId, groupBy, userFilter))
      .then(rows => {
        if (id !== subjReq.current) return;
        setSubject({ data: rows, loading: false, error: null, isEmpty: rows.length === 0 });
      })
      .catch(err => {
        if (id !== subjReq.current) return;
        recordError('Subject breakdown query failed', err);
        setSubject({ data: null, loading: false, error: String(err), isEmpty: false });
      });
  }, []);

  // §7.2 — sessions ride the engagement response under user scope. Expose them as
  // their own AsyncState view (mirrors engagement's loading/error) so the session
  // picker and the "by session" leaf breakdown render without a second round-trip.
  const sessions = useMemo<AsyncState<SessionRow[]>>(() => ({
    data: engagement.data?.sessions ?? null,
    loading: engagement.loading,
    error: engagement.error,
    isEmpty: scope.kind !== 'user' || (engagement.data?.sessions?.length ?? 0) === 0,
  }), [engagement, scope.kind]);

  return { engagement, sessions, subject, loadSubjectBreakdown, refetch: runEngagement };
}
