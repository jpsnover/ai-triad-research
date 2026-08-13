// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Minimal stub implementation of the useAnalytics hook (contract per t/2560#1).
 * Lives in analysis/ scope so tsc passes before hooks/useAnalytics.ts lands (t/2560).
 * When t/2560 merges: delete this file, update import in UsageHierarchy.tsx to
 *   `import { useAnalytics } from '../../hooks/useAnalytics';`
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { bridgeGet } from '../../bridge/web-bridge';
import type { TreeNode } from './engagementTree';

// ── Contract types (frozen per t/2560#1) ──────────────────────────────────────

export interface DateRange { from: string; to: string }

export type AnalyticsScope =
  | { kind: 'all' }
  | { kind: 'user'; user: string }
  | { kind: 'session'; session: string };

export interface SessionRow { id: string; startTime: string; engagedMs: number; nodeCount: number }

export interface EngagementResult {
  aggregate: TreeNode;
  user?: TreeNode;
  daily: { date: string; visits: number; engagedVisits: number; engagedMs: number }[];
  users?: { user: string; engagedMs: number; sessions?: number }[];
  sessions?: SessionRow[];
}

export type SubjectGroupBy = 'user' | 'session';
export interface SubjectBreakdownRow { key: string; engagedMs: number; visits: number }

export interface AsyncState<T> { data: T | null; loading: boolean; error: string | null; isEmpty: boolean }

export interface UseAnalyticsOptions { range: DateRange; scope?: AnalyticsScope }

export interface UseAnalyticsResult {
  engagement: AsyncState<EngagementResult>;
  sessions: AsyncState<SessionRow[]>;
  subject: AsyncState<SubjectBreakdownRow[]>;
  loadSubjectBreakdown: (subjectId: string, groupBy: SubjectGroupBy) => void;
  refetch: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scopeParams(scope: AnalyticsScope): string {
  if (scope.kind === 'user') return `&user=${encodeURIComponent(scope.user)}`;
  if (scope.kind === 'session') return `&session=${encodeURIComponent(scope.session)}`;
  return '';
}

function emptyAsync<T>(): AsyncState<T> {
  return { data: null, loading: false, error: null, isEmpty: true };
}

function loadingAsync<T>(): AsyncState<T> {
  return { data: null, loading: true, error: null, isEmpty: false };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAnalytics({ range, scope = { kind: 'all' } }: UseAnalyticsOptions): UseAnalyticsResult {
  const [engagement, setEngagement] = useState<AsyncState<EngagementResult>>(loadingAsync());
  const [subject, setSubject] = useState<AsyncState<SubjectBreakdownRow[]>>(emptyAsync());
  const refetchCounter = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setEngagement(loadingAsync());
    const params = `from=${range.from}&to=${range.to}${scopeParams(scope)}`;
    bridgeGet<EngagementResult>(`/api/analytics/engagement?${params}`)
      .then(d => {
        if (cancelled) return;
        const isEmpty = (d.aggregate?.visits ?? 0) === 0;
        setEngagement({ data: d, loading: false, error: null, isEmpty });
      })
      .catch(err => {
        if (cancelled) return;
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'use-analytics-stub',
          level: 'error',
          message: 'Engagement fetch failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setEngagement({ data: null, loading: false, error: String(err), isEmpty: true });
      });
    return () => { cancelled = true; };
  }, [range.from, range.to, scope.kind,
      (scope as { user?: string }).user ?? '',
      (scope as { session?: string }).session ?? '',
      refetchCounter.current]);

  const sessions: AsyncState<SessionRow[]> = (() => {
    if (!engagement.data?.sessions) return emptyAsync<SessionRow[]>();
    const rows = engagement.data.sessions;
    return { data: rows, loading: engagement.loading, error: engagement.error, isEmpty: rows.length === 0 };
  })();

  const loadSubjectBreakdown = useCallback((subjectId: string, groupBy: SubjectGroupBy) => {
    setSubject(loadingAsync());
    bridgeGet<{ rows: SubjectBreakdownRow[] }>(
      `/api/analytics/engagement?subject=${encodeURIComponent(subjectId)}&groupBy=${groupBy}&from=${range.from}&to=${range.to}${scopeParams(scope)}`
    )
      .then(d => {
        const rows = d.rows ?? [];
        setSubject({ data: rows, loading: false, error: null, isEmpty: rows.length === 0 });
      })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'use-analytics-stub',
          level: 'warn',
          message: 'Subject breakdown fetch failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setSubject({ data: null, loading: false, error: String(err), isEmpty: true });
      });
  }, [range.from, range.to, scope.kind,
      (scope as { user?: string }).user ?? '',
      (scope as { session?: string }).session ?? '']);

  const refetch = useCallback(() => { refetchCounter.current += 1; }, []);

  return { engagement, sessions, subject, loadSubjectBreakdown, refetch };
}
