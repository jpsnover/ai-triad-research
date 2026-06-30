// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './AdminErrorsTab.css';

declare const __APP_VERSION__: string;

type ErrorSummary = Awaited<ReturnType<typeof api.getErrorSummary>>;
type ErrorListResult = Awaited<ReturnType<typeof api.listErrors>>;
type ErrorDetailResult = Awaited<ReturnType<typeof api.getErrorDetail>>;

type TimeFilter = '24h' | '7d' | '30d';

function timeFilterToSince(f: TimeFilter): string {
  const d = new Date();
  if (f === '24h') d.setDate(d.getDate() - 1);
  else if (f === '7d') d.setDate(d.getDate() - 7);
  else d.setDate(d.getDate() - 30);
  return d.toISOString();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ErrorDetail({ detail }: { detail: NonNullable<ErrorDetailResult> }) {
  const [showStack, setShowStack] = useState(false);
  const { entry, relatedDumps } = detail;
  const ctx = entry.context as Record<string, string> | undefined;
  const buildMismatch = ctx?.buildVersion && ctx.buildVersion !== __APP_VERSION__;

  return (
    <div className="admin-errors-detail">
      <h4>{entry.name}: {entry.message}</h4>
      <dl className="admin-errors-detail-grid">
        <dt>Time</dt>
        <dd>{new Date(entry.timestamp).toLocaleString()} ({timeAgo(entry.timestamp)})</dd>
        {entry.userId && <><dt>User</dt><dd>{entry.userId}</dd></>}
        {ctx?.trigger && <><dt>Trigger</dt><dd>{ctx.trigger}</dd></>}
        {ctx?.url && <><dt>URL</dt><dd>{ctx.url}</dd></>}
        {ctx?.deploymentMode && <><dt>Mode</dt><dd>{ctx.deploymentMode}</dd></>}
        {ctx?.buildVersion && (
          <>
            <dt>Build</dt>
            <dd>
              {ctx.buildVersion}
              {buildMismatch && (
                <span className="admin-errors-stale-badge" style={{ marginLeft: 6 }}>stale build</span>
              )}
            </dd>
          </>
        )}
      </dl>

      {entry.stack && (
        <>
          <button className="admin-errors-stack-toggle" onClick={() => setShowStack(v => !v)}>
            {showStack ? 'Hide' : 'Show'} stack trace
          </button>
          {showStack && <pre className="admin-errors-stack">{entry.stack}</pre>}
        </>
      )}

      {relatedDumps.length > 0 && (
        <div className="admin-errors-dumps">
          <h5>Related Dumps</h5>
          {relatedDumps.map(d => (
            <a
              key={d.dumpId}
              href={`/api/admin/flight-recorder/merged?dumpId=${encodeURIComponent(d.dumpId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {d.kind} — {timeAgo(d.timestamp)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminErrorsTab() {
  const [summary, setSummary] = useState<ErrorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('7d');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [instances, setInstances] = useState<ErrorListResult | null>(null);
  const [instancesLoading, setInstancesLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ErrorDetailResult>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getErrorSummary();
      setSummary(data);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'AdminErrorsTab', level: 'error',
        message: 'Failed to fetch error summary',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setError(String((err as Error).message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSummary(); }, [fetchSummary]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => void fetchSummary(), 60000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchSummary]);

  const handleExpandGroup = useCallback(async (key: string) => {
    if (expandedKey === key) {
      setExpandedKey(null);
      setInstances(null);
      setSelectedId(null);
      setDetail(null);
      return;
    }
    setExpandedKey(key);
    setSelectedId(null);
    setDetail(null);
    setInstancesLoading(true);
    try {
      const result = await api.listErrors({ errorName: key, since: timeFilterToSince(timeFilter) });
      setInstances(result);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'AdminErrorsTab', level: 'error',
        message: `Failed to list errors for ${key}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setInstances(null);
    } finally {
      setInstancesLoading(false);
    }
  }, [expandedKey, timeFilter]);

  const handleSelectInstance = useCallback(async (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const result = await api.getErrorDetail(id);
      setDetail(result);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'AdminErrorsTab', level: 'error',
        message: `Failed to fetch error detail ${id}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  if (loading) return <div className="admin-errors-loading">Loading error data...</div>;
  if (error) return <div className="admin-errors-error">Failed to load errors: {error}</div>;
  if (!summary || summary.total === 0) return <div className="admin-errors-empty">No errors recorded.</div>;

  const filteredTopErrors = summary.topErrors;

  return (
    <div className="admin-errors">
      <div className="admin-errors-cards">
        <div className="admin-errors-card">
          <div className="admin-errors-card-count">{summary.today}</div>
          <div className="admin-errors-card-label">Today</div>
        </div>
        <div className="admin-errors-card">
          <div className="admin-errors-card-count">{summary.last7d}</div>
          <div className="admin-errors-card-label">Last 7 Days</div>
        </div>
        <div className="admin-errors-card">
          <div className="admin-errors-card-count">{summary.last30d}</div>
          <div className="admin-errors-card-label">Last 30 Days</div>
        </div>
      </div>

      <div className="admin-errors-toolbar">
        <span>Filter:</span>
        <select value={timeFilter} onChange={e => setTimeFilter(e.target.value as TimeFilter)}>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
        <label>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh (60s)
        </label>
      </div>

      <table className="admin-errors-table">
        <thead>
          <tr>
            <th>Error</th>
            <th>Count</th>
            <th>Users</th>
            <th>Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {filteredTopErrors.map(te => (
            <>
              <tr
                key={te.key}
                className={`admin-errors-row${expandedKey === te.key ? ' admin-errors-row--expanded' : ''}`}
                onClick={() => void handleExpandGroup(te.key)}
              >
                <td className="admin-errors-key">{te.key}</td>
                <td className="admin-errors-count">{te.count}</td>
                <td>{te.affectedUsers}</td>
                <td title={new Date(te.lastSeen).toLocaleString()}>{timeAgo(te.lastSeen)}</td>
              </tr>
              {expandedKey === te.key && (
                <tr key={`${te.key}-detail`} className="admin-errors-detail-row">
                  <td colSpan={4}>
                    {instancesLoading ? (
                      <div className="admin-errors-detail-loading">Loading instances...</div>
                    ) : selectedId && detailLoading ? (
                      <div className="admin-errors-detail-loading">Loading detail...</div>
                    ) : selectedId && detail ? (
                      <ErrorDetail detail={detail} />
                    ) : (
                      <div className="admin-errors-instances" style={{ padding: '8px 16px' }}>
                        {instances?.items.map(inst => (
                          <div
                            key={inst.id}
                            className="admin-errors-instance"
                            onClick={e => { e.stopPropagation(); void handleSelectInstance(inst.id); }}
                          >
                            <span className="admin-errors-instance-id">{inst.id.slice(0, 8)}</span>
                            <span style={{ flex: 1 }}>{inst.message}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                              {timeAgo(inst.timestamp)}
                            </span>
                            {inst.userId && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                                {inst.userId}
                              </span>
                            )}
                          </div>
                        ))}
                        {instances?.items.length === 0 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 0' }}>
                            No matching instances in this time window.
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
