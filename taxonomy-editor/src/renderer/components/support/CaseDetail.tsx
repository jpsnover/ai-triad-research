// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useState } from 'react';
import { api } from '@bridge';
import type { SupportCaseDetail as CaseDetailType } from '../../bridge/types';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import './CaseDetail.css';

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--color-info, #3b82f6)',
  'in-progress': 'var(--color-warning, #f59e0b)',
  resolved: 'var(--color-success, #22c55e)',
  closed: 'var(--text-muted, #94a3b8)',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: '● High',
  medium: '◐ Medium',
  low: '○ Low',
};

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

interface CaseDetailProps {
  detail: CaseDetailType;
}

export function CaseDetail({ detail }: CaseDetailProps) {
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());
  const urlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    for (const url of urlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    urlsRef.current.clear();
    setPreviewUrls(new Map());
  }, [detail.id]);

  const loadPreview = async (attachmentId: string) => {
    if (previewUrls.has(attachmentId)) return;
    try {
      const blob = (await api.downloadCaseAttachment(detail.id, attachmentId)) as Blob;
      const url = URL.createObjectURL(blob);
      urlsRef.current.set(attachmentId, url);
      setPreviewUrls(new Map(urlsRef.current));
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'case-detail',
        level: 'error',
        message: 'Failed to download attachment preview',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
    }
  };

  const statusColor = STATUS_COLORS[detail.status] ?? 'var(--text-muted)';

  return (
    <div className="support-case-detail-root">
      <h3 className="support-case-detail-title">{detail.subject}</h3>

      <div className="support-case-detail-meta-row">
        <span
          className="support-case-detail-status-badge"
          /* eslint-disable-next-line local/no-inline-style -- statusColor is a per-case dynamic value passed as a CSS custom property */
          style={{ '--status-color': statusColor } as React.CSSProperties}
        >
          {detail.status}
        </span>
        <span className="support-case-detail-meta-text">
          {PRIORITY_LABELS[detail.priority] ?? detail.priority}
        </span>
        <span className="support-case-detail-meta-text-sm">
          Created {formatDate(detail.createdAt)}
        </span>
        {detail.resolvedAt && (
          <span className="support-case-detail-meta-text-sm">
            Resolved {formatDate(detail.resolvedAt)}
          </span>
        )}
      </div>

      <div className="support-case-detail-description">{detail.description}</div>

      {/* System Info (collapsible) */}
      <div className="support-case-detail-section">
        <button
          className="btn btn-sm btn-ghost support-case-detail-toggle-btn"
          onClick={() => setShowSystemInfo(!showSystemInfo)}
        >
          {showSystemInfo ? '▼' : '▶'} System Info
        </button>
        {showSystemInfo && detail.systemInfo && (
          <div className="support-case-detail-sysinfo-box">
            <div>App: {detail.systemInfo.appVersion}</div>
            <div>Mode: {detail.systemInfo.deploymentMode}</div>
            <div>Browser: {detail.systemInfo.browser}</div>
            <div>OS: {detail.systemInfo.os}</div>
          </div>
        )}
      </div>

      {/* Attachments */}
      {detail.attachments.length > 0 && (
        <div className="support-case-detail-section">
          <h4 className="support-case-detail-section-title">
            Attachments ({detail.attachments.length})
          </h4>
          <div className="support-case-detail-attachment-list">
            {detail.attachments.map((att) => {
              const isImage = att.mimeType.startsWith('image/');
              const url = previewUrls.get(att.id);
              return (
                <div
                  key={att.id}
                  className="support-case-detail-attachment-item"
                >
                  <div className="support-case-detail-attachment-row">
                    <span className="support-case-detail-attachment-filename">{att.filename}</span>
                    <span className="support-case-detail-attachment-size">
                      {formatBytes(att.sizeBytes)}
                    </span>
                  </div>
                  {isImage && !url && (
                    <button
                      className="btn btn-sm btn-ghost support-case-detail-preview-btn"
                      onClick={() => void loadPreview(att.id)}
                    >
                      Show preview
                    </button>
                  )}
                  {isImage && url && (
                    <img
                      src={url}
                      alt={att.filename}
                      className="support-case-detail-preview-img"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Response timeline */}
      {detail.responses.length > 0 ? (
        <div>
          <h4 className="support-case-detail-section-title">
            Responses ({detail.responses.length})
          </h4>
          <div className="support-case-detail-response-list">
            {detail.responses.map((resp) => (
              <div
                key={resp.id}
                className="support-case-detail-response-item"
              >
                <div className="support-case-detail-response-meta">
                  {resp.authorId} &mdash; {formatDate(resp.createdAt)}
                </div>
                <div className="support-case-detail-response-body">{resp.body}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="support-case-detail-no-responses">
          No responses yet. We&rsquo;ll get back to you soon.
        </p>
      )}
    </div>
  );
}
