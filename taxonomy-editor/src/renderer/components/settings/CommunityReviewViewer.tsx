// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useState } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './CommunityReviewViewer.css';

// ── Types ──

interface CommunityDetail {
  submissionId: string;
  type: string;
  submitter: string;
  submittedAt: string;
  note?: string;
  title?: string;
  topic?: string;
  preview: string;
  metadata: {
    model?: string;
    turnCount?: number;
    taxonomyRefs?: string[];
  };
  sanitization: {
    willStrip: string[];
    willAdd: string[];
  };
}

// ── Props ──

export interface CommunityReviewViewerProps {
  groupId: string;
  onActionComplete?: () => void;
}

// ── API helpers ──

async function fetchDetail(groupId: string): Promise<CommunityDetail> {
  const res = await fetch(`/api/admin/review/detail/${encodeURIComponent(groupId)}`);
  if (!res.ok) throw new Error(`GET detail failed: HTTP ${res.status}`);
  return res.json();
}

async function postAction(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/admin/review/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch((err) => {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'CommunityReviewViewer', level: 'warn', message: 'Failed to read error response text', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      return '';
    });
    throw new Error(`POST action failed: HTTP ${res.status} ${text}`);
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'CommunityReviewViewer', level: 'debug', message: 'Date format failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return iso;
  }
}

// ── Component ──

export function CommunityReviewViewer({ groupId, onActionComplete }: CommunityReviewViewerProps) {
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'promote' | 'reject' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchDetail(groupId);
      if ('found' in d && !d.found) {
        setError('Submission not found — it may have been promoted or deleted.');
        return;
      }
      setDetail(d);
      setEditTitle(d.title ?? '');
      setEditDescription('');
      setRejectReason('');
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'CommunityReviewViewer',
        level: 'error',
        message: 'Failed to fetch community review detail',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  const handlePromote = async () => {
    if (!detail) return;
    setBusy('promote');
    try {
      const fields: Record<string, string> = {};
      if (editTitle && editTitle !== detail.title) fields.title = editTitle;
      if (editDescription) fields.description = editDescription;
      const editsPayload = Object.keys(fields).length > 0
        ? { edits: { [detail.submissionId]: fields } }
        : {};
      await postAction({
        domain: 'community',
        groupId,
        action: 'promote',
        itemIds: [detail.submissionId],
        ...editsPayload,
      });
      setToast('Submission promoted');
      onActionComplete?.();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'CommunityReviewViewer',
        level: 'error',
        message: 'Failed to promote community submission',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setToast(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleReject = async () => {
    if (!detail || !rejectReason.trim()) return;
    setBusy('reject');
    try {
      await postAction({
        domain: 'community',
        groupId,
        action: 'reject',
        itemIds: [detail.submissionId],
        reason: rejectReason.trim(),
      });
      setToast('Submission rejected');
      onActionComplete?.();
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'CommunityReviewViewer',
        level: 'error',
        message: 'Failed to reject community submission',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setToast(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  if (loading) return <div className="crv-loading">Loading submission detail…</div>;
  if (error) return <div className="crv-error">{error}</div>;
  if (!detail) return <div className="crv-empty">No detail available.</div>;

  const { metadata, sanitization } = detail;

  return (
    <div className="crv">
      {toast && <div className="crv-toast">{toast}</div>}

      {/* Header */}
      <div className="crv-header">
        <span className="crv-type-badge">{detail.type}</span>
        <span className="crv-submitter">{detail.submitter}</span>
        <span className="crv-date">{formatDate(detail.submittedAt)}</span>
      </div>

      {/* Metadata */}
      <div className="crv-meta">
        {metadata.model && (
          <div className="crv-meta-item">
            <span className="crv-meta-label">Model:</span> {metadata.model}
          </div>
        )}
        {metadata.turnCount != null && (
          <div className="crv-meta-item">
            <span className="crv-meta-label">Turns:</span> {metadata.turnCount}
          </div>
        )}
        {metadata.taxonomyRefs && metadata.taxonomyRefs.length > 0 && (
          <div className="crv-meta-item">
            <span className="crv-meta-label">Refs:</span> {metadata.taxonomyRefs.join(', ')}
          </div>
        )}
        {detail.topic && (
          <div className="crv-meta-item">
            <span className="crv-meta-label">Topic:</span> {typeof detail.topic === 'string' ? detail.topic : String(detail.topic)}
          </div>
        )}
        {detail.note && (
          <div className="crv-meta-item">
            <span className="crv-meta-label">Note:</span> {detail.note}
          </div>
        )}
      </div>

      {/* Transcript preview */}
      <div className="crv-section-label">Preview</div>
      <div className="crv-preview">{detail.preview}</div>

      {/* Sanitization preview */}
      {(sanitization.willStrip.length > 0 || sanitization.willAdd.length > 0) && (
        <>
          <div className="crv-section-label">Sanitization</div>
          <div className="crv-sanit">
            {sanitization.willStrip.map((s, i) => (
              <div key={`strip-${i}`} className="crv-sanit-row crv-sanit-strip">
                <span className="crv-sanit-icon">&minus;</span> {s}
              </div>
            ))}
            {sanitization.willAdd.map((s, i) => (
              <div key={`add-${i}`} className="crv-sanit-row crv-sanit-add">
                <span className="crv-sanit-icon">+</span> {s}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Edit-on-promote */}
      <div className="crv-section-label">Edit before publishing</div>
      <div className="crv-edit-fields">
        <div className="crv-edit-field">
          <label>Title</label>
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
            placeholder={detail.title || 'Untitled'} />
        </div>
        <div className="crv-edit-field">
          <label>Description (optional)</label>
          <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
            placeholder="Add a description for the community library…" rows={2} />
        </div>
      </div>

      {/* Actions */}
      <div className="crv-actions">
        <button className="btn btn-sm btn-primary" onClick={() => void handlePromote()}
          disabled={busy !== null}>
          {busy === 'promote' ? 'Promoting…' : 'Promote'}
        </button>
        <input className="crv-reject-reason" value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
          placeholder="Rejection reason…" />
        <button className="btn btn-sm btn-danger" onClick={() => void handleReject()}
          disabled={busy !== null || !rejectReason.trim()}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </div>
  );
}
