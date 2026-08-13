// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@bridge';
import type { SupportCaseSummary, SupportCaseDetail } from '../../bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { TOAST_DURATION_INFO } from '../../constants';
import './SupportAdminPanel.css';

const STATUS_OPTIONS = ['all', 'open', 'in-progress', 'resolved', 'closed'] as const;
const STATUS_COLORS: Record<string, string> = {
  open: 'var(--color-info, #3b82f6)',
  'in-progress': 'var(--warning, #f59e0b)',
  resolved: 'var(--success, #22c55e)',
  closed: 'var(--text-muted, #94a3b8)',
};
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type SortKey = 'date' | 'priority';

export function SupportAdminPanel() {
  const [cases, setCases] = useState<SupportCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<SupportCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [responseText, setResponseText] = useState('');
  const [responseSending, setResponseSending] = useState(false);
  const [responseSuccess, setResponseSuccess] = useState<string | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);

  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());
  const urlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    };
  }, []);

  const revokeAllPreviews = useCallback(() => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    setPreviewUrls(new Map());
  }, []);

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await api.listAdminSupportCases();
      const items: SupportCaseSummary[] = Array.isArray(raw) ? raw : (raw as { items: SupportCaseSummary[] }).items ?? [];
      setCases(items);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'support-admin',
        level: 'error',
        message: 'Failed to load admin support cases',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setError('Failed to load support cases');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const detail = await api.getSupportCaseDetail(id);
      setExpandedDetail(detail);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'support-admin',
        level: 'error',
        message: 'Failed to load case detail',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setError('Failed to load case details');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const toggleExpand = useCallback(
    (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        setExpandedDetail(null);
        revokeAllPreviews();
        return;
      }
      revokeAllPreviews();
      setResponseText('');
      setResponseSuccess(null);
      setExpandedId(id);
      void loadDetail(id);
    },
    [expandedId, loadDetail, revokeAllPreviews],
  );

  const handleSendResponse = useCallback(async () => {
    if (!expandedId || !responseText.trim() || responseSending) return;
    setResponseSending(true);
    setResponseSuccess(null);
    try {
      await api.respondToSupportCase(expandedId, responseText.trim());
      setResponseText('');
      setResponseSuccess('Response sent');
      setTimeout(() => setResponseSuccess(null), TOAST_DURATION_INFO);
      void loadDetail(expandedId);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'support-admin',
        level: 'error',
        message: 'Failed to send response',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setResponseSuccess('Failed to send response');
    } finally {
      setResponseSending(false);
    }
  }, [expandedId, responseText, responseSending, loadDetail]);

  const handleStatusChange = useCallback(
    async (caseId: string, newStatus: string) => {
      setStatusChanging(true);
      try {
        await api.updateSupportCaseStatus(caseId, newStatus);
        setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, status: newStatus } : c)));
        if (expandedDetail?.id === caseId) {
          setExpandedDetail((d) => (d ? { ...d, status: newStatus } : d));
        }
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'support-admin',
          level: 'error',
          message: 'Failed to update case status',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setError('Failed to update status');
      } finally {
        setStatusChanging(false);
      }
    },
    [expandedDetail],
  );

  const loadPreview = useCallback(
    async (caseId: string, attachmentId: string) => {
      if (previewUrls.has(attachmentId)) return;
      try {
        const blob = (await api.downloadCaseAttachment(caseId, attachmentId)) as Blob;
        const url = URL.createObjectURL(blob);
        urlsRef.current.set(attachmentId, url);
        setPreviewUrls(new Map(urlsRef.current));
      } catch (err) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'support-admin',
          level: 'error',
          message: 'Failed to download attachment',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }
    },
    [previewUrls],
  );

  // Filter and sort
  const filtered = cases
    .filter((c) => statusFilter === 'all' || c.status === statusFilter)
    .filter((c) => {
      if (!search) return true;
      const lc = search.toLowerCase();
      return c.subject.toLowerCase().includes(lc) || c.id.toLowerCase().includes(lc);
    })
    .sort((a, b) => {
      if (sortKey === 'priority') {
        const pa = PRIORITY_ORDER[a.priority] ?? 9;
        const pb = PRIORITY_ORDER[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  if (loading && cases.length === 0) {
    return <div className="support-admin-centered-message">Loading cases…</div>;
  }

  return (
    <div className="support-admin-panel">
      {error && (
        <div className="support-admin-error">
          {error}
          <button className="btn btn-sm btn-ghost support-admin-dismiss" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="support-admin-toolbar">
        <div className="support-admin-filter-group">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              className={`btn btn-sm support-admin-filter-btn${statusFilter === s ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? `All (${cases.length})` : s}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search subject…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="support-admin-search"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="support-admin-sort"
        >
          <option value="date">Sort: Date</option>
          <option value="priority">Sort: Priority</option>
        </select>
        <button className="btn btn-sm btn-ghost support-admin-refresh" onClick={() => void fetchCases()}>
          Refresh
        </button>
      </div>

      {/* Case table */}
      {filtered.length === 0 ? (
        <div className="support-admin-centered-message">
          {cases.length === 0 ? 'No support cases.' : 'No cases match filters.'}
        </div>
      ) : (
        <div className="support-admin-table-wrap">
          <table className="support-admin-table">
            <thead>
              <tr className="support-admin-header-row">
                <th className="support-admin-th">Subject</th>
                <th className="support-admin-th support-admin-th-status">Status</th>
                <th className="support-admin-th support-admin-th-priority">Priority</th>
                <th className="support-admin-th support-admin-th-updated">Updated</th>
                <th className="support-admin-th support-admin-th-icon" title="Attachments">
                  📎
                </th>
                <th className="support-admin-th support-admin-th-icon" title="Responses">
                  💬
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const isExpanded = expandedId === c.id;
                const statusColor = STATUS_COLORS[c.status] ?? 'var(--text-muted)';
                return (
                  <TableRow
                    key={c.id}
                    c={c}
                    isExpanded={isExpanded}
                    statusColor={statusColor}
                    onToggle={() => toggleExpand(c.id)}
                    detail={isExpanded ? expandedDetail : null}
                    detailLoading={isExpanded && detailLoading}
                    previewUrls={previewUrls}
                    onLoadPreview={loadPreview}
                    responseText={responseText}
                    onResponseTextChange={setResponseText}
                    onSendResponse={handleSendResponse}
                    responseSending={responseSending}
                    responseSuccess={responseSuccess}
                    onStatusChange={handleStatusChange}
                    statusChanging={statusChanging}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface TableRowProps {
  c: SupportCaseSummary;
  isExpanded: boolean;
  statusColor: string;
  onToggle: () => void;
  detail: SupportCaseDetail | null;
  detailLoading: boolean;
  previewUrls: Map<string, string>;
  onLoadPreview: (caseId: string, attachmentId: string) => Promise<void>;
  responseText: string;
  onResponseTextChange: (text: string) => void;
  onSendResponse: () => Promise<void>;
  responseSending: boolean;
  responseSuccess: string | null;
  onStatusChange: (caseId: string, status: string) => Promise<void>;
  statusChanging: boolean;
}

function TableRow({
  c,
  isExpanded,
  statusColor,
  onToggle,
  detail,
  detailLoading,
  previewUrls,
  onLoadPreview,
  responseText,
  onResponseTextChange,
  onSendResponse,
  responseSending,
  responseSuccess,
  onStatusChange,
  statusChanging,
}: TableRowProps) {
  const tdBorderStyle: React.CSSProperties = {
    borderBottom: isExpanded ? 'none' : '1px solid var(--border-color)',
  };

  return (
    <>
      <tr
        onClick={onToggle}
        className="support-admin-row"
        // eslint-disable-next-line local/no-inline-style -- background depends on row expansion state
        style={{ background: isExpanded ? 'rgba(var(--accent-rgb, 59,130,246), 0.06)' : undefined }}
      >
        <td
          className="support-admin-td"
          // eslint-disable-next-line local/no-inline-style -- bottom border depends on row expansion state
          style={tdBorderStyle}
        >
          <span className="support-admin-subject">{c.subject}</span>
        </td>
        <td
          className="support-admin-td"
          // eslint-disable-next-line local/no-inline-style -- bottom border depends on row expansion state
          style={tdBorderStyle}
        >
          <span
            className="support-admin-status-badge"
            // eslint-disable-next-line local/no-inline-style -- badge background color derived from case status
            style={{ background: statusColor }}
          >
            {c.status}
          </span>
        </td>
        <td
          className="support-admin-td support-admin-td-priority"
          // eslint-disable-next-line local/no-inline-style -- bottom border depends on row expansion state
          style={tdBorderStyle}
        >
          {c.priority}
        </td>
        <td
          className="support-admin-td support-admin-td-updated"
          // eslint-disable-next-line local/no-inline-style -- bottom border depends on row expansion state
          style={tdBorderStyle}
        >
          {formatDate(c.updatedAt)}
        </td>
        <td
          className="support-admin-td support-admin-td-count"
          // eslint-disable-next-line local/no-inline-style -- bottom border depends on row expansion state
          style={tdBorderStyle}
        >
          {c.attachmentCount || ''}
        </td>
        <td
          className="support-admin-td support-admin-td-count"
          // eslint-disable-next-line local/no-inline-style -- bottom border depends on row expansion state
          style={tdBorderStyle}
        >
          {c.responseCount || ''}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={6} className="support-admin-expanded-cell">
            {detailLoading ? (
              <div className="support-admin-detail-loading">Loading…</div>
            ) : detail ? (
              <ExpandedDetail
                detail={detail}
                previewUrls={previewUrls}
                onLoadPreview={onLoadPreview}
                responseText={responseText}
                onResponseTextChange={onResponseTextChange}
                onSendResponse={onSendResponse}
                responseSending={responseSending}
                responseSuccess={responseSuccess}
                onStatusChange={onStatusChange}
                statusChanging={statusChanging}
              />
            ) : null}
          </td>
        </tr>
      )}
    </>
  );
}

interface ExpandedDetailProps {
  detail: SupportCaseDetail;
  previewUrls: Map<string, string>;
  onLoadPreview: (caseId: string, attachmentId: string) => Promise<void>;
  responseText: string;
  onResponseTextChange: (text: string) => void;
  onSendResponse: () => Promise<void>;
  responseSending: boolean;
  responseSuccess: string | null;
  onStatusChange: (caseId: string, status: string) => Promise<void>;
  statusChanging: boolean;
}

function ExpandedDetail({
  detail,
  previewUrls,
  onLoadPreview,
  responseText,
  onResponseTextChange,
  onSendResponse,
  responseSending,
  responseSuccess,
  onStatusChange,
  statusChanging,
}: ExpandedDetailProps) {
  const [showSystemInfo, setShowSystemInfo] = useState(false);

  return (
    <div className="support-admin-detail">
      {/* Header with user + controls */}
      <div className="support-admin-detail-header">
        <div>
          {detail.userDisplayName && (
            <span className="support-admin-user-name">{detail.userDisplayName}</span>
          )}
          <span className="support-admin-created">Created {formatDate(detail.createdAt)}</span>
        </div>
        <div className="support-admin-status-control">
          <label className="support-admin-status-label">Status:</label>
          <select
            value={detail.status}
            onChange={(e) => void onStatusChange(detail.id, e.target.value)}
            disabled={statusChanging}
            className="support-admin-status-select"
          >
            <option value="open">Open</option>
            <option value="in-progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {/* Description */}
      <div className="support-admin-description">{detail.description}</div>

      {/* System Info */}
      <div className="support-admin-section">
        <button
          className="btn btn-sm btn-ghost support-admin-sysinfo-toggle"
          onClick={() => setShowSystemInfo(!showSystemInfo)}
        >
          {showSystemInfo ? '▼' : '▶'} System Info
        </button>
        {showSystemInfo && detail.systemInfo && (
          <div className="support-admin-sysinfo">
            <div>App: {detail.systemInfo.appVersion}</div>
            <div>Mode: {detail.systemInfo.deploymentMode}</div>
            <div>Browser: {detail.systemInfo.browser}</div>
            <div>OS: {detail.systemInfo.os}</div>
          </div>
        )}
      </div>

      {/* Attachments */}
      {detail.attachments.length > 0 && (
        <div className="support-admin-section">
          <div className="support-admin-subheading">
            Attachments ({detail.attachments.length})
          </div>
          <div className="support-admin-attach-list">
            {detail.attachments.map((att) => {
              const isImage = att.mimeType.startsWith('image/');
              const url = previewUrls.get(att.id);
              return (
                <div key={att.id} className="support-admin-attach-item">
                  <div className="support-admin-attach-row">
                    <span className="support-admin-attach-name">{att.filename}</span>
                    <span className="support-admin-attach-size">{formatBytes(att.sizeBytes)}</span>
                  </div>
                  {isImage && !url && (
                    <button
                      className="btn btn-sm btn-ghost support-admin-preview-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onLoadPreview(detail.id, att.id);
                      }}
                    >
                      Preview
                    </button>
                  )}
                  {isImage && url && (
                    <img src={url} alt={att.filename} className="support-admin-preview-img" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Response thread */}
      {detail.responses.length > 0 && (
        <div className="support-admin-section">
          <div className="support-admin-subheading">
            Responses ({detail.responses.length})
          </div>
          <div className="support-admin-response-list">
            {detail.responses.map((resp) => (
              <div key={resp.id} className="support-admin-response-item">
                <div className="support-admin-response-meta">
                  {resp.authorId} &mdash; {formatDate(resp.createdAt)}
                </div>
                <div className="support-admin-response-body">{resp.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response composer */}
      <div className="support-admin-composer">
        <textarea
          value={responseText}
          onChange={(e) => onResponseTextChange(e.target.value)}
          placeholder="Type a response…"
          rows={2}
          className="support-admin-composer-input"
        />
        <button
          className="btn btn-sm btn-primary support-admin-send-btn"
          onClick={() => void onSendResponse()}
          disabled={!responseText.trim() || responseSending}
        >
          {responseSending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {responseSuccess && (
        <div
          className="support-admin-response-status"
          // eslint-disable-next-line local/no-inline-style -- text color reflects success vs failure state
          style={{ color: responseSuccess.startsWith('Failed') ? 'var(--danger, #ef4444)' : 'var(--success, #22c55e)' }}
        >
          {responseSuccess}
        </div>
      )}
    </div>
  );
}
