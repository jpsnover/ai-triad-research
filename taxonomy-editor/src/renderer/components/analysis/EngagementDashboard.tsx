// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Engagement Dashboard — admin-only usage-analytics surface.
 * Route: #engagement (wired by Rosetta, t/2468). Entry: SaveBar admin button.
 * Spec: docs/ux/usage-analytics-instrumentation.md §4.1 + §5.1.
 * Contract: t/2468#2.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
// useCallback is used by PerUserTable's handleSort
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { bridgeGet } from '../../bridge/web-bridge';
import { useFlag } from '../../hooks/useFeatureFlags';
import { useChartTooltip, ChartTooltipLayer } from './chartTooltip';
import {
  type TreeNode,
  CAMP_COLORS, CAMP_LABELS,
  fmtDuration, fmtNumber, relativeTime, categoryLabel,
  sumByCamp, sumByCategoryForCamp, collectLeafNodes,
} from './engagementTree';
import './EngagementDashboard.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface DailyPoint { date: string; visits: number; engagedVisits: number; engagedMs: number }
interface UserRow { user: string; visits: number; engagedVisits: number; engagedMs: number; topCamp: string; lastActive: string }

interface EngagementResult {
  aggregate: TreeNode;
  user?: TreeNode;    // per-user subtree when ?user= given (t/2467#2)
  daily: DailyPoint[];
  users?: UserRow[];  // admin-only; stripped server-side for non-admins
}

