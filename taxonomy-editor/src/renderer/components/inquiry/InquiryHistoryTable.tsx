// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// "My Questions" history list (t/3620) — mirrors ChatTable.tsx's structure for the inquiry
// feature's own summary shape (InquiryResultSummary). No delete row action yet: the server has
// no DELETE /api/inquiry/:jobId route (confirmed against origin/epic/3618-questions-parity) —
// per ADR-001 graceful-empty, omit the action rather than fake it or silently no-op it.

import { useEffect } from 'react';
import { useInquiryStore } from '../../hooks/useInquiryStore';
import './InquiryHistoryTable.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function InquiryHistoryTable() {
  const { history, historyLoading, historyError, fetchHistory, openFromHistory, closeList } = useInquiryStore();

  useEffect(() => { void fetchHistory(); }, [fetchHistory]);

  return (
    <div className="inquiry-hist">
      <div className="inquiry-rawrow">
        <button className="inquiry-ghost" onClick={closeList}>Back</button>
      </div>
      {historyError && <p className="inquiry-error" role="alert">{historyError}</p>}
      <div className="inquiry-hist-wrap" role="region" aria-label="My questions table">
        <table className="inquiry-hist-table" role="grid">
          <caption className="sr-only">My Questions</caption>
          <colgroup>
            <col className="col-created" />
            <col className="col-question" />
            <col className="col-status" />
            <col className="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="col-created">Asked</th>
              <th scope="col" className="col-question">Question</th>
              <th scope="col" className="col-status">Status</th>
              <th scope="col" className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {historyLoading && history.length === 0 && (
              <tr key="loading"><td colSpan={4} className="inquiry-hist-empty-cell">Loading…</td></tr>
            )}
            {!historyLoading && history.length === 0 && !historyError && (
              <tr key="empty"><td colSpan={4} className="inquiry-hist-empty-cell">No questions yet. Ask one to get started.</td></tr>
            )}
            {history.map((h) => (
              <tr key={h.jobId} onClick={() => void openFromHistory(h.jobId)}>
                <td className="col-created" title={h.createdAt}>{formatDate(h.createdAt)}</td>
                <td className="col-question">
                  <div className="inquiry-hist-title-text" title={h.question}>{h.question}</div>
                </td>
                <td className="col-status">
                  {h.truncated && <span className="inquiry-hist-pill">Truncated</span>}
                </td>
                <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="inquiry-hist-action-btn"
                    title="Open this question's answer"
                    aria-label={`Open "${h.question}"`}
                    onClick={() => void openFromHistory(h.jobId)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
