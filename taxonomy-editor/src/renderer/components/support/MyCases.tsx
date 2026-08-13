// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect } from 'react';
import { useSupportStore } from '../../hooks/useSupportStore';
import { CaseDetail } from './CaseDetail';
import './MyCases.css';

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--color-info, #3b82f6)',
  'in-progress': 'var(--warning, #f59e0b)',
  resolved: 'var(--success, #22c55e)',
  closed: 'var(--text-muted, #94a3b8)',
};

const PRIORITY_DOT: Record<string, string> = {
  high: '●',
  medium: '◐',
  low: '○',
};

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function MyCases() {
  const {
    cases,
    selectedCaseId,
    selectedDetail,
    loading,
    detailLoading,
    error,
    fetchCases,
    selectCase,
    clearSelection,
  } = useSupportStore();

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  if (loading) {
    return (
      <div className="support-mycases-centered">
        Loading cases…
      </div>
    );
  }

  if (error && cases.length === 0) {
    return (
      <div className="support-mycases-centered-plain">
        <p className="support-mycases-error-text">{error}</p>
        <button className="btn btn-sm" onClick={() => void fetchCases()}>
          Retry
        </button>
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="support-mycases-centered">
        <p className="support-mycases-mb-8">No support cases yet.</p>
        <p className="support-mycases-fs-80">
          Use &ldquo;Report a Problem&rdquo; below to file a new case.
        </p>
      </div>
    );
  }

  // Detail drill-down view
  if (selectedCaseId) {
    return (
      <div className="support-mycases-detail-wrap">
        <button
          className="btn btn-sm btn-ghost support-mycases-back-btn"
          onClick={clearSelection}
        >
          ← Back to cases
        </button>
        <div className="support-mycases-detail-scroll">
          {detailLoading ? (
            <div className="support-mycases-centered">
              Loading…
            </div>
          ) : selectedDetail ? (
            <CaseDetail detail={selectedDetail} />
          ) : error ? (
            <div className="support-mycases-detail-error">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="support-mycases-list">
      <div className="support-mycases-list-header">
        <span className="support-mycases-count">
          {cases.length} case{cases.length !== 1 ? 's' : ''}
        </span>
        <button
          className="btn btn-sm btn-ghost support-mycases-refresh-btn"
          onClick={() => void fetchCases()}
        >
          Refresh
        </button>
      </div>
      {cases.map((c) => {
        const statusColor = STATUS_COLORS[c.status] ?? 'var(--text-muted)';
        const dot = PRIORITY_DOT[c.priority] ?? '';
        return (
          <div
            key={c.id}
            className="support-mycases-row"
            onClick={() => void selectCase(c.id)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-secondary)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-primary)';
            }}
          >
            <div className="support-mycases-row-header">
              <span className="support-mycases-row-subject">
                {c.subject}
              </span>
              <span
                className="support-mycases-status-badge"
                /* eslint-disable-next-line local/no-inline-style -- statusColor is a per-case dynamic value passed as a CSS custom property */
                style={{ '--status-color': statusColor } as React.CSSProperties}
              >
                {c.status}
              </span>
            </div>
            <div className="support-mycases-row-meta">
              {dot && <span title={c.priority}>{dot} {c.priority}</span>}
              <span>Updated {formatShortDate(c.updatedAt)}</span>
              {c.attachmentCount > 0 && <span>{c.attachmentCount} file{c.attachmentCount !== 1 ? 's' : ''}</span>}
              {c.responseCount > 0 && <span>{c.responseCount} response{c.responseCount !== 1 ? 's' : ''}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