type DatePreset = '7d' | '30d' | '90d';
type UserSortCol = 'user' | 'engagedMs' | 'visits' | 'topCamp' | 'lastActive';

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESET_DAYS: Record<DatePreset, number> = { '7d': 7, '30d': 30, '90d': 90 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateRange(preset: DatePreset): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (PRESET_DAYS[preset] - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// ── Section 1: Time-with-tool chart ──────────────────────────────────────────

function EngagedOverTime({ daily }: { daily: DailyPoint[] }) {
  const { tip, showTip, hideTip } = useChartTooltip();
  if (daily.length === 0) return null;
  const maxMs = Math.max(...daily.map(d => d.engagedMs), 1);

  return (
    <div className="eng-panel">
      <div className="eng-panel-title">Engaged Time Over Time</div>
      <div className="eng-time-bars">
        {daily.map(d => {
          const mins = Math.round(d.engagedMs / 60_000);
          return (
            <div
              key={d.date}
              className="eng-time-bar-col"
              onMouseEnter={e => showTip(e, <><strong>{d.date}</strong><br />{fmtDuration(d.engagedMs)} engaged · {fmtNumber(d.visits)} visits</>)}
              onMouseMove={e => showTip(e, <><strong>{d.date}</strong><br />{fmtDuration(d.engagedMs)} engaged · {fmtNumber(d.visits)} visits</>)}
              onMouseLeave={hideTip}
            >
              <div
                className="eng-time-bar"
                /* eslint-disable-next-line local/no-inline-style -- dynamic: bar height proportional to engagedMs */
                style={{ height: `${Math.max((d.engagedMs / maxMs) * 100, 2)}%` }}
                title={`${mins}m`}
              />
            </div>
          );
        })}
      </div>
      <div className="eng-time-legend">
        <span><span className="eng-legend-swatch" />Engaged minutes/day (total)</span>
      </div>
      <ChartTooltipLayer tip={tip} />
    </div>
  );
}

// ── Section 2 + 3: Camp distribution + category drill-down ───────────────────

function CampDistribution({
  aggregate, selectedCamp, onSelectCamp,
}: { aggregate: TreeNode; selectedCamp: string | null; onSelectCamp: (camp: string | null) => void }) {
  const camps = useMemo(() => sumByCamp(aggregate), [aggregate]);
  const maxMs = camps[0]?.engagedMs ?? 1;

  if (camps.length === 0) return (
    <div className="eng-panel"><div className="eng-panel-title">Camp Distribution</div><div className="eng-empty">No data</div></div>
  );

  return (
    <div className="eng-panel eng-camp-panel">
      <div className="eng-panel-title">Camp Distribution</div>
      <div className="eng-camp-hint">Click a camp to see category breakdown</div>
      {camps.map(c => {
        const color = CAMP_COLORS[c.key] ?? '#6b7280';
        const label = CAMP_LABELS[c.key] ?? c.key;
        const isActive = selectedCamp === c.key;
        return (
          <div
            key={c.key}
            className={`eng-camp-row${isActive ? ' eng-camp-row--active' : ''}`}
            onClick={() => onSelectCamp(isActive ? null : c.key)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onSelectCamp(isActive ? null : c.key)}
          >
            <div className="eng-camp-row-head">
              <span className="eng-camp-label">{label}</span>
              <span className="eng-camp-value">{fmtDuration(c.engagedMs)}</span>
            </div>
            <div className="eng-camp-track">
              <div
                className="eng-camp-fill"
                /* eslint-disable-next-line local/no-inline-style -- dynamic: bar width + camp color from data */
                style={{ width: `${(c.engagedMs / maxMs) * 100}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryDrillDown({ aggregate, camp }: { aggregate: TreeNode; camp: string }) {
  const categories = useMemo(() => sumByCategoryForCamp(aggregate, camp), [aggregate, camp]);
  const maxMs = categories[0]?.engagedMs ?? 1;
  const color = CAMP_COLORS[camp] ?? '#6b7280';
  const campLabel = CAMP_LABELS[camp] ?? camp;

  return (
    <div className="eng-panel eng-drilldown-panel">
      <div className="eng-panel-title">{campLabel} — Category Breakdown</div>
      {categories.length === 0 ? (
        <div className="eng-empty">No category data</div>
      ) : categories.map(c => (
        <div key={c.key} className="eng-cat-row">
          <div className="eng-cat-row-head">
            <span className="eng-cat-label">{categoryLabel(c.key)}</span>
            <span className="eng-cat-value">{fmtDuration(c.engagedMs)}</span>
          </div>
          <div className="eng-camp-track">
            <div
              className="eng-camp-fill"
              /* eslint-disable-next-line local/no-inline-style -- dynamic: bar width + camp color */
              style={{ width: `${(c.engagedMs / maxMs) * 100}%`, background: color, opacity: 0.7 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section 4: Leaderboards ───────────────────────────────────────────────────

function Leaderboards({ aggregate }: { aggregate: TreeNode }) {
  const nodes = useMemo(() => {
    const results: Array<{ id: string; engagedMs: number; visits: number }> = [];
    collectLeafNodes(aggregate, 0, results);
    return results;
  }, [aggregate]);

  const byDepth = useMemo(() => [...nodes].sort((a, b) => b.engagedMs - a.engagedMs).slice(0, 10), [nodes]);
  const byBreadth = useMemo(() => [...nodes].sort((a, b) => b.visits - a.visits).slice(0, 10), [nodes]);

  const LeaderList = ({ items, valueKey, label }: {
    items: Array<{ id: string; engagedMs: number; visits: number }>;
    valueKey: 'engagedMs' | 'visits';
    label: string;
  }) => (
    <div className="eng-leader-col">
      <div className="eng-leader-col-title">{label}</div>
      {items.length === 0 ? <div className="eng-empty">No data</div> : items.map((n, i) => (
        <div key={n.id} className="eng-leader-row">
          <span className="eng-leader-rank">{i + 1}</span>
          <span className="eng-leader-id" title={n.id}>{n.id}</span>
          <span className="eng-leader-val">
            {valueKey === 'engagedMs' ? fmtDuration(n.engagedMs) : fmtNumber(n.visits)}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="eng-panel eng-leaders-panel">
      <div className="eng-panel-title">Leaderboards</div>
      <div className="eng-leaders-row">
        <LeaderList items={byDepth} valueKey="engagedMs" label="Most Engaged Time (depth)" />
        <LeaderList items={byBreadth} valueKey="visits" label="Most Visited (breadth)" />
      </div>
    </div>
  );
}

// ── Section 5: Per-user table (admin) ─────────────────────────────────────────

function PerUserTable({ users }: { users: UserRow[] }) {
  const [sortCol, setSortCol] = useState<UserSortCol>('engagedMs');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const arr = [...users];
    arr.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      const cmp = typeof va === 'number'
        ? (va as number) - (vb as number)
        : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [users, sortCol, sortDir]);

  const handleSort = useCallback((col: UserSortCol) => {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col; }
      setSortDir('desc');
      return col;
    });
  }, []);

  const Th = ({ col, label, align = 'right' }: { col: UserSortCol; label: string; align?: 'left' | 'right' }) => (
    <th
      onClick={() => handleSort(col)}
      className="eng-th"
      /* eslint-disable-next-line local/no-inline-style -- dynamic: sort-active color + textAlign per column */
      style={{ textAlign: align, color: sortCol === col ? 'var(--text-primary)' : 'var(--text-muted)' }}
    >
      {label}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div className="eng-panel eng-users-panel">
      <div className="eng-panel-title">Per-User Engagement <span className="eng-admin-badge">Admin</span></div>
      {users.length === 0 ? (
        <div className="eng-empty">No user data for this range.</div>
      ) : (
        <table className="eng-users-table">
          <thead><tr>
            <Th col="user" label="User" align="left" />
            <Th col="engagedMs" label="Engaged" />
            <Th col="visits" label="Visits" />
            <Th col="topCamp" label="Top Camp" />
            <Th col="lastActive" label="Last Active" />
          </tr></thead>
          <tbody>
            {sorted.map(u => (
              <tr key={u.user} className="eng-user-row">
                <td className="eng-td-user" title={u.user}>{u.user}</td>
                <td className="eng-td-num">{fmtDuration(u.engagedMs)}</td>
                <td className="eng-td-num">{fmtNumber(u.visits)}</td>
                <td className="eng-td">
                  <span
                    className="eng-camp-badge"
                    /* eslint-disable-next-line local/no-inline-style -- dynamic: badge color from camp */
                    style={{ background: `${CAMP_COLORS[u.topCamp] ?? '#6b7280'}22`, color: CAMP_COLORS[u.topCamp] ?? '#6b7280' }}
                  >
                    {CAMP_LABELS[u.topCamp] ?? u.topCamp}
                  </span>
                </td>
                <td className="eng-td-num-nowrap" title={u.lastActive}>{relativeTime(u.lastActive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Section 6: Heuristic-health strip (admin) ─────────────────────────────────

function HealthStrip({ aggregate }: { aggregate: TreeNode }) {
  const engagementRate = aggregate.visits > 0
    ? ((aggregate.engagedVisits / aggregate.visits) * 100).toFixed(1)
    : '—';
  const cappedRatePct = aggregate.cappedRate != null
    ? `${(aggregate.cappedRate * 100).toFixed(1)}%`
    : '—';

  const metrics = [
    { label: 'Engagement rate', value: aggregate.visits > 0 ? `${engagementRate}%` : '—', title: 'engagedVisits / visits' },
    { label: 'Capped rate', value: cappedRatePct, title: 'fraction of engaged visits that hit the duration cap' },
    { label: 'Idle-close share', value: '—', title: 'not available in v1 contract' },
  ];

  return (
    <div className="eng-panel eng-health-panel">
      <div className="eng-panel-title">Heuristic Health <span className="eng-admin-badge">Admin</span></div>
      <div className="eng-health-metrics">
        {metrics.map(m => (
          <div key={m.label} className="eng-health-metric" title={m.title}>
            <div className="eng-health-value">{m.value}</div>
            <div className="eng-health-label">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export function EngagementDashboard() {
  const isAdmin = useFlag('permission-admin-features');

  const [preset, setPreset] = useState<DatePreset>('7d');
  // userFilter: live input value; committedFilter: triggers fetch on Enter
  const [userFilter, setUserFilter] = useState('');
  const [committedFilter, setCommittedFilter] = useState('');
  const [data, setData] = useState<EngagementResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCamp, setSelectedCamp] = useState<string | null>(null);

  const { from, to } = useMemo(() => dateRange(preset), [preset]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = committedFilter
      ? `/api/analytics/engagement?from=${from}&to=${to}&user=${encodeURIComponent(committedFilter)}`
      : `/api/analytics/engagement?from=${from}&to=${to}`;
    bridgeGet<EngagementResult>(qs)
      .then(d => { setData(d); setLoading(false); })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'engagement-dashboard',
          level: 'error',
          message: 'Engagement query failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setError(String(err));
        setLoading(false);
      });
  }, [from, to, committedFilter]);

  const handleBack = () => { window.location.hash = ''; window.location.reload(); };

  return (
    <div className="eng-root">
      {/* Header */}
      <div className="eng-header">
        <div className="eng-header-left">
          <button onClick={handleBack} className="eng-back-btn">← Back to Editor</button>
          <h1 className="eng-title">Engagement Analytics</h1>
          {isAdmin && <span className="eng-admin-badge eng-admin-badge--header">Admin</span>}
        </div>
        <div className="eng-header-right">
          {/* User filter (admin only — non-admins never receive other-user data) */}
          {isAdmin && (
            <input
              type="text"
              className="eng-user-filter"
              placeholder="Filter by user…"
              value={userFilter}
              onChange={e => setUserFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setCommittedFilter(userFilter); }}
            />
          )}
          {/* Date preset */}
          <div className="eng-preset-group">
            {(['7d', '30d', '90d'] as DatePreset[]).map(p => (
              <button
                key={p}
                onClick={() => { setPreset(p); setSelectedCamp(null); }}
                className="eng-preset-btn"
                /* eslint-disable-next-line local/no-inline-style -- dynamic: active-preset highlight */
                style={{
                  background: preset === p ? 'var(--color-acc, #3b82f6)' : 'var(--bg-secondary)',
                  color: preset === p ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${preset === p ? 'transparent' : 'var(--border-color)'}`,
                }}
              >
                {p === '7d' ? '7 days' : p === '30d' ? '30 days' : '90 days'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="eng-loading">Loading engagement data…</div>}
      {error && <div className="eng-error">Failed to load: {error}</div>}

      {data && !loading && (
        <>
          {data.aggregate.visits === 0 ? (
            <div className="eng-empty-state">
              <div className="eng-empty-title">No engagement data for this range</div>
              <div className="eng-empty-sub">Engagement events will appear as users spend time with the taxonomy.</div>
            </div>
          ) : (
            <>
              {/* Section 1: time over time */}
              <EngagedOverTime daily={data.daily} />

              {/* Sections 2+3: camp distribution + drill-down */}
              <div className="eng-dist-row">
                <CampDistribution
                  aggregate={data.aggregate}
                  selectedCamp={selectedCamp}
                  onSelectCamp={setSelectedCamp}
                />
                {selectedCamp && (
                  <CategoryDrillDown aggregate={data.aggregate} camp={selectedCamp} />
                )}
              </div>

              {/* Section 4: leaderboards */}
              <Leaderboards aggregate={data.aggregate} />

              {/* Sections 5+6: admin-only */}
              {isAdmin && <PerUserTable users={data.users ?? []} />}
              {isAdmin && <HealthStrip aggregate={data.aggregate} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
