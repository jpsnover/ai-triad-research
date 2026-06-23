// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Analytics Dashboard — web-only reporting page for usage analytics.
 * Route: #analytics. Entry point: chart icon in SaveBar.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { bridgeGet } from '../../bridge/web-bridge';
import { SystemOverviewRow } from './SystemOverviewRow';

// ── Types ──

interface DailySummary { date: string; events: number; users: number; sessions: number }
interface UserSummary { user: string; lastActive: string; sessions: number; events: number; topCategory: string }
interface QueryResult {
  summary: { activeUsers: number; sessions: number; totalEvents: number; avgSessionDurationMs: number };
  daily: DailySummary[];
  featureUsage: Record<string, number>;
  users: UserSummary[];
}
interface RawEvent {
  user: string; session_id: string; timestamp: string;
  event_type: string; category: string; detail: Record<string, unknown>; duration_ms?: number;
}

type DatePreset = '1d' | '7d' | '30d' | '90d';
type SortCol = 'user' | 'lastActive' | 'sessions' | 'events' | 'topCategory';

const CATEGORY_COLORS: Record<string, string> = {
  navigation: '#3b82f6',
  taxonomy: '#22c55e',
  debate: '#f59e0b',
  search: '#a855f7',
  ai: '#ef4444',
  config: '#6b7280',
};

const PRESET_DAYS: Record<DatePreset, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };

