// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useState } from 'react';
import { POV_META, type PovMetaKey } from '@lib/electron-shared/povMeta';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { api } from '@bridge';
import './CommunityReviewViewer.css';

// ── Types ──

interface TranscriptEntry {
  speaker: string;
  content: string;
  type: string;
}

interface CommunityDetail {
  submissionId: string;
  type: string;
  submitter: string;
  submittedAt: string;
  note?: string;
  title?: string;
  topic?: string;
  preview: string;
  transcriptPreview?: TranscriptEntry[];
  metadata: {
    model?: string;
    turnCount?: number;
    phase?: string;
    audience?: string;
    activePovers?: string[];
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
  return api.adminReviewDetail(groupId) as Promise<CommunityDetail>;
}

async function postAction(body: Record<string, unknown>): Promise<void> {
  await api.adminReviewAction(body as Parameters<typeof api.adminReviewAction>[0]);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'CommunityReviewViewer', level: 'debug', message: 'Date format failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return iso;
  }
}

const SPEAKER_COLORS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(POV_META).map(([k, v]) => [k, v.color])),
  system: '#6b7280',
  user: '#8b5cf6',
};

const SPEAKER_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(POV_META).map(([k, v]) => [k, v.label])),
  system: 'System',
  user: 'User',
};

const INITIAL_VISIBLE = 10;

function TranscriptPreview({ entries }: { entries: TranscriptEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, INITIAL_VISIBLE);
  const hasMore = entries.length > INITIAL_VISIBLE;

  return (
    <div className="crv-transcript">
      {visible.map((entry, i) => (
        <div key={i} className="crv-transcript-entry">
          <span
            className="crv-transcript-speaker"
            // eslint-disable-next-line local/no-inline-style -- color keyed to debate speaker
            style={{ color: SPEAKER_COLORS[entry.speaker] ?? 'var(--text-secondary)' }}
          >
            {SPEAKER_LABELS[entry.speaker] ?? entry.speaker}
          </span>
          {entry.type !== 'statement' && entry.type !== 'opening' && (
            <span className="crv-transcript-type">{entry.type}</span>
          )}
          <div className="crv-transcript-content">{entry.content}</div>
        </div>
      ))}
      {hasMore && (
        <button
          className="btn btn-sm btn-ghost crv-transcript-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : `Show all ${entries.length} entries`}
        </button>
      )}
    </div>
  );
}

// ── Presentational sub-components (props in → JSX out) ──

function CommunityHeader({ detail }: { detail: CommunityDetail }) {
  return (
    <div className="crv-header">
      <span className="crv-type-badge">{detail.type}</span>
      <span className="crv-submitter">{detail.submitter}</span>
      <span className="crv-date">{formatDate(detail.submittedAt)}</span>
    </div>
  );
}

function CommunityMetadata({ detail }: { detail: CommunityDetail }) {
  const { metadata } = detail;
  return (
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
      {metadata.phase && (
        <div className="crv-meta-item">
          <span className="crv-meta-label">Phase:</span> {metadata.phase}
        </div>
      )}
      {metadata.audience && (
        <div className="crv-meta-item">
          <span className="crv-meta-label">Audience:</span> {metadata.audience}
        </div>
      )}
      {metadata.activePovers && metadata.activePovers.length > 0 && (
        <div className="crv-meta-item">
          <span className="crv-meta-label">Participants:</span>{' '}
          {metadata.activePovers.map(p => SPEAKER_LABELS[p] ?? p).join(', ')}
        </div>
      )}
      {metadata.taxonomyRefs && metadata.taxonomyRefs.length > 0 && (
        <div className="crv-meta-item">
          <span className="crv-meta-label">Refs:</span> {metadata.taxonomyRefs.join(', ')}
        </div>
      )}
      {detail.topic && (
        <div className="crv-meta-item crv-meta-topic">
          <span className="crv-meta-label">Topic:</span> {typeof detail.topic === 'string' ? detail.topic : String(detail.topic)}
        </div>
      )}
      {detail.note && (
        <div className="crv-meta-item">
          <span className="crv-meta-label">Note:</span> {detail.note}
        </div>
      )}
    </div>
  );
}

function TranscriptSection({ detail }: { detail: CommunityDetail }) {
  const hasTranscript = detail.transcriptPreview && detail.transcriptPreview.length > 0;
  return (
    <>
      <div className="crv-section-label">
        {hasTranscript ? `Transcript (${detail.transcriptPreview!.length} entries)` : 'Preview'}
      </div>
      {hasTranscript ? (
        <TranscriptPreview entries={detail.transcriptPreview!} />
      ) : detail.preview ? (
        <div className="crv-preview">{detail.preview}</div>
      ) : (
        <div className="crv-preview crv-preview-empty">No preview available — the submission data may use an unrecognized format.</div>
      )}
    </>
  );
}

function SanitizationSection({ sanitization }: { sanitization: CommunityDetail['sanitization'] }) {
  if (sanitization.willStrip.length === 0 && sanitization.willAdd.length === 0) return null;
  return (
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
  );
}

function EditFields({
  detail, editTitle, setEditTitle, editDescription, setEditDescription,
}: {
  detail: CommunityDetail;
  editTitle: string;
  setEditTitle: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
}) {
  return (
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
  );
}

function ActionButtons({
  busy, rejectReason, setRejectReason, onPromote, onReject,
}: {
  busy: 'promote' | 'reject' | null;
  rejectReason: string;
  setRejectReason: (v: string) => void;
  onPromote: () => void;
  onReject: () => void;
}) {
  return (
    <div className="crv-actions">
      <button className="btn btn-sm btn-primary" onClick={onPromote}
        disabled={busy !== null}>
        {busy === 'promote' ? 'Promoting…' : 'Promote'}
      </button>
      <input className="crv-reject-reason" value={rejectReason}
        onChange={e => setRejectReason(e.target.value)}
        placeholder="Rejection reason…" />
      <button className="btn btn-sm btn-danger" onClick={onReject}
        disabled={busy !== null || !rejectReason.trim()}>
        {busy === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
    </div>
  );
}

// ── Pure helpers ──

function buildEditsPayload(
  detail: CommunityDetail,
  editTitle: string,
  editDescription: string,
): Record<string, unknown> {
  const fields: Record<string, string> = {};
  if (editTitle && editTitle !== detail.title) fields.title = editTitle;
  if (editDescription) fields.description = editDescription;
  return Object.keys(fields).length > 0
    ? { edits: { [detail.submissionId]: fields } }
    : {};
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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
      const editsPayload = buildEditsPayload(detail, editTitle, editDescription);
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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
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

  const { sanitization } = detail;

  return (
    <div className="crv">
      {toast && <div className="crv-toast">{toast}</div>}

      {/* Header */}
      <CommunityHeader detail={detail} />

      {/* Metadata */}
      <CommunityMetadata detail={detail} />

      {/* Transcript / Preview */}
      <TranscriptSection detail={detail} />

      {/* Sanitization preview */}
      <SanitizationSection sanitization={sanitization} />

      {/* Edit-on-promote */}
      <div className="crv-section-label">Edit before publishing</div>
      <EditFields
        detail={detail}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
      />

      {/* Actions */}
      <ActionButtons
        busy={busy}
        rejectReason={rejectReason}
        setRejectReason={setRejectReason}
        onPromote={() => void handlePromote()}
        onReject={() => void handleReject()}
      />
    </div>
  );
}
