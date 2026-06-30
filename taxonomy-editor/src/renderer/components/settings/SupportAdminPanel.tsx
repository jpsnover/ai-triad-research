// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@bridge';
import type { SupportCaseSummary, SupportCaseDetail } from '../../bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

const STATUS_OPTIONS = ['all', 'open', 'in-progress', 'resolved', 'closed'] as const;
const STATUS_COLORS: Record<string, string> = {
  open: 'var(--color-info, #3b82f6)',
  'in-progress': 'var(--color-warning, #f59e0b)',
  resolved: 'var(--color-success, #22c55e)',
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

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  fontWeight: 600,
  borderBottom: '1px solid var(--border)',
  fontSize: '0.75rem',
  whiteSpace: 'nowrap',
};

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
      const result = await api.listAdminSupportCases();
      setCases(result);
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
      setTimeout(() => setResponseSuccess(null), 3000);
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
    return <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>Loading cases…</div>;
  }

  return (
    <div style={{ padding: '0 12px 12px', fontSize: '0.85rem' }}>
      {error && (
        <div
          style={{
            padding: '6px 12px',
            marginBottom: 8,
            borderRadius: 6,
            background: 'rgba(239, 68, 68, 0.1)',
            color: 'var(--color-error, #ef4444)',
            fontSize: '0.8rem',
          }}
        >
          {error}
          <button className="btn btn-sm btn-ghost" onClick={() => setError(null)} style={{ marginLeft: 8 }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              className={`btn btn-sm${statusFilter === s ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => setStatusFilter(s)}
              style={{ fontSize: '0.73rem', textTransform: 'capitalize' }}
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
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '0.8rem',
            width: 180,
          }}
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '0.78rem',
          }}
        >
          <option value="date">Sort: Date</option>
          <option value="priority">Sort: Priority</option>
        </select>
        <button className="btn btn-sm btn-ghost" onClick={() => void fetchCases()} style={{ fontSize: '0.75rem' }}>
          Refresh
        </button>
      </div>

      {/* Case table */}
      {filtered.length === 0 ? (
        <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
          {cases.length === 0 ? 'No support cases.' : 'No cases match filters.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={thStyle}>Subject</th>
                <th style={{ ...thStyle, width: 80 }}>Status</th>
                <th style={{ ...thStyle, width: 70 }}>Priority</th>
                <th style={{ ...thStyle, width: 90 }}>Updated</th>
                <th style={{ ...thStyle, width: 30, textAlign: 'center' }} title="Attachments">
                  📎
                </th>
                <th style={{ ...thStyle, width: 30, textAlign: 'center' }} title="Responses">
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
  const tdStyle: React.CSSProperties = {
    padding: '6px 8px',
    borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
    verticalAlign: 'middle',
  };

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          cursor: 'pointer',
          background: isExpanded ? 'rgba(var(--accent-rgb, 59,130,246), 0.06)' : undefined,
        }}
      >
        <td style={tdStyle}>
          <span style={{ fontWeight: 500 }}>{c.subject}</span>
        </td>
        <td style={tdStyle}>
          <span
            style={{
              padding: '1px 8px',
              borderRadius: 10,
              fontSize: '0.7rem',
              fontWeight: 600,
              background: statusColor,
              color: '#fff',
            }}
          >
            {c.status}
          </span>
        </td>
        <td style={{ ...tdStyle, fontSize: '0.76rem', color: 'var(--text-muted)' }}>{c.priority}</td>
        <td style={{ ...tdStyle, fontSize: '0.73rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {formatDate(c.updatedAt)}
        </td>
        <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
          {c.attachmentCount || ''}
        </td>
        <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
          {c.responseCount || ''}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
            {detailLoading ? (
              <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>
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
    <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', fontSize: '0.82rem' }}>
      {/* Header with user + controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          {detail.userDisplayName && (
            <span style={{ fontWeight: 600, marginRight: 12 }}>{detail.userDisplayName}</span>
          )}
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Created {formatDate(detail.createdAt)}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>Status:</label>
          <select
            value={detail.status}
            onChange={(e) => void onStatusChange(detail.id, e.target.value)}
            disabled={statusChanging}
            style={{
              padding: '3px 6px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '0.78rem',
            }}
          >
            <option value="open">Open</option>
            <option value="in-progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {/* Description */}
      <div style={{ marginBottom: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{detail.description}</div>

      {/* System Info */}
      <div style={{ marginBottom: 12 }}>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setShowSystemInfo(!showSystemInfo)}
          style={{ fontSize: '0.73rem' }}
        >
          {showSystemInfo ? '▼' : '▶'} System Info
        </button>
        {showSystemInfo && detail.systemInfo && (
          <div
            style={{
              marginTop: 4,
              padding: 8,
              borderRadius: 6,
              background: 'var(--bg-primary)',
              fontSize: '0.73rem',
              fontFamily: 'monospace',
            }}
          >
            <div>App: {detail.systemInfo.appVersion}</div>
            <div>Mode: {detail.systemInfo.deploymentMode}</div>
            <div>Browser: {detail.systemInfo.browser}</div>
            <div>OS: {detail.systemInfo.os}</div>
          </div>
        )}
      </div>

      {/* Attachments */}
      {detail.attachments.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: '0.8rem' }}>
            Attachments ({detail.attachments.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {detail.attachments.map((att) => {
              const isImage = att.mimeType.startsWith('image/');
              const url = previewUrls.get(att.id);
              return (
                <div
                  key={att.id}
                  style={{
                    padding: 6,
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-primary)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 500, fontSize: '0.78rem' }}>{att.filename}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{formatBytes(att.sizeBytes)}</span>
                  </div>
                  {isImage && !url && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onLoadPreview(detail.id, att.id);
                      }}
                      style={{ marginTop: 3, fontSize: '0.7rem' }}
                    >
                      Preview
                    </button>
                  )}
                  {isImage && url && (
                    <img src={url} alt={att.filename} style={{ marginTop: 4, maxWidth: '100%', maxHeight: 200, borderRadius: 4 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Response thread */}
      {detail.responses.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: '0.8rem' }}>
            Responses ({detail.responses.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.responses.map((resp) => (
              <div
                key={resp.id}
                style={{
                  padding: 8,
                  borderRadius: 4,
                  background: 'var(--bg-primary)',
                  borderLeft: '3px solid var(--accent, #3b82f6)',
                }}
              >
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 3 }}>
                  {resp.authorId} &mdash; {formatDate(resp.createdAt)}
                </div>
                <div style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{resp.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response composer */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={responseText}
          onChange={(e) => onResponseTextChange(e.target.value)}
          placeholder="Type a response…"
          rows={2}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: '0.8rem',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void onSendResponse()}
          disabled={!responseText.trim() || responseSending}
          style={{ whiteSpace: 'nowrap' }}
        >
          {responseSending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {responseSuccess && (
        <div
          style={{
            marginTop: 4,
            fontSize: '0.73rem',
            color: responseSuccess.startsWith('Failed') ? 'var(--color-error, #ef4444)' : 'var(--color-success, #22c55e)',
          }}
        >
          {responseSuccess}
        </div>
      )}
    </div>
  );
}
