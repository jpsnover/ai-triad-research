// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect } from 'react';
import { useSupportStore } from '../../hooks/useSupportStore';
import { CaseDetail } from './CaseDetail';

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--color-info, #3b82f6)',
  'in-progress': 'var(--color-warning, #f59e0b)',
  resolved: 'var(--color-success, #22c55e)',
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
      <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
        Loading cases…
      </div>
    );
  }

  if (error && cases.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <p style={{ color: 'var(--color-error, #ef4444)', marginBottom: 12 }}>{error}</p>
        <button className="btn btn-sm" onClick={() => void fetchCases()}>
          Retry
        </button>
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
        <p style={{ marginBottom: 8 }}>No support cases yet.</p>
        <p style={{ fontSize: '0.8rem' }}>
          Use &ldquo;Report a Problem&rdquo; below to file a new case.
        </p>
      </div>
    );
  }

  // Detail drill-down view
  if (selectedCaseId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <button
          className="btn btn-sm btn-ghost"
          onClick={clearSelection}
          style={{ alignSelf: 'flex-start', marginBottom: 4, fontSize: '0.78rem' }}
        >
          ← Back to cases
        </button>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {detailLoading ? (
            <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
              Loading…
            </div>
          ) : selectedDetail ? (
            <CaseDetail detail={selectedDetail} />
          ) : error ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-error, #ef4444)' }}>
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          {cases.length} case{cases.length !== 1 ? 's' : ''}
        </span>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => void fetchCases()}
          style={{ fontSize: '0.75rem' }}
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
            onClick={() => void selectCase(c.id)}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              background: 'var(--bg-primary)',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-secondary)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-primary)';
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.subject}
              </span>
              <span
                style={{
                  padding: '1px 8px',
                  borderRadius: 10,
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  background: statusColor,
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {c.status}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
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