function dateRange(preset: DatePreset): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (PRESET_DAYS[preset] - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** The equal-length window immediately preceding the current one (for period comparison). */
function previousRange(preset: DatePreset): { from: string; to: string } {
  const days = PRESET_DAYS[preset];
  const to = new Date();
  to.setDate(to.getDate() - days);
  const from = new Date();
  from.setDate(from.getDate() - (2 * days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Fetch one analytics window via the resilient bridge helper (timeout/retry/429 handling). */
function fetchQuery(from: string, to: string): Promise<QueryResult> {
  return bridgeGet<QueryResult>(`/api/analytics/query?from=${from}&to=${to}`);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtNumber(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ── Components ──

/** Period-over-period delta indicator. `goodWhenUp` null = neutral metric (no green/red). */
function Delta({ current, previous, goodWhenUp }: { current: number; previous: number; goodWhenUp: boolean | null }) {
  // No baseline to compare against — avoid divide-by-zero.
  if (previous === 0) {
    return <div style={{ fontSize: '0.7rem', marginTop: 4, color: 'var(--text-muted)' }}>{current > 0 ? 'new' : '—'}</div>;
  }
  const delta = ((current - previous) / previous) * 100;
  const flat = Math.abs(delta) < 0.05;
  const up = delta > 0;
  const arrow = flat ? '→' : up ? '↑' : '↓';
  let color = 'var(--text-muted)';
  if (!flat && goodWhenUp !== null) {
    const good = goodWhenUp ? up : !up;
    color = good ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)';
  }
  return (
    <div style={{ fontSize: '0.7rem', marginTop: 4, color }} title={`vs. previous period`}>
      {arrow} {Math.abs(delta).toFixed(1)}%
    </div>
  );
}

function SummaryCards({ data, previous }: { data: QueryResult['summary']; previous?: QueryResult['summary'] | null }) {
  // goodWhenUp: true = higher is better (green up); null = neutral (no color judgement)
  const cards: { label: string; value: number; display: string; prev: number | undefined; goodWhenUp: boolean | null }[] = [
    { label: 'Active Users', value: data.activeUsers, display: String(data.activeUsers), prev: previous?.activeUsers, goodWhenUp: true },
    { label: 'Sessions', value: data.sessions, display: String(data.sessions), prev: previous?.sessions, goodWhenUp: true },
    { label: 'Total Events', value: data.totalEvents, display: fmtNumber(data.totalEvents), prev: previous?.totalEvents, goodWhenUp: true },
    { label: 'Avg Session', value: data.avgSessionDurationMs, display: fmtDuration(data.avgSessionDurationMs), prev: previous?.avgSessionDurationMs, goodWhenUp: null },
  ];
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      {cards.map(c => (
        <div key={c.label} style={{
          flex: '1 1 140px', padding: '16px 20px', borderRadius: 8,
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{c.display}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{c.label}</div>
          {previous != null && c.prev !== undefined && (
            <Delta current={c.value} previous={c.prev} goodWhenUp={c.goodWhenUp} />
          )}
        </div>
      ))}
    </div>
  );
}

function ActivityChart({ daily }: { daily: DailySummary[] }) {
  if (daily.length === 0) return null;
  const maxEvents = Math.max(...daily.map(d => d.events), 1);
  const maxUsers = Math.max(...daily.map(d => d.users), 1);

  return (
    <div style={{
      marginBottom: 20, padding: 16, borderRadius: 8,
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
    }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 12 }}>Activity Over Time</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
        {daily.map(d => (
          <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}
            title={`${d.date}\n${d.events} events, ${d.users} users, ${d.sessions} sessions`}
          >
            <div style={{
              width: '100%', maxWidth: 24, borderRadius: '3px 3px 0 0',
              background: '#3b82f6', opacity: 0.7,
              height: `${Math.max((d.events / maxEvents) * 100, 2)}%`,
            }} />
          </div>
        ))}
      </div>
      {/* User line overlay */}
      <svg viewBox={`0 0 ${daily.length * 10} 100`} style={{ width: '100%', height: 40, marginTop: -40, pointerEvents: 'none' }} preserveAspectRatio="none">
        <polyline
          fill="none" stroke="#f59e0b" strokeWidth="2"
          points={daily.map((d, i) => `${i * 10 + 5},${100 - (d.users / maxUsers) * 90}`).join(' ')}
        />
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#3b82f6', opacity: 0.7, borderRadius: 2, marginRight: 4 }} />Events</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#f59e0b', marginRight: 4, verticalAlign: 'middle' }} />Users</span>
      </div>
    </div>
  );
}

function FeatureUsage({ usage, onFilter }: { usage: Record<string, number>; onFilter: (cat: string) => void }) {
  const sorted = useMemo(() =>
    Object.entries(usage).sort(([, a], [, b]) => b - a),
    [usage]);
  const max = sorted[0]?.[1] || 1;

  return (
    <div style={{
      flex: '1 1 300px', padding: 16, borderRadius: 8,
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
    }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 12 }}>Feature Usage</div>
      {sorted.map(([cat, count]) => (
        <div key={cat} style={{ marginBottom: 6, cursor: 'pointer' }} onClick={() => onFilter(cat)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: 2 }}>
            <span style={{ color: 'var(--text-primary)' }}>{cat}</span>
            <span style={{ color: 'var(--text-muted)' }}>{count}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-primary)' }}>
            <div style={{
              height: '100%', borderRadius: 3, width: `${(count / max) * 100}%`,
              background: CATEGORY_COLORS[cat] || '#6b7280',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ActiveUsers({ users, sortCol, sortDir, onSort, onSelectUser }: {
  users: UserSummary[]; sortCol: SortCol; sortDir: 'asc' | 'desc';
  onSort: (col: SortCol) => void; onSelectUser: (user: string) => void;
}) {
  const sorted = useMemo(() => {
    const arr = [...users];
    arr.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [users, sortCol, sortDir]);

  const header = (col: SortCol, label: string) => (
    <th key={col} onClick={() => onSort(col)} style={{
      padding: '6px 8px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
      textAlign: col === 'user' || col === 'topCategory' ? 'left' : 'right',
      borderBottom: '1px solid var(--border-color)',
      color: sortCol === col ? 'var(--text-primary)' : 'var(--text-muted)',
    }}>
      {label} {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div style={{
      flex: '1 1 400px', padding: 16, borderRadius: 8,
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
      overflowX: 'auto',
    }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 12 }}>Active Users</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
        <thead><tr>
          {header('user', 'User')}
          {header('lastActive', 'Last Active')}
          {header('sessions', 'Sessions')}
          {header('events', 'Events')}
          {header('topCategory', 'Top Feature')}
        </tr></thead>
        <tbody>
          {sorted.map(u => (
            <tr key={u.user} onClick={() => onSelectUser(u.user)} style={{ cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-primary)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <td style={{ padding: '4px 8px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }} title={u.user}>{u.user}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap' }} title={u.lastActive}>{relativeTime(u.lastActive)}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{u.sessions}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{u.events}</td>
              <td style={{ padding: '4px 8px' }}>
                <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: '0.65rem', background: `${CATEGORY_COLORS[u.topCategory] || '#6b7280'}22`, color: CATEGORY_COLORS[u.topCategory] || '#6b7280' }}>
                  {u.topCategory}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionExplorer({ from, to, selectedUser, categoryFilter }: {
  from: string; to: string; selectedUser: string | null; categoryFilter: string | null;
}) {
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [sessions, setSessions] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load sessions for selected user
  useEffect(() => {
    if (!selectedUser) { setSessions([]); setEvents([]); return; }
    setLoading(true);
    bridgeGet<{ events: RawEvent[] }>(`/api/analytics/query?from=${from}&to=${to}&user=${encodeURIComponent(selectedUser)}`)
      .then((data) => {
        const ids = [...new Set(data.events.map(e => e.session_id))];
        setSessions(ids);
        setSelectedSession(ids[0] || null);
        setEvents(data.events);
        setLoading(false);
      })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'analytics-dashboard',
          level: 'warn',
          message: 'Failed to load analytics events — showing empty result',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setLoading(false);
      });
  }, [selectedUser, from, to]);

  const filtered = useMemo(() => {
    let evts = events;
    if (selectedSession) evts = evts.filter(e => e.session_id === selectedSession);
    if (categoryFilter) evts = evts.filter(e => e.category === categoryFilter);
    return evts.slice(0, 500);
  }, [events, selectedSession, categoryFilter]);

  return (
    <div style={{
      marginTop: 20, padding: 16, borderRadius: 8,
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Session Explorer</div>
        {selectedUser && (
          <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
            {selectedUser}
          </span>
        )}
        {sessions.length > 1 && (
          <select
            value={selectedSession || ''}
            onChange={e => setSelectedSession(e.target.value || null)}
            style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
          >
            {sessions.map(s => <option key={s} value={s}>{s.slice(0, 8)}...</option>)}
          </select>
        )}
        {categoryFilter && (
          <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 3, background: `${CATEGORY_COLORS[categoryFilter] || '#6b7280'}22`, color: CATEGORY_COLORS[categoryFilter] || '#6b7280' }}>
            {categoryFilter}
          </span>
        )}
      </div>

      {!selectedUser && (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          Click a user in the Active Users table to explore their sessions.
        </div>
      )}

      {loading && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.75rem' }}>Loading...</div>}

      {selectedUser && !loading && filtered.length === 0 && (
        <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: '0.75rem' }}>No events found.</div>
      )}

      {filtered.length > 0 && (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {filtered.map((evt, i) => {
            const time = new Date(evt.timestamp).toLocaleTimeString('en-US', { hour12: false });
            const detailStr = Object.entries(evt.detail)
              .filter(([k]) => !k.startsWith('_'))
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(', ');
            return (
              <div key={i} style={{
                display: 'flex', gap: 12, padding: '4px 8px', fontSize: '0.72rem',
                background: i % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
                borderRadius: 2,
              }}>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0, width: 60 }}>{time}</span>
                <span style={{
                  padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', fontWeight: 600,
                  background: `${CATEGORY_COLORS[evt.category] || '#6b7280'}22`,
                  color: CATEGORY_COLORS[evt.category] || '#6b7280',
                  flexShrink: 0, minWidth: 80, textAlign: 'center',
                }}>
                  {evt.event_type}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                  {detailStr}
                </span>
                {evt.duration_ms != null && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', flexShrink: 0 }}>({evt.duration_ms}ms)</span>
                )}
              </div>
            );
          })}
          {events.length > 500 && (
            <div style={{ padding: 8, textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Showing first 500 of {events.length} events
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ──

export function AnalyticsDashboard() {
  const [preset, setPreset] = useState<DatePreset>('7d');
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>('lastActive');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [compare, setCompare] = useState(false);
  const [prevData, setPrevData] = useState<QueryResult['summary'] | null>(null);

  const { from, to } = useMemo(() => dateRange(preset), [preset]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchQuery(from, to)
      .then((d) => { setData(d); setLoading(false); })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'analytics-dashboard',
          level: 'error',
          message: 'Analytics query failed',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setError(String(err));
        setLoading(false);
      });
  }, [from, to]);

  // Period comparison: fetch the equal-length preceding window when enabled.
  useEffect(() => {
    if (!compare) { setPrevData(null); return; }
    let cancelled = false;
    const prev = previousRange(preset);
    fetchQuery(prev.from, prev.to)
      .then((d) => { if (!cancelled) setPrevData(d.summary); })
      .catch(err => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'analytics-dashboard',
          level: 'warn',
          message: 'Failed to load previous-period analytics — comparison unavailable',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        if (!cancelled) setPrevData(null);
      });
    return () => { cancelled = true; };
  }, [compare, preset]);

  const handleSort = useCallback((col: SortCol) => {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col; }
      setSortDir('desc');
      return col;
    });
  }, []);

  const handleBack = () => { window.location.hash = ''; window.location.reload(); };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={handleBack} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem',
          }}>
            ← Back to Editor
          </button>
          <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Usage Analytics</h1>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['1d', '7d', '30d', '90d'] as DatePreset[]).map(p => (
            <button key={p} onClick={() => { setPreset(p); setSelectedUser(null); setCategoryFilter(null); }}
              style={{
                padding: '4px 12px', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer',
                background: preset === p ? 'var(--color-acc, #3b82f6)' : 'var(--bg-secondary)',
                color: preset === p ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${preset === p ? 'transparent' : 'var(--border-color)'}`,
              }}>
              {p === '1d' ? 'Today' : `${p.replace('d', '')} days`}
            </button>
          ))}
          <button onClick={() => setCompare(c => !c)}
            title="Compare each metric with the previous period of equal length"
            style={{
              marginLeft: 8, padding: '4px 12px', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer',
              background: compare ? 'var(--color-acc, #3b82f6)' : 'var(--bg-secondary)',
              color: compare ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${compare ? 'transparent' : 'var(--border-color)'}`,
            }}>
            vs. previous
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading analytics...</div>}
      {error && <div style={{ padding: 20, color: '#ef4444' }}>Failed to load analytics: {error}</div>}

      {data && !loading && (
        <>
          {data.summary.totalEvents === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1rem', marginBottom: 8 }}>No analytics data available</div>
              <div style={{ fontSize: '0.8rem' }}>Events will appear as users interact with the app.</div>
            </div>
          ) : (
            <>
              <SystemOverviewRow usage={{
                sessions: data.summary.sessions,
                sessionsDeltaPct: compare && prevData && prevData.sessions > 0
                  ? ((data.summary.sessions - prevData.sessions) / prevData.sessions) * 100
                  : null,
              }} />
              <SummaryCards data={data.summary} previous={compare ? prevData : null} />
              <ActivityChart daily={data.daily} />
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <FeatureUsage usage={data.featureUsage} onFilter={cat => setCategoryFilter(cat === categoryFilter ? null : cat)} />
                <ActiveUsers
                  users={data.users} sortCol={sortCol} sortDir={sortDir}
                  onSort={handleSort}
                  onSelectUser={u => setSelectedUser(u === selectedUser ? null : u)}
                />
              </div>
              <SessionExplorer from={from} to={to} selectedUser={selectedUser} categoryFilter={categoryFilter} />
            </>
          )}
        </>
      )}
    </div>
  );
}
